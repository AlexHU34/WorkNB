# -*- coding: utf-8 -*-
"""Гейт сейвов: сохранённое игроком не пропадает и читается правильно.

Две казны, обе проверяются честно:
  * приложение — монеты, ник, достижения и работы кладём в хранилище так,
    как их оставила прошлая сессия, и открываем страницу с диска: всё
    должно появиться на своих местах и не обнулиться;
  * студия — сцена собирается, сохраняется и читается обратно: число
    предметов и название должны вернуться теми же.

Обрыв на середине сохранения или «умная» чистка хранилища при старте
раньше стирали работы молча — этот гейт замечает такое сразу.
"""
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "dist", "min", "Aeris.html")
STUDIO = os.path.join(ROOT, "dist", "min", "AerisStudio.html")

SEED = r"""
(function(){
  var put = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  put("bb2_theme", "light");
  put("bb2_seen", "true");
  put("bb2_sound", "false");
  put("bb2_coins", "777");
  put("bb2_name", "Сейв");
  put("bb2_ach", JSON.stringify(["star3", "rich", "first", "streak"]));
  put("bb2_works", JSON.stringify([
    { game: 1, emoji: "🌼", n: 3, stars: 3, date: "01.01.2026" }
  ]));
  put("bb2_ugames.v1", JSON.stringify([
    { id: 901, title: "Сохранёнка", src: "fn draw():\n    box(0, 1, 0, 2, 2, 2, \"#ff7043\")" }
  ]));
})();
"""

APP_PROBE = r"""
(function(){
  var out = [];
  var d = document.createElement("pre");
  d.id = "savereport";
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    d.textContent = out.join("\n");
    document.body.appendChild(d);
  }
  try {
    var wait = function (n) {
      setTimeout(function () {
        var coins = document.getElementById("coins");
        var works = document.getElementById("wCount");
        var cards = document.querySelectorAll(".ugame-card").length;
        out.push("монеты на виду: " + (coins ? coins.textContent : "нет"));
        out.push("работ на виду: " + (works ? works.textContent : "нет"));
        out.push("плиток «своя игра»: " + cards);
        var saved = null;
        try { saved = localStorage.getItem("bb2_coins"); } catch (e) {}
        out.push("в хранилище монет: " + saved);
        var ach = null;
        try { ach = localStorage.getItem("bb2_ach"); } catch (e) {}
        out.push("достижения целы: " + (ach && JSON.parse(ach).length === 4));
        var ok = coins && coins.textContent.indexOf("777") >= 0 &&
                 works && works.textContent === "1" &&
                 cards >= 1 && saved === "777" &&
                 ach && JSON.parse(ach).length === 4;
        finish(ok);
      }, 1600);
    };
    wait(0);
  } catch (e) {
    out.push("падение: " + e.message);
    finish(false);
  }
})();
"""

STUDIO_PROBE = r"""
(function(){
  var out = [];
  var d = document.createElement("pre");
  d.id = "savereport";
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    d.textContent = out.join("\n");
    document.body.appendChild(d);
  }
  try {
    if (!window.Studio) { out.push("студии нет"); finish(false); return; }
    var sc = Studio.normalize(null);
    sc.title = "Сейв-сцена";
    Studio.addObject(sc, "box");
    Studio.addObject(sc, "pyramid");
    Studio.save(sc);
    var raw = null;
    try { raw = localStorage.getItem("bb2_studio_scene.v1"); } catch (e) {}
    if (!raw) { out.push("сцена не легла в хранилище"); finish(false); return; }
    var back = JSON.parse(raw);
    out.push("в хранилище предметов: " + back.objects.length);
    out.push("название: " + back.title);
    var loaded = Studio.load();
    out.push("прочитано предметов: " + (loaded && loaded.objects ? loaded.objects.length : "нет"));
    out.push("прочитанное название: " + (loaded && loaded.title));
    var ok = back.objects.length === 2 && back.title === "Сейв-сцена" &&
             loaded && loaded.objects.length === 2 &&
             loaded.title === "Сейв-сцена";
    finish(ok);
  } catch (e) {
    out.push("падение: " + e.message);
    finish(false);
  }
})();
"""


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    return shutil.which("chrome") or shutil.which("chromium")


def run_chrome(chrome, path, budget=15000):
    prof = tempfile.mkdtemp(prefix="nbsave_")
    try:
        return subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1280,900", "--virtual-time-budget=" + str(budget),
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + path.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def probe_report(dom):
    m = re.search(r'<pre id="savereport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        return None
    txt = html.unescape(m.group(1))
    for line in txt.strip().splitlines():
        print("      " + line.strip()[:120])
    return txt.strip().endswith("PASS")


def build_page(src, probe, seed=None):
    page = io.open(src, encoding="utf-8").read()
    if seed:
        pos = page.find("<body")
        if pos < 0:
            page = "<script>" + seed + "</script>\n" + page
        else:
            br = page.find(">", pos)
            page = page[:br + 1] + "<script>" + seed + "</script>" + page[br + 1:]
    pos = page.rfind("</body>")
    tail = "<script>" + probe + "</script>\n"
    page = page[:pos] + tail + page[pos:] if pos >= 0 else page + tail
    return page


def main():
    for f in (APP, STUDIO):
        if not os.path.isfile(f):
            print("FAIL  нет %s — сначала python build.py" % os.path.basename(f))
            return 1
    chrome = find_chrome()
    if not chrome:
        print("FAIL  Chrome/Edge не найден")
        return 1

    rc = 0
    tmp = tempfile.mkdtemp(prefix="nbsaves_")
    try:
        print("=== ПРИЛОЖЕНИЕ: СЕЙВ ПРОШЛОЙ СЕССИИ ===")
        p = os.path.join(tmp, "app.html")
        with io.open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(build_page(APP, APP_PROBE, SEED))
        ok = probe_report(run_chrome(chrome, p))
        if ok is None:
            print("  FAIL  страница не дошла до проверки")
            rc = 1
        elif not ok:
            rc = 1

        print("")
        print("=== СТУДИЯ: КРУГ «СОХРАНИЛ — ПРОЧИТАЛ» ===")
        p = os.path.join(tmp, "studio.html")
        with io.open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(build_page(STUDIO, STUDIO_PROBE))
        ok = probe_report(run_chrome(chrome, p))
        if ok is None:
            print("  FAIL  страница не дошла до проверки")
            rc = 1
        elif not ok:
            rc = 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("")
    print("ИТОГ: " + ("все проверки прошли" if rc == 0 else "есть провалы"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
