# -*- coding: utf-8 -*-
"""Гейт офлайна.

Что проверяем:
  * файлы воркера, манифеста и иконки существуют;
  * манифест — корректный JSON и ссылается на то, что есть;
  * воркер — синтаксически верный и кладёт в кэш все три страницы;
  * регистрация защищена проверкой протокола.

Последнее — главное. Сервис-воркер не работает по file://, и без
проверки каждый запуск файла двойным щелчком сыпал бы в консоль
предупреждение. А хуже того, попытка зарегистрировать воркер по file://
в некоторых браузерах бросает исключение прямо во время старта страницы,
и игра перестаёт открываться.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

rc = 0


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


print("=== ФАЙЛЫ ОФЛАЙНА ===")
need = ["sw.js", "manifest.webmanifest", "icon.svg"]
for f in need:
    check(os.path.isfile(os.path.join(ROOT, f)), "есть " + f)

print("")
print("=== МАНИФЕСТ ===")
mpath = os.path.join(ROOT, "manifest.webmanifest")
if os.path.isfile(mpath):
    raw = io.open(mpath, encoding="utf-8").read()
    try:
        data = json.loads(raw)
        ok = True
    except ValueError as e:
        data = {}
        ok = False
        print("      разбор: " + str(e))
    check(ok, "манифест — корректный JSON")
    if ok:
        for key in ("name", "short_name", "start_url", "display", "icons"):
            check(key in data, "в манифесте есть " + key)
        for ic in data.get("icons", []):
            p = os.path.normpath(os.path.join(ROOT, ic.get("src", "").lstrip("./")))
            check(os.path.isfile(p), "иконка на месте: " + os.path.basename(p))
        check(data.get("lang") == "ru", "язык указан: " + str(data.get("lang")))
        check(bool(data.get("theme_color")), "цвет темы указан")

print("")
print("=== ВОРКЕР ===")
swpath = os.path.join(ROOT, "sw.js")
if os.path.isfile(swpath):
    sw = io.open(swpath, encoding="utf-8").read()
    node = shutil.which("node") or "node"
    r = subprocess.run([node, "--check", swpath], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    check(r.returncode == 0, "sw.js разбирается без ошибок")
    for page in ("index.html", "lang.html", "studio.html"):
        check(("./" + page) in sw, "воркер кладёт в кэш " + page)
    check("activate" in sw and "VERSION" in sw, "в воркере есть версия кэша и очистка старого")
    check('mode === "navigate"' in sw or "navigate" in sw,
          "навигация обрабатывается: при обрыве связи отдаём игру из кэша")

print("")
print("=== РЕГИСТРАЦИЯ ЗАЩИЩЕНА ===")
app = io.open(os.path.join(ROOT, "src", "app", "app.js"), encoding="utf-8").read()
check('"serviceWorker" in navigator' in app, "наличие воркера проверяется")
check('location.protocol' in app and 'file:' in app.replace("http:", "").replace("https:", ""),
      "протокол проверяется до регистрации")
# Проверка идёт ДО вызова register.
m = re.search(r"proto\s*!==\s*\"http:\"[\s\S]{0,400}?\.register\(", app)
check(m is not None, "сначала проверка протокола, потом register")

print("")
print("=== МАНИФЕСТ ПОДКЛЮЧЁН К СТРАНИЦАМ ===")
for page in ("index.html", "lang.html", "studio.html"):
    t = io.open(os.path.join(ROOT, page), encoding="utf-8").read()
    check("manifest.webmanifest" in t, page + ": манифест подключён")

print("")
print("ИТОГ: " + ("все проверки прошли" if rc == 0 else "есть провалы"))
sys.exit(rc)