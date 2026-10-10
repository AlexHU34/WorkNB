# -*- coding: utf-8 -*-
"""Гейт редактора (Фаза 6): номера строк и подсветка строки с ошибкой."""
import html, io, os, re, shutil, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LG = os.path.join(ROOT, "lang.html")

PROBE = r'''
(function(){
  var out = [], fail = 0;
  function ok(c, m) { if (!c) fail++; out.push((c ? "OK   " : "FAIL ") + m); }

  var ed = document.getElementById("ed");
  var gut = document.getElementById("gutter");
  var ed2 = document.getElementById("ed2");
  var gut2 = document.getElementById("gutter2");

  /* 1. элементы на месте */
  ok(!!gut, "поле номеров в основном редакторе есть");
  ok(!!gut2, "поле номеров в редакторе урока есть");

  /* 2. номера соответствуют числу строк */
  var code = "let a = 1\nlet b = 2\nlet c = 3\nfn f():\n    return a + b + c\n";
  ed.value = code;
  ed._errLine = 0;
  buildGutter(ed, gut, 0);
  var lines = code.split("\n").length;
  ok(gut.textContent.trim().split("\n").length === lines,
     "номеров столько же, сколько строк: " + gut.textContent.trim().split("\n").length);
  ok(/^\s*1\n/.test(gut.textContent), "первая строка помечена как 1");
  ok(new RegExp("\\n" + lines + "\\s*$").test(gut.textContent),
     "последняя строка помечена как " + lines);

  /* 3. строка с ошибкой подсвечена */
  ed._errLine = 3;
  buildGutter(ed, gut, 3);
  ok(gut.querySelectorAll(".err").length === 1, "ровно одна строка помечена как ошибочная");
  ok(gut.querySelector(".err").textContent.trim() === "3",
     "ошибка на строке 3: " + gut.querySelector(".err").textContent);

  /* 4. текущая строка подсвечена */
  ed.selectionStart = code.indexOf("fn f()");
  buildGutter(ed, gut, 0);
  ok(gut.querySelectorAll(".cur").length === 1, "текущая строка подсвечена одна");

  /* 5. номера не перестраиваются зря: тот же текст — та же разметка */
  var before = gut.innerHTML;
  buildGutter(ed, gut, 0);
  ok(gut.innerHTML === before || gut.querySelectorAll(".cur").length === 1,
     "повторный вызов не ломает разметку");

  /* 6. ширина поля совпадает с отступом текста — иначе номера разъедутся */
  var cs = getComputedStyle(ed);
  var padLeft = parseFloat(cs.paddingLeft);
  ok(Math.abs(padLeft - 56) < 1, "отступ под номера 56px, поле тоже 56px");
  var gcs = getComputedStyle(gut);
  ok(parseFloat(gcs.width) === 56, "ширина поля номеров: " + gcs.width);

  /* 7. прокрутка синхронна: содержимое номеров сдвигается вместе с текстом.
     Скроллить можно только длинный текст — у короткого полосы нет. */
  var longCode = [];
  for (var q = 0; q < 300; q++) longCode.push("let x" + q + " = " + q);
  ed.value = longCode.join("\n");
  buildGutter(ed, gut, 0);
  ed.scrollTop = 38;
  syncGutterScroll(ed, gut);
  var tr = gut._inner ? gut._inner.style.transform : "";
  ok(tr.indexOf("-38px") >= 0, "номера сдвинуты за текстом: transform=" + tr);

  /* 8. большой файл не ломает редактор */
  var big = [];
  for (var i = 0; i < 2000; i++) big.push("let v" + i + " = " + i);
  var t0 = performance.now();
  ed.value = big.join("\n");
  buildGutter(ed, gut, 0);
  var ms = performance.now() - t0;
  ok(ms < 400, "2000 строк строятся за " + Math.round(ms) + " мс");
  ok(gut.textContent.trim().split("\n").length === 2000, "все номера на месте");

  /* 9. редактор урока работает так же */
  if (ed2 && gut2) {
    ed2.value = "a\nb\nc\n";
    buildGutter(ed2, gut2, 2);
    /* хвостовой перевод строки даёт пустую последнюю строку — у textarea
       она тоже есть, значит и номер у неё должен быть */
    var g2n = gut2.textContent.trim().split("\n").length;
    ok(g2n === 4, "нумерация в редакторе урока: " + g2n + " строк (как в textarea)");
    var e2 = gut2.querySelector(".err");
    ok(e2 && e2.textContent.trim() === "2", "ошибка подсвечена в уроке");
  }

  out.push(fail ? ("ИТОГО: провалено " + fail) : "ИТОГО: все проверки прошли");
  var p = document.createElement("pre");
  p.id = "gutreport"; p.textContent = out.join("\n");
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
    with io.open(LG, encoding="utf-8") as f:
        page = f.read()
    if 'id="gutter"' not in page:
        print("FAIL  в редакторе нет поля номеров")
        return 1
    tmp = os.path.join(ROOT, "_tmp_gutter.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page.replace("</body>", "<script>try{" + PROBE + "}catch(e){var d=document.createElement('pre');"
                             "d.id='gutreport';d.textContent='ИСКЛЮЧЕНИЕ: '+e.message+' @ '+String(e.stack||'').slice(0,250);"
                             "document.body.appendChild(d);}</script>\n</body>"))
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbgut_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1280,900", "--virtual-time-budget=40000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        os.remove(tmp)
    m = re.search(r'<pre id="gutreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  редактор не дошёл до проверки")
        for e in re.findall(r"JSERR[^<]{0,250}", dom)[:3]:
            print("      " + html.unescape(e))
        return 1
    rc = 0
    for line in html.unescape(m.group(1)).strip().split("\n"):
        print("  " + line.strip()[:130])
        if line.strip().startswith(("FAIL", "ИСКЛЮЧЕНИЕ")):
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())