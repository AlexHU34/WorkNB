# -*- coding: utf-8 -*-
"""Гейт: на сайте нет числа, написанного от руки.

Зачем. Игр ровно 100, и в лобби счётчик берётся из данных. Но в трёх
местах число написано словами в самой разметке: описание для ссылки,
заголовок вкладки и надпись на макете картинки. Если добавить игру и
забыть эти места, сайт начнёт врать в самом видном месте — а это
ровно то, что портит впечатление сильнее всего.

Как проверяем. Считаем игры в данных, потом ищем в собранном сайте
любую цифру рядом со словом «игр», которая с ней не совпадает.
Метка {{GAMES}}, если она осталась, тоже считается ошибкой.

Что специально НЕ проверяется. Старые документы в docs/ хранят
историю: там «50 игр» и «36 игр» — это верные записи о том, сколько
игр было в тот момент. Переписывать историю незачем.
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gamecount import count_games  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

N, UNIQ = count_games()
print("настоящее число игр: %d (уникальных id: %d)" % (N, UNIQ))

# Всё, что реально уезжает к пользователю.
TARGETS = ["dist/Aeris.html", "dist/BloomScript.html", "dist/AerisStudio.html",
           "dist/min/Aeris.html", "dist/min/BloomScript.html",
           "dist/min/AerisStudio.html", "share.html"]

# Цифра рядом со словом «игр»: «100 игр», «120 игры», «100 ИГР»
PAT = re.compile(r"(\d{1,4})\s*(?:игр\b|игры\b|игр$)", re.I)

# Ложные срабатывания: речь о других единицах или о части текста,
# где «число» относится не к каталогу.
SKIP = re.compile(
    r"(fps|кадр|%|ms|мс|px|раз\b|×|x\s|step|уровн|звезд|лайк|❤|❤|ов)",
    re.I)

bad = []
checked = 0

# Комментарии внутри скриптов человек не видит никогда. Например, в
# коде модуля управления написано «34 игры читают клавиатуру» — это
# другое утверждение, а не размер каталога, и путать их нельзя.
# Поэтому перед проверкой вырезаем содержимое всех <script>.
SCRIPT = re.compile(r"<script\b[^>]*>.*?</script>", re.I | re.S)


def visible(t):
    return SCRIPT.sub(" ", t)


for rel in TARGETS:
    p = os.path.join(ROOT, rel)
    if not os.path.isfile(p):
        continue
    raw = io.open(p, encoding="utf-8").read()
    if "{{GAMES}}" in raw:
        bad.append((rel, "метка {{GAMES}} осталась в собранном файле"))
    t = visible(raw)
    for m in PAT.finditer(t):
        ctx = t[max(0, m.start() - 60):m.end() + 10]
        if SKIP.search(ctx):
            continue
        # Часть «100 игр» может стоять внутри цвета или координаты.
        num = int(m.group(1))
        checked += 1
        if num != N:
            snippet = re.sub(r"\s+", " ", ctx)[-70:]
            bad.append((rel, "написано «%s», а игр %d  (%s)"
                        % (m.group(0).strip(), N, snippet)))

# Отдельно: описание для ссылки обязано содержать настоящее число.
p = os.path.join(ROOT, "dist/min/Aeris.html")
if os.path.isfile(p):
    t = io.open(p, encoding="utf-8").read()
    m = re.search(r'property="og:title" content="([^"]+)"', t)
    if not m:
        bad.append(("og:title", "описание для ссылки не найдено"))
    elif ("%d игр" % N) not in m.group(1):
        bad.append(("og:title", "в описании для ссылки нет числа %d: %r"
                    % (N, m.group(1))))

print("проверено упоминаний числа: %d" % checked)

if bad:
    print("\nПРОВАЛ — числа на сайте не сходятся с данными:")
    for rel, msg in bad:
        print("  %-28s %s" % (rel, msg))
    raise SystemExit(1)

print("\nвсе числа на сайте совпадают с данными")