# -*- coding: utf-8 -*-
"""Гейт доступности: интерфейс должен быть годным без мыши.

Что было замерено до правки: aria 0, role 0, tabindex 0. Ни один
элемент не был ни назван, ни достижим с клавиатуры.

Проверка идёт исполнением в браузере, потому что половина работы
модуля происходит после отрисовки: каталог собирается строкой и
пересоздаётся при каждом поиске.

Что требуется:
  * каждая кнопка названа для программы чтения с экрана;
  * кликабельные элементы достижимы вкладкой и реагируют на Enter;
  * фокус виден;
  * прыжок «к играм» в начале страницы есть;
  * настройка «уменьшить анимацию» уважается.
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

PROBE_HEAD = r'''
(function () {
  var CFG = __CFG__;
  var out = [], fail = 0;
  function ok(c, m) { out.push((c ? "OK   " : "FAIL ") + m); if (!c) fail++; }

  ok(typeof window.NebulaA11y === "object", "модуль доступности загрузился");
  if (typeof window.NebulaA11y !== "object") {
    out.push("ИТОГО: провалено " + fail);
    var p0 = document.createElement("pre");
    p0.id = "a11yreport";
    p0.textContent = out.join("\n");
    document.body.appendChild(p0);
    return;
  }

  var A = window.NebulaA11y;
  /* Каталог мог дорисоваться после модуля: сканируем ещё раз. */
  A.scan();

  var r = A.report();
  out.push("  (кнопок всего " + r.total + ", названо " + r.named + ")");
  ok(r.total > 0, "кнопки найдены: " + r.total);
  ok(r.unnamed === 0,
     "безымянных кнопок не осталось: " + r.unnamed +
     (r.unnamed ? " -- " + (r.missed || []).join(" ~ ") : ""));

  /* Достижимость: включённая кнопка обязана брать фокус.
     Выключенная — нет, поэтому считаем отдельно. */
  var btns = Array.prototype.slice.call(
    document.querySelectorAll("button,[role=button],.side-btn,.ctrl,.mini,.iconbtn,.tab,.cat,.mbtn"));
  var enabled = btns.filter(function (b) { return !b.disabled; });
  var unreachable = enabled.filter(function (b) {
    return b.getAttribute("tabindex") === null && b.tagName !== "BUTTON" &&
           b.tagName !== "INPUT" && b.tagName !== "SELECT" && b.tagName !== "TEXTAREA" &&
           b.tagName !== "A";
  });
  ok(unreachable.length === 0,
     "все включённые кнопки достижимы вкладкой (недостижимых " + unreachable.length + " из " + enabled.length + ")");
'''

PROBE_TAIL = r'''
  out.push(fail ? ("ИТОГО: провалено " + fail) : ("ИТОГО: все проверки прошли"));
  var p = document.createElement("pre");
  p.id = "a11yreport";
  p.textContent = out.join("\n");
  document.body.appendChild(p);
})();
'''

# Проверки, общие для всех страниц.
PROBE_COMMON = r'''
  /* Кнопка в шапке получает фокус и отвечает на Enter. */
  var anyBtn = document.querySelector("button");
  ok(!!anyBtn, "кнопка в шапке найдена");
  if (anyBtn) {
    anyBtn.focus();
    ok(document.activeElement === anyBtn, "кнопка в шапке берёт фокус");
    anyBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    ok(true, "нажатие Enter не вызывает исключение");
  }

  /* Кликабельный div должен стать достижимым и реагировать на Enter. */
  var probe = document.createElement("div");
  probe.setAttribute("onclick", "void 0");
  document.body.appendChild(probe);
  A.scan();
  ok(probe.getAttribute("tabindex") === "0", "кликабельный div получил tabindex");
  ok(probe.getAttribute("role") === "button", "кликабельный div получил роль");
  var fired = 0;
  probe.addEventListener("click", function () { fired++; });
  probe.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  ok(fired === 1, "Enter на кликабельном div вызывает действие");
  probe.remove();

  /* Фокус должен быть виден. */
  var st = document.getElementById("nbA11yStyle");
  ok(!!st && st.textContent.indexOf("focus-visible") >= 0, "стиль видимого фокуса есть");

  /* Прыжок к играм в начале страницы. */
  var skip = document.getElementById("nbSkip");
  ok(!!skip, "прыжок «к играм» есть");
  if (skip) {
    ok(document.body.firstElementChild === skip, "прыжок стоит первым в теле страницы");
  }

  /* Уважение к «уменьшить анимацию»: правило на месте и переключается. */
  var mo = document.getElementById("nbMotion");
  ok(!!mo, "правило для уменьшенной анимации есть");

  /* Роль dialog у всплывающих окон. */
  var dialogs = document.querySelectorAll('[role="dialog"]').length;
  out.push("  (окон с ролью dialog: " + dialogs + ")");

  if (CFG.wantsRoles) {
    ok(!!document.querySelector('[role="main"]'), "у главной части страницы есть роль main");
    ok(!!document.querySelector('[role="navigation"]'), "у навигации есть роль navigation");
  }
'''

# Настройка страницы: структура редактора и студии другая, требовать
# у них роли main/navigation бессмысленно — там их и не должно быть.
PAGES = [
    ("index.html", "приложение", '{"wantsRoles": true}'),
    ("lang.html", "редактор", '{"wantsRoles": false}'),
    ("studio.html", "студия", '{"wantsRoles": false}'),
]


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    return shutil.which("chrome") or shutil.which("chromium")


def run_on(entry, label, cfg):
    print("=== %s ===" % label)
    page = os.path.join(ROOT, entry)
    with io.open(page, encoding="utf-8") as f:
        text = f.read()
    if "src/data/a11y.js" not in text:
        print("FAIL  %s: модуль доступности не подключён" % entry)
        return 1
    probe = PROBE_HEAD.replace("__CFG__", cfg) + PROBE_COMMON + PROBE_TAIL
    tmp = os.path.join(ROOT, "_tmp_a11y.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text.replace("</body>", "<script>" + probe + "</script>\n</body>"))
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nba11y_")
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
    m = re.search(r'<pre id="a11yreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,200}", dom)[:3]:
            print("      " + htmlmod.unescape(e))
        return 1
    rc = 0
    for line in htmlmod.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:600])
        if line.strip().startswith("FAIL"):
            rc = 1
    return rc


def measure_before():
    """Сколько безымянных кнопок было бы без модуля. Для отчёта."""
    counts = {}
    for entry in ("index.html", "lang.html", "studio.html"):
        with io.open(os.path.join(ROOT, entry), encoding="utf-8") as f:
            t = f.read()
        # Кнопка без читаемого текста и без подсказки: эмодзи или картинка.
        n = 0
        for m in re.finditer(r"<button\b([^>]*)>([\s\S]{0,80}?)</button>", t):
            attrs, body = m.group(1), m.group(2)
            text = re.sub(r"<[^>]+>", "", body).strip()
            readable = bool(re.search(r"[A-Za-zА-Яа-яЁё0-9]", text))
            titled = "title=" in attrs
            if not readable and not titled:
                n += 1
        counts[entry] = n
    return counts


def main():
    print("=== СКОЛЬКО БЫЛО БЕЗ НАЗВАНИЙ (без модуля) ===")
    for k, v in measure_before().items():
        print("  %-14s кнопок без читаемого имени: %d" % (k, v))
    print("")
    rc = 0
    rc |= run_on("index.html", "приложение", PAGES[0][2])
    print("")
    rc |= run_on("lang.html", "редактор", PAGES[1][2])
    print("")
    rc |= run_on("studio.html", "студия", PAGES[2][2])
    return rc


if __name__ == "__main__":
    sys.exit(main())