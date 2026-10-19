#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run-tests.py — пргон автотестов AERIS в headless Chrome.

Использование:
    python tools/run-tests.py                 # полный прогон всех игр (ворота)
    python tools/run-tests.py --behaviour     # только поведенческие проверки
    python tools/run-tests.py --games 1,2,15  # только указанные игры
    python tools/run-tests.py --game 15       # одна игра
    python tools/run-tests.py --shots outdir  # отрендерить скриншоты игр
    python tools/run-tests.py --list          # показать список id игр

Требуется установленный Chrome/Edge. Код возврата != 0, если есть ошибки.

Как это работает:
  1. index.html копируется во временный файл и в конец <body> добавляется
     tools/harness.js (через ?harness=... в URL) плюс rAF-прокси: headless
     почти не крутит animation frames, а игровые циклы живут именно на них.
  2. Chrome запускается с --virtual-time-budget, чтобы таймеры шли мгновенно.
  3. Скрипт парсит <pre id="__report"> из выгруженного DOM.
"""
import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
HARNESS = os.path.join(ROOT, "tools", "harness.js")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

# rAF через таймеры: в headless + virtual-time настоящие кадры почти не идут,
# а без них игровые циклы не проверяются.
RAF_SHIM = (
    "<script>(function(){"
    "window.requestAnimationFrame=function(cb){return setTimeout(function(){"
    "try{cb(performance.now())}"
    "catch(e){window.__rafErr=window.__rafErr||[];window.__rafErr.push(String(e)+' @'+(e.lineno||'?'))}},4)};"
    "window.cancelAnimationFrame=function(i){clearTimeout(i)};"
    "})();</script>"
)

# ловим синтаксические ошибки страницы до запуска харнесса
GUARD = (
    "<script>window.addEventListener('error',function(e){"
    "document.title='JSERR '+(e.message||e.error)+' @'+(e.lineno||'?')"
    # стек нужен, чтобы отличать «движок получил undefined» от «игра передала мусор»
    "+(e.error&&e.error.stack?' @@ '+String(e.error.stack).slice(0,600):'');});</script>"
)


def find_chrome():
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    which = shutil.which("chrome") or shutil.which("google-chrome") or shutil.which("chromium")
    if which:
        return which
    sys.exit("Chrome/Edge не найден. Укажи путь в CHROME_CANDIDATES.")


def read_index():
    with open(INDEX, encoding="utf-8") as f:
        return f.read()


def copy_src_tree(tmpdir):
    """Копирует src/ рядом с тестовой страницей.

    index.html подключает движок как <script src="src/engine/e3.js">.
    Тестовая страница живёт во временном каталоге, поэтому относительный путь
    должен вести в скопированное дерево, иначе E3 не определится.
    """
    srcdir = os.path.join(ROOT, "src")
    if not os.path.isdir(srcdir):
        return
    dst = os.path.join(tmpdir, "src")
    if os.path.isdir(dst):
        return
    shutil.copytree(srcdir, dst)


def make_page(tmpdir, query, extra_head=""):
    """Собирает тестовую страницу: index.html + src/ + rAF-шим + гард + harness.

    Харнесс инлайнится намеренно: внешний <script src> для file://-страниц
    ненадёжен, а лишний файл в tmpdir добавляет путей для ошибок.
    Модули движка наоборот остаются файлами — их копирует copy_src_tree.
    """
    src = read_index()
    with open(HARNESS, encoding="utf-8") as f:
        h = f.read()
    if "</script" in h.lower():
        sys.exit("harness.js не должен содержать '</script' — он инлайнится в страницу")
    copy_src_tree(tmpdir)
    boot = RAF_SHIM + GUARD + extra_head
    page = src.replace("<body>", "<body>\n" + boot, 1)
    page = page.replace("</body>", "<script>\n" + h + "\n</script>\n</body>")
    path = os.path.join(tmpdir, "page.html")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    return path, h


def run_chrome(chrome, url, profile, budget, shot=None, size=None):
    """Запускает Chrome и возвращает выгруженный DOM (--dump-dom).

    --dump-dom нужен всегда; --screenshot добавляется по желанию.

    Про таймаут. Раньше его здесь не было во��се, и из-за этого тяжёлые
    прогоны не падали с ошибкой, а висели бесконечно: Chrome получает
    виртуальный бюджет времени (по умолчанию 400 секунд) и успевает
    отрисовать столько, сколько успевает, а вс�� остальное Python
    ждал вечно. Теперь есть потолок: он считается от бюджета, потому
    что виртуальное время всё равно тратит реальное на отрисовку.
    """
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--user-data-dir=" + profile, "--hide-scrollbars",
           "--virtual-time-budget=" + str(budget), "--allow-file-access-from-files"]
    if size:
        cmd.append("--window-size=" + size)
    if shot:
        cmd.append("--screenshot=" + shot)
    cmd.append("--dump-dom")
    cmd.append(url)

    # Виртуальный бюджет — это верхняя граница, а не точное время.
    # Реальное время больше: та же картинка рисуется по-настоящему.
    # Поэтому потолок ставим щедрый, но конечный.
    limit = max(120, budget / 1000.0 + 150)
    try:
        res = subprocess.run(cmd, capture_output=True, text=True,
                             encoding="utf-8", errors="replace",
                             timeout=limit)
    except subprocess.TimeoutExpired:
        sys.stderr.write(
            "Chrome не уложился в %.0f с (виртуальный бюджет %d мс).\n"
            "Это не поломка сайта: бюджет просто слишком большой.\n"
            "Попробуй --budget поменьше.\n" % (limit, budget))
        return ""
    if not res.stdout.strip():
        sys.stderr.write(res.stderr[-2000:] + "\n")
    return res.stdout


def parse_report(dom):
    m = re.search(r'<pre id="__report"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        return None
    raw = html.unescape(m.group(1))
    if raw.startswith("DONE"):
        raw = raw[4:]
    return json.loads(raw)


def page_title(dom):
    m = re.search(r"<title>(.*?)</title>", dom, re.S)
    return m.group(1) if m else ""


def cmd_syntax(args, chrome):
    """Проверка синтаксиса ВСЕГО кода: модулей и встроенных скриптов.

    Раньше проверялся только последний встроенный <script> главной
    страницы. После того как игры, данные и логика уехали в src/app/*.js,
    встроенного скрипта в index.html не осталось — и проверка молча падала
    на пустом месте (0 секунд, нет вывода), не сообщая почему.

    Теперь проверяется всё, и каждый файл отдельно:
      * все .js под src/ — через node --check, это мгновенно и точно;
      * встроенные <script> без src во всех трёх страницах.
    SyntaxError означает, что файл не выполнится вообще, поэтому проверка
    идёт без выполнения: разметка и DOM не нужны.
    """
    root = ROOT
    bad = []
    checked = 0

    node = shutil.which("node") or "node"
    js_files = []
    for dirpath, dirnames, filenames in os.walk(os.path.join(root, "src")):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in filenames:
            if fn.endswith(".js"):
                js_files.append(os.path.join(dirpath, fn))
    js_files.sort()
    for path in js_files:
        checked += 1
        r = subprocess.run([node, "--check", path], capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            first = (r.stderr or "").strip().splitlines()
            msg = next((l for l in first if "Error" in l), first[0] if first else "?")
            bad.append("модуль %s: %s" % (os.path.relpath(path, root), msg.strip()))

    for page_name in ("index.html", "lang.html", "studio.html"):
        page_path = os.path.join(root, page_name)
        if not os.path.isfile(page_path):
            continue
        with open(page_path, encoding="utf-8") as f:
            page = f.read()
        for k, m in enumerate(re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>",
                                          page, re.S)):
            code = m.group(1)
            if not code.strip():
                continue
            checked += 1
            tmp = tempfile.mkdtemp(prefix="syn_")
            try:
                p = os.path.join(tmp, "in.html.js")
                with open(p, "w", encoding="utf-8", newline="\n") as f:
                    f.write(code.replace("</script>", "<\\/script>"))
                r = subprocess.run([node, "--check", p], capture_output=True,
                                   text=True, encoding="utf-8", errors="replace")
                if r.returncode != 0:
                    first = (r.stderr or "").strip().splitlines()
                    msg = next((l for l in first if "Error" in l),
                               first[0] if first else "?")
                    bad.append("%s, встроенный скрипт #%d: %s" % (page_name, k + 1, msg.strip()))
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

# ЛИНТ: requestAnimationFrame в конце тела цикла. Такой вызов удваивает
    # цепочку каждый кадр (в начале тела уже есть raf=...requestAnimationFrame),
    # и Chrome зависает насмерть, а гейт молчит. Раньше проверка смотрела
    # только на последний встроенный скрипт; теперь — на все файлы, потому
    # что игры с такими циклами уехали в src/app/games.js.
    for path in js_files:
        with open(path, encoding="utf-8") as f:
            code = f.read()
        ls = code.split("\n")
        dbl = [i + 1 for i, l in enumerate(ls)
               if l.strip().endswith("requestAnimationFrame(loop)};")
               or l.strip().endswith("requestAnimationFrame(loop);}")]
        if dbl:
            print("FAIL  дублирующий requestAnimationFrame :: %s, строки %s" % (
                os.path.relpath(path, root), ", ".join(str(x) for x in dbl[:8])))
            for n in dbl[:8]:
                print("      %5d: %s" % (n, ls[n - 1][:150]))
            bad.append(os.path.relpath(path, root))

    if bad:
        print("FAIL  синтаксис или цикл: %d из %d" % (len(bad), checked))
        return 1
    print("PASS  синтаксис верен: файлов и скриптов проверено %d" % checked)
    return 0


# --------------------------------------------------------------------- smoke
def cmd_smoke(args, chrome):
    tmpdir = tempfile.mkdtemp(prefix="nbtest_")
    profile = tempfile.mkdtemp(prefix="nbprof_")
    try:
        q = "?harness=smoke"
        if args.games:
            q += "&games=" + args.games
        path, _ = make_page(tmpdir, q)
        url = "file:///" + path.replace("\\", "/") + q
        dom = run_chrome(chrome, url, profile, args.budget)
        title = page_title(dom)
        if title.startswith("JSERR"):
            print("FAIL  синтаксическая ошибка страницы: " + title)
            return 1
        rep = parse_report(dom)
        if rep is None:
            print("FAIL  харнесс не отдал отчёт (страница не дошла до конца?)")
            return 1

        games = [r for r in rep if "game" in r and r.get("game") != 0]
        lobby = [r for r in rep if r.get("game") == 0 and "lobby" in r]
        bad = 0
        for r in games:
            e = r.get("errs") or r.get("lobby") or []
            fatal = r.get("fatal")
            if e or fatal or r.get("leftoverModes"):
                bad += 1
                print("FAIL  игра %-4s кадров=%-5s .mode=%s деталей=%s" % (
                    r.get("game"), r.get("frames"), r.get("leftoverModes"), r.get("parts")))
                if fatal:
                    print("        " + fatal)
                for x in e:
                    print("        " + x)

        frames = [r["frames"] for r in games if "frames" in r]
        idle = [r["game"] for r in games if r.get("frames", 0) < 20]
        leaks = sum(1 for r in games if r.get("leftoverModes"))
        print("-" * 66)
        print("прогнано игр      : %d" % len(games))
        print("из них с ошибками : %d" % bad)
        print("кадров всего      : %d (мин %s, макс %s)" % (
            sum(frames), min(frames) if frames else "-", max(frames) if frames else "-"))
        print("утечек .mode      : %d" % leaks)
        print("не крутились (<20): %s" % (idle or "нет"))
        print("лобби             : %s" % ("ok" if lobby and not lobby[0]["lobby"] else lobby))
        ok = bad == 0 and leaks == 0 and not idle
        print("-" * 66)
        print("GATE: " + ("PASS" if ok else "FAIL"))
        return 0 if ok else 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


# ----------------------------------------------------------------- behaviour
def cmd_behaviour(args, chrome):
    tmpdir = tempfile.mkdtemp(prefix="nbtest_")
    profile = tempfile.mkdtemp(prefix="nbprof_")
    try:
        q = "?harness=beh"
        path, _ = make_page(tmpdir, q)
        url = "file:///" + path.replace("\\", "/") + q
        dom = run_chrome(chrome, url, profile, args.budget)
        title = page_title(dom)
        if title.startswith("JSERR"):
            print("FAIL  синтаксическая ошибка страницы: " + title)
            return 1
        rep = parse_report(dom)
        if rep is None:
            print("FAIL  харнесс не отдал отчёт")
            return 1
        bad = 0
        for r in rep:
            if "check" not in r:
                continue
            tag = "PASS" if r["pass"] else "FAIL"
            if not r["pass"]:
                bad += 1
            extra = ""
            if r.get("extra") is not None:
                extra = " :: " + json.dumps(r["extra"], ensure_ascii=False)
            print("%s  %s%s" % (tag, r["check"], extra))
        print("-" * 66)
        print("проверок: %d, провалено: %d" % (len(rep), bad))
        print("GATE: " + ("PASS" if bad == 0 else "FAIL"))
        return 0 if bad == 0 else 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


# ------------------------------------------------------------------ engine
def cmd_engine(args, chrome):
    tmpdir = tempfile.mkdtemp(prefix="nbtest_")
    profile = tempfile.mkdtemp(prefix="nbprof_")
    try:
        path, _ = make_page(tmpdir, "")
        # бюджет маленький: тест синхронный, просто ждём его старт
        url = "file:///" + path.replace("\\", "/") + "?harness=e3"
        dom = run_chrome(chrome, url, profile, min(args.budget, 6000))
        title = page_title(dom)
        if title.startswith("JSERR"):
            print("FAIL  синтаксическая ошибка страницы: " + title)
            return 1
        rep = parse_report(dom)
        if not rep:
            print("FAIL  engine-тесты не отдали отчёт (пусто)")
            return 1
        checks = []
        for entry in rep:
            if "engine" in entry:
                checks = entry["engine"]
        if not checks:
            print("FAIL  в отчёте нет результатов engine-тестов")
            print("      отчёт: " + json.dumps(rep, ensure_ascii=False)[:300])
            return 1
        bad = 0
        for r in checks:
            tag = "PASS" if r["pass"] else "FAIL"
            if not r["pass"]:
                bad += 1
            extra = ""
            if r.get("extra") is not None:
                extra = " :: " + json.dumps(r["extra"], ensure_ascii=False)
            print("%s  %s%s" % (tag, r["check"], extra))
        print("-" * 66)
        print("проверок: %d, провалено: %d" % (len(checks), bad))
        print("GATE: " + ("PASS" if bad == 0 else "FAIL"))
        return 0 if bad == 0 else 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


# --------------------------------------------------------------------- shots
SHOTS = {
    # модалка — там .ach-чипы с фиксированным светлым фоном, контраст ловим глазами
    "modal": "goHome();openModal(1);",
    "lobby": "", "builder": "goHome();openGame(1);",
    "mem": "goHome();openGame(11);", "maze": "goHome();openGame(22);",
    "color": "goHome();openGame(12);", "quiz": "goHome();openGame(14);",
    "run3d": "goHome();openGame(15);", "tycoon": "goHome();openGame(16);",
    "flower3d": "goHome();openGame(21);", "tower": "goHome();openGame(23);",
    "wheel": "goHome();openGame(26);", "catch": "goHome();openGame(31);",
    "shoot": "goHome();openGame(34);", "cubes": "goHome();openGame(35);",
    "snake": "goHome();openGame(36);", "slide": "goHome();openGame(38);",
    "bowl": "goHome();openGame(39);", "ark": "goHome();openGame(40);",
    "golf": "goHome();openGame(41);", "pin": "goHome();openGame(44);",
    "tet": "goHome();openGame(45);", "jump": "goHome();openGame(46);",
    "pool": "goHome();openGame(48);", "hoops": "goHome();openGame(49);",
    "heli": "goHome();openGame(50);", "train": "goHome();openGame(52);",
    "fish": "goHome();openGame(53);", "plane": "goHome();openGame(54);",
    "sumo": "goHome();openGame(55);", "pac": "goHome();openGame(56);",
    "tanks": "goHome();openGame(57);", "td": "goHome();openGame(58);",
    "ski": "goHome();openGame(59);", "race": "goHome();openGame(60);",
    "parkour": "goHome();openGame(62);", "hockey": "goHome();openGame(63);",
    "drift": "goHome();openGame(64);", "zombie": "goHome();openGame(65);",
    "cosmo": "goHome();openGame(66);", "surf": "goHome();openGame(67);",
    "chess": "goHome();openGame(68);", "climb": "goHome();openGame(69);",
    "city": "goHome();openGame(70);",
    # волна G (E3 v2): инстансинг, частицы, физика, node
    "curling": "goHome();openGame(71);",
    "skate": "goHome();openGame(72);",
    "kite": "goHome();openGame(73);",
    "archery": "goHome();openGame(74);",
    "freestyle": "goHome();openGame(75);",
    "crane": "goHome();openGame(76);",
    # волна H: полёт и транспорт
    "orbit": "goHome();openGame(77);",
    "glider": "goHome();openGame(78);",
    "balloon": "goHome();openGame(79);",
    "mono": "goHome();openGame(80);",
    "rocket": "goHome();openGame(81);",
    "dino": "goHome();openGame(82);",
    # волна I
    "skip": "goHome();openGame(83);",
    "boomerang": "goHome();openGame(84);",
    "falcon": "goHome();openGame(85);",
    "volcano": "goHome();openGame(86);",
    "magnet": "goHome();openGame(87);",
    "ferry": "goHome();openGame(88);",
    # волна J
    "mole": "goHome();openGame(89);",
    "hive": "goHome();openGame(90);",
    "house": "goHome();openGame(91);",
    "hoop": "goHome();openGame(92);",
    "aquarium": "goHome();openGame(93);",
    "orient": "goHome();openGame(94);",
    # волна K — финальная
    "butterfly": "goHome();openGame(95);",
    "mine": "goHome();openGame(96);",
    "dna": "goHome();openGame(97);",
    "ghost": "goHome();openGame(98);",
    "firework": "goHome();openGame(99);",
    "rainbow": "goHome();openGame(100);",
}


def cmd_shots(args, chrome):
    outdir = os.path.abspath(args.shots)
    os.makedirs(outdir, exist_ok=True)
    src = read_index()
    tmpdir = tempfile.mkdtemp(prefix="nbshot_")
    profile = tempfile.mkdtemp(prefix="nbprof_")
    try:
        # детерминированный рендер: фиксированное время rAF + seeded PRNG,
        # иначе шапка (рандомные счётчики игроков) и логика игр «плавают»
        # и сравнивать кадр до/после бессмысленно
        pre = ("try{localStorage.setItem('bb2_seen','true');localStorage.setItem('bb2_theme','light')}catch(e){};"
               "document.getElementById('coach').classList.remove('show');"
               "document.getElementById('titleScreen').style.display='none';"
               "var __vt=0,__fn=0;var __cap=90;"
               "window.requestAnimationFrame=function(cb){return setTimeout(function(){"
               "if(__fn++>=__cap)return;"
               # ошибка внутри игрового кадра раньше молча проглатывалась шимом —
               # снимок получался «пустым», но гейт рапортовал ok
               "try{cb(__vt+=16)}catch(e){if(!window.__rafErr){window.__rafErr=1;"
               "document.title='JSERR '+(e&&e.message||e)+' @'+(e&&e.lineno||'?')}}},0)};"
               "var __sd=987654321;Math.random=function(){__sd=(__sd*1103515245+12345)&0x7fffffff;"
               "return __sd/0x7fffffff};"
               "['petals','confetti'].forEach(function(i){var n=document.getElementById(i);if(n)n.style.display='none'});"
               # CSS-анимации (bgShift с hue-rotate и пр.) идут по стенным часам —
               # без этого снимок меняется при каждом запуске
               "var __st=document.createElement('style');"
               "__st.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';"
               "document.head.appendChild(__st);"
               # глобальные 5-секундные интервалы (счётчик игроков в шапке, слайд hero)
               # зависят от того, сколько виртуального времени успело пройти
               "var __si=window.setInterval;"
               "window.setInterval=function(fn,ms){return ms===5000?0:__si(fn,ms)};")
        bad = 0
        for name, code in SHOTS.items():
            boot = ("<script>window.addEventListener('error',function(e){"
                    "document.title='JSERR '+e.message+' @'+e.lineno});"
                    "try{" + pre + code + "}catch(e){document.title='THROW '+e}</script>\n")
            page = src.replace("</body>", boot + "</body>")
            p = os.path.join(tmpdir, "s_%s.html" % name)
            with open(p, "w", encoding="utf-8", newline="\n") as f:
                f.write(page)
            url = "file:///" + p.replace("\\", "/")
            png = os.path.join(outdir, name + ".png")
            run_chrome(chrome, url, profile, 9000, shot=png, size="1500,950")
            dom = run_chrome(chrome, url, profile, 9000)
            t = page_title(dom)
            okfile = os.path.exists(png)
            if t.startswith("JSERR") or t.startswith("THROW") or not okfile:
                bad += 1
            print("%-10s %-9s %s" % (name, "ok" if okfile else "FAIL", t if t.startswith(("JSERR", "THROW")) else ""))
        print("-" * 66)
        print("скриншотов: %d, проблем: %d -> %s" % (len(SHOTS), bad, outdir))
        return 0 if bad == 0 else 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


# -------------------------------------------------------------------- one
def cmd_game(args, chrome):
    tmpdir = tempfile.mkdtemp(prefix="nbtest_")
    profile = tempfile.mkdtemp(prefix="nbprof_")
    try:
        q = "?harness=smoke&games=%d" % args.game
        path, _ = make_page(tmpdir, q)
        url = "file:///" + path.replace("\\", "/") + q
        dom = run_chrome(chrome, url, profile, args.budget)
        rep = parse_report(dom)
        if rep is None:
            print("FAIL  нет отчёта")
            return 1
        for r in rep:
            if "game" not in r:
                continue
            e = r.get("errs") or r.get("lobby") or []
            print("игра %-4s кадров=%-5s кликов=%-4s .mode=%s деталей=%s" % (
                r.get("game"), r.get("frames"), r.get("clicked"),
                r.get("leftoverModes"), r.get("parts")))
            for x in (e + ([r["fatal"]] if r.get("fatal") else [])):
                print("   !! " + x)
        return 0 if all(not (r.get("errs") or r.get("fatal") or r.get("leftoverModes"))
                        for r in rep if "game" in r) else 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)


def cmd_list(_args):
    with open(INDEX, encoding="utf-8") as f:
        src = f.read()
    js = re.search(r"<script>(.*)</script>", src, re.S).group(1)
    block = re.search(r"const GAMES=\[(.*?)\n\];", js, re.S).group(1)
    for m in re.finditer(r'\{id:(\d+),title:"([^"]+)",emoji:"([^"]*)".*?(?:mode:"(\w+)")?\}', block):
        pass
    # надёжнее: построчно
    n = 0
    for line in block.split("\n"):
        mm = re.search(r'id:(\d+),title:"([^"]+)",emoji:"([^"]*)"', line)
        if not mm:
            continue
        n += 1
        mode = re.search(r'mode:"(\w+)"', line)
        price = re.search(r'price:(\d+)', line)
        print("%3s  %-22s %-4s %-10s %s" % (
            mm.group(1), mm.group(2)[:22], mm.group(3),
            mode.group(1) if mode else "builder",
            ("VIP " + price.group(1)) if price else ""))
    print("всего игр:", n)


def main():
    ap = argparse.ArgumentParser(description="автотесты AERIS")
    ap.add_argument("--behaviour", action="store_true", help="только поведенческие проверки")
    ap.add_argument("--engine", action="store_true", help="только тесты движка E3")
    ap.add_argument("--syntax", action="store_true", help="только проверка синтаксиса (быстро)")
    ap.add_argument("--all", action="store_true", help="движок + поведение + все игры")
    ap.add_argument("--shots", metavar="DIR", help="отрендерить скриншоты в DIR")
    ap.add_argument("--games", help="список id через запятую, например 1,2,15")
    ap.add_argument("--game", type=int, help="одна игра по id")
    ap.add_argument("--list", action="store_true", help="показать каталог игр")
    ap.add_argument("--budget", type=int, default=400000, help="virtual-time-budget, мс")
    args = ap.parse_args()

    if args.list:
        return cmd_list(args)
    chrome = find_chrome()
    if args.shots:
        return cmd_shots(args, chrome)
    rc = 0
    if args.all:
        print("=== СИНТАКСИС ===")
        rc |= cmd_syntax(args, chrome)
        print()
        print("=== ДВИЖОК ===")
        rc |= cmd_engine(args, chrome)
        print()
        print("=== ПОВЕДЕНИЕ ===")
        rc |= cmd_behaviour(args, chrome)
        print()
        print("=== ИГРЫ ===")
        rc |= cmd_smoke(args, chrome)
        return rc
    if args.syntax:
        return cmd_syntax(args, chrome)
    if args.engine:
        return cmd_engine(args, chrome)
    if args.behaviour:
        return cmd_behaviour(args, chrome)
    if args.game:
        return cmd_game(args, chrome)
    return cmd_smoke(args, chrome)


if __name__ == "__main__":
    sys.exit(main())
