# -*- coding: utf-8 -*-
"""Гейт панели родителей и защиты страниц.

Проверяем три вещи, каждая из которых легко отваливается молча:
  * панель (parents.html) действительно пишет настройки в то же
    хранилище, что читает игра, и умеет стереть прогресс;
  * приложение слушает эти настройки: предел времени и запрет облака
    имеют код, а не только надпись;
  * у всех страниц есть мета защиты (CSP) с запретом по умолчанию —
    и на собранных файлах, и в папке выкладки.
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
rc = 0


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


def read(p):
    return io.open(os.path.join(ROOT, p), encoding="utf-8").read()


print("=== ПАНЕЛЬ ===")
par = read("parents.html")
for marker, human in (("parLim", "выбор предела времени"),
                      ("parCloud", "переключатель облака"),
                      ("parSave", "кнопка сохранения"),
                      ("parReset", "кнопка сброса прогресса"),
                      ("bb2.v3.data", "пишет в то же хранилище, что игра")):
    check(marker in par, human)
check("confirm(" in par, "сброс спрашивает подтверждение")

print("")
print("=== ПРИЛОЖЕНИЕ СЛУШАЕТ ===")
app = read("src/app/app.js")
store = read("src/data/store.js")
sb = read("src/data/supabase.js")
check('"bb2_parent_limit":"parentLimit"' in app, "предел времени в карте хранилища")
check("bb2_parent_used" in app, "израсходованное время в карте хранилища")
check("function parentTimeUp" in app and "openGame(id){if(parentTimeUp()" in app,
      "предел закрывает вход в игру")
check("parentLimit: 0" in store and "parentCloud: true" in store,
      "у настроек есть значения по умолчанию")
check("function cloudAllowed" in sb, "запрет облака имеет код")
for fn in ("function req(", "function qAdd(", "function qFlush(", "function errReq("):
    seg = sb[sb.find(fn):sb.find(fn) + 220]
    check("cloudAllowed()" in seg, "запрет облака учтён: " + fn[9:-1])
check(sb.count("cloudAllowed()") >= 6, "запрет облака покрывает все каналы")

print("")
print("=== ЗАЩИТА СТРАНИЦ (CSP) ===")
pages = ["dist/min/Aeris.html", "dist/min/BloomScript.html", "dist/min/AerisStudio.html",
         "site/index.html", "site/lang.html", "site/studio.html", "site/parents.html"]
for p in pages:
    if not os.path.isfile(os.path.join(ROOT, p)):
        check(False, "нет файла " + p)
        continue
    t = read(p)
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', t)
    check(bool(m), "мета защиты есть: " + p)
    if m:
        csp = m.group(1)
        check("default-src 'none'" in csp, "запрет по умолчанию (default-src none): " + os.path.basename(p))
        check("https://xqujfjlktbdpxsaylfpn.supabase.co" in csp,
              "облачный адрес разрешён точечно: " + os.path.basename(p))

print("")
print("=== ПАНЕЛЬ РАБОТАЕТ (браузер) ===")
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
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    var d = document.createElement("pre");
    d.id = "parreport";
    d.textContent = out.join("\n");
    document.body.appendChild(d);
  }
  try {
    var set = document.getElementById("parLim");
    set.value = "60";
    document.getElementById("parSnd").checked = false;
    document.getElementById("parSave").click();
    var raw = null;
    try { raw = localStorage.getItem("bb2.v3.data"); } catch (e) {}
    var d = raw ? JSON.parse(raw) : {};
    out.push("предел записан: " + d.parentLimit);
    out.push("звук выключен: " + (d.sound === false));
    out.push("облако: " + d.parentCloud);
    var aux = null;
    try { aux = localStorage.getItem("bb2.v3.data_bak"); } catch (e) {}
    out.push("резервная копия рядом: " + !!aux);
    finish(d.parentLimit === 60 && d.sound === false && !!aux);
  } catch (e) {
    out.push("падение: " + e.message);
    finish(false);
  }
})();
"""
    tmp = tempfile.mkdtemp(prefix="nbpar_")
    try:
        page = io.open(os.path.join(ROOT, "parents.html"), encoding="utf-8").read()
        pos = page.rfind("</body>")
        page = page[:pos] + "<script>" + probe + "</script>\n" + page[pos:]
        p = os.path.join(tmp, "parents.html")
        with io.open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(page)
        prof = tempfile.mkdtemp(prefix="nbprof_")
        try:
            dom = subprocess.run(
                [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                 "--user-data-dir=" + prof, "--virtual-time-budget=9000",
                 "--allow-file-access-from-files", "--dump-dom",
                 "file:///" + p.replace("\\", "/")],
                capture_output=True, text=True, encoding="utf-8",
                errors="replace").stdout
        finally:
            shutil.rmtree(prof, ignore_errors=True)
        m = re.search(r'<pre id="parreport"[^>]*>(.*?)</pre>', dom, re.S)
        if not m:
            check(False, "панель не дошла до проверки")
        else:
            txt = html.unescape(m.group(1))
            for line in txt.strip().splitlines():
                print("      " + line.strip()[:120])
            check(txt.strip().endswith("PASS"), "настройки панели доходят до хранилища")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

print("")
print("ИТОГ: " + ("все проверки прошли" if rc == 0 else "есть провалы"))
sys.exit(rc)
