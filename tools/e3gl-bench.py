# -*- coding: utf-8 -*-
"""Замер: Canvas 2D против WebGL2 на одной и той же сцене (tools/e3gl-bench.py).

Гоняет N кадров одной сцены через E3.draw и через E3GL.draw в одном
браузере и печатает время.

ЧИТАТЬ РЕЗУЛЬТАТ ОСТОРОЖНО. Гейты гоняют Chrome с --disable-gpu, и там
видеокарта эмулируется программно (SwiftShader). GL в таком режиме
считает заливку на процессоре — ровно то, от чего мыtrying уйти. Поэтому
цифры здесь показывают честную разницу «с ускорением на процессоре»,
а НЕ реальную разницу «Canvas против видеокарты». На машине с настоящей
видеокартой разрыв в пользу GL заметно больше.

Смысл замера сейчас не в абсолютных числах, а в том, чтобы поймать
регрессию: если GL-путь вдруг станет медленнее 2D на той же сцене,
значит мы где-то напортачили с буферами.
"""
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

PROBE = r"""
<script>
(function () {
  function scene(n) {
    var F = [], i;
    for (i = 0; i < n; i++) {
      var x = (i % 40) * 1.6 - 32, z = ((i / 40) | 0) * 1.6 - 20;
      F.push.apply(F, E3.box(x, 0.5 + (i % 5) * 0.3, z, 1.2, 1 + (i % 3) * 0.5,
                             1.2, ["#ff7043", "#4fc3f7", "#81c784", "#ffd54f"][i % 4]));
    }
    F.push.apply(F, E3.quad([-40, 0, -30], [40, 0, -30], [40, 0, 30], [-40, 0, 30],
                            "#2e7d4f", [0, 1, 0]));
    return F;
  }
  var W = 640, H = 380, FRAMES = 40;

  function run(usingGL, faces) {
    var c = document.createElement("canvas");
    c.width = W; c.height = H; c._lw = W; c._lh = H;
    document.body.appendChild(c);
    var ctx = c.getContext("2d");
    var cam = { x: 0, y: 22, z: -34, yaw: 0.2, pitch: 0.5 };
    if (usingGL) {
      if (!E3GL.attach(ctx)) return null;
      E3GL.enable();
    }
    /* один прогрев, чтобы компиляция шейдера не попала в замер */
    if (usingGL) { E3GL.beginFrame("#111a2b", "#1d2b45"); E3GL.draw(ctx, faces, cam, 430, LIGHT3); }
    else { E3.draw(ctx, faces, cam, 430, LIGHT3); }

    var t0 = performance.now();
    for (var f = 0; f < FRAMES; f++) {
      if (usingGL) {
        E3GL.beginFrame("#111a2b", "#1d2b45");
        E3GL.draw(ctx, faces, cam, 430, LIGHT3);
      } else {
        E3.draw(ctx, faces, cam, 430, LIGHT3);
      }
    }
    var ms = (performance.now() - t0) / FRAMES;
    if (usingGL) E3GL.disable();
    return { ms: ms, st: E3GL.stats() };
  }

  var out = [];
  try {
    [500, 1500, 4000].forEach(function (n) {
      var faces = scene(n);
      var a = run(false, faces);
      var b = run(true, faces);
      out.push(n + " кубов | 2D " + a.ms.toFixed(1) + " мс | GL " +
               (b ? b.ms.toFixed(1) : "нет") + " мс | " +
               (b ? (a.ms / b.ms).toFixed(2) + "x" : "-"));
    });
  } catch (e) {
    out.push("исключение: " + e.message);
  }
  var pre = document.createElement("pre");
  pre.id = "bench"; pre.textContent = out.join("\n");
  document.body.appendChild(pre);
})();
</script>
"""

PAGE = """<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>замер 2D против GL</title>
<style>body{margin:0;background:#0e1420}</style></head><body>
<script src="src/engine/e3.js"></script>
<script src="src/engine/e3gl.js"></script>
</body></html>"""


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    w = shutil.which("chrome") or shutil.which("chromium")
    if w:
        return w
    sys.exit("Chrome/Edge не найден")


def main():
    tmp = os.path.join(ROOT, "_tmp_gl_bench.html")
    page = PAGE.replace("</body>", PROBE + "\n</body>")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    prof = tempfile.mkdtemp(prefix="nbglbench_")
    try:
        dom = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=900,700", "--virtual-time-budget=60000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass

    m = re.search(r'<pre id="bench"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("замер не отработал")
        return 1
    print("сцена | 2D | WebGL2 | выигрыш")
    print("-" * 58)
    for line in html.unescape(m.group(1)).strip().split("\n"):
        print(line)
    print("-" * 58)
    print("Chrome идёт с --disable-gpu: GL эмулируется на процессоре")
    print("(SwiftShader). На реальной видеокарте выигрыш выше.")
    return 0


if __name__ == "__main__":
    sys.exit(main())