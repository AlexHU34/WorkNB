# -*- coding: utf-8 -*-
"""Имена элементов в редакторе: поле кода, кнопка запуска, вывод."""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
t = io.open(os.path.join(ROOT, "lang.html"), encoding="utf-8").read()

ids = re.findall(r'id="([a-zA-Z0-9_]+)"', t)
print("всего элементов с id:", len(ids))
for key in ("ed", "out", "log", "status", "run", "gview", "view", "err"):
    hits = [i for i in ids if key in i.lower()]
    if hits:
        print("  %-8s %s" % (key, hits[:8]))

print()
print("--- что рядом с кнопкой запуска:")
i = t.find('id="btnRun"')
print(re.sub(r"\s+", " ", t[max(0, i - 260):i + 220]))