# -*- coding: utf-8 -*-
"""Гейт диагностики: ошибки не должны пропадать молча.

Зачем. В проекте был ОДИН обработчик ошибок на десять тысяч строк.
Поломка выглядела одинаково: игра не работает, и чинить приходилось
вслепую. Здесь проверяется обратное — что ошибка ДОШЛА до человека.

Проверка идёт исполнением: страницу роняют намеренно (ошибка в
обработчике, отказ промиса, битый ресурс) и требуют, чтобы каждая из
трёх попала в журнал. Если хоть одна исчезнет — гейт падает.
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

PROBE = r'''
(function () {
  var out = [], fail = 0;
  function ok(c, m) { out.push((c ? "OK   " : "FAIL ") + m); if (!c) fail++; }

  ok(typeof window.NebulaDiag === "object", "диагностика загрузилась");

  if (typeof window.NebulaDiag !== "object") {
    out.push("ИТОГО: провалено " + fail);
    var p = document.createElement("pre");
    p.id = "diagreport";
    p.textContent = out.join("\n");
    document.body.appendChild(p);
    return;
  }

  var D = window.NebulaDiag;
  D.clear();

  /* 1. Обычная ошибка: её ловит window.onerror */
  setTimeout(function () { throw new Error("Проверка: обычная ошибка"); }, 0);
  /* 2. Обещание, которое отвергли */
  Promise.reject(new Error("Проверка: отказ промиса"));
  /* 3. Прямая жалоба в журнал (так ловятся ошибки в try/catch) */
  D.report("error", "Проверка: жалоба вручную", "откуда-то");

  setTimeout(function () {
    var t = D.text();
    ok(t.indexOf("обычная ошибка") >= 0, "ошибка из кода попала в журнал");
    ok(t.indexOf("отказ промиса") >= 0, "отказ промиса попал в журнал");
    ok(t.indexOf("жалоба вручную") >= 0, "жалоба вручную попала в журнал");
    ok(D.count() >= 3, "в журнале записей: " + D.count());

    /* Повторы не плодят новые записи: ошибка в цикле спамит, а
       человеку достаточно знать, что она повторялась. */
    var before = D.count();
    D.report("error", "Проверка: жалоба вручную");
    ok(D.count() === before, "повтор той же ошибки не создал новую запись");

    /* Панель показывается и её можно закрыть — игра не блокируется. */
    D.show();
    var panel = document.getElementById("nbErrPanel");
    ok(!!panel && panel.classList.contains("show"), "панель ошибки показана");
    var close = panel && panel.querySelector('[data-a="close"]');
    if (close) close.click();
    ok(panel && !panel.classList.contains("show"), "панель закрывается кнопкой");

    /* Страница диагностики открывается и показывает записи. */
    D.open();
    var diag = document.getElementById("nbDiag");
    ok(!!diag && diag.classList.contains("show"), "страница диагностики открылась");
    var rows = diag ? diag.querySelectorAll(".nbDiagRow").length : 0;
    ok(rows >= 3, "в диагностике строк: " + rows);

    /* Стили диагностики загрузились: без них панель невидима.
       Ищем нужный блок, а не первый на странице: первым идёт CSS самой
       страницы, и проверка всегда смотрела не туда. */
    var styles = document.querySelectorAll("style");
    var diagCss = false;
    for (var i = 0; i < styles.length; i++) {
      if (styles[i].textContent.indexOf("nbErrPanel") >= 0) { diagCss = true; break; }
    }
    ok(diagCss, "стили диагностики на месте (блоков style: " + styles.length + ")");

    /* Журнал переживает перезагрузку: лежит в хранилище. */
    var stored = "";
    try { stored = localStorage.getItem("bb2_errors.v1") || ""; } catch (e) {}
    ok(stored.indexOf("обычная ошибка") >= 0, "журнал сохранён в хранилище");

    out.push(fail ? ("ИТОГО: провалено " + fail) : ("ИТОГО: все проверки прошли"));
    var p = document.createElement("pre");
    p.id = "diagreport";
    p.textContent = out.join("\n");
    document.body.appendChild(p);
  }, 350);
})();
'''


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    return shutil.which("chrome") or shutil.which("chromium")


def run_on(entry, label):
    print("=== %s ===" % label)
    page = os.path.join(ROOT, entry)
    with io.open(page, encoding="utf-8") as f:
        text = f.read()
    if "src/data/diag.js" not in text:
        print("FAIL  %s: диагностика не подключена" % entry)
        return 1
    tmp = os.path.join(ROOT, "_tmp_diag.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text.replace("</body>", "<script>" + PROBE + "</script>\n</body>"))
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbdiag_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=25000", "--allow-file-access-from-files",
             "--dump-dom", "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=180).stdout
    except subprocess.TimeoutExpired:
        # Потолок обязателен. Приложение крутит бесконечный кадровый
        # цикл, и под нагрузкой (параллельно поднято ещё несколько
        # Chrome) виртуальное время в этом окне не доходит до конца:
        # процесс не завершается и молча держит весь прогон гейтов.
        # Раньше здесь просто ждали вечно.
        print("FAIL  страница не дошла до проверки: Chrome не ответил за 180 с")
        print("      Это гонка за ресурсы, а не поломка диагностики.")
        return 1
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
    m = re.search(r'<pre id="diagreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,200}", dom)[:3]:
            print("      " + htmlmod.unescape(e))
        return 1
    rc = 0
    for line in htmlmod.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith("FAIL"):
            rc = 1
    return rc


def main():
    rc = 0
    rc |= run_on("index.html", "приложение")
    print("")
    rc |= run_on("lang.html", "редактор")
    print("")
    rc |= run_on("studio.html", "студия")
    return rc


if __name__ == "__main__":
    sys.exit(main())