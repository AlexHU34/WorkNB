#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Полный прогон всех гейтов одной командой: tools/all-gates.py.

Гейты делятся на быстрые (секунды) и тяжёлые (полный прогон 100 игр).
По умолчанию идут быстрые; --full добавляет тяжёлые.
"""
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")

FAST = [
    ("синтаксис index", "run-tests.py", ["--syntax"]),
    ("движок", "run-tests.py", ["--engine"]),
    ("поведение", "run-tests.py", ["--behaviour"]),
    ("BloomScript", "lang-tests.py", []),
    ("песочница+лимиты", "limit-gate.py", []),
    ("хранилище", "store-gate.py", []),
    ("профилировщик", "profile-gate.py", []),
    ("сетка отсечения", "grid-gate.py", []),
    ("адаптивная заливка", "fill-gate.py", []),
    ("шаг и пул", "time-gate.py", []),
    ("номера строк", "gutter-gate.py", []),
    ("мост", "bridge-gate.py", []),
    ("круг редактор-приложение", "roundtrip-gate.py", []),
]
FULL = [
    ("100 игр", "run-tests.py", ["--all", "--budget", "120000"]),
]
POST = [
    ("сборка", "build.py", []),
    ("офлайн-сборка", "dist-gate.py", []),
]


def run_one(job):
    """Один гейт в отдельном процессе. Гейты независимы: каждый поднимает
    свой Chrome, поэтому их выгодно гнать одновременно, а не по очереди."""
    name, script, args = job
    t0 = time.time()
    path = script if os.path.isfile(os.path.join(ROOT, script)) \
        else os.path.join(TOOLS, script)
    p = subprocess.run([sys.executable, path] + args,
                       cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    dt = time.time() - t0
    lines = [l.strip() for l in p.stdout.splitlines() if l.strip()]
    tail = lines[-1:] or ["(нет вывода)"]
    return (p.returncode == 0, name, dt, tail[0][:70])


def run_parallel(jobs):
    """Параллельный прогон. Три тяжёлых гейта (движок, поведение, сборка)
    занимали 18 минут по очереди; одновременно это те же гейты, но общее
    время ограничено самым долгим, а не суммой."""
    with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        results = list(ex.map(run_one, jobs))
    bad = []
    for ok_, name, dt, tail in results:
        print("%-6s %-28s %5.1f с  %s" % ("OK" if ok_ else "FAIL", name, dt, tail))
        if not ok_:
            bad.append(name)
    return bad


def run(name, script, args):
    ok_, _, dt, tail = run_one((name, script, args))
    print("%-6s %-28s %5.1f с  %s" % ("OK" if ok_ else "FAIL", name, dt, tail))
    return ok_


def main():
    full = "--full" in sys.argv
    t0 = time.time()
    bad = []

    # Порядок важен и определяется зависимостями, а не только скоростью.
    #
    # 1. Лёгкие гейты — все сразу: каждый поднимает свой Chrome, они
    #    независимы, и вместе занимают время самого долгого, а не сумму.
    # 2. Движок и поведение — тоже вместе, но ОТДЕЛЬНО от лёгких: на
    #    прошлом прогоне в общей куче они растянулись с 353/403 с до 778 с.
    # 3. Сборка — после проверок, и без повторной проверки: build.py сам
    #    гоняет engine и behaviour, а мы их уже прогнали.
    # 4. Офлайн-проверка — строго после сборки: она читает dist/, и при
    #    параллельном запуске попадала в файл посреди записи.
    light = [j for j in FAST if "движок" not in j[0] and "поведение" not in j[0]]
    heavy = [j for j in FAST if "движок" in j[0] or "поведение" in j[0]]
    if full:
        heavy = heavy + FULL

    print("=== лёгкие гейты (параллельно) ===")
    bad += run_parallel(light)

    print("\n=== движок и поведение ===")
    bad += run_parallel(heavy)

    print("\n=== сборка ===")
    bad += run_parallel([("сборка", "build.py", ["--no-verify"])])

    print("\n=== офлайн-сборка (после сборки) ===")
    bad += run_parallel([("офлайн-сборка", "dist-gate.py", [])])

    print("\nвремя всего: %.1f с" % (time.time() - t0))
    if bad:
        print("НЕ ПРОШЛИ: " + ", ".join(bad))
        return 1
    print("ВСЕ ГЕЙТЫ ПРОШЛИ")
    return 0


if __name__ == "__main__":
    sys.exit(main())