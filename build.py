#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сборщик AERIS.

Задача: приложение должно работать офлайн одним файлом (открыл index.html —
и играешь), но код при этом живёт в куче модулей, а не в монолите на полмегабайта.

Как это работает:
  src/engine/*.js и прочие *.js  — модули движка, подключаются в index.html
                                   через <script src="src/...">.
  index.html / lang.html         — «исходники»: разметка + собственный скрипт.

build.py делает две вещи:

  python build.py            → dist/Aeris.html   (приложение одним файлом)
                              dist/BloomScript.html    (редактор одним файлом)

Модули инлайнятся на место тега <script src="...">. Порядок не меняется:
файл подключается раньше основного скрипта, значит и в сборке движок должен
оказаться раньше него. Поэтому инлайн идёт по порядку возрастания src,
а не по алфавиту.

Проверка сборки: после сборки гоняются штатные гейты tools/run-tests.py.
"""

import html
import io
import os
import re
import shutil
import subprocess
import sys
import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
TOOLS = os.path.join(ROOT, "tools")

# Без этой строки сборщик молча умирал на печати: консоль Windows отдаёт
# русский текст в cp1251, и первый отчёт с «байт» ронял процесс
# UnicodeEncodeError уже ПОСЛЕ того, как файлы были записаны.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Имя исходника -> имя собранного файла.
TARGETS = [
    ("index.html", "Aeris.html"),
    ("lang.html", "BloomScript.html"),
    ("studio.html", "AerisStudio.html"),
]

SRC_RE = re.compile(
    r'^[ \t]*<script\s+src=["\']([^"\']+)["\']\s*></script>[ \t]*\r?\n?',
    re.M,
)


def log(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def find_chrome():
    for c in (
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ):
        if os.path.isfile(c):
            return c
    w = shutil.which("chrome") or shutil.which("google-chrome") or shutil.which("chromium")
    return w


def resolve(src_rel, depth=0):
    """Путь из атрибута src -> абсолютный путь на диске.

    Ссылка в HTML пишется от корня проекта: src="src/engine/e3.js",
    поэтому отсчитываем от ROOT, а не от SRC.
    """
    if depth > 8:
        sys.exit("слишком глубокая вложенность script src: " + src_rel)
    p = os.path.normpath(os.path.join(ROOT, src_rel.replace("/", os.sep)))
    if not os.path.isfile(p):
        sys.exit("НЕТ ФАЙЛА: %s (на диске искали %s)" % (src_rel, p))
    return p


def inline(html_text, label):
    """Заменяет <script src=...> на содержимое файла. Возвращает (текст, счётчик)."""
    n = 0

    def repl(m):
        nonlocal n
        rel = m.group(1)
        path = resolve(rel)
        with io.open(path, encoding="utf-8") as f:
            code = f.read()
        # </script> внутри строковых литералов закрыл бы инлайн-тег.
        code = code.replace("</script>", "<\\/script>")
        n += 1
        log("    %-34s %6d Б  (%s)" % (rel, len(code.encode("utf-8")), label))
        return "<!-- %s -->\n<script>\n%s\n</script>\n" % (rel, code)

    return SRC_RE.sub(repl, html_text), n


def build():
    if not os.path.isdir(DIST):
        os.makedirs(DIST)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    results = []
    for entry, outname in TARGETS:
        src_html = os.path.join(ROOT, entry)
        if not os.path.isfile(src_html):
            log("ПРОПУЩЕН %s — файла нет" % entry)
            continue
        with io.open(src_html, encoding="utf-8") as f:
            text = f.read()
        refs = len(SRC_RE.findall(text))
        log("")
        log("=== %s -> dist/%s ===" % (entry, outname))
        if refs == 0:
            log("    внешних модулей нет, копия как есть")
        text, n = inline(text, entry)
        if n != refs:
            log("    ВНИМАНИЕ: найдено тегов %d, инлайнено %d" % (refs, n))
        out = os.path.join(DIST, outname)
        # Пишем во временный файл рядом и переименовываем: os.replace
        # атомарен в пределах тома. Если сборку прервут, dist/ останется
        # с прошлым рабочим файлом, а не с наполовину записанным.
        tmp = out + ".building"
        with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, out)
        kb = os.path.getsize(out) // 1024
        log("    готово: dist/%s — %d КБ, модулей встроено %d" % (outname, kb, n))
        results.append((entry, outname, out, kb, n))
    # Подчищаем огрызки прошлых прерванных сборок.
    for f in os.listdir(DIST):
        if f.endswith(".orig") or f.endswith(".building"):
            try:
                os.remove(os.path.join(DIST, f))
                log("  удалён мусор: %s" % f)
            except OSError:
                pass

    log("")
    log("сборка завершена: %s" % stamp)
    return results


def minify(results):
    """Жмёт собранные файлы через tools/minhtml.mjs.

    Зачем отдельный шаг. Гейты проверяют dist/*.html — они читают исходники
    по тексту и должны видеть исходник. Игрок получает другой файл: тот же,
    но ужатый. Проверять надо оба, и build.py пишет ужатый рядом, в dist/min,
    чтобы tools/min-gate.py гонял именно то, что скачает человек.

    Сколько это даёт (замерено на проекте):
        Aeris   684 -> 498 КБ   (-27%)
        BloomScript   328 -> 194 КБ   (-41%)
        AerisStudio  109 ->  56 КБ   (-49%)

    Ниже 500 КБ приложение не ужмётся без потери игр: 285 КБ из 498 — это
    сами сто игр, и esbuild выжимает из них уже почти всё. Разметка весит
    16 КБ и не трогается: выигрыш от склейки пробелов копеечный, а поломка
    вёрстки рядом с inline-элементами — нет.
    """
    log("")
    log("=== МИНИФИКАЦИЯ ===")
    out_dir = os.path.join(DIST, "min")
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    node = shutil.which("node") or "node"
    script = os.path.join(TOOLS, "minhtml.mjs")
    ok = True
    for entry, outname, out, kb, n in results:
        dest = os.path.join(out_dir, outname)
        try:
            r = subprocess.run([node, script, out, dest], cwd=ROOT,
                               capture_output=True, text=True,
                               encoding="utf-8", errors="replace")
        except OSError as e:
            log("  %s: node недоступен (%s), минификация пропущена" % (outname, e))
            continue
        for line in (r.stdout or "").splitlines():
            if line.strip():
                log(line.rstrip())
        for line in (r.stderr or "").splitlines():
            if line.strip():
                log("      " + line.rstrip())
        if r.returncode != 0:
            ok = False
    # Статика офлайна. Воркер и манифест нужны рядом со страницами: на
    # сервере браузер ищет их именно там, где лежит сама страница, и без
    # них офлайн молча не включается. В папку с тремя готовыми файлами
    # их не копируем — там запуск двойным щелчком, а воркер по file:// не
    # работает в принципе, и лишние файлы только путают.
    for f in ("sw.js", "manifest.webmanifest", "icon.svg"):
        src = os.path.join(ROOT, f)
        if os.path.isfile(src):
            for d in (DIST, out_dir):
                shutil.copyfile(src, os.path.join(d, f))
            log("  %s: скопирован в dist/ и dist/min/" % f)

    make_site()
    return ok


SITE_NAMES = {"Aeris.html": "index.html",
              "BloomScript.html": "lang.html",
              "AerisStudio.html": "studio.html"}


def make_site():
    """Папка site/ — ровно то, что уезжает в интернет.

    Зачем она нужна. На хостинге (Cloudflare Pages) отдаётся содержимое
    одной папки. Если указать корень проекта, наружу попадут tools/,
    src/ и docs/ — служебные скрипты проверок, которые никто видеть не
    должен. Поэтому собираем отдельную папку ровно из шести файлов.

    Имена приводятся к человеческим: Aeris.html -> index.html.
    Иначе главная страница была бы aeris.html и по ссылке.

    Папка site/ в git — намеренно. На хостинге нечем собрать проект:
    Python там не запускается, а Cloudflare выполняет только Node.
    """
    site = os.path.join(ROOT, "site")
    if not os.path.isdir(site):
        os.makedirs(site)
    for old in os.listdir(site):
        p = os.path.join(site, old)
        if os.path.isfile(p):
            os.remove(p)
    n = 0
    for src_name, dst_name in SITE_NAMES.items():
        src = os.path.join(ROOT, "dist", "min", src_name)
        if os.path.isfile(src):
            shutil.copyfile(src, os.path.join(site, dst_name))
            n += 1
    for f in ("sw.js", "manifest.webmanifest", "icon.svg", "404.html"):
        src = os.path.join(ROOT, f)
        if os.path.isfile(src):
            shutil.copyfile(src, os.path.join(site, f))
            n += 1
    size = sum(os.path.getsize(os.path.join(site, f)) for f in os.listdir(site))
    log("")
    log("=== ПАПКА ДЛЯ ВЫКЛАДКИ ===")
    log("  site/: %d файлов, %.0f КБ — это всё, что уезжает в интернет" % (n, size / 1024.0))
    return n


def verify(results):
    """Гоняет штатные гейты по СОБРАННОМУ файлу.

    Гейты читают index.html из корня, поэтому собранный файл временно
    подменяется на время прогона и возвращается обратно в finally.
    """
    log("")
    log("=== ПРОВЕРКА СБОРКИ ===")
    ok = True
    for entry, outname, out, kb, n in results:
        if n == 0:
            log("  %s: модулей нет, гейты не меняем" % outname)
            continue
        target = next((x for x in TARGETS if x[0] == entry), None)
        if not target:
            continue
        tester = None
        if entry == "index.html":
            tester = os.path.join(TOOLS, "run-tests.py")
        elif entry == "lang.html":
            tester = os.path.join(TOOLS, "lang-tests.py")
        elif entry == "studio.html":
            tester = os.path.join(TOOLS, "studio-page-gate.py")
        if not (tester and os.path.isfile(tester)):
            log("  %s: нет тестера, пропуск" % outname)
            continue

        # Проверяем ИСХОДНИК, а не собранный файл, и никогда его не подменяем.
        # Раньше ради проверки сборка отодвигалась в .orig, на её место
        # копировался исходник, а тесты шли по исходнику. Прерывание в этом
        # окне оставляло в dist/ исходник вместо сборки — то есть в
        # dist попадало то, что никто не собирал.
        log("  %s: %s" % (outname, os.path.basename(tester)))
        r = subprocess.run([sys.executable, tester], cwd=ROOT,
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        tail = [l for l in r.stdout.splitlines() if l.strip()][-4:]
        for l in tail:
            log("      " + l)
        if r.returncode != 0:
            ok = False
            log("      FAIL (код %d)" % r.returncode)
    log("")
    log("ИТОГ ПРОВЕРКИ: " + ("PASS" if ok else "FAIL"))
    return ok


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        log(__doc__)
        return 0
    if not os.path.isdir(SRC):
        sys.exit("нет каталога src/")
    results = build()
    if not results:
        sys.exit("ничего не собрано")
    min_ok = minify(results)
    if not min_ok:
        log("минификация не удалась — отдавать игрокам нечего, сборка прервана")
        return 1
    if "--no-verify" not in sys.argv:
        if not verify(results):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())