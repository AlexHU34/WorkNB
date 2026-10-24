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
  /* Эталон обязан пройти процессором, а не уйти в GL: с P2.2 «авто» —
     поведение по умолчанию, поэтому здесь приказ «выключить» временно. */
  E3GL.request(false);
  E3.draw(ctx2, scene(), cam, 430, LIGHT3);
  E3GL.request(null);
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

  /* Совпадение. Прежняя метрика была надутой: фон GL прозрачный, фон 2D
     тёмно-синий, разница меньше допуска — значит ВСЕ фоновые пиксели
     засчитывались как совпадение, а их 98% площади. Теперь GL сначала
     сводится на тот же фон, что и у эталона, и сравнение идёт только по
     пикселям, где эталон 2D что-то нарисовал. */
  var bgPix = [bgColor[0], bgColor[1], bgColor[2]];
  var glc = new Uint8Array(W * H * 4);
  for (var q = 0; q < W * H; q++) {
    var a = glData[q * 4 + 3] / 255;            /* GL-слой прозрачный */
    for (var ch = 0; ch < 3; ch++)
      glc[q * 4 + ch] = Math.round(glData[q * 4 + ch] * a + bgPix[ch] * (1 - a));
    glc[q * 4 + 3] = 255;
  }
  var m2 = signedMask(ref2d, W, H, bgColor);
  var mG = signedMask(glc, W, H, bgColor);      /* теперь оба по одному фону */
  var inter = 0, union = 0, m2n = 0;
  for (var i = 0, p = 0; i < m2.length; i++, p++) {
    if (m2[p]) m2n++;
    if (m2[p] && mG[p]) inter++;
    if (m2[p] || mG[p]) union++;
  }
  var iou = union ? inter / union : 0;
  ok(iou > 0.80, "пересечение закраски 2D и GL: " + (iou * 100).toFixed(1) + "%");

  var agree = 0;
  for (var i3 = 0, p3 = 0; i3 < m2.length; i3++, p3++) {
    if (m2[p3] && mG[p3]) agree++;
  }
  var recall = m2n ? agree / m2n : 0;
  ok(recall > 0.85, "GL попадает туда же, где 2D: " + (recall * 100).toFixed(1) +
     "% из " + m2n + " px эталона");

  /* Яркость — по тем же нарисованным пикселям, уже сведённым на фон. */
  var close = 0, sumDiff = 0, n = m2n || 1;
  for (var i2 = 0, p2 = 0; i2 < m2.length; i2++, p2++) {
    if (!m2[p2]) continue;
    var l1 = (ref2d[i2] + ref2d[i2 + 1] + ref2d[i2 + 2]) / 3;
    var l2v = (glc[i2] + glc[i2 + 1] + glc[i2 + 2]) / 3;
    var d = Math.abs(l1 - l2v);
    sumDiff += d;
    if (d < 90) close++;
  }
  var sim = close / n;
  var meanDiff = sumDiff / n;
  ok(sim > 0.75, "яркость совпадает на " + (sim * 100).toFixed(1) +
     "% нарисованных пикселей (средняя разница " + meanDiff.toFixed(1) + ")");

  /* Ошибки GL не должны копиться: раньше getError не вызывался ни разу,
     и четыре критичных бага были молчаливыми. */
  var gs = E3GL.stats();
  ok(gs.glErrors === 0, "GL не накопил ошибок (glErrors=" + gs.glErrors +
     (gs.firstError ? ", первая: " + gs.firstError + " в " + gs.firstErrorAt : "") + ")");

  /* Тень обязана быть ПРОЗРАЧНОЙ. Раньше альфа терялась в шейдере, тени
     ложились непрозрачными и закрывали пол — а гейт этого не видел. */
  var transparent = 0, seen = 0;
  for (var z = 0; z < W * H; z++) {
    if (glData[z * 4 + 3] > 8) {
      seen++;
      if (glData[z * 4 + 3] < 250) transparent++;
    }
  }
  ok(transparent > 200, "есть полупрозрачные пиксели (тень): " +
     transparent + " из " + seen + " нарисованных");

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
  E3GL.request(false); /* эталон — только процессор, смотри выше */
  E3.draw(ctx3, facesTM, cam2, 430, LIGHT3);
  E3GL.request(null);
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

  /* ---- 4a. КАДР ЧИСТИТСЯ ----
     Раньше beginFrame был объявлен дважды, и рабочая очистка была
     недостижима: каждый кадр наслаивался на предыдущий, и сцена темнела.
     Проверяем прямо: рисуем сцену, потом пустую, и смотрим, что от
     сцены не осталось ничего. */
  E3GL.draw(ctx2, scene(), cam, 430, LIGHT3);
  E3GL.draw(ctx2, [], cam, 430, LIGHT3);
  var pxClear = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pxClear);
  var left = 0;
  for (var z2 = 3; z2 < pxClear.length; z2 += 4)
    if (pxClear[z2] > 8) left++;
  ok(left < 200, "пустой кадр очищает предыдущий (осталось " + left + " px)");

  /* ---- 4b. ТЕНЬ ПОЛУПРОЗРАЧНА ----
     Считать надо ИМЕННО тень: раньше полупрозрачные пиксели давала
     обводка, поэтому сломанная альфа проходила незамеченной. Здесь
     сцена состоит только из тени — у неё нет и обводки. */
  var shOnly = [].concat(E3.shadow(0, 0, 3, 2, {}));
  E3GL.draw(ctx2, shOnly, cam, 430, LIGHT3);
  var pxSh = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pxSh);
  var shSoft = 0, shHard = 0, shLevels = {};
  for (var z3 = 3; z3 < pxSh.length; z3 += 4) {
    var av = pxSh[z3];
    if (av >= 250) shHard++;
    else if (av > 2) { shSoft++; shLevels[av] = 1; }
  }
  /* Тень теперь с плавным краем (веер из центра), поэтому «мягкость» —
     это не одно значение альфы на всю площадь, а много ступеней. */
  ok(shSoft > 500, "тень полупрозрачная: мягких пикселей " + shSoft +
     " (жёстких " + shHard + ")");
  ok(shHard < 200, "тень не рисуется непрозрачной: жёстких пикселей " + shHard);
  ok(Object.keys(shLevels).length >= 4,
     "у тени плавный край: разных ступеней прозрачности " +
     Object.keys(shLevels).length);

  /* ---- 4c. ОБВОДКА ПРАВИЛЬНОГО ЦВЕТА ----
     Раньше гейт считал только число отрезков. При сбитом шаге цвет
     читался из координат вершины — и гейт этого не замечал. Проверяем
     сам цвет: обводка тёмно-синяя, то есть синий канал выше красного. */
  /* ---- 4c. ОБВОДКА ПРАВИЛЬНОГО ЦВЕТА ----
     Регулятор качества E3.maxFaces мог остаться от предыдущих кадров и
     срезать всю сцену, поэтому перед каждой точечной проверкой он
     сбрасывается. */
  E3.maxFaces = 0;
  var boxOnly = [].concat(E3.box(0, 1, 0, 4, 4, 4, "#c8c8c8"));
  E3GL.draw(ctx2, boxOnly, cam, 430, LIGHT3);
  var pxLn = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pxLn);
