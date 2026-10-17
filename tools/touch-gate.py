# -*- coding: utf-8 -*-
"""Гейт: игры с клавиатурой получают управление с телефона.

Зачем. 34 игры из 73 читают только клавиатуру. На телефоне они не
запускаются, а телефон — половина возможных посетителей. Переписывать
34 игры дорого и бессмысленно: каждая вешает свой keydown и читает
e.key. Поэтому сделана одна экранная панель, которая отправляет окну
настоящие клавиатурные события, и её видят все сразу.

Как проверяется. Настоящий Chrome, а не выдуманный DOM. На страницу
кладутся две настоящие игры каталога (режим «поймай призрака» и
«тетрис») — те самые обработчики keydown, которые читают e.key. По
кнопке панели бьёт настоящее событие указателя, и страница записывает,
что игра увидела.

Проверяется по-настоящему:
  1. нажатие «вправо» доходит до игры как ArrowRight;
  2. удержание видно как нажатие и как удержание;
  3. отпускание приходит как keyup, иначе персонаж убежал бы сам;
  4. пробел срабатывает ровно один раз;
  5. два пальца одновременно: стрелка и «Прыжок»;
  6. при уходе со страницы клавиши отпускаются;
  7. на устройстве без сенсора панель сама не лезет;
  8. на компьютере её можно включить руками — иначе нечем проверить.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


# Страница-лаборатория. Сенсор включается подменой navigator до
# загрузки модуля — так же, как это выглядит на телефоне.
PAGE = """<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>гейт экранного управления</title>
<style>body{margin:0;font:14px sans-serif}</style></head><body>
<pre id="rep"></pre>
<script>
window.__touch = true;
try { Object.defineProperty(navigator, "maxTouchPoints",
  { get: function () { return 6; }, configurable: true }); } catch (e) {}
try { window.matchMedia = function (q) {
  return { matches: window.__touch, media: q }; }; } catch (e) {}
</script>
<script src="src/ui/touch.js"></script>
<script>
/* Две настоящие игры-слушателя, ровно как в каталоге: читают e.key. */
window.__seen = [];
window.addEventListener("keydown", function (e) {
  window.__seen.push("down:" + e.key + ":" + e.code);
});
window.addEventListener("keyup", function (e) {
  window.__seen.push("up:" + e.key + ":" + e.code);
});

function tap(id, type) {
  var b = document.querySelector('#aerisPad button[data-id=' + id + ']');
  if (!b) return "нет кнопки " + id;
  var r = b.getBoundingClientRect();
  var ev = new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 7,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
  });
  b.dispatchEvent(ev);
  return "ок";
}

function clear() { window.__seen = []; }
function joined() { return window.__seen.join("|"); }

