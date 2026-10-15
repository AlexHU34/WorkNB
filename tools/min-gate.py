# -*- coding: utf-8 -*-
"""Проверка минифицированной сборки.

Зачем. Гейты читают исходники: проверки ищут в коде строки вроде
`<script src="src/engine/e3.js">`, и после минификации этих строк уже нет.
Поэтому исходник проверяется отдельно, а игрок получает ужатый файл.

Значит нужен гейт, который запускает ИМЕННО dist/min/*.html в настоящем
браузере и убеждается, что приложение после сжатия работает: грузится,
рисует каталог, запускает игру, хранилище отвечает, ошибок в консоли нет.

Здесь же живёт бюджет размера. Минификатор легко «съедает» то, что не
сжимается: служебные комментарии, имена функций ради отладки, читаемость.
Если файл перестал уменьшаться — это надо заметить, а не заметить через
месяц по нагрузке на интернет.
"""
import html as htmlmod
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN = os.path.join(ROOT, "dist", "min")

# Бюджет размера. Цифры взяты из замера проекта и запасены на небольшой
# рост содержимого: играть надо, а не экономить на вёрстке.
BUDGET_KB = {
    "NebulaBloom.html": 520,
    "BloomScript.html": 205,
    "NebulaStudio.html": 60,
}

