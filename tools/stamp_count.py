# -*- coding: utf-8 -*-
"""Сборщик подставляет настоящее число игр вместо метки.

Зачем. Описание для ссылки и картинка для ссылки собираются как
обычные файлы, и браузер-поисковик или мессенджер не выполняет
скрипты. Значит число там может быть только одно — и оно должно
быть настоящим, а не написанным от руки.

В исходниках стоит {{GAMES}}. Здесь оно заменяется на реальное
число из данных. Проверка site-gate падает, если метка осталась.
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gamecount import count_games  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def stamp(paths):
    n, uniq = count_games()
    if n != uniq:
        raise SystemExit("в каталоге %d игр, а уникальных id %d — "
                         "кто-то забудет про это на публичном сайте"
                         % (n, uniq))
    for rel in paths:
        p = os.path.join(ROOT, rel)
        if not os.path.isfile(p):
            continue
        t = io.open(p, encoding="utf-8").read()
        if "{{GAMES}}" not in t:
            continue
        out = t.replace("{{GAMES}}", str(n))
        io.open(p, "w", encoding="utf-8", newline="\n").write(out)
        print("  %s: подставлено %d" % (rel, n))
    return n


if __name__ == "__main__":
    stamp(["dist/Aeris.html", "dist/AerisStudio.html", "dist/BloomScript.html"])