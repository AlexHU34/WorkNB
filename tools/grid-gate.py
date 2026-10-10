# -*- coding: utf-8 -*-
"""Гейт сетки отсечения (Фаза 1.2): картинка не меняется, работы меньше.

Главная проверка — не количество граней, а ПИКСЕЛИ: сетка отсечения обязана
рисовать ровно то же, что линейный путь. Иначе это не ускорение, а порча.
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
SRC = os.path.join(ROOT, "src", "engine", "e3.js")

PROBE = r'''
(function(){
  var out = [], fail = 0;
  function ok(c, m) { if (!c) fail++; out.push((c ? "OK   " : "FAIL ") + m); }

  var cv = document.createElement("canvas");
  cv.width = 640; cv.height = 380; cv._lw = 640; cv._lh = 380;
  var L = [0.42, 0.75, 0.5];
  /* Сцена: 20x20 кубов вдоль Z. Камера стоит ВНУТРИ сцены и смотрит вперёд —
     позади неё половина мира. Именно этот случай и выигрывает от сетки:
     когда всё впереди, отсекать нечего, и это честно. */
  var cam = { x: 0, y: 20, z: 300, yaw: 0, pitch: 0.15 };
  var faces = [];
  for (var i = 0; i < 400; i++) {
    var gx = i % 20, gz = (i / 20) | 0;
    faces = faces.concat(E3.box(gx * 8 - 80, 2, gz * 40, 6, 4, 6, "#88ccff"));
  }
  faces.push(E3.sprite(0, 20, 400, 24, "A", "#fff"));
  out.push("INFO сцена: " + faces.length + " объектов задано");

  function render(flag) {
    E3.grid.clear();
    E3.grid.use = flag;
    if (flag) E3.grid.build(faces, 16);
    var c2 = cv.getContext("2d");
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.clearRect(0, 0, cv.width, cv.height);
    c2.fillStyle = "#000";
    c2.fillRect(0, 0, cv.width, cv.height);
    E3.draw(c2, faces, cam, 430, L);
    return {
      tested: E3.stats.tested,
      faces: E3.stats.faces,
      culled: E3.stats.culled,
      px: c2.getImageData(0, 0, cv.width, cv.height).data
    };
  }

  /* 1. линейный путь (по умолчанию) */
  var lin = render(false);
  ok(lin.faces > 0, "линейный путь нарисовал граней: " + lin.faces);
  ok(lin.tested === faces.length, "линейный путь проверил все: " + lin.tested);

  /* 2. сетка построена */
  var buckets = E3.grid.build(faces, 16);
  ok(buckets > 0, "сетка построена, ячеек: " + buckets);
  ok(E3.grid.nx >= 1 && E3.grid.ny >= 1 && E3.grid.nz >= 1,
     "размеры сетки: " + E3.grid.nx + "x" + E3.grid.ny + "x" + E3.grid.nz);

  /* 3. сетка рисует ту же картинку.
     ВАЖНО: число граней у сетки МЕНЬШЕ и это правильно. Линейный путь
     проецирует грани за краями экрана вхолостую и кладёт их в items —
     они не видны, но стоят работы. Сетка отсекает их по плоскостям пирамиды
     заранее. Значит верное условие — «не больше», а не «столько же». */
  var gr = render(true);
  ok(gr.faces <= lin.faces, "сетка рисует не больше граней: " +
     gr.faces + " против " + lin.faces);
  ok(gr.tested < lin.tested,
     "сетка проверяет меньше граней: " + gr.tested + " против " + lin.tested);
  out.push("INFO экономия проверок: " +
           Math.round((1 - gr.tested / lin.tested) * 100) + "%, " +
           "лишних граней отсечено: " + (lin.faces - gr.faces));

  /* 4. пиксели совпадают — это главная проверка */
  var diff = 0;
  for (var i = 0; i < lin.px.length; i += 4)
    if (lin.px[i] !== gr.px[i] || lin.px[i+1] !== gr.px[i+1] || lin.px[i+2] !== gr.px[i+2]) diff++;
  ok(diff === 0, "картинка идентична, отличающихся пикселей: " + diff);

  /* 5. пустая и мелкая сцена не ломают сетку */
  E3.grid.clear();
  ok(E3.grid.build([], 16) === 0, "пустая сцена: ячеек 0");
  var small = E3.box(0, 0, 0, 1, 1, 1, "#fff");
  E3.grid.build(small, 16);
  ok(E3.grid.cells !== null, "мелкая сцена построена без ошибок");

  /* 6. minFaces: на мелкой сцене сетка не включается */
  E3.grid.use = true;
  E3.grid.clear();
  E3.grid.build(small, 16);
  var x = cv.getContext("2d");
  x.clearRect(0, 0, cv.width, cv.height);
  E3.draw(x, small, cam, 430, L);
  ok(E3.stats.tested === small.length,
     "на сцене меньше minFaces проверяем всё: " + E3.stats.tested);
  E3.grid.use = false;
  E3.grid.clear();

  out.push(fail ? ("ИТОГО: провалено " + fail) : "ИТОГО: все проверки прошли");
  var p = document.createElement("pre");
  p.id = "gridreport"; p.textContent = out.join("\n");
  document.body.appendChild(p);
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
    with io.open(SRC, encoding="utf-8") as f:
        engine = f.read()
    if "E3.grid" not in engine:
        print("FAIL  в движке нет сетки отсечения")
        return 1
    page = ("<!doctype html><meta charset=utf-8><body>"
            "<script>" + engine.replace("</script>", "<\\/script>") + "</script>"
            "<script>" + PROBE + "</script></body>")
    tmp = os.path.join(ROOT, "_tmp_grid.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbgrid_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=40000", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass

    m = re.search(r'<pre id="gridreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  сетка: страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    rc = 0
    for line in html.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith("FAIL"):
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())