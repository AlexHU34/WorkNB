#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AB-проверка визуальной регрессии движка: рендерит каждую 3D-игру дважды
   (E3.cull=true и E3.cull=false) и печатает расхождения по хэшу PNG.

   Если хэши совпали — отсечение не изменило картинку.
   Если разошлись — игра попала под culling, её нужно посмотреть глазами.
"""
import hashlib, importlib.util, os, re, subprocess, sys, tempfile, shutil

spec = importlib.util.spec_from_file_location("rt", r"C:\MPresent\tools\run-tests.py")
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)

PRE = ("try{localStorage.setItem('bb2_seen','true');localStorage.setItem('bb2_theme','light')}catch(e){};"
       "document.getElementById('coach').classList.remove('show');"
       "document.getElementById('titleScreen').style.display='none';"
       # фон-канвасы со случайными частицами делают рендер недетерминированным
       "['petals','confetti'].forEach(function(i){var n=document.getElementById(i);if(n)n.style.display='none'});"
       "var s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}';"
       "document.head.appendChild(s);")

# только 3D-режимы (у них есть MODES.* с E3)
with open(R.INDEX, encoding="utf-8") as f:
    src = f.read()
modes = sorted(set(re.findall(r"\bmode:\"(\w+)\"", src)), key=lambda s: (len(s), s))
ids = []
for mm in re.finditer(r"\{id:(\d+),title:.*?mode:\"(\w+)\"", src):
    ids.append((int(mm.group(1)), mm.group(2)))
# уникальные mode -> первый id
seen = {}
for i, m in ids:
    seen.setdefault(m, i)
pairs = sorted(seen.items(), key=lambda kv: kv[1])
print("3D-режимов:", len(pairs))

chrome = R.find_chrome()
tmp = tempfile.mkdtemp(prefix="ab_")
prof = tempfile.mkdtemp(prefix="abp_")
diff, same, err = [], 0, []
try:
    for mode, gid in pairs:
        h = {}
        for cull in ("true", "false"):
            boot = ("<script>window.addEventListener('error',function(e){document.title='JSERR '+e.message});"
                    "try{" + PRE + "E3.cull=(" + cull + ");goHome();openGame(" + str(gid) + ");"
                    "}catch(e){document.title='THROW '+e}</script>\n")
            page = src.replace("</body>", boot + "</body>")
            p = os.path.join(tmp, "ab_%s_%s.html" % (gid, cull))
            with open(p, "w", encoding="utf-8", newline="\n") as f:
                f.write(page)
            png = os.path.join(tmp, "s_%s_%s.png" % (gid, cull))
            R.run_chrome(chrome, "file:///" + p.replace("\\", "/"), prof, 9000, shot=png, size="1200,760")
            h[cull] = hashlib.md5(open(png, "rb").read()).hexdigest() if os.path.exists(png) else "NOPNG"
        if h["true"] == "NOPNG" or h["false"] == "NOPNG":
            err.append((mode, gid, h))
        elif h["true"] == h["false"]:
            same += 1
        else:
            diff.append((mode, gid))
    print("-" * 60)
    print("совпало (culling не изменил картинку): %d" % same)
    print("разошлось (стоит посмотреть):        %d" % len(diff))
    for mode, gid in diff:
        print("   %-10s игра %d" % (mode, gid))
    for e in err:
        print("   ОШИБКА", e)
    print("-" * 60)
    print("RESULT: " + ("OK" if not err and len(diff) == 0 else "REVIEW"))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(prof, ignore_errors=True)
