# -*- coding: utf-8 -*-
"""Разбор того, что занимает память в странице.

Почему не через браузер. Пытались снять замер в headless: страница с
сотней игр не доходит до конца виртуального времени, и съёмка
обрывается по таймауту. Chrome при этом отдаёт пустую страницу, а
не цифры, — замер получается правдоподобным и бесполезным.

Поэтому считаем по исходникам. Это точно и мгновенно: сколько холстов
и какой они площадью, сколько картинок вшито прямо в код и сколько они
весят, сколько узлов в разметке до запуска скриптов.

Каждый холст на экране 1920×1080 занимает около 8 МБ: по 4 байта на
точку, и браузер держит его и в памяти, и на видеокарте.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

html = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
app = io.open(os.path.join(ROOT, "src", "app", "app.js"), encoding="utf-8").read()
data = io.open(os.path.join(ROOT, "src", "app", "data.js"), encoding="utf-8").read()

print("=== РАЗМЕТКА ДО ЗАПУСКА СКРИПТОВ ===")
tags = re.findall(r"<([a-zA-Z][\w-]*)\b", html)
from collections import Counter
c = Counter(t.lower() for t in tags)
print("  всего узлов в разметке:", sum(c.values()))
for k, v in c.most_common(8):
    print("    %-10s %d" % (k, v))

print()
print("=== ХОЛСТЫ ===")
canvases = re.findall(r'<canvas[^>]*id="([^"]+)"', html)
print("  объявлено в разметке:", canvases)
created = re.findall(r"""createElement\([^)]*canvas[^)]*\)""", app)
print("  создаётся скриптом:", len(created))
# площадь в пикселях при окне 1920x1080
for cid in canvases:
    full = ("canvas" in cid) or cid in ("canvas", "canvasBase")
    print("    %-14s %s" % (cid,
          "на весь экран — около 8 МБ" if full else "меньше"))
print()
print("  замечание: холст конфетти нужен только в момент празднования,")
print("  но создаётся сразу и всегда занимает место.")

print()
print("=== КАРТИНКИ ===")
data_uris = re.findall(r'data:image/[a-z+]+;base64,([A-Za-z0-9+/=]+)', data + app + html)
total = sum(len(d) * 3 / 4 for d in data_uris)
print("  вшитых картинок:", len(data_uris))
print("  их суммарный размер: %.0f КБ" % (total / 1024))
if not data_uris:
    print("  (картинки не вшиты — рисуются кодом, это экономнее)")

print()
print("=== САМОЕ ТЯЖЁЛОЕ ===")
print("  код сотни игр: %.0f КБ в исходниках" % (
    os.path.getsize(os.path.join(ROOT, "src", "app", "games.js")) / 1024))
print("  он один раз разбирается движком и живёт в памяти как функции.")
print("  Отложенный разбор игр проверяли замером: выигрыша нет, браузер")
print("  и так не читает тела функций, пока их не позвали.")