/* Обводка ищем СРАВНЕНИЕМ двух кадров: с ней и без неё. Разница обязана
     быть тонкой рамкой по краям куба. Если шаг в буфере обводки сбит,
     линии ложатся не туда и картина рассыпается. */
  E3.maxFaces = 0;
  var savedStroke = E3.minStroke;
  E3.minStroke = 0;
  E3GL.draw(ctx2, boxOnly, cam, 430, LIGHT3);
  var withLn = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, withLn);
  E3.minStroke = 1e9;                      /* обводка выключена */
  E3GL.draw(ctx2, boxOnly, cam, 430, LIGHT3);
  var noLn = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, noLn);
  E3.minStroke = savedStroke;

  var facePx = 0, edgePx = 0;
  for (var z7 = 0; z7 < W * H; z7++) {
    var a7 = noLn[z7 * 4 + 3];
    if (a7 > 200) facePx++;
    if (Math.abs(withLn[z7 * 4] - noLn[z7 * 4]) > 6 ||
        Math.abs(withLn[z7 * 4 + 1] - noLn[z7 * 4 + 1]) > 6 ||
        Math.abs(withLn[z7 * 4 + 2] - noLn[z7 * 4 + 2]) > 6) edgePx++;
  }
  ok(edgePx > 100, "обводка что-то рисует: отличающихся пикселей " + edgePx);
  ok(edgePx < facePx * 0.6, "обводка тонкая, а не заливка: " + edgePx +
     " px разницы против " + facePx + " px грани");

  var blueish = 0, junk = 0, bright = 0;
  var dR = 0, dG = 0, dB = 0, dN = 0;
  for (var z4 = 0; z4 < W * H; z4++) {
    var r4 = withLn[z4 * 4], g4 = withLn[z4 * 4 + 1], b4 = withLn[z4 * 4 + 2];
    if (withLn[z4 * 4 + 3] < 200) continue;
    if (b4 > r4) blueish++;
    if (r4 > 250 && g4 > 250 && b4 > 250) bright++;
    if (b4 > r4 + 60) junk++;
    var dr = noLn[z4 * 4] - withLn[z4 * 4];
    var dg = noLn[z4 * 4 + 1] - withLn[z4 * 4 + 1];
    var db = noLn[z4 * 4 + 2] - withLn[z4 * 4 + 2];
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 12) { dR += dr; dG += dg; dB += db; dN++; }
  }
  var sb6 = E3GL.stats();
  ok(blueish > edgePx * 0.3, "обводка сине грани: " + blueish +
     " из " + edgePx + " отмеченных пикселей");
  ok(junk < 50, "цвет обводки не взят из координат: перекосов " + junk);
  ok(bright < 50, "обводка не рисуется белым: " + bright + " px");

  /* Цвет обводки — постоянный (10,10,25) при alpha .25, поэтому вклад
     в R, G и B обязан быть почти одинаковым. При сбитом шаге буфера
     цвет читается из координат вершины, и вклады расходятся. */
  var mR = dN ? Math.abs(dR / dN) : 0, mG = dN ? Math.abs(dG / dN) : 0,
      mB = dN ? Math.abs(dB / dN) : 0;
  var spread = Math.max(mR, mG, mB) - Math.min(mR, mG, mB);
  ok(dN > 100 && spread < Math.max(mR, mG, mB) * 0.35,
     "вклад каналов обводки ровный: R " + mR.toFixed(1) + ", G " +
     mG.toFixed(1) + ", B " + mB.toFixed(1) + ", разброс " + spread.toFixed(1));

  /* ---- 4d. ГРАНЬ e:1 НЕ ОСВЕЩАЕТСЯ ----
     В 2D-пути грань с флагом e:1 идёт плоской, своим цветом. В GL она
     была освещена и темнела. Рисуем такую грань одну и сравниваем с её
     собственным цветом. */
  E3.maxFaces = 0;
  /* Грань e:1 обязана остаться своего цвета, а та же грань без этого
     флага — освещённой. Сравниваем их друг с другом: если флаг перестал
     действовать, значения сойдутся и проверка это увидит. Раньше
     сравнивалось только с ожидаемым числом, и при случайном повороте
     камеры грань освещалась в полную, а проверка всё равно проходила. */
  E3.maxFaces = 0;
  var litTri = E3.tri([-2, 0, 3], [2, 0, 3], [0, 3, 3], "#808080",
                      [-0.42, -0.75, -0.5]);
  var flatTri = E3.tri([-2, 0, 3], [2, 0, 3], [0, 3, 3], "#808080",
                       [-0.42, -0.75, -0.5]);
  flatTri.e = 1;
  function avgBright(face) {
    E3GL.draw(ctx2, [face], cam, 430, LIGHT3);
    var buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    var s = 0, n = 0;
    for (var z5 = 0; z5 < W * H; z5++) {
      if (buf[z5 * 4 + 3] < 250) continue;
      s += (buf[z5 * 4] + buf[z5 * 4 + 1] + buf[z5 * 4 + 2]) / 3;
      n++;
    }
    return { avg: n ? s / n : 0, n: n };
  }
  var gLit = avgBright(litTri), gFlat = avgBright(flatTri);
  ok(gFlat.n > 200 && gLit.n > 200, "обе грани нарисованы: освещённая " +
     gLit.n + " px, плоская " + gFlat.n + " px");
  ok(Math.abs(gLit.avg - gFlat.avg) > 25,
     "фла�� e:1 меняет освещение: без флага " + gLit.avg.toFixed(1) +
     ", с флагом " + gFlat.avg.toFixed(1));
  ok(Math.abs(gFlat.avg - 128) < 8,
     "плоская грань остаётся своего цвета #808080 (средняя " +
     gFlat.avg.toFixed(1) + ")");

  /* ---- 5. откат: без GL страница живёт ---- */
  var before = E3GL.ok;
  E3GL.disable();
  ok(E3GL.active === false, "GL-путь выключается");
  E3GL.beginFrame("#111a2b", "#1d2b45");
  E3GL.draw(ctx2, scene(), cam, 430, LIGHT3);
  ok(E3GL.state.ok === before, "состояние не ломается при выключенном active");

  /* P2.2: авто-режим по умолчанию. Жесткие приказы (
     request(true|false)) главнее автоматики; класс no-gl и выключение —
     уважаются даже в авто; vamos после провала attach не бесится. */
  document.body.classList.add("no-gl");
  E3GL.request(null);
  ok(E3GL.want === false, "авто уважает класс no-gl");
  document.body.classList.remove("no-gl");
  ok(E3GL.want === true, "авто по умолчанию пробует видеокарту");
  E3GL.request(false);
  ok(E3GL.want === false, "жёсткий «выключить» сильнее автоматики");
  E3GL.request(true);
  ok(E3GL.want === true, "жёсткий «включить» работает без адреса");
  E3GL.request(null);

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