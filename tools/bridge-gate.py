# -*- coding: utf-8 -*-
"""Гейт моста: игра на BloomScript запускается в приложении (Фаза 0.3).

Проверяет то, что увидит пользователь на свежей загрузке:
  1. код игры лежит в localStorage ДО старта страницы,
  2. в лобби появилась плитка «своя игра»,
  3. клик по плитке запускает игру,
  4. игра рисует кадр и остаётся в состоянии «идёт».

Отдельным файлом, а не частью run-tests.py: страница тяжёлая, а гейт
нужен не на каждый прогон, а перед тем, как отдать мост в работу.
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile

import io

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")

GAME = '''// Прыгающий кубик
let px = 0
let py = 0
let vy = 0

fn setup():
    bg("#1b2a4a", "#0d1526")
    camera(0, 6, -22, 0, 0.25)
    ground(60, 120, "#2e7d4f")

fn update(dt):
    if key(KEY_LEFT): px = px - 14 * dt
    if key(KEY_RIGHT): px = px + 14 * dt
    if px < -22: px = -22
    if px > 22: px = 22
    if py > 0 or vy > 0:
        vy = vy - 34 * dt
        py = py + vy * dt
        if py <= 0:
            py = 0
            vy = 0
            if keyhit(KEY_SPACE): vy = 12

fn draw():
    box(px, 3 + py, 0, 6, 6, 6, "#ff5d8f")
    shadow(px, 0, 4, 3 + py)
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
    var cards = document.querySelectorAll(".ugame-card").length;
    out.push("плиток «своя игра» в лобби: " + cards);
    if (!cards) { finish(false); return; }
    document.querySelector(".ugame-card").click();
    setTimeout(function () {
      var cv = document.querySelector(".playfield");
      if (!cv) { out.push("полотно режима не найдено"); finish(false); return; }
      var px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      var lit = 0;
      for (var i = 0; i < px.length; i += 4)
        if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 40) lit++;
      out.push("нарисовано пикселей: " + lit);
      var info = document.getElementById("ugInfo");
      out.push("состояние: " + (info ? info.textContent : "нет #ugInfo"));
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
    w = shutil.which("chrome") or shutil.which("chromium")
    if w:
        return w
    sys.exit("Chrome/Edge не найден")


def main():
    chrome = find_chrome()
    src_json = GAME.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    seed = SEED.replace("%SRC%", '"' + src_json + '"')

    with io.open(INDEX, encoding="utf-8") as f:
        page = f.read()
    tag = '<script src="src/engine/e3.js"></script>'
    if tag not in page:
        sys.exit("в index.html нет подключения движка")
    page = page.replace(tag, "<script>" + seed + "</script>\n" + tag, 1)

    tmp = os.path.join(ROOT, "_tmp_bridge_gate.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page.replace("</body>", "<script>" + PROBE + "</script>\n</body>"))

    prof = tempfile.mkdtemp(prefix="nbbridge_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1280,900", "--virtual-time-budget=25000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass

    m = re.search(r'<pre id="bridgereport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  мост: страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1

    txt = html.unescape(m.group(1))
    for line in txt.strip().split("\n"):
        print("      " + line.strip()[:120])
    return 0 if txt.rstrip().endswith("PASS") else 1


if __name__ == "__main__":
    sys.exit(main())