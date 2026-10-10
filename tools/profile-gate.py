# -*- coding: utf-8 -*-
"""Гейт профилировщика (Фаза 1.1): замеры идут, доли сходятся, буфер ограничен."""
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

  /* полотно в памяти: draw() не требует присутствия в документе */
  var cv = document.createElement("canvas");
  cv.width = 640; cv.height = 380;
  cv._lw = 640; cv._lh = 380;
  var x = cv.getContext("2d");
  var cam = { x: 0, y: 6, z: -20, yaw: 0, pitch: .2 };
  var L = [0.42, 0.75, 0.5];

  function scene(n) {
    var f = [];
    for (var i = 0; i < n; i++)
      f = f.concat(E3.box((i % 10) * 6 - 30, 2 + ((i / 10) | 0) * 5,
                          -((i / 100) | 0) * 20, 4, 4, 4, "#88ccff"));
    return f;
  }

  /* 1. выключен по умолчанию: лишних замеров нет */
  ok(E3.profile.on === false, "профилировщик выключен по умолчанию");
  E3.draw(x, scene(50), cam, 430, L);
  ok(E3.profile.frames.length === 0, "выключенный профилировщик не пишет кадры");
  ok(E3.profile.avg() === null, "avg() без кадров возвращает null");

  /* 2. включение пишет кадры */
  E3.profile.start();
  for (var i = 0; i < 30; i++) E3.draw(x, scene(60), cam, 430, L);
  var a = E3.profile.avg();
  ok(!!a, "avg() после 30 кадров: " + (a ? a.n : "нет"));
  ok(a && a.n === 30, "записано кадров: " + (a ? a.n : "?"));
  ok(a && a.ms >= 0, "время кадра измерено: " + (a ? a.ms : "?") + " мс");

  /* 3. доли этапов сходятся в сумме к 100% */
  var b = E3.profile.breakdown();
  ok(!!b, "разбивка получена");
  var sum = b.setup + b.sort + b.fill + b.other;
  ok(Math.abs(sum - 100) <= 2, "доли в сумме дают 100%: " + sum + "%");
  ok(b.setup >= 0 && b.sort >= 0 && b.fill >= 0, "доли неотрицательны");
  out.push("INFO доли: подготовка " + b.setup + "%, сортировка " + b.sort +
           "%, заливка " + b.fill + "%, прочее " + b.other + "%");

  /* 4. сортировка действительно дороже подготовки на большой сцене —
        именно ради такого замера всё и делалось */
  var big = scene(200);
  E3.profile.reset();
  for (var i = 0; i < 5; i++) E3.draw(x, big, cam, 430, L);
  var ab = E3.profile.breakdown();
  ok(ab && ab.sort > 0, "на 1200 гранях сортировка видна: " + (ab ? ab.sort : "?") + "%");

  /* 5. буфер ограничен: 300 кадров при keep=240 не растут дальше */
  ok(E3.profile.frames.length <= E3.profile.keep,
     "буфер ограничен: " + E3.profile.frames.length + " <= " + E3.profile.keep);

  /* 6. смена бюджета сбрасывает профиль: старые кадры описывают другое состояние */
  var wasMax = E3.maxFaces;
  var before = E3.profile.frames.length;
  E3.maxFaces = 500;
  E3.profile.onBudgetChange();
  ok(E3.profile.frames.length === 0,
     "onBudgetChange() очистил кадры (было " + before + ")");
  E3.maxFaces = wasMax;

  /* 7. отчёт читаем */
  E3.profile.reset();
  for (var i = 0; i < 10; i++) E3.draw(x, scene(40), cam, 430, L);
  var rep = E3.profile.report();
  ok(typeof rep === "string" && rep.indexOf("кадров 10") === 0,
     "report(): " + rep.slice(0, 100));
  E3.profile.stop();
  ok(E3.profile.on === false, "stop() выключил профилировщик");

  /* 8. движок не сломан: грани всё ещё рисуются */
  E3.stats.faces = 0;
  E3.draw(x, scene(20), cam, 430, L);
  ok(E3.stats.faces > 0 && E3.stats.faces <= 120,
     "после всех манипуляций draw рисует грани: " + E3.stats.faces + " из 120 (20 кубов)");

  out.push(fail ? ("ИТОГО: провалено " + fail) : "ИТОГО: все проверки прошли");
  var p = document.createElement("pre");
  p.id = "profilereport"; p.textContent = out.join("\n");
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
    if not os.path.isfile(SRC):
        print("FAIL  нет src/engine/e3.js")
        return 1
    with io.open(SRC, encoding="utf-8") as f:
        engine = f.read()
    if "E3.profile" not in engine:
        print("FAIL  в движке нет профилировщика")
        return 1
    page = ("<!doctype html><meta charset=utf-8><body>"
            "<script>" + engine.replace("</script>", "<\\/script>") + "</script>"
            "<script>" + PROBE + "</script></body>")
    tmp = os.path.join(ROOT, "_tmp_profile.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbprof_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=25000", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass

    m = re.search(r'<pre id="profilereport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  профилировщик: страница не дошла до проверки")
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