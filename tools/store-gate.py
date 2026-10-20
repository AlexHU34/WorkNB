# -*- coding: utf-8 -*-
"""Гейт хранилища: версия, миграции, импорт старых ключей, экспорт/импорт."""
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding='utf-8')
# Путь считается от этого файла, а не зашит: проект переехал в Work AI,
# и гейт с жёстким C:\MPresent тихо проверял бы несуществующий каталог.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDX = os.path.join(ROOT, 'index.html')

PROBE = r'''
(function(){
  var out = [];
  var fail = 0;
  function ok(cond, msg) {
    if (!cond) fail++;
    out.push((cond ? "OK   " : "FAIL ") + msg);
  }
  function clearAll() {
    var keep = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      keep.push(k);
    }
    for (var i = 0; i < keep.length; i++) localStorage.removeItem(keep[i]);
  }

  /* 1. чистая установка */
  clearAll();
  BB.data = null;
  var d = BB.load();
  ok(d.version === BB.schema, "чистая установка: версия " + d.version);
  ok(d.coins === 120, "монеты по умолчанию: " + d.coins);
  ok(Array.isArray(d.favs) && d.favs.length === 0, "избранное — пустой массив");
  ok(Array.isArray(d.ugames), "поле моих игр существует");

  /* 2. запись и чтение */
  BB.set("coins", 777);
  ok(BB.get("coins") === 777, "запись монет: " + BB.get("coins"));
  /* Запись склеивается (debounce), поэтому для проверки на диске нужен flush. */
  BB.flush();
  ok(localStorage.getItem("bb2.v3.data") !== null, "данные лежат под версионным ключом");
  var reread = JSON.parse(localStorage.getItem("bb2.v3.data"));
  ok(reread.coins === 777, "flush довёл монеты до диска: " + reread.coins);

  /* 3. импорт старых плоских ключей (игрок до версионирования) */
  clearAll();
  localStorage.setItem("bb2_coins", JSON.stringify(4242));
  localStorage.setItem("bb2_favs", JSON.stringify([3, 7]));
  localStorage.setItem("bb2_ach", JSON.stringify(["run"]));
  BB.data = null;
  var d2 = BB.load();
  ok(d2.coins === 4242, "старые монеты перенесены: " + d2.coins);
  ok(Array.isArray(d2.favs) && d2.favs[1] === 7, "старые избранные перенесены");
  ok(Array.isArray(d2.ach) && d2.ach[0] === "run", "старые достижения перенесены");
  ok(d2.version === BB.schema, "после переноса версия поднята");

  /* 4. битые старые значения не ломают загрузку */
  clearAll();
  localStorage.setItem("bb2_coins", "{это не json");
  BB.data = null;
  var d3 = BB.load();
  ok(d3.coins === 120, "битое значение игнорируется, монеты по умолчанию");

  /* 5. экспорт и импорт */
  BB.set("xp", 500);
  BB.set("works", [{ id: 1, parts: ["a"] }]);
  BB.flush();
  var text = BB.exportText();
  ok(text.indexOf("\"xp\": 500") >= 0, "экспорт содержит xp");
  BB.reset();
  ok(BB.get("xp") === 0, "сброс вернул xp к нулю");
  var res = BB.importText(text);
  ok(res.ok, "импорт принят: " + JSON.stringify(res));
  ok(BB.get("xp") === 500, "xp вернулся после импорта");
  ok(BB.get("works")[0].id === 1, "работы вернулись после импорта");

  /* 6. мусор на входе отвергаем, а не роняем игру */
  var r1 = BB.importText("не json вовсе");
  ok(!r1.ok, "мусор отвергнут: " + r1.error);
  var r2 = BB.importText(JSON.stringify({ version: BB.schema + 5, coins: 1 }));
  ok(!r2.ok, "будущая версия отвергнута");
  ok(BB.get("xp") === 500, "после отказов данные целы");

  /* 7. старый store-обёртка работает поверх нового слоя */
  var before = BB.get("coins");
  store.set("bb2_coins", 55);
  BB.flush();
  ok(store.get("bb2_coins", 0) === 55, "store.set/get через старый API");
  ok(BB.get("coins") === 55, "store пишет в версионированное хранилище");

  /* 8. размер хранилища известен */
  ok(BB.bytes() > 0, "размер хранилища: " + BB.bytes() + " байт");

  /* 9. двойное сохранение: основная запись + резервная копия данных */
  clearAll();
  BB.data = null;
  var d9 = BB.load();
  BB.set("coins", 333);
  BB.flush();
  ok(localStorage.getItem("bb2.v3.data_bak") !== null, "резервная копия появилась после flush");
  var bak = JSON.parse(localStorage.getItem("bb2.v3.data_bak"));
  ok(bak.coins === 333, "в резерве те же монеты: " + bak.coins);
  ok(bak.version === BB.schema, "в резерве версия схемы: " + bak.version);

  /* 10. битая основная запись лечится из резерва */
  localStorage.setItem("bb2.v3.data", "{битый json");
  BB.data = null;
  BB.repaired = false;
  var d10 = BB.load();
  ok(d10.coins === 333, "битая запись: монеты из резерва " + d10.coins);
  ok(BB.repaired === true, "самовосстановление зафиксировано");
  /* после самовосстановления основная запись снова исправна */
  localStorage.removeItem("bb2.v3.data_bak");
  BB.data = null;
  var d10b = BB.load();
  ok(d10b.coins === 333, "после чинки основная запись сама держит монеты");

  /* 11. битая и основная, и резервная — чистая установка без падения */
  clearAll();
  localStorage.setItem("bb2.v3.data", "!!!не-json");
  localStorage.setItem("bb2.v3.data_bak", "&&&тоже мусор");
  BB.data = null;
  var d11 = BB.load();
  ok(d11.coins === 120, "оба биты — стартуем по умолчанию, монеты " + d11.coins);

  /* 12. резервная запись битая, основная хороша — берём основную */
  clearAll();
  BB.data = null;
  BB.load();
  BB.set("coins", 101);
  BB.flush();
  localStorage.setItem("bb2.v3.data_bak", "$испорченный$");
  BB.data = null;
  var d12 = BB.load();
  ok(d12.coins === 101, "битый резерв не перекрывает целую основную: " + d12.coins);

  out.push(fail ? ("ИТОГО: провалено " + fail) : ("ИТОГО: все проверки прошли"));
  var p = document.createElement("pre");
  p.id = "storereport";
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
    with io.open(IDX, encoding="utf-8") as f:
        page = f.read()
    if "src/data/store.js" not in page:
        print("FAIL  хранилище не подключено к index.html")
        return 1
    tmp = os.path.join(ROOT, "_tmp_store.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page.replace("</body>", "<script>" + PROBE + "</script>\n</body>"))

    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbstore_")
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

    m = re.search(r'<pre id="storereport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  хранилище: страница не дошла до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    txt = html.unescape(m.group(1))
    rc = 0
    for line in txt.strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith("FAIL"):
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())