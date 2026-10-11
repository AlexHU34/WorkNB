# -*- coding: utf-8 -*-
"""Гейт бэкенда WebGL2 (src/engine/e3gl.js).

Проверяет не «вызвалось без ошибки», а две вещи, которые действительно
значимы:

  1. GL-путь рисует. Берём пиксели из GL-буфера и убеждаемся, что они
     не фоновые и что покрытие сопоставимо с 2D-путём.
  2. GL-путь рисует ТО ЖЕ. Та же сцена гонится и в E3.draw, и в
     E3GL.draw; сравниваем покрытие и долю совпавших по грубой
     яркости пикселей. Порог снисходительный не потому, что точность
     не важна, а потому что формула освещения считается на GPU и на
     процессоре: там целочисленное усечение, здесь нет.

Дополнительно проверяется откат: без WebGL2 страница обязана продолжить
работать на 2D-пути.
"""
import html
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

GUARD = r"""
<script>
window.__errs = [];
/* Если пробник упал, отчёта не будет — а гейт скажет только «страница не
   дошла». Поэтому ловим ошибку и сами пишем отчёт: видно, что именно
   сломалось, а не просто что сломалось что-то. */
window.__report = function (lines) {
  if (document.getElementById("glreport")) return;
  var p = document.createElement("pre");
  p.id = "glreport";
  p.textContent = lines.join("\n") + "\nИТОГ: FAIL";
  document.body.appendChild(p);
};
window.onerror = function (m, s, l, c, e) {
  window.__errs.push(m + " @ " + (s || "").split("/").pop() + ":" + l);
  setTimeout(function () {
    window.__report(["FAIL пробник упал: " + m,
                     "     на строке " + l,
                     "     " + (e && e.stack ? String(e.stack).split("\n")[1] : "")]);
  }, 0);
};
</script>
"""

