# -*- coding: utf-8 -*-
"""Штамп перед отправкой: на сайт не должна уезжать старая сборка.

Гит зовёт этот счётчик из .githooks/pre-push перед каждой отправкой
на GitHub (включено через core.hooksPath=.githooks).

Две беды, которые он ловит:
  * исходники и страницы поменялись, а site/ не пересобран — хостинг
    покажет прежнюю версию, и человек будет искать правку, которой
    на сайте нет;
  * в site/sw.js осталась заглушка метки кэша — тогда старый кэш
    переживает выкладку, и игроки видят вчерашний сайт.

Обойти нарочно можно: SKIP_STAMP=1 git push
"""
import io
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Что считается исходником выкладки: страницы, стили, код, сам сборщик.
INPUTS = ["src", "index.html", "studio.html", "lang.html", "index.css",
          "build.py", "sw.js", "manifest.webmanifest",
          "tools/stamp_count.py", "tools/minhtml.mjs"]


def git_time(path):
    r = subprocess.run(["git", "log", "-1", "--format=%ct", "--", path],
                       cwd=ROOT, capture_output=True, text=True)
    t = (r.stdout or "").strip()
    return int(t) if t.isdigit() else 0


def main():
    if os.environ.get("SKIP_STAMP") == "1":
        print("  штамп пропущен по просьбе человека (SKIP_STAMP=1)")
        return 0

    newest_in = 0
    where = ""
    for p in INPUTS:
        if not os.path.exists(os.path.join(ROOT, p)):
            continue
        t = git_time(p)
        if t > newest_in:
            newest_in, where = t, p

    site_time = git_time("site")
    if not os.path.isdir(os.path.join(ROOT, "site")):
        print("  ПРОВАЛ: папки site/ нет — сначала python build.py")
        return 1
    if not site_time:
        print("  ПРОВАЛ: site/ ещё ни разу не сохранялся в историю — сначала python build.py")
        return 1
    if newest_in > site_time:
        print("  ПРОВАЛ: папка site/ старше исходника «%s»" % where)
        print("          на сайт уехала бы старая сборка — запусти python build.py")
        return 1

    swp = os.path.join(ROOT, "site", "sw.js")
    if not os.path.isfile(swp):
        print("  ПРОВАЛ: в site/ нет воркера — сборка неполная")
        return 1
    sw = io.open(swp, encoding="utf-8").read()
    if "__BUILDSTAMP__" in sw:
        print("  ПРОВАЛ: в site/sw.js осталась заглушка метки кэша")
        print("          игроки увидели бы прежнюю версию — запусти python build.py")
        return 1

    print("  штамп свежий: сборка не старше исходников, метка кэша на месте")
    return 0


if __name__ == "__main__":
    sys.exit(main())