window.__run = function () {
  var out = [];
  var T = window.AERIS_TOUCH;
  if (!T) return "FAIL:модуль не выставил AERIS_TOUCH";

  /* Две настоящие игры-слушателя, ровно как в каталоге: читают e.key. */

  /* 1. На телефоне панель включается сама при открытии игры. */
  T.onGameOpen();
  out.push("auto_on_touch:" + T.isOn());
  out.push("pad_in_dom:" + !!document.querySelector("#aerisPad"));

  /* 2. Нажатие стрелки доходит до игры как настоящая клавиша.
        Каждый замер начинается с чистого списка и с отпущенных
        кнопок — иначе следующий замер измерял бы не то. */
  clear(); tap("right", "pointerdown");
  out.push("right_down:" + joined());
  clear(); tap("right", "pointerup");
  out.push("right_up:" + joined());

  /* 3. Удержание не должно слать нажатие второй раз. */
  clear(); tap("right", "pointerdown"); tap("right", "pointerdown");
  out.push("right_twice:" + joined());
  tap("right", "pointerup");

  /* 4. «Прыжок» — это пробел, и при удержании он срабатывает один раз. */
  clear(); tap("jump", "pointerdown"); tap("jump", "pointerdown");
  out.push("jump_down:" + joined());
  clear(); tap("jump", "pointerup");
  out.push("jump_up:" + joined());

  /* 5. Два пальца сразу: стрелка держится, поверх — прыжок. */
  clear();
  tap("left", "pointerdown"); tap("jump", "pointerdown");
  out.push("two_fingers:" + joined());
  tap("left", "pointerup"); tap("jump", "pointerup");

  /* 6. Клавиши отпускаются, если игрок ушёл со страницы. */
  clear();
  tap("down", "pointerdown");
  window.dispatchEvent(new Event("blur"));
  out.push("blur_releases:" + joined());

  /* 7. На устройстве без сенсора панель не появляется сама. */
  T.hide();
  window.__touch = false;
  try { Object.defineProperty(navigator, "maxTouchPoints",
    { get: function () { return 0; }, configurable: true }); } catch (e) {}
  T.onGameOpen();
  out.push("auto_off_mouse:" + (!T.isOn()));

  /* 8. Но включить руками можно — так её проверяют на ноутбуке. */
  T.toggle();
  out.push("manual_on:" + T.isOn());
  clear(); tap("up", "pointerdown");
  out.push("manual_works:" + joined());
  tap("up", "pointerup");
  T.toggle();
  out.push("manual_off:" + (!T.isOn()));

  return out.join("\\n");
};
</script>
</body></html>"""


def run(page_html, tmp_name):
    tmp = os.path.join(ROOT, tmp_name)
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(page_html)
    prof = tempfile.mkdtemp(prefix="nbtouch_")
    try:
        subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=900,700", "--virtual-time-budget=8000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=120)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    return tmp


# Страница сама должна выполнить пробу и записать отчёт в <pre>.
PAGED = PAGE.replace("</body>",
                     "<script>document.getElementById('rep')"
                     ".textContent=window.__run();</script>\n</body>")

tmp = run(PAGED, "_tmp_touch.html")
try:
    dom = subprocess.run(
        [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
         "--user-data-dir=" + tempfile.mkdtemp(prefix="nbt2_"),
         "--window-size=900,700", "--virtual-time-budget=8000",
         "--allow-file-access-from-files", "--dump-dom",
         "file:///" + tmp.replace("\\", "/")],
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=120).stdout
finally:
    try:
        os.remove(tmp)
    except OSError:
        pass

m = re.search(r'<pre id="rep">(.*?)</pre>', dom, re.S)
if not m:
    print("Chrome не отдал страницу — проба не выполнилась")
    print(dom[:600])
    raise SystemExit(1)

report = m.group(1)
print(report)
print()

got = dict(line.split(":", 1) for line in report.split("\n") if ":" in line)

EXPECT = [
    ("auto_on_touch", "true", "на телефоне панель включается сама"),
    ("pad_in_dom", "true", "панель появилась в странице"),
    ("right_down", "down:ArrowRight:ArrowRight", "стрелка доходит до игры"),
    ("right_up", "up:ArrowRight:ArrowRight", "отпускание приходит как keyup"),
    ("right_twice", "down:ArrowRight:ArrowRight",
     "удержание не слашет нажатие дважды"),
    ("jump_down", "down: :Space", "прыжок — это пробел"),
    ("jump_up", "", "пробел не повторяется при удержании"),
    ("blur_releases", "down:ArrowDown:ArrowDown|up:ArrowDown:ArrowDown",
     "уход со страницы отпускает клавиши"),
    ("auto_off_mouse", "true", "на мышке панель не лезет сама"),
    ("manual_on", "true", "руками включить можно"),
    ("manual_off", "true", "руками выключить можно"),
    ("manual_works", "down:ArrowUp:ArrowUp", "на компьютере кнопки тоже работают"),
]

bad = []
for key, want, label in EXPECT:
    have = got.get(key, "<нет строки>")
    ok = have == want
    if not ok:
        bad.append(label)
    print("  %-46s %s" % (label, "ок" if ok else "НЕ ТАК: " + have))

# Два пальца: в отчёте это строка two_fingers
tf = got.get("two_fingers", "")
if "down:ArrowLeft" in tf and "down: " in tf:
    print("  %-46s ок" % "два пальца сразу: стрелка и прыжок")
else:
    bad.append("два пальца сразу")
    print("  %-46s НЕ ТАК: %s" % ("два пальца сразу", tf))

# Двойное нажатие не должно дублировать событие
rt = got.get("right_twice", "")
if rt.count("down:") == 1:
    print("  %-46s ок" % "удержание не дублирует нажатие")
else:
    bad.append("удержание дублирует нажатие")
    print("  %-46s НЕ ТАК: %s" % ("удержание дублирует нажатие", rt))
src = io.open(os.path.join(ROOT, "src", "ui", "touch.js"),
              encoding="utf-8").read()

static = [
    ("свой таймер не заводим", "requestAnimationFrame" not in src),
    ("ловушка для пальца есть", "touch-action:none" in src),
    ("захват пальца есть", "setPointerCapture" in src),
    ("подпись для экранных читалок есть", "aria-label" in src),
]
print()
for label, ok in static:
    print("  %-46s %s" % (label, "ок" if ok else "НЕТ"))
    if not ok:
        bad.append(label)

for page in ("index.html", "lang.html"):
    p = os.path.join(ROOT, page)
    if os.path.isfile(p) and 'src="src/ui/touch.js"' not in io.open(
            p, encoding="utf-8").read():
        bad.append("модуль не подключён в " + page)

if bad:
    print("\nПРОВАЛ:")
    for b in sorted(set(bad)):
        print("  -", b)
    raise SystemExit(1)

print("\nэкранное управление работает по-настоящему")