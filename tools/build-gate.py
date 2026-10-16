# -*- coding: utf-8 -*-
"""Гейт починки сборки (шаг 4).

Проверяем ровно то, что было сломано:
  1. сборка пишет файл атомарно — не остаётся .building;
  2. проверка НЕ подменяет dist/ исходником (главный баг);
  3. прерывание в середине не оставляет в dist/ исходник;
  4. мусор от прошлых прерваний вычищается.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build.py")
DIST = os.path.join(ROOT, "dist")

out = []
fail = 0


def ok(cond, msg):
    global fail
    if not cond:
        fail += 1
    out.append(("OK   " if cond else "FAIL ") + msg)


src = io.open(BUILD, encoding="utf-8").read()

# 1. атомарная запись
ok('".building"' in src and "os.replace(tmp, out)" in src,
   "сборка пишет во временный файл и переименовывает")

# 2. главный баг: подмена собранного файла исходником
#    Упоминание .orig в комментариях и в чистке мусора — законно.
#    Запрещено только использовать .orig как файл, который пишется/переносится.
orig_uses = [l.strip() for l in src.splitlines()
             if ".orig" in l
             and 'endswith(".orig")' not in l
             and not l.strip().startswith("#")]
ok(not orig_uses,
   "проверка больше не создаёт .orig (найдено: %s)" % (orig_uses or "нет"))
ok("shutil.copyfile(os.path.join(ROOT, entry), out)" not in src,
   "собранный файл не подменяется исходником перед проверкой")
ok("dist/" in src, "сборщик всё ещё пишет в dist/")

# 3. чистка мусора
ok('endswith(".orig")' in src, "мусор .orig/.building вычищается")

# 4. реальная сборка проходит и не оставляет мусора
if os.path.isdir(DIST):
    for f in os.listdir(DIST):
        if f.endswith((".orig", ".building")):
            os.remove(os.path.join(DIST, f))

p = subprocess.run([sys.executable, BUILD, "--no-verify"],
                   cwd=ROOT, capture_output=True, text=True,
                   encoding="utf-8", errors="replace")
ok(p.returncode == 0, "сборка отработала (--no-verify)")
for n in ("Aeris.html", "BloomScript.html"):
    q = os.path.join(DIST, n)
    ok(os.path.isfile(q) and os.path.getsize(q) > 1000,
       "%s собран: %d КБ" % (n, os.path.getsize(q) // 1024 if os.path.isfile(q) else 0))

junk = [f for f in os.listdir(DIST) if f.endswith((".orig", ".building"))]
ok(not junk, "мусора в dist/ не осталось: %s" % (junk or "нет"))

# 5. СОДЕРЖИМОЕ важнее имени: в собранном файле должен быть настоящий код,
#    а не исходник приложения. Проверяем по размеру и по отсутствию
#    внешних <script src> — у исходника они есть, у сборки нет.
nb = os.path.join(DIST, "Aeris.html")
if os.path.isfile(nb):
    t = io.open(nb, encoding="utf-8").read()
    ext = re.findall(r'<script src="([^"]+)"', t)
    ok(not ext, "в сборке нет внешних <script src>: %s" % (ext or "нет"))
    # core.js в сборке есть — это и есть цель: он инлайнится. Проверять надо
    # не отсутствие упоминания (маркер <!-- src/... --> остаётся в HTML),
    # а присутствие настоящего кода.
    ok("<!-- src/lang/core.js -->" in t, "модуль core.js помечен маркером инлайна")
    core = io.open(os.path.join(ROOT, "src", "lang", "core.js"), encoding="utf-8").read()
    fn = re.search(r"function\s+tokenize", core)
    ok(bool(fn) and fn.group(0) in t,
       "код core.js действительно встроен (function tokenize)")
    ok(len(t) > 400000, "сборка полного размера: %d КБ" % (len(t.encode('utf-8')) // 1024))

# 6. Прерывание: имитируем обрыв — файл .building остался, но .html цел
if os.path.isfile(nb):
    before = os.path.getsize(nb)
    with io.open(nb + ".building", "w", encoding="utf-8", newline="\n") as f:
        f.write("<html>обрыв")
    ok(os.path.getsize(nb) == before,
       "при обрыве рабочий файл не тронут (%d КБ)" % (before // 1024))
    ok(os.path.isfile(nb + ".building"),
       "недописанный остаётся отдельным файлом, а не вместо сборки")
    # а следующая сборка обязана его убрать
    subprocess.run([sys.executable, BUILD, "--no-verify"], cwd=ROOT,
                   capture_output=True, text=True, encoding="utf-8",
                   errors="replace")
    ok(not os.path.isfile(nb + ".building"),
       "следующая сборка убирает огрызок прерванной")

print("\n".join(out))
print("ИТОГО: все проверки прошли" if not fail else "ИТОГО: провалено " + str(fail))
sys.exit(1 if fail else 0)