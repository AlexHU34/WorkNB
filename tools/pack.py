#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Упаковка сборки в готовый к выкладке артефакт.

Зачем. dist/ удобен для проверок, но выкладывать его как есть нельзя:
во-первых, имена файлов не отвечают ни одному хостингу (index.html
обязан лежать в корне), во-вторых, рядом лежит редактор, который в
каталоге игры не нужен. Здесь получается ровно то, что заливается на
диск или в архив:

    release/
      index.html    — приложение (каталог игр), точка входа
      editor.html   — редактор BloomScript
      README.md     — что это и как выложить

Проверка перед упаковкой та же, что и в dist-gate: в собранном файле
не должно быть ни одной внешней ссылки. Если есть — пакет не создаётся.
Иначе игра на чужом хостинге молча сломается: файл откроется, но
движок не загрузится.

  python tools/pack.py             # собрать release/
  python tools/pack.py --zip       # ещё и release.zip
  python tools/pack.py --out pub   # другой каталог
"""

import argparse
import io
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
# Минифицированная сборка: игрок получает файл на 27-49% меньше.
# Эталон без сжатия остаётся в dist/ для гейтов, которые читают исходники.
MIN = os.path.join(DIST, "min")


def pick(name):
    """Минифицированный файл, если он есть, иначе обычный."""
    m = os.path.join(MIN, name)
    return m if os.path.isfile(m) else os.path.join(DIST, name)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Чего быть не должно в собранном файле. Регексп — только для src=,
# полные адреса ловим отдельно: они могут прятаться в CSS, шрифтах и
# в строках внутри кода.
BANNED = [
    ("внешний <script src>", re.compile(r'<script[^>]+src\s*=\s*["\']', re.I)),
    ("внешняя <link>", re.compile(r'<link[^>]+href\s*=\s*["\']', re.I)),
    ("полный адрес http(s)", re.compile(r'https?://', re.I)),
    ("fetch()", re.compile(r'\bfetch\s*\(')),
    ("XMLHttpRequest", re.compile(r'\bXMLHttpRequest\b')),
    ("динамический import()", re.compile(r'\bimport\s*\(')),
]

README = """# AERIS — готовый к выкладке пакет

Собранный продукт. Дальше его только заливают на хостинг.

## Что внутри

| Файл | Что это |
|---|---|
| `index.html` | приложение: каталог из 100 игр, точка входа |
| `editor.html` | редактор и среда BloomScript, свои игры на публикацию |
| `studio.html` | AERIS Studio: сборка 3D-сцены мышью и публикация в каталог |

Все три файла самодостаточны: движок, интерпретатор и игры встроены внутрь.
Каталога `src/` рядом нет и не требуется. Интернет для запуска не нужен —
внешних запросов в файлах нет вообще.

## Как выложить

1. Загрузить содержимое каталога на любой статический хостинг так,
   чтобы `index.html` оказался в корне сайта.
2. Открыть адрес и убедиться, что каталог игр загрузился.

Подойдёт бесплатный тариф: Cloudflare Pages, Netlify, GitHub Pages.
Своё доменное имя не обязательно — у бесплатных хостингов есть поддомен.

## Проверка

