# -*- coding: utf-8 -*-
"""Гейт безопасности вывода: чужие строки не становятся кодом.

Повод — аудит 2026-10-24: имя из общего рейтинга вставлялось в страницу
через innerHTML, и любой мог записать в базу HTML, который выполнялся у
всех игроков. Проверки делятся на две половины:

  * по тексту — нет ли снова вставки серверных строк через innerHTML,
    закреплены ли серверные ограничения в миграции, стоит ли защита на
    странице 404 и заголовки в _headers;
  * по поведению — открываем собранную страницу в браузере, подсовываем
    рейтингу злую строку и требуем, чтобы она стала текстом, а не кодом.

Браузерная половина — главная: только она отличает «мы поправили строчку»
от «дыры действительно нет».
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

rc = 0


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


def read(p):
    return io.open(os.path.join(ROOT, p), encoding="utf-8").read()


print("=== ВЫВОД ЧУЖИХ СТРОК ===")
app = read("src/app/app.js")
m = re.search(r"function renderHall\(g\)\{([\s\S]*?)\n/\* ===== Профиль", app)
body = m.group(1) if m else ""
check(bool(body), "renderHall нашёлся")
plain = re.sub(r"/\*[\s\S]*?\*/", "", body)
plain = re.sub(r"//[^\n]*", "", plain)
check("innerHTML" not in plain, "в рейтинге нет innerHTML")
check("textContent" in plain and "replaceChildren" in plain,
      "имя рисуется текстом, а не разметкой")
check(re.search(r"line\.textContent=.*who", plain) is not None,
      "имя попадает в textContent")
# Общий запрет: ни одна строка с чужим полем не должна идти в innerHTML.
bad = []
for line in app.splitlines():
    if "innerHTML" in line and re.search(r"\br\.(name|score)\b|\.name\b", line):
        bad.append(line.strip()[:90])
check(not bad, "серверные имена не идут в innerHTML" +
      ("" if not bad else ": " + " | ".join(bad[:2])))
check("hallNick" in app and re.search(r"hallNick[\s\S]{0,200}textContent", app) is not None,
      "ник в профиле тоже текстом")

print("")
print("=== СЕРВЕРНЫЕ ОГРАНИЧЕНИЯ ===")
scores_sql = os.path.join(ROOT, "supabase", "migrations", "v4_scores.sql")
check(os.path.isfile(scores_sql), "миграция рекордзала лежит в git")
if os.path.isfile(scores_sql):
    sql = read("supabase/migrations/v4_scores.sql")
    check("with check" in sql.lower(), "вставка проверяется политикой")
    check("score between 0 and 999" in sql, "счёт ограничен 0–999")
    check("scores_force_created" in sql, "время ставит сервер, а не клиент")
    check("scores_quiet" in sql, "есть ограничитель залповых вставок")
    check("scores_score_range" in sql, "ограничения закреплены и в таблице")
    check("sec-probe-" in sql, "тестовые строки аудита убираются миграцией")
    check("drop policy" in sql.lower(), "старые разрешающие политики снимаются")

print("")
print("=== ЗАЩИТА И ЗАГОЛОВКИ ===")
p404 = read("404.html")
check('http-equiv="Content-Security-Policy"' in p404, "у 404 есть мета защиты")
check("default-src 'none'" in p404, "у 404 запрет по умолчанию")
assert_h = read("_headers")
check("frame-ancestors 'none'" in assert_h, "запрет встраивания в рамку (_headers)")
check("Strict-Transport-Security" in assert_h, "строгий транспорт (HSTS)")
check("X-Frame-Options: DENY" in assert_h, "двойной запрет рамки")
check("Referrer-Policy" in assert_h and "Permissions-Policy" in assert_h,
      "политика ссылок и разрешений")
check(os.path.isfile(os.path.join(ROOT, "security.txt")),
      "есть security.txt для сообщений о дырах")

print("")
print("=== НИКИ ===")
sb = read("src/data/supabase.js")
check('normalize("NFKC")' in sb, "ники сводятся к одной форме (NFKC)")
check("смесь азбук" in sb, "смесь кириллицы и латиницы запрещена")
check(r'[\\%_]' in sb, "знаки шаблона экранируются в поиске ника")

print("")
print("=== ПОВЕДЕНИЕ: ЗЛАЯ СТРОКА В РЕЙТИНГЕ ===")
if not os.path.isfile(APP):
    check(False, "нет собранной страницы — сначала python build.py")
else:
    chrome = None
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            chrome = c
            break
    if not chrome:
        check(False, "Chrome/Edge не найден")
    else:
        probe = r"""
(function(){
  var out = [];
  var d = document.createElement("pre");
  d.id = "secreport";
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    d.textContent = out.join("\n");
    document.body.appendChild(d);
  }
  try {
    var evil = '<img src=x onerror="document.title=\'XSS-HAPPENED\'">';
    if (!window.AERIS_SB) { out.push("нет облачного моста"); finish(false); return; }
    /* Подменяем ТОЛЬКО ответ рейтинга: база не затрагивается. */
    AERIS_SB.top = function (id, cb) { cb([{ name: evil, score: 5 }, { name: "Вася", score: 3 }]); };
    renderHall({ id: 123 });
    setTimeout(function () {
      var list = document.getElementById("hallList");
      document.title = document.title; /* не даём проверке себя обмануть */
      out.push("заголовок после отрисовки: " + (document.title === "XSS-HAPPENED" ? "ВЗЛОМАН" : "цел"));
      out.push("картинки из строки нет: " + !list.querySelector("img"));
      out.push("видно текстом: " + (String(list.textContent).indexOf("<img") >= 0));
      out.push("вторая строка: " + (String(list.textContent).indexOf("Вася") >= 0));
      finish(document.title !== "XSS-HAPPENED" && !list.querySelector("img") &&
             String(list.textContent).indexOf("<img") >= 0 &&
             String(list.textContent).indexOf("Вася") >= 0);
    }, 120);
  } catch (e) {
    out.push("падение: " + e.message);
    finish(false);
  }
})();
"""
        tmp = tempfile.mkdtemp(prefix="nbsec_")
        try:
            page = io.open(APP, encoding="utf-8").read()
            pos = page.rfind("</body>")
            page = page[:pos] + "<script>" + probe + "</script>\n" + page[pos:]
            p = os.path.join(tmp, "app.html")
            with io.open(p, "w", encoding="utf-8", newline="\n") as f:
                f.write(page)
            prof = tempfile.mkdtemp(prefix="nbprof_")
            try:
                dom = subprocess.run(
                    [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                     "--user-data-dir=" + prof, "--hide-scrollbars",
                     "--window-size=1280,900", "--virtual-time-budget=15000",
                     "--allow-file-access-from-files", "--dump-dom",
                     "file:///" + p.replace("\\", "/")],
                    capture_output=True, text=True, encoding="utf-8",
                    errors="replace", timeout=180).stdout
            finally:
                shutil.rmtree(prof, ignore_errors=True)
            mm = re.search(r'<pre id="secreport"[^>]*>(.*?)</pre>', dom, re.S)
            if not mm:
                check(False, "страница не дошла до проверки")
            else:
                txt = html.unescape(mm.group(1))
                for line in txt.strip().splitlines():
                    print("      " + line.strip()[:120])
                check(txt.strip().endswith("PASS"),
                      "злая строка осталась текстом, код не выполнился")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

print("")
print("ИТОГ: " + ("все проверки прошли" if rc == 0 else "есть провалы"))
sys.exit(rc)
