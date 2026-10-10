#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Гейт для lang.html (BloomScript).

Запускает lang.html в headless Chrome с ?selftest=1, ждёт, пока страница
прогонит selfTest(), и читает отчёт из DOM. Так же проверяет, что каждый
встроенный образец парсится и запускается без исключений.

    python tools/lang-tests.py            # полный гейт
    python tools/lang-tests.py --quick    # только selfTest

Код: 0 — всё зелёное, 1 — есть падения.
"""
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
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

DATA_RE = re.compile(r'<pre id="testreport"[^>]*>(.*?)</pre>', re.S)
SAMPLE_RE = re.compile(r'<pre id="samplereport"[^>]*>(.*?)</pre>', re.S)


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.isfile(c):
            return c
    for name in ("chrome", "google-chrome", "chromium", "msedge"):
        w = shutil.which(name)
        if w:
            return w
    sys.exit("Chrome/Edge не найден. Проверь CHROME_CANDIDATES.")


def file_url(path):
    return "file:///" + path.replace("\\", "/")


def run_chrome(chrome, url, budget=20000):
    profile = tempfile.mkdtemp(prefix="langtest")
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-extensions",
        "--allow-file-access-from-files",
        "--virtual-time-budget=%d" % budget,
        "--user-data-dir=" + profile,
        "--dump-dom",
        url,
    ]
    try:
        res = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=budget / 1000.0 + 60,
        )
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    return res.stdout or ""


def unescape(s):
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    s = s.replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
    return s


def parse_report(dom, rx):
    m = rx.search(dom)
    if not m:
        return None
    return [unescape(l).strip() for l in m.group(1).splitlines() if l.strip()]


def dump_error_tail(dom):
    for frag in ("SyntaxError", "Uncaught", "ReferenceError", "TypeError"):
        i = dom.find(frag)
        if i >= 0:
            print("      " + " ".join(dom[max(0, i - 120):i + 200].split()))
            return


def cmd_selftest(chrome):
    dom = run_chrome(chrome, file_url(LANG) + "?selftest=1")
    lines = parse_report(dom, DATA_RE)
    if lines is None:
        print("FAIL  страница не выдала отчёт selfTest — скрипт, вероятно, упал при загрузке")
        dump_error_tail(dom)
        return 1

    fails = [l for l in lines if l.startswith("FAIL")]
    for l in lines:
        if l.startswith("FAIL") or l.startswith("OK") or l.startswith("INFO"):
            if l.startswith("FAIL") or "ИТОГО" in l:
                print("  " + l)
    if fails:
        print("FAIL  selfTest: %d падений" % len(fails))
        return 1
    print("PASS  selfTest")
    return 0


def cmd_samples(chrome):
    dom = run_chrome(chrome, file_url(LANG) + "?samples=1")
    lines = parse_report(dom, SAMPLE_RE)
    if lines is None:
        print("FAIL  образцы не отчитались")
        dump_error_tail(dom)
        return 1
    rc = 0
    for ln in lines:
        print("  " + ln)
        if ln.startswith("FAIL"):
            rc = 1
    if rc == 0:
        print("PASS  образцы")
    return rc


LEARN_RE = re.compile(r'<pre id="learnreport"[^>]*>(.*?)</pre>', re.S)
SANDBOX_RE = re.compile(r'<pre id="sandboxreport"[^>]*>(.*?)</pre>', re.S)

# Вещи, которые программа не должна доставать. Всё остальное — ОК.
SANDBOX_ALLOWED = ("push массива", "toUpperCase строки", "ок:")


def cmd_learn(chrome):
    dom = run_chrome(chrome, file_url(LANG) + "?learn=1")
    lines = parse_report(dom, LEARN_RE)
    if lines is None:
        print("FAIL  обучение не отчиталось")
        dump_error_tail(dom)
        return 1
    rc = 0
    for ln in lines:
        print("  " + ln)
        if ln.startswith("FAIL") or ln.startswith("ИТОГО: есть"):
            rc = 1
    if rc == 0:
        print("PASS  обучение: эталон всех уроков проходит")
    return rc


def cmd_sandbox(chrome):
    """Проверяет, что из языка нельзя выбраться наружу (document, Function, __proto__)."""
    dom = run_chrome(chrome, file_url(LANG) + "?sandbox=1")
    lines = parse_report(dom, SANDBOX_RE)
    if lines is None:
        print("FAIL  песочница: отчёт не получен")
        dump_error_tail(dom)
        return 1
    rc = 0
    for ln in lines:
        name = ln.split(" =>")[0].replace("INFO ", "").strip()
        if name.startswith(SANDBOX_ALLOWED):
            continue
        if "запрещён" in ln or "неизвестная переменная" in ln:
            print("  OK   " + name + " — закрыто")
        else:
            print("  ДЫРА " + name + " → " + ln.split("=>")[-1].strip())
            rc = 1
    if rc == 0:
        print("PASS  песочница: выхода наружу нет")
    return rc


def cmd_syntax(chrome):
    dom = run_chrome(chrome, file_url(LANG) + "?selftest=1", budget=8000)
    bad = [f for f in ("SyntaxError", "ReferenceError", "TypeError", "Uncaught") if f in dom]
    if bad:
        print("FAIL  загрузка lang.html: " + ", ".join(sorted(set(bad))))
        dump_error_tail(dom)
        return 1
    print("PASS  синтаксис lang.html")
    return 0


def main():
    args = sys.argv[1:]
    quick = "--quick" in args
    if not os.path.isfile(LANG):
        sys.exit("Не найден " + LANG)
    chrome = find_chrome()

    print("== синтаксис и загрузка")
    rc = cmd_syntax(chrome)
    if rc:
        return rc

    print("== selfTest")
    rc |= cmd_selftest(chrome)
    if not quick:
        print("== песочница")
        rc |= cmd_sandbox(chrome)
        print("== обучение")
        rc |= cmd_learn(chrome)
        print("== образцы")
        rc |= cmd_samples(chrome)

    print("")
    print("ИТОГ: " + ("все проверки прошли" if rc == 0 else "есть падения"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
