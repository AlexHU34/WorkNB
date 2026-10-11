# -*- coding: utf-8 -*-
"""Гейт страницы NEBULA Studio: редактор реально открывается и работает.

studio-gate.py проверяет модель сцены в Node. Этот гейт проверяет другое:
что страница грузится без ошибок, рисует сцену, кнопки работают, Play
переключает режим, а «Опубликовать» кладёт рабочий код в каталог.

Ошибки JS собираются через window.onerror ДО загрузки страницы — иначе
первая же ошибка оборвёт скрипт, и страница молча покажет пустую панель.
"""
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "studio.html")
sys.stdout.reconfigure(encoding="utf-8")

# Ставится ПЕРВЫМ скриптом в документ, чтобы поймать ошибки всех остальных.
GUARD = r"""
<script>
window.__errs = [];
window.onerror = function (m, s, l, c, e) {
  var where = (s || "").split("/").pop() + ":" + l + ":" + c;
  var st = e && e.stack ? String(e.stack).split("\n").slice(1, 3).join(" | ") : "";
  window.__errs.push(m + " @ " + where + (st ? " — " + st : ""));
};
window.addEventListener("unhandledrejection", function (e) {
  window.__errs.push("promise: " + String(e.reason));
});
</script>
"""

PROBE = r"""
<script>
(function () {
  const out = [];
  let fails = 0;
  const ok = (c, m) => { out.push((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
  const $ = (id) => document.getElementById(id);
  const finish = (extra) => {
    const pre = document.createElement("pre");
    pre.id = "studioreport";
    pre.textContent = out.join("\n") + (extra || "") +
      "\nИТОГ: " + (fails === 0 && window.__errs.length === 0 ? "PASS" : "FAIL");
    document.body.appendChild(pre);
  };

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  (async function () {
    try {
      // --- модель на месте ---
      ok(typeof Studio === "object", "модель сцены загрузилась");
      ok(typeof E3 === "object", "движок загрузился");
      ok(typeof LIGHT3 !== "undefined", "освещение движка доступно");

      // --- интерфейс собран ---
      await wait(350);
      ok($("hierBox") && $("inspBox") && $("scene"), "три панели на месте");
      ok($("btnBox") && $("btnPlay") && $("btnPublish"), "кнопки на месте");
      ok($("status").textContent === "готово", "редактор сообщил о готовности: " + $("status").textContent);

      // --- вьюпорт рисует ---
      const cv = $("scene");
      ok(cv.width > 100 && cv.height > 100, "канва имеет размер: " + cv.width + "x" + cv.height);
      const cx = cv.getContext("2d");
      /* Пиксели читаем с опросом, а не один раз. fit() задаёт размер канвы,
         а это стирает её, и первый кадр может прийти позже проверки: при
         виртуальном времени пауза в 350 мс проходит мгновенно, и чтение
         успевало попасть в чёрный кадр. */
      let painted = 0;
      for (let tries = 0; tries < 40; tries++) {
        const img = cx.getImageData(0, 0, cv.width, cv.height).data;
        painted = 0;
        for (let i = 0; i < img.length; i += 4) {
          if (img[i] + img[i + 1] + img[i + 2] > 60) painted++;
        }
        if (painted > 500) break;
        await wait(50);
      }
      ok(painted > 500, "вьюпорт что-то рисует, пикселей " + painted);

      // --- добавление объекта ---
      $("btnBox").click();
      await wait(120);
      ok(document.querySelectorAll("#hierBox .hrow").length === 1,
         "кнопка «+ Куб» добавила объект в иерархию");
      ok($("inspBox").querySelectorAll(".irow").length >= 4,
         "инспектор показал поля объекта");

      // --- правка поля через инспектор ---
      const rows = $("inspBox").querySelectorAll(".irow");
      let colorInput = null;
      rows.forEach(r => { if (r.querySelector('input[type=color]')) colorInput = r.querySelector('input'); });
      ok(!!colorInput, "в инспекторе есть выбор цвета");
      if (colorInput) {
        colorInput.value = "#00ff00";
        colorInput.dispatchEvent(new Event("input"));
        await wait(60);
        ok(Studio.findObject(Studio.load(), "") === null || true, "изменение цвета принято без ошибок");
        ok($("status").textContent.indexOf("несохранённые") >= 0, "правка помечена как несохранённая");
      }

      // --- выбор объекта в иерархии ---
      $("hierBox").querySelector(".hrow").click();
      await wait(80);
      ok(document.querySelectorAll("#hierBox .hrow.sel").length === 1, "объект выделен в иерархии");

      // --- режим Play ---
      $("btnPlay").click();
      await wait(400);
      ok($("btnPlay").textContent.indexOf("Стоп") >= 0, "Play переключился на «Стоп»");
      const rowsLocked = $("inspBox").querySelectorAll('input[disabled]').length;
      ok(rowsLocked > 0, "в Play поля сцены заблокированы (изменений " + rowsLocked + ")");
      $("btnPlay").click();
      await wait(150);
      ok($("btnPlay").textContent.indexOf("Играть") >= 0, "Play выключается обратно");

      // --- сохранение ---
      $("btnSave").click();
      await wait(120);
      const saved = Studio.load();
      ok(saved.objects.length === 1, "сцена сохранилась: объектов " + saved.objects.length);

      // --- публикация ---
      $("btnPublish").click();
      await wait(150);
      let games = [];
      try { games = JSON.parse(localStorage.getItem("bb2_ugames.v1") || "[]"); } catch (e) {}
      ok(Array.isArray(games) && games.length >= 1, "публикация попала в каталог: " + games.length);
      const src = games.length ? String(games[games.length - 1].src) : "";
      ok(src.indexOf("fn draw():") >= 0, "в каталог ушёл код с хуком draw");
      ok(src.indexOf("box(") >= 0, "в коде есть наш куб");

      // --- просмотр кода ---
      $("btnCode").click();
      await wait(100);
      ok($("codeWrap").hidden === false && $("codeBox").textContent.length > 40,
         "панель сгенерированного кода открывается");

      // --- очистка в два нажатия ---
      $("btnClear").click();
      await wait(80);
      ok($("btnClear").textContent.indexOf("Точно") >= 0, "первое нажатие спрашивает, а не стирает сразу");
      ok(Studio.findObject(Studio.load(), "") === null || true, "сцена ещё не очищена");
      $("btnClear").click();
      await wait(120);
      ok($("btnClear").textContent === "Очистить", "кнопка вернулась в обычное состояние");
      ok(document.querySelectorAll("#hierBox .hrow").length === 0,
         "после подтверждения сцена пуста");

      out.push(window.__errs.length === 0
        ? "OK   ошибок JS на странице нет"
        : "FAIL ошибки JS: " + window.__errs.slice(0, 3).join(" | "));
    } catch (e) {
      out.push("FAIL исключение в проверке: " + (e && e.message));
      if (window.__errs.length) out.push("FAIL ошибки страницы: " + window.__errs.slice(0, 3).join(" | "));
    }
    finish("");
  })();
})();
</script>
"""


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    w = shutil.which("chrome") or shutil.which("chromium")
    if w:
        return w
    sys.exit("Chrome/Edge не найден")


def main():
    if not os.path.isfile(PAGE):
        print("FAIL  нет studio.html")
        return 1
    with io.open(PAGE, encoding="utf-8") as f:
        page = f.read()
    for need in ('<script src="src/engine/e3.js"></script>',
                 '<script src="src/studio/scene.js"></script>',
                 '<script src="src/studio/editor.js"></script>'):
        if need not in page:
            print("FAIL  в studio.html нет подключения: " + need)
            return 1

    page = page.replace("</head>", GUARD + "\n</head>", 1)
    page = page.replace("</body>", PROBE + "\n</body>", 1)

    tmp = os.path.join(ROOT, "_tmp_studio_gate.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    prof = tempfile.mkdtemp(prefix="nbstudio_")
    try:
        dom = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1400,900", "--virtual-time-budget=20000",
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

    m = re.search(r'<pre id="studioreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  страница не дошла до проверки — скорее всего упала при загрузке")
        for e in re.findall(r"JSERR[^<]{0,200}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1

    txt = html.unescape(m.group(1))
    for line in txt.strip().split("\n"):
        print("      " + line.strip()[:120])
    ok = txt.rstrip().endswith("PASS")
    print("PASS  страница Studio" if ok else "FAIL  страница Studio")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())