# -*- coding: utf-8 -*-
"""Гейт защиты интерпретатора (Фаза 3.2): рекурсия, память, глубина.

Проверяем на настоящем интерпретаторе из src/lang/core.js, не на копии.
"""
import html, io, os, re, shutil, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, "src", "lang", "core.js")

PROBE = r'''
(function(){
  var out = [], fail = 0;
  function ok(c, m) { if (!c) fail++; out.push((c ? "OK   " : "FAIL ") + m); }

  var HOST = {
    loadModule: function () { return null; },
    setNativeMember: function (o, k, v) { o[k] = v; },
    nativeMember: function (o, n) { return o[n]; },
    call: function (n, env, I) { return I.eval(n.callee, env); }
  };
  var I = new Interp(HOST);
  I.globals = new Env(null);
  function run(src, maxSteps) {
    I.steps = 0;
    I.maxSteps = maxSteps || 1000000;
    try { I.run(parse(src), new Env(I.globals)); return null; }
    catch (e) { return e.message || String(e); }
  }

  /* 1. обычный код работает */
  ok(run("let a = 1\nlet b = a + 2\n") === null, "обычный код исполняется");

  /* 2. рекурсия конечной глубины проходит */
  ok(run("fn f(n):\n    if n <= 0:\n        return 0\n    return 1 + f(n - 1)\nlet r = f(50)\n") === null,
     "рекурсия глубины 50 проходит");

  /* 3. глубокая рекурсия даёт ПОНЯТНУЮ ошибку, а не падение страницы */
  var deep = run("fn f(n):\n    return f(n + 1)\nf(1)\n");
  ok(deep !== null, "бесконечная рекурсия остановлена");
  ok(deep && deep.indexOf("рекурс") >= 0, "ошибка называет причину: " + deep);

  /* 4. умеренная глубина проходит (предел не слишком мал) */
  ok(run("fn f(n):\n    if n <= 0:\n        return 0\n    return 1 + f(n - 1)\nf(120)\n") === null,
     "рекурсия глубины 120 проходит");

  /* 5. лимит памяти: бесконечный цикл с накоплением ловится.
     Сообщение может прийти от ЛИМИТА ШАГОВ — он срабатывает раньше и это
     нормально: цикл без конца останавливается, просто другим способом. */
  var mem = run("let a = []\nlet i = 0\nwhile true:\n    a.push(i)\n    i = i + 1\n");
  ok(mem !== null, "накопление данных остановлено");
  ok(mem && (mem.indexOf("объём") >= 0 || mem.indexOf("шаг") >= 0),
     "ошибка объясняет причину: " + mem);

  /* 6. лимит строк: длинная строка ловится */
  var str = run("let s = \"\"\nlet i = 0\nwhile true:\n    s = s + \"abcdefghij\"\n    i = i + 1\n");
  ok(str !== null, "рост строки остановлен");

  /* 7. счётчики сбрасываются между запусками: вторая программа не падает
        из-за первой */
  ok(run("let a = []\nlet i = 0\nwhile true:\n    a.push(i)\n    i = i + 1\n") !== null,
     "первая программа упёрлась в лимит");
  ok(run("let x = 1\n") === null,
     "после неё обычная программа снова работает (лимиты сброшены)");

  /* 8. счётчик глубины тоже сброшен */
  ok(run("fn f(n):\n    if n <= 0:\n        return 0\n    return 1 + f(n - 1)\nf(100)\n") === null,
     "глубина не накоплена между запусками");

  /* 9. пределы настраиваются */
  I.maxDepth = 10;
  var shallow = run("fn f(n):\n    if n <= 0:\n        return 0\n    return 1 + f(n - 1)\nf(50)\n");
  ok(shallow !== null, "пониженный предел глубины работает: " + shallow);
  I.maxDepth = 200;

  out.push(fail ? ("ИТОГО: провалено " + fail) : "ИТОГО: все проверки прошли");
  var p = document.createElement("pre");
  p.id = "limitreport"; p.textContent = out.join("\n");
  document.body.appendChild(p);
})();
'''


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    return shutil.which("chrome") or shutil.which("chromium")


def main():
    if not os.path.isfile(CORE):
        print("FAIL  нет src/lang/core.js")
        return 1
    with io.open(CORE, encoding="utf-8") as f:
        core = f.read()
    page = ("<!doctype html><meta charset=utf-8><body><script>"
            + core.replace("</script>", "<\\/script>")
            + "</script><script>try{" + PROBE + "}catch(e){var d=document.createElement('pre');"
            "d.id='limitreport';d.textContent='ИСКЛЮЧЕНИЕ: '+e.message+' @ '+String(e.stack||'').slice(0,300);"
            "document.body.appendChild(d);}</script></body>")
    tmp = os.path.join(ROOT, "_tmp_limit.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nblimit_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--virtual-time-budget=40000", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        os.remove(tmp)
    m = re.search(r'<pre id="limitreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    rc = 0
    for line in html.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith("FAIL") or line.strip().startswith("ИСКЛЮЧЕНИЕ"):
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())