Пакет собран из `dist/`, а тот — из исходников скриптом `build.py`.
Перед упаковкой проверяется, что в файлах нет внешних ссылок.
"""


def log(m):
    sys.stdout.write(m + "\n")
    sys.stdout.flush()


def strip_comments(text):
    """Убирает комментарии, оставляя код. Нужна, чтобы проверка внешних
    ссылок не цеплялась за текст ВНУТРИ комментариев: в lang.html есть
    пояснение «<script src="src/engine/e3.js"> подключается выше» — это
    комментарий, а не подключение движка.

    Разбор с учётом строковых литералов: иначе `//` внутри URL или `/*`
    внутри CSS-правила вырезали бы живой код, и проверка молча пропустила
    бы настоящую внешнюю ссылку.
    """
    out = []
    i, n = 0, len(text)
    quote = None          # кавычка, внутри которой мы сейчас
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "\"'`":
            quote = c
            out.append(c)
            i += 1
            continue
        if text.startswith("<!--", i):
            j = text.find("-->", i)
            i = n if j < 0 else j + 3
            out.append(" ")
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            out.append(" ")
            continue
        out.append(c)
        i += 1
    return "".join(out)


def check_self_contained(path):
    """Возвращает список нарушений. Пустой список — файл годится."""
    raw = io.open(path, encoding="utf-8").read()
    text = strip_comments(raw)
    bad = []
    for name, rx in BANNED:
        m = rx.search(text)
        if m:
            line = text[: m.start()].count("\n") + 1
            bad.append("%s (строка %d: %s)" % (name, line,
                                               m.group(0)[:40]))
    return bad


def main():
    ap = argparse.ArgumentParser(description="Упаковка сборки для выкладки")
    ap.add_argument("--out", default="release", help="каталог пакета")
    ap.add_argument("--zip", action="store_true", help="собрать архив .zip")
    a = ap.parse_args()

    # Отдаём минифицированную сборку: игрок получает файл на 27-49% меньше.
    # Эталон без сжатия остаётся в dist/ для гейтов, которые читают исходники.
    src_app = pick("Aeris.html")
    src_editor = pick("BloomScript.html")
    src_studio = pick("AerisStudio.html")
    for p in (src_app, src_editor, src_studio):
        if not os.path.isfile(p):
            log("НЕТ %s — сначала python build.py" % os.path.relpath(p, ROOT))
            return 1

    # Проверяем до копирования: если в файле есть внешние ссылки, на хостинге
    # игра не запустится, и пакет не должен существовать вовсе.
    bad = False
    for p in (src_app, src_editor, src_studio):
        issues = check_self_contained(p)
        name = os.path.basename(p)
        if issues:
            bad = True
            log("ПРОБЛЕМА %s:" % name)
            for i in issues:
                log("    " + i)
        else:
            kb = os.path.getsize(p) // 1024
            log("OK  %s автономен, %d КБ" % (name, kb))
    if bad:
        log("")
        log("Пакет не собран: во внешних ссылках есть ошибка.")
        return 1

    out = os.path.join(ROOT, a.out)
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    pairs = [(src_app, "index.html"), (src_editor, "editor.html"),
             (src_studio, "studio.html")]
    for s, n in pairs:
        shutil.copyfile(s, os.path.join(out, n))
        log("    %s -> %s/%s" % (os.path.basename(s), a.out, n))
    with io.open(os.path.join(out, "README.md"), "w", encoding="utf-8",
                 newline="\n") as f:
        f.write(README)

    if a.zip:
        zp = os.path.join(ROOT, a.out + ".zip")
        if os.path.isfile(zp):
            os.remove(zp)
        # arcname задаём явно: иначе в архив попадает путь "release/...",
        # и после распаковки index.html оказывается не в корне.
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
            for _, n in pairs:
                z.write(os.path.join(out, n), arcname=n)
            z.write(os.path.join(out, "README.md"), arcname="README.md")
        log("    архив: %s (%d КБ)" % (a.out + ".zip",
                                       os.path.getsize(zp) // 1024))

    # Готовые .gz для хостинга. Минификация убрала пробелы и сократила имена,
    # а gzip убирает повторяющиеся куски текста — эффекты складываются.
    # Замерено на проекте: 498 КБ -> около 120 КБ по сети вместо 684 КБ.
    import gzip
    for _, n in pairs:
        p = os.path.join(out, n)
        gz = p + ".gz"
        with open(p, "rb") as fin, gzip.open(gz, "wb", compresslevel=9) as fout:
            shutil.copyfileobj(fin, fout)
        raw = os.path.getsize(p) // 1024
        packed = os.path.getsize(gz) // 1024
        log("    %s.gz: %d КБ -> %d КБ по сети (-%d%%)" % (
            n, raw, packed, 100 - (packed * 100 // max(1, raw))))

    log("")
    log("пакет готов: %s/" % a.out)
    log("файлов: %d, вес: %d КБ" % (
        len(os.listdir(out)),
        sum(os.path.getsize(os.path.join(out, n)) for _, n in pairs) // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())