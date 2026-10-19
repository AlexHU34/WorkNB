# -*- coding: utf-8 -*-
"""Убивает ТОЛЬКО тестовый Chrome. Обычный браузер не трогает.

Зачем эта штука существует. Раньше чистка выполнялась так:
`Get-Process chrome | Stop-Process -Force`. Это выглядит безобидно,
но убивает ВСЕ процессы Chrome — включая твой обычный браузер со
всеми открытыми вкладками. Так случилось.

Как отличить тестовый от обычного. Тестовый Chrome всегда запускается
с `--user-data-dir=` и временной папкой в каталоге TEMP. У обычного
браузера такой папки нет: он работает со своим профилем в профиле
пользователя. Поэтому правило простое и точное:

    если в командной строке нет --user-data-dir из TEMP — не трогаем.

Чем пользоваться
    python tools/kill-test-chrome.py          # показать, кого найдел
    python tools/kill-test-chrome.py --kill   # закрыть только тестовые
"""
import os
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")

TEMP = os.path.normcase(os.path.abspath(tempfile.gettempdir()))


def chrome_processes():
    """Возвращает список (pid, командная строка) для Chrome и Edge."""
    out = []
    try:
        # wmic убран из новых Windows, поэтому powershell
        ps = ("Get-CimInstance Win32_Process -Filter "
              "\"Name='chrome.exe' or Name='msedge.exe'\" | "
              "ForEach-Object { '{0}`t{1}' -f $_.ProcessId, "
              "$_.CommandLine }")
        raw = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                             capture_output=True, text=True,
                             encoding="utf-8", errors="replace",
                             timeout=60).stdout
    except Exception as e:  # noqa: BLE001
        print("не удалось получить список процессов:", e)
        return out

    for line in raw.splitlines():
        if "`t" not in line:
            continue
        pid, cmd = line.split("`t", 1)
        try:
            out.append((int(pid.strip()), cmd.strip()))
        except ValueError:
            continue
    return out


def is_test_chrome(cmd):
    """Тестовый ли это Chrome.

    Только два признака одновременно: есть --user-data-dir, и он
    указывает во временную папку Windows. Второй признак обязателен:
    иначе под правило попал бы обычный браузер, если бы он когда-нибудь
    запускался с временным профилем.
    """
    if "--user-data-dir=" not in cmd:
        return False
    part = cmd.split("--user-data-dir=", 1)[1]
    profile = part.split()[0] if part.split() else ""
    if not profile:
        return False
    profile = os.path.normcase(os.path.abspath(profile.strip('"')))
    return profile.startswith(TEMP + os.sep)


def main():
    kill = "--kill" in sys.argv
    procs = chrome_processes()
    test, user = [], []
    for pid, cmd in procs:
        (test if is_test_chrome(cmd) else user).append((pid, cmd))

    print("тестовых Chrome: %d" % len(test))
    print("обычных Chrome/Edge: %d  (их не трогаем)" % len(user))

    if not test:
        print("\nзависших тестовых процессов нет — убирать нечего")
        return 0

    for pid, cmd in test:
        prof = cmd.split("--user-data-dir=", 1)[1].split()[0].strip('"')
        print("  pid %-7d %s" % (pid, os.path.basename(prof.rstrip("\\/"))))

    if not kill:
        print("\nэто был пробный прогон, ничего не закрыто")
        print("чтобы закрыть только их: python tools/kill-test-chrome.py --kill")
        return 0

    for pid, _ in test:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True)
    print("\nзакрыто тестовых процессов: %d" % len(test))
    print("обычный браузер не тронут")
    return 0


if __name__ == "__main__":
    sys.exit(main())