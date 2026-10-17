# -*- coding: utf-8 -*-
"""Итоговая проверка живого сайта.

Что делает. Ждёт, пока выкладка дойдёт, и сверяет содержимое сайта
в интернете с тем, что должно быть. Проверяет не по одному признаку,
а по всем сразу, чтобы не вышло «частично обновилось».
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gamecount import count_games  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

BASE = "https://alexhu34.github.io/WorkNB"
GAME_COUNT_STR = str(count_games()[0])

PAGES = [
    ("/", "заставка"),
    ("/lang.html", "редактор"),
    ("/studio.html", "студия"),
    ("/make.html", "инструкция"),
    ("/parents.html", "для взрослых"),
    ("/404.html", "страница потерялась"),
    ("/sw.js", "воркер офлайна"),
    ("/manifest.webmanifest", "манифест"),
    ("/icon.svg", "знак"),
]

CONTENT = [
    # Заголовок теперь собирается из настоящего числа игр, поэтому
    # проверяем не точную строку, а что число в ней есть и совпадает
    # с данными — иначе сайт начнёт врать после добавления игр.
    ("заголовок с числом игр", "/", GAME_COUNT_STR + " 3D-игр и редактор"),
    ("в заголовке не осталось метки", "/", None),
    ("что это — первой строкой", "/", "запускаются прямо в браузере"),
    ("главная кнопка «Играть»", "/", ">Играть<"),
    ("кнопка «Написать свою игру»", "/", "Написать свою игру"),
    ("каталог порциями", "/", "moreBtn"),
    ("короткий боковой список", "/", "sideMore"),
    ("ссылка на инструкцию", "/", "make.html"),
    ("ссылка для взрослых", "/", "parents.html"),
    ("знак на месте", "/", "logo-mark"),
    ("инструкция ведёт в редактор", "/make.html", 'href="./lang.html"'),
    ("инструкция ведёт в студию", "/make.html", 'href="./studio.html"'),
    ("взрослым про безопасность", "/parents.html", "нет доступа к файлам"),
    ("воркер кладёт инструкцию", "/sw.js", "./make.html"),
    ("воркер кладёт взрослых", "/sw.js", "./parents.html"),
    ("манифест про AERIS", "/manifest.webmanifest", '"AERIS"'),
]


def fetch(path):
    r = subprocess.run(["curl.exe", "-s", "--noproxy", "*", "--max-time", "60",
                        "-L", BASE + path],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    return r.stdout or ""


rc = 0

print("=== СТРАНИЦЫ ОТКРЫВАЮТСЯ ===")
pages = {}
for path, name in PAGES:
    body = fetch(path)
    ok = len(body) > 100
    pages[path] = body
    print("  %-4s %-22s %7d байт" % ("OK" if ok else "FAIL", name, len(body)))
    if not ok:
        rc = 1

print()
print("=== СОДЕРЖИМОЕ ===")
for name, path, needle in CONTENT:
    # needle None означает «такого куска быть НЕ должно».
    if needle is None:
        ok = "{{" not in pages.get(path, "")
    else:
        ok = needle in pages.get(path, "")
    print("  %-4s %s" % ("OK" if ok else "FAIL", name))
    if not ok:
        rc = 1

print()
print("ИТОГ: " + ("сайт соответствует исходникам" if rc == 0
                 else "на сайте что-то не совпадает"))
sys.exit(rc)