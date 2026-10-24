# -*- coding: utf-8 -*-
"""Сверка снимков: вид страниц не поехал после правок.

Снимки снимаются тем же детерминированным способом, что и в
run-tests.py: фиксированное время кадра, seeded random, без анимаций.
Поэтому один и тот же кадр обязан выходить байт в байт одинаковым —
и на этой машине, и в следующем прогоне.

Проверка честная в две ступени:
  1. снимаем набор дважды и сверяем прогоны между собой — если кадр
     «плавает», сверка с эталоном бессмысленна, об этом говорим прямо;
  2. сверяем с эталоном в tools/shots/ref.

Обновить эталон после намеренной правки вида:
    python tools/shots-gate.py --save
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "tools", "shots", "ref")

# Набор короткий намеренно: это сторож вида, а не галерея всех игр.
# Игры с живым ходом сюда не годятся: их кадр зависит от хода часов
# браузера, и повторный прогон даёт другую картинку (проверено:
# maze, tet, cubes между двумя съёмками различаются).
SHOTS = ["modal", "lobby", "builder"]


def shoot(dest):
    os.makedirs(dest, exist_ok=True)
    r = subprocess.run(
        [sys.executable, os.path.join(ROOT, "tools", "run-tests.py"),
         "--shots", dest, "--shots-only", ",".join(SHOTS)],
        cwd=ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace")
    tail = [x for x in (r.stdout or "").splitlines() if x.strip()][-1:]
    print("      " + (tail[0] if tail else "нет ответа съёмки"))
    if r.returncode != 0:
        print("      съёмка не удалась: " + (r.stderr or "")[:200])
    return r.returncode == 0


def files(d):
    return {n: os.path.join(d, n + ".png") for n in SHOTS}


def read(p):
    with io.open(p, "rb") as f:
        return f.read()


def main():
    save = "--save" in sys.argv
    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        print("FAIL  нет index.html")
        return 1

    rc = 0
    tmp = tempfile.mkdtemp(prefix="nbshotgate_")
    try:
        print("=== СЪЁМКА ===")
        a = os.path.join(tmp, "a")
        b = os.path.join(tmp, "b")
        ok_a = shoot(a)
        ok_b = shoot(b)
        if not ok_a or not ok_b:
            print("ИТОГ: съёмка не прошла")
            return 1

        print("")
        print("=== ПОВТОРЯЕМОСТЬ ===")
        stable = True
        for n in SHOTS:
            pa, pb = files(a)[n], files(b)[n]
            if not (os.path.isfile(pa) and os.path.isfile(pb)):
                print("  FAIL  нет кадра " + n)
                stable = False
                continue
            same = read(pa) == read(pb)
            print(("  OK   " if same else "  FAIL ") + "кадр " + n + (" стабилен" if same else " плавает"))
            if not same:
                stable = False
        if not stable:
            rc = 1

        if save:
            if not stable:
                print("")
                print("эталон не тронут: сначала кадры должны стать повторяемыми")
                return rc
            ref_dir = REF
            if os.path.isdir(ref_dir):
                shutil.rmtree(ref_dir, ignore_errors=True)
            os.makedirs(ref_dir, exist_ok=True)
            for n in SHOTS:
                shutil.copyfile(files(a)[n], files(ref_dir)[n])
            print("")
            print("эталон обновлён: %d кадров в tools/shots/ref" % len(SHOTS))
            return rc

        print("")
        print("=== СВЕРКА С ЭТАЛОНОМ ===")
        if not os.path.isdir(REF):
            print("  FAIL  нет эталона — один раз запусти python tools/shots-gate.py --save")
            return 1
        for n in SHOTS:
            pr = files(REF)[n]
            if not os.path.isfile(pr):
                print("  FAIL  эталона нет для кадра " + n)
                rc = 1
                continue
            same = read(pr) == read(files(a)[n])
            print(("  OK   " if same else "  FAIL ") +
                  "кадр " + n + (" совпал" if same else " изменился"))
            if not same:
                rc = 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("")
    print("ИТОГ: " + ("вид на месте" if rc == 0 else "кадры изменились"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