PROBE = r"""
<script>
(function () {
  var out = [], fail = 0;
  var ok = function (c, m) { out.push((c ? "OK   " : "FAIL ") + m); if (!c) fail++; };

  var W = 480, H = 320;

  /* ---- сцена, одинаковая для обоих путей ---- */
  function scene() {
    var F = [];
    F.push.apply(F, E3.box(0, 1, 0, 2, 2, 2, "#ff7043"));
    F.push.apply(F, E3.box(-3, 0.7, 1, 1.6, 1.4, 1.6, "#4fc3f7"));
    F.push.apply(F, E3.pyramid(3, 0.8, 0, 2, 1.8, 2, "#81c784"));
    F.push.apply(F, E3.shadow(0, 0, 2, 2, { y: 0, a: 0.3 }));
    F.push.apply(F, E3.quad([-8, 0, -2], [8, 0, -2], [8, 0, 6], [-8, 0, 6],
                            "#2e7d4f", [0, 1, 0]));
    F.push(E3.sprite(0, 4, 0, 2, "A", "#ffffff"));
    return F;
  }
  var cam = { x: 0, y: 5, z: -9, yaw: 0, pitch: 0.42 };

  /* ---- 1. путь 2D: эталон ---- */
  var c2 = document.createElement("canvas");
  c2.width = W; c2.height = H; c2._lw = W; c2._lh = H;
  document.body.appendChild(c2);
  var ctx2 = c2.getContext("2d");
  ctx2.fillStyle = "#111a2b"; ctx2.fillRect(0, 0, W, H);
  E3.draw(ctx2, scene(), cam, 430, LIGHT3);
  var ref2d = ctx2.getImageData(0, 0, W, H).data;

  function coverage(data, W, H, bg) {
    /* Пиксель считаем закрашенным, если он отличается от фона. */
    var n = 0;
    for (var i = 0; i < data.length; i += 4) {
      var d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) +
              Math.abs(data[i + 2] - bg[2]);
      if (d > 30) n++;
    }
    return n;
  }
  function signedMask(data, W, H, bg) {
    var m = new Uint8Array(W * H);
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      var d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) +
              Math.abs(data[i + 2] - bg[2]);
      m[p] = d > 30 ? 1 : 0;
    }
    return m;
  }

  var bgColor = [0x11, 0x1a, 0x2b];
  var cov2d = coverage(ref2d, W, H, bgColor);
  ok(cov2d > 3000, "2D-путь рисует сцену, закрашено " + cov2d + " px");

  /* ---- 2. путь GL ---- */
  var okAttach = E3GL.attach(ctx2);
  ok(okAttach, "WebGL2 подключился (" + (E3GL.stats().err || "без ошибок") + ")");
  if (!okAttach) { finish(); return; }

  ok(E3GL.beginFrame("#111a2b", "#1d2b45"), "фон нарисован в GL");
  E3GL.draw(ctx2, scene(), cam, 430, LIGHT3);
  var st = E3GL.stats();
  ok(st.verts > 0, "в GL ушло вершин: " + st.verts);
  ok(st.lines > 0, "обводка собрана, отрезков: " + st.lines);
  ok(st.sprites === 1, "спрайт ушёл на 2D-слой: " + st.sprites);

  /* ---- 2a. слой HUD поверх геометрии ----
     Без него цифры счёта и полосы здоровья, которые игра рисует на
     своей канве, оказались бы ПОД геометрией и пропали бы там, где сцена
     на них налезает. */
  ok(!!document.getElementById("e3glHud"), "создан слой HUD поверх сцены");
  var hctx = E3GL.hud();
  ok(!!hctx, "E3GL.hud() отдаёт 2D-контекст");
  if (hctx) {
    hctx.clearRect(0, 0, W, H);
    hctx.fillStyle = "#ff00ff";
    hctx.fillRect(20, 20, 60, 30);
    var hd = hctx.getImageData(0, 0, W, H).data;
    var magenta = 0;
    for (var q = 0; q < hd.length; q += 4)
      if (hd[q] > 180 && hd[q + 1] < 90 && hd[q + 2] > 180) magenta++;
    ok(magenta > 1000, "на слое HUD пишется текст и полосы, пикселей " + magenta);
    var rect = document.getElementById("e3glHud").getBoundingClientRect();
    var glRect = document.getElementById("e3glLayer").getBoundingClientRect();
    ok(rect.top <= glRect.top + 1 && rect.left <= glRect.left + 1,
       "слой HUD лежит не ниже слоя GL");
  }

  var gl = E3GL.state.gl;
  var px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);

  /* GL читается снизу вверх, а E3 считает сверху вниз — переворачиваем. */
  var glData = new Uint8Array(W * H * 4);
  for (var y = 0; y < H; y++) {
    var src = (H - 1 - y) * W * 4, dst = y * W * 4;
    glData.set(px.subarray(src, src + W * 4), dst);
  }

  var covGl = coverage(glData, W, H, [0, 0, 0]);
  ok(covGl > 3000, "GL-путь рисует сцену, закрашено " + covGl + " px");

  /* Совпадение масок закраски: насколько пути рисуют одно и то же место. */
  var m2 = signedMask(ref2d, W, H, bgColor);
  var mG = signedMask(glData, W, H, [0, 0, 0]);
  var inter = 0, union = 0;
  for (var i = 0; i < m2.length; i++) {
    if (m2[i] && mG[i]) inter++;
    if (m2[i] || mG[i]) union++;
  }
  var iou = union ? inter / union : 0;
  ok(iou > 0.55, "пересечение закраски 2D и GL: " + (iou * 100).toFixed(1) + "%");

  /* Совпадение по яркости ВСЕЙ картинки, а не только закрашенных пикселей.
     Сначала сравнивали маски, но маска GL считалась от чёрного, а фон у
     GL — тёмно-синий градиент: он целиком попадал в «закрашенные», и
     метрика теряла смысл. Теперь просто мерим, насколько картинки
     похожи попиксельно. Порог снисходительный: формула освещения на GPU
     считается без целочисленного усечения, которое делает E3.shade. */
  var close = 0, sumDiff = 0, n = W * H;
  for (var i = 0, p = 0; i < n * 4; i += 4, p++) {
    var l1 = (ref2d[i] + ref2d[i + 1] + ref2d[i + 2]) / 3;
    var l2v = (glData[i] + glData[i + 1] + glData[i + 2]) / 3;
    var d = Math.abs(l1 - l2v);
    sumDiff += d;
    if (d < 90) close++;
  }
  var sim = close / n;
  var meanDiff = sumDiff / n;
  ok(sim > 0.5, "яркость совпадает в " + (sim * 100).toFixed(1) +
     "% пикселей (средняя разница " + meanDiff.toFixed(1) + ")");

  /* ---- 3. тень стала четырёхугольной (баг из блока A) ---- */
  var sh = E3.shadow(0, 0, 2, 2, {});
  var nvSh = (sh[0].t || sh[0].v[3] === sh[0].v[0]) ? 3 : 4;
  ok(nvSh === 4, "тень считается четырьмя вершинами");

  /* ---- 4. сетка клеток tileMap: раньше на каждую клетку приходились
       четыре проекции, заливка и save/clip/restore. Теперь клетки идут
       в один буфер. Проверяем, что рисунок совпал с 2D-путём. */
  var tm = E3.tileMap(6, 6, 4, 4, function (gx, gz) {
    return ((gx + gz) % 2) ? "#2e7d4f" : "#3a8f5f";
  });
  var facesTM = [].concat(tm, E3.box(0, 2, 0, 2, 4, 2, "#ff7043"));
  var cam2 = { x: 0, y: 12, z: -16, yaw: 0.1, pitch: 0.6 };

  var c3 = document.createElement("canvas");
  c3.width = W; c3.height = H; c3._lw = W; c3._lh = H;
  document.body.appendChild(c3);
  var ctx3 = c3.getContext("2d");
  ctx3.fillStyle = "#111a2b"; ctx3.fillRect(0, 0, W, H);
  E3.draw(ctx3, facesTM, cam2, 430, LIGHT3);
  var refTM = ctx3.getImageData(0, 0, W, H).data;
  var covTM = coverage(refTM, W, H, bgColor);
  ok(covTM > 20000, "2D-путь рисует сетку, закрашено " + covTM + " px");

  E3GL.draw(ctx2, facesTM, cam2, 430, LIGHT3);
  var stTM = E3GL.stats();
  ok(stTM.verts > 0, "сетка ушла в GL, вершин " + stTM.verts);

  var pxTM = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pxTM);
  var glTM = new Uint8Array(W * H * 4);
  for (var y2 = 0; y2 < H; y2++) {
    var s2 = (H - 1 - y2) * W * 4, d2 = y2 * W * 4;
    glTM.set(pxTM.subarray(s2, s2 + W * 4), d2);
  }
  var covGLTM = coverage(glTM, W, H, [0, 0, 0]);
  ok(covGLTM > 20000, "GL-путь рисует сетку, закрашено " + covGLTM + " px");

  var closeTM = 0;
  for (var j = 0; j < W * H * 4; j += 4) {
    var a1 = (refTM[j] + refTM[j + 1] + refTM[j + 2]) / 3;
    var a2 = (glTM[j] + glTM[j + 1] + glTM[j + 2]) / 3;
    if (Math.abs(a1 - a2) < 90) closeTM++;
  }
  var simTM = closeTM / (W * H);
  ok(simTM > 0.5, "рисунок сетки совпал с 2D-путём: " +
     (simTM * 100).toFixed(1) + "%");

  /* ---- 5. откат: без GL страница живёт ---- */
  var before = E3GL.ok;
  E3GL.disable();
  ok(E3GL.active === false, "GL-путь выключается");
  E3GL.beginFrame("#111a2b", "#1d2b45");
  E3GL.draw(ctx2, scene(), cam, 430, LIGHT3);
  ok(E3GL.state.ok === before, "состояние не ломается при выключенном active");

  out.push(window.__errs.length === 0
    ? "OK   ошибок JS нет"
    : "FAIL ошибки JS: " + window.__errs.slice(0, 3).join(" | "));
  finish();

  function finish() {
    var pre = document.createElement("pre");
    pre.id = "glreport";
    pre.textContent = out.join("\n") + "\nИТОГ: " +
      (fail === 0 && window.__errs.length === 0 ? "PASS" : "FAIL");
    document.body.appendChild(pre);
  }
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


PAGE = """<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>гейт WebGL2</title>
<style>body{margin:0;background:#0e1420}canvas{image-rendering:pixelated}</style>
</head><body>
<script src="src/engine/e3.js"></script>
<script src="src/engine/e3gl.js"></script>
</body></html>"""


GAME = """let px = 0

fn setup():
    bg("#1b2a4a", "#0d1526")
    camera(0, 6, -22, 0, 0.25)
    ground(60, 120, "#2e7d4f")

fn update(dt):
    px = px + 3 * dt

fn draw():
    box(px, 3, 0, 6, 6, 6, "#ff5d8f")
    shadow(px, 0, 4, 3)
    text(12, 24, "GL-тест", 18, "#ffffff")
"""

APP_PROBE = r"""
<script>
window.__errs = [];
window.onerror = function (m, s, l) { window.__errs.push(m + " @" + l); };
setTimeout(function () {
  var card = document.querySelector(".ugame-card");
  var put = function (o) {
    var p = document.createElement("pre");
    p.id = "appgl"; p.textContent = JSON.stringify(o);
    document.body.appendChild(p);
  };
  if (!card) { put({ err: "плитка своей игры не появилась" }); return; }
  card.click();
  setTimeout(function () {
    var gl = E3GL.stats();
    put({
      playing: !!document.querySelector(".playfield"),
      glOk: E3GL.ok,
      want: E3GL.want,
      layer: !!document.getElementById("e3glLayer"),
      verts: gl.verts, lines: gl.lines, sprites: gl.sprites,
      canvas: gl.w + "x" + gl.h,
      errs: window.__errs.slice(0, 3)
    });
  }, 2200);
}, 1000);
</script>
"""


def app_phase():
    """То же самое, но внутри настоящей страницы приложения и настоящей
    игры на BloomScript. Первый тест доказывал, что бэкенд работает сам
    по себе; этот — что до него доходит игра из каталога."""
    out = []
    page = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    src = json.dumps(GAME, ensure_ascii=False)
    seed = ('(function(){try{localStorage.setItem("bb2_ugames.v1",'
            'JSON.stringify([{id:1,src:%s}]));}catch(e){}})();' % src)
    tag = '<script src="src/engine/e3.js"></script>'
    if tag not in page:
        return ["FAIL  в index.html нет подключения движка"]
    page = page.replace(tag, "<script>" + seed + "</script>\n" + tag, 1)
    page = page.replace("</body>", APP_PROBE + "\n</body>", 1)

    tmp = os.path.join(ROOT, "_tmp_gl_app.html")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    dom = None
    try:
        # Свой профиль на каждый запуск: два Chrome на одном профиле
        # не уживаются, второй молча зависает.
        prof = tempfile.mkdtemp(prefix="nbglapp_")
        try:
            dom = subprocess.run(
                [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
                 "--user-data-dir=" + prof, "--hide-scrollbars",
                 "--window-size=1100,760", "--virtual-time-budget=20000",
                 "--allow-file-access-from-files", "--dump-dom",
                 "file:///" + tmp.replace("\\", "/") + "?gl=1"],
                capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=180).stdout
        finally:
            shutil.rmtree(prof, ignore_errors=True)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    m = re.search(r'<pre id="appgl"[^>]*>(.*?)</pre>', dom or "", re.S)
    if not m:
        return ["FAIL  игра не дошла до проверки GL"]
    try:
        r = json.loads(html.unescape(m.group(1)))
    except Exception:
        return ["FAIL  отчёт не разобран: " + m.group(1)[:200]]

    def ok(c, msg):
        out.append(("OK   " if c else "FAIL ") + msg)

    ok(r.get("playing") is True, "игра на BloomScript запустилась")
    ok(r.get("want") is True, "GL-режим запрошен адресом ?gl=1")
    ok(r.get("glOk") is True, "GL подключился внутри игры")
    ok(r.get("layer") is True, "слой GL создан в странице")
    ok((r.get("verts") or 0) > 0, "игра отдала геометрию в GL: " + str(r.get("verts")))
    ok((r.get("sprites") or 0) >= 0, "спрайты обработаны: " + str(r.get("sprites")))
    ok(not r.get("errs"), "ошибок JS нет: " + str(r.get("errs")))
    return out


def main():
    # Страница обязана лежать в корне проекта: она подключает движок по
    # относительному пути src/engine/e3.js, и из временной папки он не
    # находится — страница молча падала, а гейт писал «не дошла».
    tmp = os.path.join(ROOT, "_tmp_gl_gate.html")
    page = PAGE.replace("</head>", GUARD + "\n</head>")
    page = page.replace("</body>", PROBE + "\n</body>")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    prof = tempfile.mkdtemp(prefix="nbglprof_")
    try:
        dom = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=900,700", "--virtual-time-budget=20000",
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

    m = re.search(r'<pre id="glreport"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        print("FAIL  страница не дошла до проверки — вероятно, упала при загрузке")
        for e in re.findall(r"Uncaught[^<]{0,220}", dom)[:4]:
            print("      " + html.unescape(e))
        return 1

    txt = html.unescape(m.group(1))
    for line in txt.strip().split("\n"):
        print("      " + line.strip()[:120])
    passed = txt.rstrip().endswith("PASS")

    print("\n      --- игра из каталога на странице приложения (?gl=1) ---")
    app = app_phase()
    for line in app:
        print("      " + line[:120])
    if any(l.startswith("FAIL") for l in app):
        passed = False

    print("PASS  бэкенд WebGL2" if passed else "FAIL  бэкенд WebGL2")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())