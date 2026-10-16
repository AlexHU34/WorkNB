# -*- coding: utf-8 -*-
"""Замер: сколько стоит разбор файла со ста играми при запуске.

Зачем это вообще мерить. План предлагал переделать сто игр так, чтобы
их код читался только при запуске нужной игры. Но движок браузера и так
делает тела функций лениво: функция не компилируется, пока её не
вызвали. То есть сто определений MODES.* — это почти не «разбор», и
перекладывать их в строки может оказаться бессмысленной работой.

Проверяем на деле. Собираем две копии страницы:
  1. обычную, где games.js на месте;
  2. подменённую, где вместо ста игр пустышки с теми же именами.
Разница во времени до первого кадра — ровно цена этих 343 КБ.
Если она незаметна, фазу не делаем и говорим об этом прямо.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROBE = """
<script>
/* Меряем не «сколько длится разбор», а сколько человек ждёт картинку.
   Отсчёт идёт от начала загрузки страницы, поэтому лишние килобайты
   видны честно. Два кадра после load — чтобы точно дождаться, когда
   приложение уже что-то нарисовало. */
function report(tag) {
  var paint = performance.getEntriesByType("paint")
      .map(function(p){ return p.name + "=" + Math.round(p.startTime); });
  var el = document.createElement("pre");
  el.id = "PERF";
  el.textContent = tag + "\\nready:" + document.readyState
      + "\\nnow:" + Math.round(performance.now())
      + "\\npaint:" + paint.join(",")
      + "\\ndom:" + document.querySelectorAll(".card,#lobby *").length;
  document.body.appendChild(el);
}
window.addEventListener("load", function () {
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    report("ok");
  }); });
});
</script>
"""


def find_chrome():
    for p in ("chrome", "google-chrome", "chromium"):
        w = shutil.which(p)
        if w:
            return w
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"):
        if os.path.isfile(p):
            return p
    raise SystemExit("Chrome не найден")


def build_page(stub_games):
    """Собирает index.html из исходников, при желании с пустышками вместо игр."""
    src = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    games = io.open(os.path.join(ROOT, "src", "app", "games.js"), encoding="utf-8").read()
    data = io.open(os.path.join(ROOT, "src", "app", "data.js"), encoding="utf-8").read()
    app = io.open(os.path.join(ROOT, "src", "app", "app.js"), encoding="utf-8").read()

    # Ровно так же собирает build.py: модули становятся встроенными
    # скриптами, чтобы страница работала с диска одним файлом.
    def inline(page, tag, src):
        m = re.search(r'<script[^>]*src="%s"[^>]*>\s*</script>' % re.escape(tag), page)
        if not m:
            return page
        return page[:m.start()] + "<script>\n" + src + "\n</script>" + page[m.end():]

    src = inline(src, "src/app/data.js", data)
    src = inline(src, "src/app/games.js", stub_games if stub_games else games)
    src = inline(src, "src/app/app.js", app)
    src = src.replace("</body>", PROBE + "</body>")
    return src


def stub_games():
    """Пустышки с теми же именами: лобби должно нарисоваться как обычно."""
    games = io.open(os.path.join(ROOT, "src", "app", "games.js"), encoding="utf-8").read()
    names = re.findall(r"MODES\.([A-Za-z0-9_]+)\s*=", games)
    out = ["const MODES = {};", ""]
    for n in names:
        out.append("MODES.%s=function(){var L=[];while(L.length<10)L.push(0);return L;};" % n)
    return "\n".join(out)


def measure(html, label):
    tmp = os.path.join(ROOT, "_perf_probe.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    prof = tempfile.mkdtemp(prefix="nbperf_")
    try:
        dom = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=20000", "--allow-file-access-from-files",
             "--dump-dom", "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=240).stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        os.remove(tmp)
    m = re.search(r'<pre id="PERF"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("%s: страница не дошла до замера" % label)
        return None
    print("--- " + label)
    for line in io.StringIO(m.group(1)).read().splitlines():
        print("    " + line.strip()[:160])
    # Ищем первый paint
    mm = re.search(r"paint:([^\n]*)", m.group(1))
    if not mm:
        return None
    nm = re.search(r"first-contentful-paint=(\d+)", mm.group(1))
    if nm:
        return int(nm.group(1))
    nm = re.search(r"now:(\d+)", m.group(1))
    return int(nm.group(1)) if nm else None


def main():
    print("=== ЗАМЕР ЦЕНЫ ФАЙЛА ИГР ===")
    print("")
    full = measure(build_page(False), "со ста играми")
    print("")
    stub = measure(build_page(stub_games()), "с пустышками вместо игр")
    print("")
    print("разница: файл со играми стоит на %s мс больше" %
          ("?" if (full is None or stub is None) else (full - stub)))


if __name__ == "__main__":
    main()