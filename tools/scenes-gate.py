# -*- coding: utf-8 -*-
"""Проверка библиотеки сцен: сохранить, открыть список, выгрузить."""
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


print("=== ФУНКЦИИ ЕСТЬ ===")
scene = io.open(os.path.join(ROOT, "src", "studio", "scene.js"), encoding="utf-8").read()
editor = io.open(os.path.join(ROOT, "src", "studio", "editor.js"), encoding="utf-8").read()
for fn in ("libList", "libSave", "libOpen", "libDelete",
           "sceneDownload", "scenePickFile", "sceneFromText"):
    check("function %s(" % fn in scene, "есть %s" % fn)
    check(fn + ":" in scene or fn + "()" in editor or fn in editor,
          "%s подключён к интерфейсу" % fn)

print("")
print("=== КНОПКИ НА МЕСТЕ ===")
html = io.open(os.path.join(ROOT, "studio.html"), encoding="utf-8").read()
for bid in ("btnLibrary", "btnFileOut", "btnFileIn"):
    check('id="%s"' % bid in html, "кнопка %s в панели" % bid)
    check('$("%s").onclick' % bid in editor, "кнопка %s работает" % bid)

print("")
print("=== НЕТ НЕСУЩЕСТВУЮЩИХ ССЫЛОК ===")
for bad in ("getScene(", "applyScene(", "Studio.parseCode"):
    check(bad not in editor, "нет обращения к несуществующей %s" % bad)

print("")
print("=== ПАНЕЛЬ НЕ ПЕРЕПОЛНЯЕТСЯ ===")
check("flex-wrap" in html or "overflow-x:auto" in html,
      "панель инструментов умеет переноситься или прокручиваться")

print("")
print("=== СЦЕНА В ФАЙЛ — ЭТО ЧИТАЕМЫЙ ТЕКСТ ===")
check(".bs" in scene, "файл с расширением .bs")
check("text/plain" in scene, "файл сохраняется обычным текстом")
check("// " in scene, "в файле есть заголовок-комментарий")

print("")
print("ИТОГ: " + ("библиотека в порядке" if rc == 0 else "есть провалы"))
sys.exit(rc)