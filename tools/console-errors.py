#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Показывает ошибки загрузки страницы в консоли Chrome: tools/console-errors.py [query]"""
import re
import shutil
import subprocess
import sys
import tempfile

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.isfile(c) if False else False:
            pass
    import os
    for c in CHROME_CANDIDATES:
        if os.path.isfile(c):
            return c
    return None


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else "?selftest=1"
    chrome = find_chrome()
    if not chrome:
        sys.exit("Chrome не найден")
    profile = tempfile.mkdtemp(prefix="conerr")
    # Путь к редактору считаем от этого файла: проект переехал в Work AI.
    lang = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "lang.html")
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--enable-logging=stderr", "--virtual-time-budget=6000",
           "--user-data-dir=" + profile, "--dump-dom",
           "file:///" + lang.replace("\\", "/") + query]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    shutil.rmtree(profile, ignore_errors=True)
    found = False
    for line in (r.stderr or "").splitlines():
        if "CONSOLE" in line:
            print("  " + line[:400])
            found = True
    if not found:
        print("  ошибок в консоли нет")


if __name__ == "__main__":
    sys.exit(main())