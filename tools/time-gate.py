# -*- coding: utf-8 -*-
"""Гейт фиксированного шага и пула объектов (Фаза 1.3)."""
import html, io, os, re, shutil, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIME = os.path.join(ROOT, "src", "engine", "time.js")

PROBE = r'''
(function(){
  var out = [], fail = 0;
  function ok(c, m) { if (!c) fail++; out.push((c ? "OK   " : "FAIL ") + m); }
  var T = E3Step, P = E3Pool;

  /* --- фиксированный шаг --- */
  ok(Math.abs(T.dt - 1 / 60) < 1e-9, "шаг по умолчанию 1/60 с: " + T.dt);

  T.start();
  var n = T.advance(16.7);
  ok(n === 1, "за кадр 16.7 мс ровно один шаг: " + n);
  n = T.advance(16.7);
  ok(n === 1, "следующий кадр — тоже один: " + n);
  T.start();
  n = T.advance(1000);
  ok(n === T.max, "за секунду шагов не больше max: " + n + " <= " + T.max);
  ok(T.dropped > 0, "избыток честно посчитан в dropped: " + Math.round(T.dropped));

  /* частота монитора не влияет на симуляцию: одинаковое ВРЕМЯ ->
     одинаковое число шагов. 600 кадров по 16.67 мс это 10 с,
     значит 1200 кадров по 8.33 мс — те же 10 с и те же 600 шагов. */
  T.start();
  var a = 0;
  for (var i = 0; i < 600; i++) a += T.advance(16.6667);   /* 60 Гц, 10 с */
  T.start();
  var b = 0;
  for (var i = 0; i < 1200; i++) b += T.advance(8.3333);   /* 120 Гц, те же 10 с */
  ok(Math.abs(a - b) <= 2, "60 Гц и 120 Гц за 10 с дают одинаковые шаги: " + a + " / " + b);

  /* после заморозки вкладки не гонимся */
  T.start();
  n = T.advance(60000);
  ok(n <= T.max, "после минуты простоя шагов не больше max: " + n);
  ok(T.alpha >= 0 && T.alpha <= 1, "alpha в норме: " + T.alpha);

  /* renderDt всегда фиксирован, независимо от кадра */
  T.setup(30);
  ok(Math.abs(T.renderDt() - 1 / 30) < 1e-9, "настройка 30 Гц: " + T.renderDt());
  T.setup(60);

  /* --- пул объектов --- */
  var p = P.pool("test",
    () => ({ a: 1, b: 2 }),
    o => { o.a = 1; o.b = 2; });
  var x1 = p.take(), x2 = p.take();
  ok(!!x1 && !!x2 && x1 !== x2, "пул выдаёт разные объекты");
  ok(p.live === 2, "живых объектов: " + p.live);

  /* release -> take возвращает тот же объект */
  p.release(x1);
  ok(p.live === 1, "после release живых: " + p.live);
  var x3 = p.take();
  ok(x3 === x1, "пул переиспользует объект");
  ok(p.reused >= 1, "счётчик переиспользований: " + p.reused);

  /* поля сброшены при повторной выдаче */
  x1.a = 999; x1.b = 999;
  p.release(x1);
  var x4 = p.take();
  ok(x4.a === 1 && x4.b === 2, "поля сброшены при выдаче: " + x4.a + "," + x4.b);

  /* двойной release игнорируется, а не портит счётчик */
  p.release(x4);
  var before = p.live;
  p.release(x4);
  ok(p.live === before, "двойной release не ломает счётчик: " + p.live);

  /* чужой объект не принимается */
  var alien = { __alive: 1 };
  ok(p.release(alien) === false, "чужой объект не принят");

  /* предел: пул не растёт бесконечно */
  var q = P.pool("limit", () => ({}), null);
  var made = 0, nulls = 0;
  for (var i = 0; i < 5000; i++) { var o = q.take(); if (o) made++; else nulls++; }
  ok(nulls > 0, "пул упёрся в предел и вернул null: " + made + " создано, " + nulls + " отказов");

  /* releaseAll */
  var r = P.pool("batch", () => ({}), null);
  var list = [];
  for (var i = 0; i < 100; i++) list.push(r.take());
  var n2 = r.releaseAll(list);
  ok(n2 === 100 && r.live === 0, "releaseAll вернул всё: " + n2);

  /* готовые шаблоны */
  ok(P.get("particle") && P.get("enemy") && P.get("bullet") && P.get("debris"),
     "готовые пулы на месте");
  var st = P.stats();
  ok(st.total.made > 0 && st.pools.length >= 4,
     "сводка по пулам: " + st.pools.length + " пулов, создано " + st.total.made);

  /* реальное применение: 10к частиц с переиспользованием не растут */
  var pp = P.pool("stress", () => ({ v: 0 }), o => { o.v = 0; });
  var live = [];
  var peakMade = 0;
  for (var f = 0; f < 100; f++) {
    for (var i = 0; i < 100; i++) live.push(pp.take());
    for (var i = 0; i < 100; i++) pp.release(live.pop());
    if (pp.made > peakMade) peakMade = pp.made;
  }
  ok(pp.made === 100, "за 10 000 операций создано всего 100 объектов: " + pp.made);
  ok(pp.reused === 9900, "переиспользовано: " + pp.reused);

  out.push(fail ? ("ИТОГО: провалено " + fail) : "ИТОГО: все проверки прошли");
  var p2 = document.createElement("pre");
  p2.id = "timereport"; p2.textContent = out.join("\n");
  document.body.appendChild(p2);
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
    if not os.path.isfile(TIME):
        print("FAIL  нет src/engine/time.js")
        return 1
    with io.open(TIME, encoding="utf-8") as f:
        src = f.read()
    page = ("<!doctype html><meta charset=utf-8><body><script>"
            + src.replace("</script>", "<\\/script>")
            + "</script><script>try{" + PROBE + "}catch(e){var d=document.createElement('pre');"
      "d.id='timereport';d.textContent='ИСКЛЮЧЕНИЕ: '+e.message+' @ '+String(e.stack||'').slice(0,300);"
      "document.body.appendChild(d);}</script></body>")
    tmp = os.path.join(ROOT, "_tmp_time.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    chrome = find_chrome()
    prof = tempfile.mkdtemp(prefix="nbtime_")
    try:
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--virtual-time-budget=25000", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        os.remove(tmp)
    m = re.search(r'<pre id="timereport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  страница не дошла до проверки")
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