#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка выравнивания подсветки и курсора в редакторе lang.html."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANG = os.path.join(ROOT, "lang.html")
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.isfile(c):
            return c
    w = shutil.which("chrome") or shutil.which("msedge")
    if w:
        return w
    sys.exit("Chrome не найден")


def main():
    chrome = find_chrome()
    profile = tempfile.mkdtemp(prefix="caret")
    url = "file:///" + LANG.replace("\\", "/") + "?probe=caret"
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--virtual-time-budget=6000", "--user-data-dir=" + profile, "--dump-dom", url]
    try:
        dom = subprocess.run(cmd, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=180).stdout or ""
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    m = re.search(r'<pre id="caretreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL отчёт не найден")
        for frag in ("Uncaught", "SyntaxError"):
            i = dom.find(frag)
            if i >= 0:
                print("  " + " ".join(dom[max(0, i - 100):i + 200].split()))
        return 1
    txt = re.sub(r"<[^>]+>", "", m.group(1))
    for line in txt.splitlines():
        line = line.strip()
        if line:
            print("  " + line)
    return 0 if "ВЫРАВНИВАНИЕ: OK" in txt else 1


if __name__ == "__main__":
    sys.exit(main())
