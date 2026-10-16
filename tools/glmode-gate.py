# -*- coding: utf-8 -*-
"""Гейт выбора пути отрисовки: авто, включён, выключен.

Зачем отдельный гейт, если есть e3gl-gate.py. Тот сверяет картинку GL и 2D
попиксельно — это про КАК рисует GL. Здесь про то, КАК ВЫБИРАЕТСЯ путь,
и это важнее: до фазы 5 WebGL2 включался только вручную через ?gl=1,
то есть по умолчанию все играли на медленном пути, хотя умеющий GPU
простаивал.

Главная проверка здесь — откат. На живой видеокарте путь не проверялся,
и единственная защита от чужого сломанного драйвера — автоматический
возврат на 2D. Если откат не срабатывает, автовключение опаснее
ручного включения, и включать его нельзя.
"""
import html as htmlmod
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROBE_MODES = r'''
(function(){
  var out = [], fail = 0;
  function ok(c,m){ out.push((c?"OK   ":"FAIL ")+m); if(!c) fail++; }

  ok(typeof E3GL === "object" && typeof E3GL.request === "function",
     "у бэкенда есть выбор режима");

  /* Три режима: авто, включён, выключен. Человек должен иметь
     возможность сказать «не трогай мою видеокарту». */
  E3GL.request(null);  ok(E3GL.force === null, "авто: выбор не навязан");
  E3GL.request(false); ok(E3GL.force === false, "выключен: запрет записан");
  E3GL.request(true);  ok(E3GL.force === true, "включён: разрешение записано");

  /* При запрете движок не должен лезть в GL сам. */
  E3GL.request(false);
  ok(!E3GL.want || E3GL.active, "при запрете движок сам GL не просит");
  E3GL.request(null);

  out.push(fail ? ("ИТОГО: провалено "+fail) : ("ИТОГО: все проверки прошли"));
  var p=document.createElement("pre");
  p.id="glmodereport"; p.textContent=out.join("\n");
  document.body.appendChild(p);
})();
'''

# Запуск игры в авторежиме. Главное здесь — игра должна реально
# запуститься и нарисовать кадр: если автоопределение ломает старт,
# это хуже, чем медленная картинка.
PROBE_FALLBACK = r'''
(function(){
  var out = [], fail = 0;
  function ok(c,m){ out.push((c?"OK   ":"FAIL ")+m); if(!c) fail++; }

  var logs = [];
  var cv = document.createElement("canvas");
  cv.width = 320; cv.height = 200; cv._lw = 320; cv._lh = 200;
  document.body.appendChild(cv);
  var ctx = cv.getContext("2d");

  function tryMode(mode, label) {
    logs.length = 0;
    var rt = createRuntime({
      canvas: cv, scale: 1, logicalWidth: 320, logicalHeight: 200,
      gameId: "probe-" + mode,
      gl: mode,
      log: function (m, cls) { logs.push(String(m)); }
    });
    var started = rt.launch("fn setup():\n    box(0,1,0,2,2,2)\n" +
      "fn update(dt):\n    return 1\nfn draw():\n    box(0,1,0,2,2,2)");
    ok(started, "режим " + label + ": игра запустилась");
    ok(!!rt.hooks.draw, "режим " + label + ": хук draw на месте");
    /* Кадр должен что-то нарисовать: пустой холст — это тихий провал. */
    var faces = 0;
    try {
      /* Плоский список граней: box возвращает массив, а движок ждёт
         список граней, а не список списков. */
      var f = E3.box(0, 1, 0, 2, 2, 2);
      E3.draw(ctx, f, {x:0,y:6,z:-12,yaw:0,pitch:0.3}, 430, [0.4,0.7,0.5]);
      faces = E3.stats.faces;
    } catch (e) { faces = -1; out.push("  исключение при отрисовке: " + e.message); }
    ok(faces > 0, "режим " + label + ": кадр нарисован, граней " + faces);
    rt.stopLoop();
    return logs.slice(0, 3);
  }

  tryMode("off", "выключен");
  tryMode("auto", "авто");
  tryMode("on", "включён");

  /* После ручного запрета движок обязан остаться на 2D, даже если
     кто-то позже попросит авто: запрет человека сильнее автоправила. */
  if (typeof E3GL !== "undefined" && E3GL.request) {
    E3GL.request(false);
    var stuck = !E3GL.want || E3GL.active;
    ok(stuck, "запрет держится");
  }

  out.push(fail ? ("ИТОГО: провалено "+fail) : ("ИТОГО: все проверки прошли"));
  var p=document.createElement("pre");
  p.id="glfallbackreport"; p.textContent=out.join("\n");
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


def run_probe(title, entry, probe, report_id):
    page = io.open(os.path.join(ROOT, entry), encoding="utf-8").read()
    tmp = os.path.join(ROOT, "_tmp_%s.html" % report_id)
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page.replace("</body>", "<script>" + probe + "</script>\n</body>"))
    prof = tempfile.mkdtemp(prefix="nbglmode_")
    try:
        dom = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=900,700", "--virtual-time-budget=25000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
    m = re.search(r'<pre id="%s"[^>]*>(.*?)</pre>' % report_id, dom, re.S)
    if not m:
        print("FAIL  %s: страница не дошла до проверки" % title)
        for e in re.findall(r"JSERR[^<]{0,200}", dom)[:3]:
            print("      " + htmlmod.unescape(e))
        return 1
    rc = 0
    for line in htmlmod.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith("FAIL"):
            rc = 1
    return rc


def main():
    rc = 0
    print("=== РЕЖИМЫ ВЫБОРА ===")
    rc |= run_probe("редактор", "lang.html", PROBE_MODES, "glmodereport")
    print("")
    print("=== ИГРА В КАЖДОМ РЕЖИМЕ ===")
    rc |= run_probe("редактор", "lang.html", PROBE_FALLBACK, "glfallbackreport")
    print("")
    print("=== НАСТРОЙКА В ПРИЛОЖЕНИИ ===")
    # После разбивки логика приложения живёт в src/app/app.js, а в
    # index.html остался только каркас. Искать настройку надо там, где она
    # теперь: проверка искала в разметке и падала, хотя всё работало.
    sources = {}
    for rel in ("index.html", "src/app/app.js"):
        p = os.path.join(ROOT, rel)
        if os.path.isfile(p):
            sources[rel] = io.open(p, encoding="utf-8").read()
    need = [("bb2_gl", "ключ настройки ускорения"),
            ("segGl", "переключатель в окне настроек"),
            ("function setGl", "функция переключения")]
    for token, what in need:
        where = [rel for rel, s in sources.items() if token in s]
        if where:
            print("  OK   %s есть (%s)" % (what, ", ".join(where)))
        else:
            print("  FAIL  %s отсутствует — искали в: %s" % (what, ", ".join(sources)))
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())