#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скриншоты lang.html: страница целиком + каждый образец в игровом режиме.

    python tools/lang-shots.py            # все кадры
    python tools/lang-shots.py --one 3    # только образец №3
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANG = os.path.join(ROOT, "lang.html")
OUT = os.path.join(ROOT, "_lang_shots")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.isfile(c):
            return c
    for name in ("chrome", "google-chrome", "chromium", "msedge"):
        w = shutil.which(name)
        if w:
            return w
    sys.exit("Chrome/Edge не найден.")


def file_url(path):
    return "file:///" + path.replace("\\", "/")


def shot(chrome, url, png, budget=9000, size="1500,950"):
    profile = tempfile.mkdtemp(prefix="langshot")
    cmd = [
        chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--hide-scrollbars", "--force-device-scale-factor=1",
        "--virtual-time-budget=%d" % budget,
        "--window-size=" + size,
        "--user-data-dir=" + profile,
        "--screenshot=" + png,
        url,
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=budget / 1000.0 + 60)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    return os.path.isfile(png) and os.path.getsize(png) > 2000


def main():
    args = sys.argv[1:]
    only = None
    if "--one" in args:
        only = int(args[args.index("--one") + 1])

    chrome = find_chrome()
    os.makedirs(OUT, exist_ok=True)

    jobs = [("page", "?runsample=1"), ("learn", "?learnview=1"),
            ("learn_list", "?learnview=1&list=1"),
            ("learn_gfx", "?learnview=scene"), ("modules_panel", "?modulesview=1"), ("modules", "?modulesview=1")]
    n = 1
    while True:
        q = "?runsample=%d" % n
        jobs.append(("sample%d" % n, q))
        if n > 12:
            break
        n += 1

    made, missed = [], []
    for name, q in jobs:
        idx = int(name.replace("sample", "")) if name.startswith("sample") else 0
        if only is not None and idx != only:
            continue
        png = os.path.join(OUT, name + ".png")
        if shot(chrome, file_url(LANG) + q, png):
            made.append(name)
            print("  ok  " + name + "  " + str(os.path.getsize(png) // 1024) + " КБ")
        else:
            missed.append(name)
            print("  --  " + name + " (не отрисовался)")

    print("")
    print("готово: %d, пропущено: %d -> %s" % (len(made), len(missed), OUT))
    return 1 if (missed and only is None) else 0


if __name__ == "__main__":
    sys.exit(main())
