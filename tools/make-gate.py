# -*- coding: utf-8 -*-
"""Проверяет, что пример из инструкции реально запускается.

Инструкция «как сделать свою игру» приводит готовый код и обещает,
что он запустится. Обещание надо держать.

Первая попытка проверяла это через node, и она обманула: движок
рассчитан на браузер, в обычном node не грузится, и гейт показывал
провал там, где всё на самом деле работает.

Теперь проверка настоящая. Пример вставляется в поле редактора,
нажимается «Запустить», и смотрится, что написано в выводе.
Элементы страницы: поле кода — #ed, кнопка запуска — #btnRun,
вывод с ошибками — #lOut.
"""
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

rc = 0


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


def chrome_path():
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"):
        if os.path.isfile(p):
            return p
    return shutil.which("chrome")


PROBE = """
<script>
setTimeout(function(){
  try{
    var box = document.getElementById('ed');
    if(!box){ document.title = 'НЕТ ПОЛЯ КОДА'; return; }
    box.value = %s;
    var btn = document.getElementById('btnRun');
    if(!btn){ document.title = 'НЕТ КНОПКИ'; return; }
    btn.click();
    setTimeout(function(){
      var out = document.getElementById('lOut');
      var txt = out ? (out.textContent || '') : '';
      document.title = txt.indexOf('строка') >= 0 || txt.indexOf('ошибка') >= 0
        ? ('ОШИБКА: ' + txt.replace(/\\s+/g,' ').slice(0,160))
        : 'ОШИБОК НЕТ';
    }, 3000);
  }catch(e){ document.title = 'СБОЙ: ' + e.message; }
}, 2500);
</script>
"""


def main():
    print("=== ТЕКСТ ПРИМЕРА ===")
    page = io.open(os.path.join(ROOT, "make.html"), encoding="utf-8").read()
    m = re.search(r"(?s)<pre><code>(.*?)</code></pre>", page)
    check(m is not None, "на странице есть блок с кодом")
    if not m:
        return 1
    code = (m.group(1).replace("&lt;", "<").replace("&gt;", ">")
            .replace("&amp;", "&"))
    check("fn setup()" in code, "есть функция setup")
    check("in update(dt)" in code, "есть кадровый цикл")
    check("in draw()" in code, "есть отрисовка")
    check("&lt;" not in code, "спецсимволы страницы не попали в код")

    print("")
    print("=== ПРИМЕР ЗАПУСКАЕТСЯ В РЕДАКТОРЕ ===")
    built = os.path.join(ROOT, "dist", "min", "BloomScript.html")
    if not os.path.isfile(built):
        check(False, "сначала python build.py")
        return 1
    src = io.open(built, encoding="utf-8").read()
    src = src.replace("</body>", (PROBE % json.dumps(code)) + "</body>")

    tmp = os.path.join(ROOT, "_make_probe.html")
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(src)

    s = socket.socket(); s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port),
                            "--bind", "127.0.0.1"], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp(prefix="nbmake_")
    dom = ""
    try:
        for _ in range(60):
            try:
                c = socket.create_connection(("127.0.0.1", port), 0.4)
                c.close(); break
            except OSError:
                time.sleep(0.25)
        r = subprocess.run([chrome_path(), "--headless=new", "--disable-gpu",
                            "--no-sandbox", "--user-data-dir=" + prof,
                            "--virtual-time-budget=40000", "--dump-dom",
                            "http://127.0.0.1:%d/_make_probe.html" % port],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=500)
        dom = r.stdout or ""
    finally:
        srv.kill()
        shutil.rmtree(prof, ignore_errors=True)
        os.remove(tmp)

    t = re.search(r"<title>([^<]*)</title>", dom)
    state = t.group(1).strip() if t else "(страница не ответила)"
    print("  редактор ответил: " + state)
    check("ОШИБОК НЕТ" in state, "пример запустился без ошибок")
    if "ОШИБКА" in state or "СБОЙ" in state:
        print("  подробности: " + state[:300])

    print("")
    print("=== СТРАНИЦА ПОДКЛЮЧЕНА ===")
    for f in ("index.html", "sw.js"):
        tt = io.open(os.path.join(ROOT, f), encoding="utf-8").read()
        check("make.html" in tt, "%s ссылается на инструкцию" % f)

    print("")
    print("ИТОГ: " + ("инструкция верна" if rc == 0 else "есть провалы"))
    return rc


if __name__ == "__main__":
    sys.exit(main())