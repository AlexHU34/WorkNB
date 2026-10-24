# -*- coding: utf-8 -*-
"""Гейт пускашки: страница «игра в файл» работает с диска, без сети.

Проверка в два приёма, и оба честные:
  1. Открываем ужатую студию (как её получает игрок), в ней собираем
     страницу-пускалку для собственной сцены и забираем её текст.
  2. Пишем собранное в отдельную папку — без src, без сайта, без сети —
     и открываем как файл с диска, как это сделает друг двойным щелчком.
Игра обязана завестись: подсказка сменится на «идёт» и холст нарисует.

Пока этого гейта не было, сборку приходилось проверять руками: пузырь
блоба в живом браузере показывал одно, а у друга на диске могло
выйти другое.
"""
import base64
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDIO = os.path.join(ROOT, "dist", "min", "AerisStudio.html")

GENERATE_PROBE = r"""
(function(){
  var out = [];
  var d = document.createElement("pre");
  d.id = "runnerreport";
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    d.textContent = out.join("\n");
    document.body.appendChild(d);
    var p = document.createElement("pre");
    p.id = "runnerpayload";
    try {
      p.textContent = btoa(unescape(encodeURIComponent(window.__RUNNER_HTML__ || "")));
    } catch (e) { p.textContent = ""; }
    document.body.appendChild(p);
  }
  try {
    if (!window.Studio) { out.push("студии нет: " + (window.__errs || []).join(" | ")); finish(false); return; }
    var sc = Studio.normalize(null);
    sc.title = "Прыгающий кубик";
    Studio.addObject(sc, "box");
    Studio.addObject(sc, "box");
    Studio.addObject(sc, "water");
    var res = Studio.gameRunnerHtml(sc, "Прыгающий кубик");
    if (!res.ok) {
      var big = [], all = document.scripts || [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].src) continue;
        var c = String(all[i].textContent || "");
        if (c.length >= 200) big.push(c.length);
      }
      out.push(res.error + "; вшитых блоков: " + big.join("/"));
      finish(false);
      return;
    }
    if (/<script src=/.test(res.html)) { out.push("в пускалке внешние скрипты"); finish(false); return; }
    if (/src="http/.test(res.html)) { out.push("в пускалке ссылки на сеть"); finish(false); return; }
    if (res.html.indexOf("#2a9df4") < 0) { out.push("в пускалке нет воды из сцены"); finish(false); return; }
    out.push("собрано символов: " + res.html.length);
    window.__RUNNER_HTML__ = res.html;
    finish(true);
  } catch (e) {
    out.push("падение: " + e.message);
    finish(false);
  }
})();
"""

RUN_PROBE = r"""
(function(){
  var out = [];
  var d = document.createElement("pre");
  d.id = "runnerreport";
  function finish(ok) {
    out.push(ok ? "PASS" : "FAIL");
    d.textContent = out.join("\n");
    document.body.appendChild(d);
  }
  try {
    setTimeout(function () {
      var hint = document.getElementById("hint");
      var cv = document.getElementById("cv");
      var lit = 0;
      if (cv && cv.width) {
        try {
          var g = cv.getContext("2d");
          if (g) {
            var px = g.getImageData(0, 0, cv.width, cv.height).data;
            for (var i = 0; i < px.length; i += 4) {
              if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 40) lit++;
            }
          }
        } catch (e) { out.push("холст не отдал пиксели: " + e.message); }
      }
      out.push("нарисовано пикселей: " + lit);
      if (!hint) { out.push("подсказки нет"); finish(false); return; }
      out.push("подсказка: " + hint.textContent);
      out.push("глобалы: E3=" + typeof window.E3);
      finish(hint.textContent === "идёт" && lit > 500);
    }, 3000);
  } catch (e) {
    out.push("падение: " + e.message);
    finish(false);
  }
})();
"""


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    return shutil.which("chrome") or shutil.which("chromium")


def run_chrome(chrome, path, budget):
    prof = tempfile.mkdtemp(prefix="nbrun_")
    try:
        return subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1280,900", "--virtual-time-budget=" + str(budget),
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + path.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def main():
    if not os.path.isfile(STUDIO):
        print("FAIL  нет ужатой студии — сначала python build.py")
        return 1
    chrome = find_chrome()
    if not chrome:
        print("FAIL  Chrome/Edge не найден")
        return 1

    stage_dir = tempfile.mkdtemp(prefix="nbrunner_")
    try:
        # --- приём первый: собрать пускалку в ужатой студии -------------
        target = os.path.join(stage_dir, "studio.html")
        shutil.copy2(STUDIO, target)
        with io.open(target, encoding="utf-8") as f:
            page = f.read()
        # Подстраховку и пробу вставляем по позициям с конца: в ужатом
        # коде живут собственные строки «/body», и наивная замена первой
        # найденной скобки порвала бы скрипт.
        start = page.find("<html")
        shim = ('<script>window.__errs=[];window.addEventListener("error",'
                'function(e){window.__errs.push(String(e.message).slice(0,140))});</script>')
        if start >= 0:
            br = page.find(">", start)
            page = page[:br + 1] + shim + page[br + 1:]
        else:
            page = shim + page
        pos = page.rfind("</body>")
        tail = "<script>" + GENERATE_PROBE + "</script>\n" if pos >= 0 else None
        if pos >= 0:
            page = page[:pos] + tail + page[pos:]
        else:
            page = page + tail
        with io.open(target, "w", encoding="utf-8", newline="\n") as f:
            f.write(page)

        dom = run_chrome(chrome, target, 25000)
        m = re.search(r'<pre id="runnerreport"[^>]*>(.*?)</pre>', dom, re.S)
        if not m:
            print("FAIL  сборка пускалки: страница не дошла до проверки")
            for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
                print("      " + html.unescape(e))
            return 1
        report = html.unescape(m.group(1))
        for line in report.strip().split("\n"):
            print("      " + line.strip()[:120])
        if not report.strip().endswith("PASS"):
            return 1
        pm = re.search(r'<pre id="runnerpayload"[^>]*>([\s\S]*?)</pre>', dom, re.S)
        if not pm:
            print("FAIL  сборка пускалки: тело не передано")
            return 1
        runner_html = base64.b64decode(html.unescape(pm.group(1))).decode("utf-8")
        if len(runner_html) < 50000:
            print("FAIL  сборка пускалки: тело подозрительно малое")
            return 1

        # --- приём второй: открыть её же как файл с диска ---------------
        game = os.path.join(stage_dir, "runner-page.html")
        with io.open(game, "w", encoding="utf-8", newline="\n") as f:
            f.write(runner_html)
        with io.open(game, encoding="utf-8") as f:
            gp = f.read()
        gp = gp[:gp.rfind("</body>")] + "<script>" + RUN_PROBE + "</script>\n" + gp[gp.rfind("</body>"):]
        with io.open(game, "w", encoding="utf-8", newline="\n") as f:
            f.write(gp)

        dom = run_chrome(chrome, game, 15000)
        m = re.search(r'<pre id="runnerreport"[^>]*>(.*?)</pre>', dom, re.S)
        if not m:
            print("FAIL  игра с диска: страница не дошла до проверки")
            return 1
        report = html.unescape(m.group(1))
        for line in report.strip().split("\n"):
            print("      " + line.strip()[:120])
        return 0 if report.strip().endswith("PASS") else 1
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
