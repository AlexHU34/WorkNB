# -*- coding: utf-8 -*-
"""Считает игры в данных правильно.

Первая попытка искала все «{id:» подряд и выдала 113 вместо 100:
двенадцать лишних нашлись в других списках — детали, достижения,
магазин, герой. У всех у них тоже есть поле id.

Правильный способ — вырезать только сам массив GAMES и посчитать
внутри него. Скобки считаются по глубине, поэтому содержимое внутри
игр не сбивает счётку.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def games_array(src):
    """Возвращает текст массива GAMES целиком."""
    i = src.find("const GAMES=")
    if i < 0:
        raise SystemExit("список GAMES не найден")
    start = src.index("[", i)
    depth = 0
    in_str = None
    for j in range(start, len(src)):
        ch = src[j]
        if in_str:
            if ch == in_str and src[j - 1] != "\\":
                in_str = None
            continue
        if ch in "\"'`":
            in_str = ch
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return src[start:j + 1]
    raise SystemExit("массив GAMES не закрыт")


def count_games():
    src = io.open(os.path.join(ROOT, "src", "app", "data.js"),
                  encoding="utf-8").read()
    arr = games_array(src)
    ids = re.findall(r"\{\s*id\s*:", arr)
    # Проверяем, что id уникальны: иначе в меню будут одинаковые карточки.
    found = re.findall(r"\{\s*id\s*:\s*([0-9A-Za-z_\"']+)", arr)
    uniq = len(set(found))
    if uniq != len(ids):
        print("ВНИМАНИЕ: игр %d, а уникальных id %d" % (len(ids), uniq))
    return len(ids), uniq


if __name__ == "__main__":
    n, u = count_games()
    print("игр в массиве: %d, уникальных id: %d" % (n, u))