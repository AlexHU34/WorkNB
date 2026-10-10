# -*- coding: utf-8 -*-
"""Гейт офлайн-сборки: dist/NebulaBloom.html работает один, без каталога src/.

Смысл проверки: приложение обязано запускаться двойным кликом по одному файлу.
Если сборка тянет внешние скрипты, она не самостоятельна. Проверяем честно —
копируем dist в отдельную папку, src рядом не кладём, гоняем игру на BloomScript.
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
DIST = os.path.join(ROOT, "dist", "NebulaBloom.html")

GAME = '''// Прыгающий кубик
let px = 0
let py = 0

fn setup():
    bg("#1b2a4a", "#0d1526")
    camera(0, 6, -22, 0, 0.25)
    ground(60, 120, "#2e7d4f")

fn update(dt):
    if key(KEY_LEFT): px = px - 14 * dt
    if key(KEY_RIGHT): px = px + 14 * dt
    if py > 0:
        py = py - 30 * dt
        if py <= 0: py = 0

fn draw():
    box(px, 3 + py, 0, 6, 6, 6, "#ff5d8f")
    text(12, 24, "Прыгай пробелом", 18, "#ffffff")
'''

SEED = ('(function(){try{localStorage.setItem("bb2_ugames.v1",JSON.stringify(['
        '{id:1,title:"Прыгающий кубик",src:%SRC%}]));}catch(e){}})();')

PROBE = '''
(function(){
  var out = [];
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    var d = document.createElement("pre");
    d.id = "bridgereport";
    d.textContent = out.join("\\n");
    document.body.appendChild(d);
  }
  try {
    if (typeof E3 !== "object") { out.push("движок не загрузился"); finish(false); return; }
    out.push("движок встроен: методов " + Object.keys(E3).length);
    var cards = document.querySelectorAll(".ugame-card").length;
    out.push("плиток «своя игра»: " + cards);
    if (!cards) { finish(false); return; }
    document.querySelector(".ugame-card").click();
    setTimeout(function () {
      var cv = document.querySelector(".playfield");
      if (!cv) { out.push("полотно не найдено"); finish(false); return; }
      var px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      var lit = 0;
      for (var i = 0; i < px.length; i += 4)
        if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 40) lit++;
      out.push("нарисовано пикселей: " + lit);
      var info = document.getElementById("ugInfo");
      out.push("состояние: " + (info ? info.textContent : "нет"));
      finish(lit > 1000 && !!info && info.textContent === "идёт");
    }, 1400);
  } catch (e) {
    out.push("исключение: " + e.message);
    finish(false);
  }
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
    if not os.path.isfile(DIST):
        print("FAIL  нет dist/NebulaBloom.html — сначала python build.py")
        return 1
    chrome = find_chrome()
    if not chrome:
        print("FAIL  Chrome/Edge не найден")
        return 1

    box_dir = tempfile.mkdtemp(prefix="nbdist_")
    target = os.path.join(box_dir, "NebulaBloom.html")
    shutil.copy2(DIST, target)

    src_json = GAME.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    seed = SEED.replace("%SRC%", '"' + src_json + '"')

    with io.open(target, encoding="utf-8") as f:
        page = f.read()
    left = re.findall(r'<script src="([^"]+)"', page)
    if left:
        print("FAIL  в сборке остались внешние скрипты: " + ", ".join(left))
        shutil.rmtree(box_dir, ignore_errors=True)
        return 1

    page = page.replace("<body>", "<body>\n<script>" + seed + "</script>", 1)
    page = page.replace("</body>", "<script>" + PROBE + "</script>\n</body>")
    with io.open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    prof = tempfile.mkdtemp(prefix="nbprof_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1280,900", "--virtual-time-budget=25000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + target.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        shutil.rmtree(box_dir, ignore_errors=True)

    m = re.search(r'<pre id="bridgereport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  сборка: страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    txt = html.unescape(m.group(1))
    for line in txt.strip().split("\n"):
        print("      " + line.strip()[:120])
    return 0 if txt.rstrip().endswith("PASS") else 1


if __name__ == "__main__":
    sys.exit(main())