# -*- coding: utf-8 -*-
"""Проверка окна настроек и трёх уровней графики в настоящем браузере.

Проверка идёт исполнением: окно открывается, кнопки нажимаются, и
следом читаются последствия — сменилась ли тема, размер, громкость и
уровень графики. Глазами смотреть нечем: страницу никто не видит.
"""
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
IDX = os.path.join(ROOT, "index.html")

PROBE = r'''
(function(){
  var out = [], fail = 0;
  function ok(c, m) { out.push((c ? "OK   " : "FAIL ") + m); if (!c) fail++; }

  try { localStorage.clear(); } catch (e) {}
  BB.data = null;

  /* окно закрыто в начале */
  ok(!document.getElementById("setOverlay").classList.contains("show"),
     "окно настроек в начале закрыто");

  openSettings();
  ok(document.getElementById("setOverlay").classList.contains("show"),
     "окно настроек открылось");

  /* три уровня графики присутствуют */
  var q = document.getElementById("segQuality").children.length;
  ok(q === 3, "три уровня графики: " + q);

  /* переключение графики меняет настройки движка */
  setQuality("low");
  ok(E3.quality === "low", "графика переключилась на low: " + E3.quality);
  ok(E3.minGrad === 0, "на low нет градиентов: minGrad=" + E3.minGrad);
  setQuality("high");
  ok(E3.quality === "high", "графика переключилась на high: " + E3.quality);
  ok(E3.minGrad > 0, "на high градиенты вернулись: minGrad=" + E3.minGrad);
  setQuality("medium");
  ok(E3.quality === "medium" && E3.minGrad === 7,
     "средний уровень восстановился: minGrad=" + E3.minGrad);

  /* тема */
  setTheme("dark");
  ok(document.documentElement.dataset.theme === "dark", "тема стала тёмной");
  setTheme("light");
  ok(document.documentElement.dataset.theme === "light", "тема стала светлой");

  /* размер интерфейса */
  setScale("1.1");
  ok(Math.abs(parseFloat(document.documentElement.style.zoom || 1) - 1.1) < 0.01,
     "размер интерфейса увеличен: " + document.documentElement.style.zoom);
  setScale(1);
  ok(!document.documentElement.style.zoom, "размер интерфейса вернулся к 100%");

  /* громкость */
  setVolume(40);
  ok($("volVal").textContent === "40", "громкость показана: " + $("volVal").textContent);
  setVolume(0);
  ok(vol === 0, "громкость до нуля: " + vol);
  setVolume(100);
  ok(vol === 1, "громкость до ста: " + vol);

  /* звук переключается из окна */
  setSoundUI(false);
  ok(soundOn === false, "звук выключен из окна");
  setSoundUI(true);
  ok(soundOn === true, "звук включён из окна");

  /* настройки записались в хранилище */
  ok(store.get("bb2_vol", 0) === 100, "громкость сохранена: " + store.get("bb2_vol", 0));
  ok(store.get("bb2_quality", "") === "medium", "графика сохранена: " + store.get("bb2_quality", ""));

  /* Escape закрывает окно */
  openSettings();
  closeSettings();
  ok(!document.getElementById("setOverlay").classList.contains("show"),
     "окно закрылось по кнопке");

  out.push(fail ? ("ИТОГО: провалено " + fail) : ("ИТОГО: все проверки прошли"));
  var p = document.createElement("pre");
  p.id = "setreport";
  p.textContent = out.join("\n");
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
    page = io.open(IDX, encoding="utf-8").read()
    # страница грузится с сервера? нет — файлом, но внешних скриптов нет
    tmp = os.path.join(ROOT, "_tmp_set.html")
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(
        page.replace("</body>", "<script>" + PROBE + "</script>\n</body>"))
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbset_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--virtual-time-budget=20000", "--allow-file-access-from-files",
             "--dump-dom", "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
    m = re.search(r'<pre id="setreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  страница не дошла до проверки настроек")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    rc = 0
    for line in html.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith("FAIL"):
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())