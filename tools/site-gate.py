# -*- coding: utf-8 -*-
"""Гейт папки для выкладки.

Зачем. Папка site/ — это ровно то, что уезжает в интернет, и однажды
именно она всё испортила: в неё попали ИСХОДНЫЕ файлы вместо
собранных, и сайт открывался пустым. Причина в том, что эти файлы
собирает build.py, а гейты тоже запускают сборку по кругу — в какой-то
момент папка оказалась старой, и это заметил только человек, открыв
сайт.

Что проверяем:
  * в site/ ровно десять файлов, ничего лишнего;
  * главная страница самодостаточна: скрипты внутри, а не ссылками
    на другие файлы. Именно это ломает сайт на сервере и не ломает
    при открытии с диска;
  * размеры совпадают с собранными файлами в dist/min;
  * есть 404, манифест, иконка и воркер офлайна.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
MIN = os.path.join(ROOT, "dist", "min")

rc = 0


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


EXPECT = {"index.html", "lang.html", "studio.html",
          "sw.js", "manifest.webmanifest", "icon.svg", "404.html", "og.png",
          "make.html", "parents.html", "CNAME", "_headers", "security.txt",
          ".well-known"}
PAIRS = [("index.html", "Aeris.html"),
         ("lang.html", "BloomScript.html"),
         ("studio.html", "AerisStudio.html")]

print("=== СОСТАВ ПАПКИ ===")
if not os.path.isdir(SITE):
    print("  FAIL  папки site/ нет — запусти python build.py")
    sys.exit(1)

have = set(os.listdir(SITE))
missing = EXPECT - have
extra = have - EXPECT
check(not missing, "все тринадцать файлов на месте" +
      ("" if not missing else " — нет: " + ", ".join(sorted(missing))))
check(not extra, "лишнего нет" +
      ("" if not extra else " — лишние: " + ", ".join(sorted(extra))))
# security.txt по правильному адресу — на случай проверки извне.
check(os.path.isfile(os.path.join(SITE, ".well-known", "security.txt")),
      "security.txt лежит по адресу /.well-known/")

# CNAME говорит GitHub Pages, какой домен отдавать.
cname_p = os.path.join(SITE, "CNAME")
if os.path.isfile(cname_p):
    cname_t = io.open(cname_p, encoding="utf-8").read().strip()
    check(cname_t == "aerisgames.ru",
          "CNAME указывает на aerisgames.ru («%s»)" % cname_t)
else:
    check(False, "CNAME нет — свой домен не подключён")

print("")
print("=== САМОДОСТАТОЧНОСТЬ ===")
# Ключевая проверка. Если скрипты подключаются ссылками, страница
# работает с диска, но на сервере ищет файлы там, где их нет.
for page in ("index.html", "lang.html", "studio.html"):
    p = os.path.join(SITE, page)
    if not os.path.isfile(p):
        continue
    t = io.open(p, encoding="utf-8").read()
    ext = re.findall(r'<script[^>]*\ssrc\s*=', t)
    check(not ext, "%s: скрипты внутри файла, а не ссылками (%d внешних)"
          % (page, len(ext)))
    check(len(t) > 40000, "%s: размер похож на собранный (%d КБ)"
          % (page, len(t) // 1024))

print("")
print("=== СОВПАДЕНИЕ СО СБОРКОЙ ===")
for site_name, min_name in PAIRS:
    a = os.path.join(SITE, site_name)
    b = os.path.join(MIN, min_name)
    if not (os.path.isfile(a) and os.path.isfile(b)):
        check(False, "%s: не с чем сравнивать" % site_name)
        continue
    sa, sb = os.path.getsize(a), os.path.getsize(b)
    check(abs(sa - sb) <= 2, "%s: совпадает с dist/min/%s (%d и %d байт)"
          % (site_name, min_name, sa, sb))

print("")
print("=== ОФЛАЙН И 404 ===")
for f in ("sw.js", "manifest.webmanifest", "404.html", "og.png",
              "make.html", "parents.html"):
    p = os.path.join(SITE, f)
    ok = os.path.isfile(p) and os.path.getsize(p) > 50
    check(ok, "есть и не пустой: " + f)

print("")
print("ИТОГ: " + ("папка для выкладки в порядке" if rc == 0 else "есть провалы"))
sys.exit(rc)