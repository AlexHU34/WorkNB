# -*- coding: utf-8 -*-
"""Гейт полного круга: редактор -> приложение -> редактор (Фаза 0.3).

Оба файла общего origin, поэтому localStorage общий — как у пользователя.
Проверяем цепочку целиком:
  1. кнопка «Опубликовать» кладёт код в bb2_ugames.v1,
  2. приложение показывает плитку «своя игра» в лобби,
  3. клик по плитке запускает игру, кадр рисуется,
  4. кнопка «Редактор» в игре передаёт код обратно в редактор.

Функции публикации берём из lang.html и подставляем в страницу приложения:
так гейт проверяет настоящий код, а не его копию.
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
LG = os.path.join(ROOT, "lang.html")
INDEX = os.path.join(ROOT, "index.html")

GAME = '''// Мой тест
let x = 0

fn setup():
    bg("#22304a", "#0f1626")
    camera(0, 6, -20, 0, 0.2)
    ground(50, 100, "#3a7d4f")

fn update(dt):
    if key(KEY_RIGHT): x = x + 12 * dt
    if x > 20: x = -20

fn draw():
    box(x, 3, 0, 6, 6, 6, "#7dd3fc")
    text(12, 24, "Опубликовано из редактора", 18, "#ffffff")
'''

FUNCS = ["publishToApp", "ugLoad", "ugSave", "ugTitle", "ugFileName",
         "ugCurrentId", "ugAdoptFromApp"]

PROBE = '''
(function(){
  var out = [];
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    var d = document.createElement("pre");
    d.id = "roundreport";
    d.textContent = out.join("\\n");
    document.body.appendChild(d);
  }
  function litOf(sel) {
    var cv = document.querySelector(sel);
    if (!cv) return -1;
    var px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    var n = 0;
    for (var i = 0; i < px.length; i += 4)
      if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 40) n++;
    return n;
  }
  try {
    localStorage.removeItem("bb2_ugames.v1");

    var pub = document.getElementById("actPublish");
    out.push("кнопка «Опубликовать»: " + (pub ? "есть" : "НЕТ"));
    if (!pub) { finish(false); return; }
    ed.value = %SRC%;
    pub.click();

    var stored = JSON.parse(localStorage.getItem("bb2_ugames.v1") || "[]");
    out.push("записей в bb2_ugames.v1: " + stored.length);
    if (!stored.length) {
      out.push("консоль редактора: " + (_printed || []).slice(-2).join(" | "));
      finish(false); return;
    }
    out.push("название из комментария: " + stored[0].title);

    renderLobby(false);
    var cards = document.querySelectorAll(".ugame-card").length;
    out.push("плиток «своя игра» в лобби: " + cards);
    if (!cards) { finish(false); return; }

    document.querySelector(".ugame-card").click();
    setTimeout(function () {
      var lit = litOf(".playfield");
      out.push("нарисовано пикселей: " + lit);
      var info = document.getElementById("ugInfo");
      out.push("состояние игры: " + (info ? info.textContent : "нет"));
      if (lit < 1000 || !info || info.textContent !== "идёт") { finish(false); return; }

      document.getElementById("ugEdit").click();
      var id = localStorage.getItem("bb2_ugame_to_edit");
      out.push("игра передана на правку: " + (id ? "да (id=" + id + ")" : "НЕТ"));
      finish(!!id);
    }, 1400);
  } catch (e) {
    out.push("исключение: " + e.message + " | " + String(e.stack || "").slice(0, 160));
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


def extract_function(src, name):
    m = re.search(r'(?:^|\n)function %s\b' % name, src)
    if not m:
        return None
    start = m.start() + 1
    j = src.index('{', start)
    depth = 0
    k = j
    while k < len(src):
        if src[k] == '{':
            depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0:
                break
        k += 1
    return src[start:k + 1]


def main():
    with io.open(LG, encoding="utf-8") as f:
        lang = f.read()
    with io.open(INDEX, encoding="utf-8") as f:
        idx = f.read()

    if 'id="actPublish"' not in lang:
        print("FAIL  в редакторе нет кнопки actPublish")
        return 1

    parts = [f for f in (extract_function(lang, n) for n in FUNCS) if f]
    missing = [n for n, f in zip(FUNCS, parts) if not f]
    if missing:
        print("FAIL  в редакторе нет функций: " + ", ".join(missing))
        return 1

    shim = ('\n<button class="act" id="actPublish" hidden>x</button>\n'
            '<script>\n' + '\n\n'.join(parts) + '\n</script>\n'
            '<script>document.getElementById("actPublish")'
            '.onclick = publishToApp;</script>\n')
    stub = ('<script>\n'
            'var ed = { value: "" };\n'
            'var edTitle = { textContent: "" };\n'
            'var _printed = [];\n'
            'function printToConsole(msg, cls) { _printed.push(cls + ": " + msg); }\n'
            'function refresh() {}\nfunction setView() {}\n'
            'function updateStatus() {}\nfunction markError() {}\n'
            '</script>\n')

    src_json = GAME.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    probe = PROBE.replace("%SRC%", '"' + src_json + '"')

    tmp = os.path.join(ROOT, "_tmp_round.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(idx.replace("</body>", shim + stub
                            + "<script>" + probe + "</script>\n</body>"))

    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbround_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1280,900", "--virtual-time-budget=30000",
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

    m = re.search(r'<pre id="roundreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  круг: страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:4]:
            print("      " + html.unescape(e))
        return 1
    txt = html.unescape(m.group(1))
    for line in txt.strip().split("\n"):
        print("      " + line.strip()[:120])
    return 0 if txt.rstrip().endswith("PASS") else 1


if __name__ == "__main__":
    sys.exit(main())