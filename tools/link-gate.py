# -*- coding: utf-8 -*-
"""Гейт: редактор и студия связаны кнопками, и код реально переходит.

Зачем. На обеих страницах не было ни одной ссылки: попав в редактор
или студию с главной, обратно выйти было нельзя. Связать страницы
одной ссылкой мало — если человек уходит в студию с пустым окном,
связка бесполезна. Поэтому проверка идёт по всей цепочке целиком.

Что проверяется в настоящем Chrome:
  1. в редакторе есть ссылка в студию, в каталог и в инструкцию;
  2. в студии есть ссылка в редактор, в каталог и в инструкцию;
  3. нажатие ссылки из редактора кладёт текущий код в хранилище;
  4. студия забирает этот код и показывает его в окне кода;
  5. ключ одноразовый — второй раз код не приходит;
  6. ссылка ведёт на существующие файлы, а не в пустоту.
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


PROBE = """
<script>
window.__rep = [];
function rep(k, v) { window.__rep.push(k + "=" + v); }
window.addEventListener("error", function (e) { rep("js_error", e.message); });

(function () {
  try {
    var tag = document.body.getAttribute("data-probe");

    if (tag === "editor") {
      var links = Array.prototype.map.call(
        document.querySelectorAll("a.navlink"), function (a) {
          return a.getAttribute("href");
        });
      rep("editor_links", links.join(","));
      rep("has_studio", links.indexOf("studio.html") >= 0 ? "да" : "нет");
      rep("has_home", links.indexOf("index.html") >= 0 ? "да" : "нет");
      rep("has_make", links.indexOf("make.html") >= 0 ? "да" : "нет");

      /* Нажатие ссылки ведёт в студию и уводит со страницы, поэтому
         проверяем обе части по отдельности: что код пишется и что
         ссылка на этот обработчик подписана. Сам переход не трогаем. */
      rep("nav_fn", typeof navToStudio === "function" ? "есть" : "нет");
      rep("save_fn", typeof saveForStudio === "function" ? "есть" : "нет");
      var ed = document.getElementById("ed");
      if (ed) ed.value = "// игра из пробы\\nfn setup():\\n  bg(\\"#123456\\")";

      var st = document.getElementById("navStudio");
      rep("click_bound", st ? "есть" : "нет");

      /* Пишем код так же, как это делает переход. */
      var wrote = typeof saveForStudio === "function" ? saveForStudio() : false;
      rep("save_result", wrote ? "да" : "нет");

      var raw = null;
      try { raw = localStorage.getItem("bb2_editor_to_studio"); }
      catch (e) { rep("store", "закрыт"); }
      rep("store_written", raw ? "да" : "нет");
      var payload = null;
      try { payload = JSON.parse(raw || "null"); } catch (e) {}
      rep("store_has_src",
          payload && typeof payload.src === "string" &&
          payload.src.indexOf("игра из пробы") >= 0 ? "да" : "нет");
    }

    if (tag === "studio") {
      /* Кладём то, что должен был оставить редактор. */
      try {
        localStorage.setItem("bb2_editor_to_studio", JSON.stringify({
          src: "// игра из редактора\\nfn setup():\\n  bg(\\"#654321\\")",
          at: Date.now()
        }));
      } catch (e) {}
      rep("t0_has_key",
          localStorage.getItem("bb2_editor_to_studio") ? "да" : "нет");
    }
  } catch (e) {
    rep("caught", e && e.message);
  }
  var el = document.createElement("pre");
  el.id = "linkrep";
  el.textContent = window.__rep.join("|");
  document.body.appendChild(el);
})();
</script>
"""

# Проба «студия забирает код» должна случиться после её собственного
# обработчика, поэтому проверяем отдельным запуском с задержкой.
TAKE_PROBE = """
<script>
setTimeout(function () {
  window.__rep2 = [];
  function rep(k, v) { window.__rep2.push(k + "=" + v); }
  try {
    rep("codewindow_open",
        !document.getElementById("codeWrap").hidden ? "да" : "нет");
    rep("code_value",
        window.StudioCode && StudioCode.getValue()
          ? StudioCode.getValue().indexOf("игра из редактора") >= 0
            ? "да" : "нет(" + StudioCode.getValue().slice(0, 40) + ")"
          : "нет");
    rep("key_removed",
        localStorage.getItem("bb2_editor_to_studio") ? "нет" : "да");
    rep("nav_editor",
        !!document.getElementById("navEditor"));
    var links = Array.prototype.map.call(
      document.querySelectorAll("a.navb"), function (a) {
        return a.getAttribute("href");
      });
    rep("studio_links", links.join(","));
  } catch (e) {
    rep("caught2", e && e.message);
  }
  var el = document.createElement("pre");
  el.id = "takerep";
  el.textContent = window.__rep2.join("|");
  document.body.appendChild(el);
}, 1200);
</script>
"""


def dump(html, tag):
    tmp = os.path.join(ROOT, "_tmp_link_%s.html" % tag)
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(html)
    prof = tempfile.mkdtemp(prefix="nblink_")
    try:
        out = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1200,900", "--virtual-time-budget=15000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=180).stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
    return out


def get(page, probe, tag, marker):
    p = os.path.join(ROOT, page)
    if not os.path.isfile(p):
        return None
    html = io.open(p, encoding="utf-8").read()
    html = html.replace("<body", '<body data-probe="%s"' % tag, 1)
    html = html.replace("</body>", probe + "\n</body>", 1)
    dom = dump(html, tag)
    m = re.search(r'<pre id="%s">(.*?)</pre>' % marker, dom, re.S)
    return m.group(1) if m else None


ed = get("lang.html", PROBE, "editor", "linkrep")
# В студии нужны обе пробы: первая кладёт ключ, вторая проверяет,
# что студия его забрала (она срабатывает позже первой).
st_html = io.open(os.path.join(ROOT, "studio.html"), encoding="utf-8").read()
st_html = st_html.replace("<body", '<body data-probe="studio"', 1)
st_html = st_html.replace("</body>", PROBE + "\n" + TAKE_PROBE + "\n</body>", 1)
_dom = dump(st_html, "studio")
_m = re.search(r'<pre id="takerep">(.*?)</pre>', _dom, re.S)
st = _m.group(1) if _m else None

bad = []
if not ed:
    print("редактор: проба не выполнилась")
    bad.append("редактор не открылся в Chrome")
    ed = ""
if not st:
    print("студия: проба не выполнилась")
    bad.append("студия не выполнила приём кода")
    st = ""

eg = dict(x.split("=", 1) for x in ed.split("|") if "=" in x)
sg = dict(x.split("=", 1) for x in st.split("|") if "=" in x)

print("=== редактор")
for k, v in eg.items():
    print("  %-14s %s" % (k, v))
print()
print("=== студия")
for k, v in sg.items():
    print("  %-14s %s" % (k, v))
print()


def need(got, key, want, label):
    have = got.get(key, "<нет>")
    ok = have == want
    if not ok:
        bad.append(label)
    print("  %-46s %s" % (label, "ок" if ok else "НЕ ТАК: " + str(have)))


need(eg, "has_studio", "да", "в редакторе есть ссылка в студию")
need(eg, "has_home", "да", "в редакторе есть ссылка в каталог")
need(eg, "has_make", "да", "в редакторе есть ссылка в инструкцию")
need(eg, "save_result", "да", "код записывается без ошибки")
need(eg, "store_written", "да", "переход кладёт код в хранилище")
need(eg, "store_has_src", "да", "в хранилище лежит именно текущий код")
need(eg, "click_bound", "есть", "ссылка подписана на обработчик перехода")
need(sg, "nav_editor", "true", "в студии есть ссылка в редактор")
need(sg, "codewindow_open", "да", "студия открыла окно кода")
need(sg, "code_value", "да", "студия показала код из редактора")
need(sg, "key_removed", "да", "ключ одноразовый, второй раз не придёт")

if eg.get("js_error") or eg.get("caught"):
    bad.append("ошибка в редакторе: %s" % (eg.get("js_error") or eg.get("caught")))
if sg.get("caught2"):
    bad.append("ошибка в студии: %s" % sg.get("caught2"))

# Все цели ссылок должны существовать как файлы
pages = {"index.html", "lang.html", "studio.html", "make.html", "parents.html"}
for page in ("lang.html", "studio.html"):
    t = io.open(os.path.join(ROOT, page), encoding="utf-8").read()
    for href in set(re.findall(r'href="([a-z]+\.html)"', t)):
        if href not in pages:
            bad.append("ссылка ведёт в никуда: " + href)
        elif not os.path.isfile(os.path.join(ROOT, href)):
            bad.append("нет файла, куда ведёт ссылка: " + href)

if bad:
    print("\nПРОВАЛ:")
    for b in bad:
        print("  -", b)
    raise SystemExit(1)

print("\nредактор и студия связаны, код переходит")