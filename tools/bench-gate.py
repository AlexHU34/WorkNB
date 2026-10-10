# -*- coding: utf-8 -*-
"""Бенчмарк интерпретатора и движка (Фаза 5).

Смысл — заменить ощущение «медленно» цифрами и увидеть, оправдана ли
следующая оптимизация (байткод). Без замеров любое утверждение о скорости
 guess, а не факт.

Что меряем:
  * интерпретатор: пустой цикл, арифметика, вызовы функций, строки,
    массивы — в миллионах операций в секунду;
  * движок: кадр на разном числе граней (100 / 1000 / 5000);
  * сетку отсечения: тот же кадр с ней и без.
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
CORE = os.path.join(ROOT, "src", "lang", "core.js")
ENGINE = os.path.join(ROOT, "src", "engine", "e3.js")

PROBE = r'''
(function(){
  var out = [];

  var HOST = {
    loadModule: function () { return null; },
    setNativeMember: function (o, k, v) { o[k] = v; },
    nativeMember: function (o, n) { return o[n]; },
    call: function (n, env, I) { return I.eval(n.callee, env); }
  };
  var I = new Interp(HOST);
  I.globals = new Env(null);
  I.globals.declare("PI", Math.PI, true);
  /* Минимальный набор NAT, без которого не собрать тесты: страница
     бенчмарка поднимает только интерпретатор, без игровой среды. */
  I.globals.declare("str", function (v) { return v === null || v === undefined ? "" : String(v); }, false);
  I.globals.declare("push", function (a, v) { a.push(v); return a.length; }, false);
  I.globals.declare("print", function () {}, false);

  function bench(name, src, iters) {
    var ast = parse(src);
    var env = new Env(I.globals);
    /* прогрев: первый запуск трогает ленивые ветки */
    I.steps = 0; I.maxSteps = 1e9; I.run(ast, env);
    var t0 = performance.now();
    I.steps = 0; I.run(ast, env);
    var ms = performance.now() - t0;
    out.push("ИНТЕРП " + name + ": " + ms.toFixed(2) + " мс  (" +
             iters + " итераций, " + Math.round(ms > 0 ? iters / ms * 1000 : 0) +
             " тыс/с)");
    return ms;
  }

  bench("пустой цикл 1e6", "let i = 0\nfor i in 0..1000000:\n    i = i + 0\n", 1000000);
  bench("арифметика 1e6", "let s = 0\nfor i in 0..1000000:\n    s = s + i * 2 - 1\n", 1000000);
  bench("вызов функции 2e5", "fn f(n):\n    return n + 1\nlet s = 0\nfor i in 0..200000:\n    s = f(s)\n", 200000);
  bench("строка 1e5", "let s = \"\"\nfor i in 0..100000:\n    s = str(i)\n", 100000);
  bench("массив 1e5", "let a = []\nfor i in 0..100000:\n    a.push(i)\n", 100000);

  /* --- движок --- */
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
  function drawBench(name, faces, useGrid) {
    E3.grid.clear();
    E3.grid.use = false;
    E3.draw(x, faces, cam, 430, L);
    if (useGrid) { E3.grid.build(faces, 16); E3.grid.use = true; }
    var t0 = performance.now();
    var FR = 12;
    for (var i = 0; i < FR; i++) E3.draw(x, faces, cam, 430, L);
    var ms = (performance.now() - t0) / FR;
    out.push("ДВИЖ " + name + (useGrid ? " (сетка)" : " (линейно)") +
             ": " + ms.toFixed(2) + " мс/кадр, нарисовано " + E3.stats.faces);
    E3.grid.use = false;
    E3.grid.clear();
    return ms;
  }
  var s100 = scene(100), s1000 = scene(1000), s5000 = scene(5000);
  var a = drawBench("100 граней", s100, false);
  var b = drawBench("1000 граней", s1000, false);
  var c = drawBench("5000 граней", s5000, false);
  var b2 = drawBench("1000 граней", s1000, true);
  out.push("СЕТКА дала выигрыш: " +
           (b2 < b ? "да, " + Math.round((1 - b2 / b) * 100) + "% быстрее"
                    : "нет (медленнее на " + Math.round((b2 / b - 1) * 100) + "%)"));

  /* профилировщик: где именно уходит кадр */
  E3.profile.start();
  for (var i = 0; i < 10; i++) E3.draw(x, s1000, cam, 430, L);
  out.push("ПРОФИЛЬ " + E3.profile.report());
  E3.profile.stop();

  var d = document.createElement("pre");
  d.id = "bench"; d.textContent = out.join("\n");
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
    with io.open(CORE, encoding="utf-8") as f:
        core = f.read()
    with io.open(ENGINE, encoding="utf-8") as f:
        eng = f.read()
    page = ("<!doctype html><meta charset=utf-8><body>"
            "<script>" + core.replace("</script>", "<\\/script>") + "</script>"
            "<script>" + eng.replace("</script>", "<\\/script>") + "</script>"
            "<script>try{" + PROBE + "}catch(e){var d=document.createElement('pre');"
            "d.id='bench';d.textContent='ИСКЛЮЧЕНИЕ: '+e.message+' @ '+String(e.stack||'').slice(0,300);"
            "document.body.appendChild(d);}</script></body>")
    tmp = os.path.join(ROOT, "_tmp_bench.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbbench_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=120000", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        os.remove(tmp)
    m = re.search(r'<pre id="bench"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  бенчмарк не отработал")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    for line in html.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:150])
    return 0


if __name__ == "__main__":
    sys.exit(main())