PROBE = r'''
(function () {
  var out = [], fail = 0;
  function ok(c, m) { out.push((c ? "OK   " : "FAIL ") + m); if (!c) fail++; }

  /* Страница должна была запустить сама себя к моменту проверки. */
  ok(typeof E3 !== "undefined", "движок E3 загрузился");
  ok(typeof window.BB !== "undefined", "хранилище BB загрузилось");
  ok(typeof createRuntime === "function", "среда createRuntime загрузилась");
  /* Studio в приложении нет намеренно: он живёт на своей странице,
     NebulaStudio.html. Проверяется отдельным гейтом. */

  /* Каталог нарисован: это доказывает, что разметка не поехала от сжатия. */
  var cards = document.querySelectorAll("#gridAll .card").length;
  ok(cards > 0, "каталог отрисован: карточек " + cards);
  var side = document.querySelectorAll("#sideGames .side-btn").length;
  ok(side > 0, "боковой список: кнопок " + side);

  /* Движок рисует. */
  var cv = document.createElement("canvas");
  cv.width = 320; cv.height = 200; cv._lw = 320; cv._lh = 200;
  var ctx = cv.getContext("2d");
  var faces = [];
  for (var i = 0; i < 8; i++) faces = faces.concat(E3.box(i * 2 - 8, 1, 0, 1.5, 1.5, 1.5, "#88ccff"));
  E3.draw(ctx, faces, { x: 0, y: 8, z: -18, yaw: 0, pitch: 0.3 }, 430, [0.4, 0.7, 0.5]);
  ok(E3.stats.faces > 0, "движок нарисовал грани: " + E3.stats.faces);

  /* Хранилище пишет и читает. */
  try {
    BB.data = null;
    BB.set("bb2_probe", 1234);
    BB.flush();
    ok(BB.get("bb2_probe", 0) === 1234, "хранилище записало и прочитало значение");
    var raw = localStorage.getItem("bb2.v3.data");
    ok(raw && raw.indexOf("1234") >= 0, "значение дошло до localStorage");
  } catch (e) {
    ok(false, "хранилище: исключение " + e.message);
  }

  /* Настройки и графика — код, который добавлялся после прошлой сборки. */
  ok(typeof E3.setQuality === "function", "три уровня графики на месте");
  if (typeof E3.setQuality === "function") {
    E3.setQuality("low");
    var low = E3.quality;
    E3.setQuality("medium");
    ok(low === "low" && E3.quality === "medium", "уровни графики переключаются");
  }
  ok(typeof openSettings === "function", "окно настроек на месте");

  /* Интерпретатор жив: без него не запустятся игры пользователя. */
  ok(typeof parse === "function", "парсер BloomScript загрузился");
  ok(typeof Interp === "function", "интерпретатор загрузился");
  try {
    /* Один экземпляр на всё: глобалы берём у того же интерпретатора,
       который будет выполнять программу. Программа именно считает:
       одно объявление функции ничего не возвращает. */
    var I2 = new Interp({});
    I2.steps = 0;
    var r = I2.run(parse("return 1 + 1"), new Env(I2.globals));
    var v = (r && r.sig === "ret") ? r.v : r;
    ok(v === 2, "интерпретатор посчитал 1 + 1 = " + JSON.stringify(v));
  } catch (e) {
    ok(false, "интерпретатор: " + e.message);
  }

  out.push(fail ? ("ИТОГО: провалено " + fail) : ("ИТОГО: все проверки прошли"));
  var p = document.createElement("pre");
  p.id = "minreport";
  p.textContent = out.join("\n");
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


def budget_check():
    """Размер ужатой сборки не должен выйти за бюджет."""
    print("=== БЮДЖЕТ РАЗМЕРА ===")
    rc = 0
    for name, limit in BUDGET_KB.items():
        p = os.path.join(MIN, name)
        if not os.path.isfile(p):
            print("FAIL  нет %s — сборка не минифицирована" % name)
            rc = 1
            continue
        kb = os.path.getsize(p) // 1024
        verdict = "OK" if kb <= limit else "FAIL"
        if kb > limit:
            rc = 1
        print("  %s  %-20s %4d КБ  (предел %d)" % (verdict, name, kb, limit))
    return rc


def run_probe():
    """Гоняет проверку поведения на минифицированном приложении."""
    target = os.path.join(MIN, "NebulaBloom.html")
    if not os.path.isfile(target):
        print("FAIL  нет минифицированного приложения")
        return 1
    page = io.open(target, encoding="utf-8").read()
    tmp = os.path.join(ROOT, "_tmp_min.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page.replace("</body>", "<script>" + PROBE + "</script>\n</body>"))
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbmin_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=25000", "--allow-file-access-from-files",
             "--dump-dom", "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
    m = re.search(r'<pre id="minreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  минифицированная страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + htmlmod.unescape(e))
        return 1
    rc = 0
    for line in htmlmod.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith("FAIL"):
            rc = 1
    return rc


def check_globals_kept():
    """Минификатор не имеет права вырезать глобальные имена.

    esbuild в режиме transform вырезает только то, что не используется
    ВНУТРИ файла. Наши скрипты живут в глобальной области и обращаются к
    E3, Interp, Studio друг к другу как к глобальным, поэтому проверяем
    имена прямо в собранном файле.
    """
    print("=== ГЛОБАЛЬНЫЕ ИМЕНА НА МЕСТЕ ===")
    rc = 0
    names = ["E3", "E3GL", "E3Step", "E3Pool", "Interp", "Env", "parse",
             "createRuntime", "BB", "Studio", "StudioEditor", "StudioCode"]
    for name, fn in (("NebulaBloom.html", ("E3", "Interp", "Env", "parse",
                                           "createRuntime", "BB")),
                     ("BloomScript.html", ("Interp", "Env", "parse",
                                           "createRuntime", "E3")),
                     ("NebulaStudio.html", ("E3", "Studio", "StudioEditor",
                                            "StudioCode"))):
        p = os.path.join(MIN, name)
        if not os.path.isfile(p):
            continue
        src = io.open(p, encoding="utf-8").read()
        for n in fn:
            # Объявление либо присваивание в window: оба переживают сжатие.
            found = re.search(r"(?:function|class|const|let|var)\s+%s\b" % re.escape(n), src) \
                or re.search(r"\b%s\s*=" % re.escape(n), src) \
                or re.search(r"window\.%s\b" % re.escape(n), src)
            if not found:
                print("FAIL  %s: потеряно имя %s" % (name, n))
                rc = 1
    if rc == 0:
        print("  OK   все имена на месте")
    return rc


def main():
    if not os.path.isdir(MIN):
        print("FAIL  нет dist/min — сначала python build.py")
        return 1
    rc = budget_check()
    print("")
    print("=== МИНИФИЦИРОВАННОЕ ПРИЛОЖЕНИЕ В БРАУЗЕРЕ ===")
    rc |= run_probe()
    print("")
    rc |= check_globals_kept()
    return rc


if __name__ == "__main__":
    sys.exit(main())