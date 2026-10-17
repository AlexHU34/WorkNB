# -*- coding: utf-8 -*-
"""Гейт: на сайте нет старого названия и внутренних имён вместо слов.

Зачем. Проект когда-то назывался BloomBlox и Nebula Bloom, а потом стал
AERIS. Переименование прошло по файлам, но два места оказались забыты:
приветствие нового посетителя и подпись под названием игры. Оба стоят
в самом заметном месте — их видит каждый, кто зашёл впервые.

Вторая половина проверки. В данных у игры лежит внутреннее имя режима:
run3d, td, hockey. Такое нельзя показывать человеку. Проверка требует,
чтобы для каждого режима был русский перевод, и чтобы в подписи
использовался он, а не само поле mode.

Что НЕ проверяется. Названия отдельных игр вроде «3D-Небула Сити» —
это про игры про город, а не про проект. Их не трогаем.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

bad = []

# --- 1. старые названия в том, что видит человек --------------------
PUBLIC = ["index.html", "lang.html", "studio.html", "make.html",
          "parents.html", "404.html", "share.html", "src/app/app.js"]

# «Небула» внутри названия игры про город — не бренд.
GAME_NAME_OK = ["Небула Сити", "3D-Небула"]

for rel in PUBLIC:
    p = os.path.join(ROOT, rel)
    if not os.path.isfile(p):
        continue
    t = io.open(p, encoding="utf-8").read()
    for old in ["BloomBlox", "NEBULA BLOOM", "NebulaBloom",
                "Nebula Studio", "NebulaStudio"]:
        for m in re.finditer(re.escape(old), t):
            bad.append((rel, "осталось старое название «%s»" % old))
    if "Небула" in t and not rel.endswith("games.js"):
        # допускаем только если рядом «Сити»
        for m in re.finditer(r"Небула", t):
            near = t[max(0, m.start() - 12):m.start() + 12]
            if not any(k in near for k in GAME_NAME_OK):
                bad.append((rel, "«Небула» вне названия игры про город"))

# --- 2. каждому режиму — русский перевод ----------------------------
app = io.open(os.path.join(ROOT, "src", "app", "app.js"),
              encoding="utf-8").read()
i = app.find("MODE_LABEL=")
j = app.find("};", i)
block = app[i:j] if i > 0 else ""
label_keys = set(re.findall(r"(\w+)\s*:\s*\"[^\"]*[А-Яа-яЁё][^\"]*\"", block))
print("русских переводов жанров: %d" % len(label_keys))

data = io.open(os.path.join(ROOT, "src", "app", "data.js"),
               encoding="utf-8").read()
modes = set(re.findall(r'mode:\s*\"([^\"]*)\"', data))
print("разных режимов в играх: %d" % len(modes))

no_label = sorted(m for m in modes if m not in label_keys)
if no_label:
    bad.append(("app.js", "жёсткий внутренний код без перевода: %s"
                % ", ".join(no_label)))

# --- 3. в подписи используется перевод, а не само поле mode ---------
if 'MODE_LABEL[g.mode]||"конструктор"' not in app.replace("\n", "").replace(
        "MODE_LABEL[g.mode] || ", "MODE_LABEL[g.mode]||"):
    if "+g.mode+" in app or "• \"+g.mode" in app:
        bad.append(("app.js", "в подпись игры попадает внутреннее поле mode"))

# --- 4. приветствие называет AERIS и не выдумывает число игр --------
idx = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
k = idx.find('id="coach"')
coach = idx[k:k + 900] if k > 0 else ""
if k < 0:
    bad.append(("index.html", "приветствие нового посетителя не найдено"))
else:
    if "AERIS" not in coach:
        bad.append(("index.html", "приветствие не называет проект AERIS"))
    if 'id="coachGames"' not in coach:
        bad.append(("index.html", "в приветствии число игр снова написано рукой"))

if bad:
    print("\nПРОВАЛ:")
    for rel, msg in bad:
        print("  %-22s %s" % (rel, msg))
    raise SystemExit(1)

print("\nстарых названий нет, все жанры переведены")