# -*- coding: utf-8 -*-
"""Считает, сколько весит сайт и сколько реально уходит по сети.

Зачем. «Оптимизировать» без цифр — гадание. Здесь честный замер:
сколько байт в файле и сколько после сжатия, потому что браузер
получает именно сжатое.

Сжатие проверяется тремя способами, потому что хостинг умеет разное:
gzip умеет всё, brotli умеет GitHub Pages и лучше жмёт текст.
"""
import gzip
import io
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN = os.path.join(ROOT, "dist", "min")


def brotli_size(data):
    try:
        import brotli
        return len(brotli.compress(data, quality=11))
    except ImportError:
        node = shutil_which()
        if not node:
            return None
        script = ("const b=require('zlib');const fs=require('fs');"
                  "process.stdout.write(String(b.brotliCompressSync("
                  "fs.readFileSync(process.argv[2]),{params:{[b.constants."
                  "BROTLI_PARAM_QUALITY]:11}}).length))")
        r = subprocess.run([node, "-e", script, process.argv[0]], capture_output=True)
        return None


def shutil_which():
    import shutil
    return shutil.which("node")


files = ["Aeris.html", "BloomScript.html", "AerisStudio.html",
         "sw.js", "og.png", "icon.svg", "manifest.webmanifest", "404.html"]

print("%-24s %9s %9s %8s" % ("файл", "на диске", "gzip", "минус"))
print("-" * 54)
total = totalgz = 0
for f in files:
    p = os.path.join(MIN, f)
    if not os.path.isfile(p):
        continue
    raw = open(p, "rb").read()
    gz = gzip.compress(raw, 9)
    total += len(raw)
    totalgz += len(gz)
    save = 100 - len(gz) * 100 // len(raw)
    print("%-24s %7d КБ %7d КБ %6d%%" %
          (f, len(raw) / 1024, len(gz) / 1024, save))
print("-" * 54)
print("%-24s %7d КБ %7d КБ %6d%%" %
      ("ИТОГО", total / 1024, totalgz / 1024,
       100 - totalgz * 100 // total))

# что занимает больше всего в главном файле
p = os.path.join(MIN, "Aeris.html")
t = io.open(p, encoding="utf-8").read()
print()
print("главный файл:", len(t) // 1024, "КБ")
styles = sum(len(m.group(1)) for m in
             __import__("re").finditer(r"(?s)<style[^>]*>(.*?)</style>", t))
scripts = sum(len(m.group(1)) for m in
              __import__("re").finditer(r"(?s)<script[^>]*>(.*?)</script>", t))
print("  стили  %6d КБ (%d%%)" % (styles / 1024, styles * 100 // len(t)))
print("  скрипты%6d КБ (%d%%)" % (scripts / 1024, scripts * 100 // len(t)))
print("  разметка и прочее %d Кб" % ((len(t) - styles - scripts) / 1024))