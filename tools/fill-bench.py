# -*- coding: utf-8 -*-
"""Микрозамер заливки: где именно уходят 74% кадра.

Гипотезы, которые проверяем по одной:
  A. createLinearGradient на каждую грань — создание объекта градиента дорого;
  B. stroke() после fill() удваивает работу по контуру;
  C. сам fill полигона неплох, и виноват вкладок.

Меряем на одинаковой сцене, меняя только заливку.
"""
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, "src", "engine", "e3.js")

PROBE = r'''
(function(){
  var out = [];
  var cv = document.createElement("canvas");
  cv.width = 640; cv.height = 380; cv._lw = 640; cv._lh = 380;
  var x = cv.getContext("2d");
  var cam = { x: 0, y: 20, z: 300, yaw: 0, pitch: 0.15 };
  var L = [0.42, 0.75, 0.5];

  function scene(n) {
    var f = [];
    for (var i = 0; i < n; i++) {
      var gx = i % 20, gz = (i / 20) | 0;
      f = f.concat(E3.box(gx * 8 - 80, 2, gz * 8 + 100, 6, 4, 6, "#88ccff"));
    }
    return f;
  }

  /* Один и тот же кадр, три варианта отрисовки. Грани берём из движка,
     а заливку делаем сами — так видно цену каждой операции. */
  function render(faces, mode) {
    var items = [];
    for (var i = 0; i < faces.length; i++) {
      var f = faces[i];
      if (f.k) continue;
      var pv = [];
      var behind = false;
      for (var k = 0; k < 4; k++) {
        var q = E3.view(f.v[k], cam);
        if (q[2] < 0.15) behind = true;
        pv.push(E3.proj(q, 430, 640, 380));
      }
      if (behind) continue;
      items.push({ d: pv[0][2], p: pv });
    }
    items.sort(function (a, b) { return b.d - a.d; });

    x.fillStyle = "#000"; x.fillRect(0, 0, 640, 380);
    var t0 = performance.now();
    for (var n = 0; n < items.length; n++) {
      var P = items[n].p;
      if (mode === "flat") {
        x.fillStyle = "#88ccff";
      } else if (mode === "grad") {
        var g = x.createLinearGradient(0, P[0][1], 0, P[0][1] + 4);
        g.addColorStop(0, "#a8d8ff");
        g.addColorStop(1, "#5a9ad8");
        x.fillStyle = g;
      } else if (mode === "grad-nofill") {
        var g2 = x.createLinearGradient(0, P[0][1], 0, P[0][1] + 4);
        g2.addColorStop(0, "#a8d8ff");
        g2.addColorStop(1, "#5a9ad8");
        x.fillStyle = g2;
      }
      x.beginPath(); x.moveTo(P[0][0], P[0][1]);
      for (var k = 1; k < P.length; k++) x.lineTo(P[k][0], P[k][1]);
      x.closePath();
      if (mode !== "grad-nofill") x.fill();
      if (mode === "grad-stroke") { x.strokeStyle = "rgba(10,10,25,.25)"; x.lineWidth = 1; x.stroke(); }
    }
    var ms = performance.now() - t0;
    return { ms: ms, n: items.length };
  }

  var faces = scene(800);
  /* прогрев */
  render(faces, "flat"); render(faces, "grad"); render(faces, "grad-stroke");

  var FR = 15;
  var modes = ["flat", "grad", "grad-nofill", "grad-stroke"];
  var res = {};
  for (var m = 0; m < modes.length; m++) {
    var total = 0, cnt = 0;
    for (var f = 0; f < FR; f++) { var r = render(faces, modes[m]); total += r.ms; cnt = r.n; }
    res[modes[m]] = total / FR;
    out.push("ЗАЛИВКА " + modes[m] + ": " + (total / FR).toFixed(2) + " мс на " + cnt + " граней");
  }
  out.push("ГРАДИЕНТ стоит: " + (res.grad - res.flat).toFixed(2) + " мс");
  out.push("ОБВОДКА стоит: " + (res["grad-stroke"] - res.grad).toFixed(2) + " мс");
  out.push("САМА ЗАЛИВКА (без создания градиента): " + res.flat.toFixed(2) + " мс");

  /* для сравнения: полный кадр движка сейчас */
  E3.grid.clear(); E3.grid.use = false;
  E3.draw(x, faces, cam, 430, L);
  var t1 = performance.now();
  for (var f = 0; f < FR; f++) E3.draw(x, faces, cam, 430, L);
  out.push("ДВИЖОК целиком: " + ((performance.now() - t1) / FR).toFixed(2) + " мс/кадр");

  var d = document.createElement("pre");
  d.id = "fill"; d.textContent = out.join("\n");
  document.body.appendChild(d);
})();
'''


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    return shutil.which("chrome") or shutil.which("chromium")


def main():
    with io.open(ENGINE, encoding="utf-8") as f:
        eng = f.read()
    page = ("<!doctype html><meta charset=utf-8><body><script>"
            + eng.replace("</script>", "<\\/script>")
            + "</script><script>try{" + PROBE + "}catch(e){var d=document.createElement('pre');"
            "d.id='fill';d.textContent='ИСКЛЮЧЕНИЕ: '+e.message+' @ '+String(e.stack||'').slice(0,250);"
            "document.body.appendChild(d);}</script></body>")
    tmp = os.path.join(ROOT, "_tmp_fill.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbfill_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=60000", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        os.remove(tmp)
    m = re.search(r'<pre id="fill"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  замер не отработал")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    for line in html.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
    return 0


if __name__ == "__main__":
    sys.exit(main())