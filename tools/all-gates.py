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

# Без этой строки прогон молча умирал на печати: консоль Windows отдаёт
# русский текст в cp1251, и первый же отчёт с «секунд» ронял оркестратор
# UnicodeEncodeError — все гейты успевали отработать, а итог не печатался.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

FAST = [
    ("синтаксис index", "run-tests.py", ["--syntax"]),
    ("движок", "run-tests.py", ["--engine"]),
    ("поведение", "run-tests.py", ["--behaviour"]),
    ("BloomScript", "lang-tests.py", []),
    ("песочница+лимиты", "limit-gate.py", []),
    ("свой счётчик интерпретатора", "i0-gate.py", []),
    ("Studio: модель сцены", "studio-gate.py", []),
    ("Studio: страница", "studio-page-gate.py", []),
    ("хранилище", "store-gate.py", []),
    ("профилировщик", "profile-gate.py", []),
    ("бэкенд WebGL2", "e3gl-gate.py", []),
    ("номера строк", "gutter-gate.py", []),
    ("мост", "bridge-gate.py", []),
    ("круг редактор-приложение", "roundtrip-gate.py", []),
    # Сборка целостности: сам выполняет build.py --no-verify и проверяет,
    # что запись атомарна. Пишет только в dist/, исходники не трогает.
    ("сборка целостность", "build-gate.py", []),
]
FULL = [
    ("100 игр", "run-tests.py", ["--all", "--budget", "120000"]),
]

# Гейты, которые МЕРЯЮТ ВРЕМЯ. Их нельзя гнать вместе с остальными:
# они сравнивают «стало ли быстрее», а на соседних гейтах процессор
# загружен, и проверка падает без всякой причины. Раньше fill-gate
# выдавал «провалено 1» только когда шёл в общей куче.
TIMING = [
    ("сетка отсечения", "grid-gate.py", []),
    ("адаптивная заливка", "fill-gate.py", []),
    ("шаг и пул", "time-gate.py", []),
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
    light_only = "--light" in sys.argv
    t0 = time.time()
    bad = []

    # Порядок важен и определяется зависимостями, а не только скоростью.
    #
    # 1. Лёгкие гейты — все сразу: каждый поднимает свой Chrome, они
    #    независимы, и вместе занимают время самого долгого, а не сумму.
    # 2. Движок и поведение — тоже вместе, но ОТДЕЛЬНО от лёгких: на
    #    прошлом прогоне в общей куче они растянулись с 353/403 с до 778 с.
    # 3. Сборка — build-gate.py уже отработал в фазе лёгких гейтов и
    #    оставил в dist/ свежие файлы, поэтому повторно строить не нужно.
    # 4. Офлайн-проверка — строго после сборки: она читает dist/, и при
    #    параллельном запуске попадала в файл посреди записи.
    light = [j for j in FAST if "движок" not in j[0] and "поведение" not in j[0]]
    heavy = [j for j in FAST if "движок" in j[0] or "поведение" in j[0]]
    if full:
        heavy = heavy + FULL

    print("=== лёгкие гейты (параллельно) ===")
    bad += run_parallel(light)

    print("\n=== гейты времени (по одному — они меряют скорость) ===")
    for job in TIMING:
        bad += run_parallel([job])

    if not light_only:
        print("\n=== движок и поведение ===")
        bad += run_parallel(heavy)

        print("\n=== офлайн-сборка (после сборки) ===")
        bad += run_parallel([("офлайн-сборка", "dist-gate.py", [])])
    else:
        print("\n(движок и поведение пропущены — флаг --light)")

    print("\nвремя всего: %.1f с" % (time.time() - t0))
    if bad:
        print("НЕ ПРОШЛИ: " + ", ".join(bad))
        return 1
    print("ВСЕ ГЕЙТЫ ПРОШЛИ")
    return 0


if __name__ == "__main__":
    sys.exit(main())