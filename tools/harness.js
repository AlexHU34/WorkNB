/* ============================================================================
 * harness.js — автотест NEBULA BLOOM
 * ---------------------------------------------------------------------------
 * Вставляется вторым <script> в конец body страницы index.html и прогоняет
 * КАЖДУЮ игру: открывает, шлёт ввод с клавиатуры и мыши, ждёт ~230 кадров,
 * собирает window.onerror, проверяет отсутствие утечек игровых режимов.
 *
 * Режимы запуска (через параметр в URL):
 *   ?harness=smoke  — общий прогон всех игр      (основной «ворота»)
 *   ?harness=beh    — поведенческие проверки      (конструктор, экономика, UI)
 *   ?harness=single — одна игра из ?game=N
 *   ?harness=shots  — рендер скриншотов           (используется run-tests.py --shots)
 * ==========================================================================*/
(function () {
  var P = new URLSearchParams(location.search);
  var MODE = P.get('harness') || 'smoke';
  if (!MODE) return;

  var errs = [];
  window.addEventListener('error', function (e) {
    var msg = 'ERR ' + (e.message || e.error) + ' @' + e.lineno + ':' + e.colno;
    errs.push(msg);
    // харнесс rAF-прокси собирает ошибки из игровых циклов сюда же
    if (window.__rafErr && window.__rafErr.length) {
      errs.push('RAFF ' + window.__rafErr[window.__rafErr.length - 1]);
    }
  });
  window.addEventListener('unhandledrejection', function (e) { errs.push('REJ ' + e.reason); });

  /* --- считаем реально отработавшие кадры, чтобы убедиться, что циклы крутились --- */
  var rafCount = 0;
  (function tick() { rafCount++; requestAnimationFrame(tick); })();

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var out = [];
  function record(o) { out.push(o); flush(); }
  function flush() {
    var el = document.getElementById('__report') || (function () {
      var e = document.createElement('pre'); e.id = '__report';
      e.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0';
      document.body.appendChild(e); return e;
    })();
    el.textContent = (out.done ? 'DONE' : '') + JSON.stringify(out);
  }

  /* -------------------------------------------------------------- ввод --- */
  var KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'w', 'a', 's', 'd'];
  function pressAll() {
    KEYS.forEach(function (k) {
      var o = { key: k, code: k === ' ' ? 'Space' : 'Key' + k.toUpperCase(), bubbles: true };
      document.dispatchEvent(new KeyboardEvent('keydown', o));
      document.dispatchEvent(new KeyboardEvent('keyup', o));
    });
  }
  function tapCanvas(fx, fy) {
    var cv = document.querySelector('#canvas canvas.playfield');
    if (!cv) return false;
    var r = cv.getBoundingClientRect();
    if (!r.width) return false;
    var o = {
      clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
      bubbles: true, pointerId: 1, button: 0, isPrimary: true
    };
    ['pointerdown', 'pointermove', 'pointerup', 'click'].forEach(function (t) {
      cv.dispatchEvent(new PointerEvent(t, o));
    });
    return true;
  }

  function clickModeButtons() {
    var n = document.querySelectorAll('#canvas .mbtn, #canvas .ctrl, #canvas .tool, #canvas .memcard, #canvas [data-z]');
    for (var i = 0; i < n.length; i++) { try { n[i].click(); } catch (e) {} }
    return n.length;
  }

  /* --------------------------------------------------- прогон одной игры --- */
  async function playGame(id) {
    errs.length = 0;
    var f0 = rafCount;
    var t = { game: id };

    try { openGame(id); } catch (e) { t.fatal = String(e); record(t); return; }
    await wait(140);

    // магазин из топ-бара во время 3D-режима — регресс «allParts()» (бывший краш)
    try { openShop(); closeShop(); } catch (e) { errs.push('SHOP ' + e); }
    await wait(140);

    var taps = 0;
    for (var k = 0; k < 4; k++) {
      if (tapCanvas(0.2 + 0.2 * k, 0.3 + 0.2 * (k % 2))) taps++;
      pressAll();
      await wait(80);
    }

    t.clicked = clickModeButtons();
    pressAll();
    await wait(160);

    try { saveClick(); } catch (e) { errs.push('SAVE ' + e); }
    await wait(120);
    try { undo(); redo(); } catch (e) { errs.push('UNDO ' + e); }
    try { goHome(); } catch (e) { errs.push('HOME ' + e); }
    await wait(60);

    t.taps = taps;
    t.errs = errs.slice();
    t.leftoverModes = document.querySelectorAll('#canvas .mode').length;
    t.parts = document.querySelectorAll('#canvas .part').length;
    t.frames = rafCount - f0;
    record(t);
  }

  /* --------------------------------------------------- поведенческие тесты --- */
  async function behaviour() {
    function ok(k, cond, extra) {
      out.push({ check: k, pass: !!cond, extra: extra === undefined ? undefined : extra });
      flush();
    }
    function frames(n) {
      return new Promise(function (r) { var i = 0; function s() { if (++i >= n) return r(); requestAnimationFrame(s); } requestAnimationFrame(s); });
    }
    function pd(el, type, o) {
      el.dispatchEvent(new PointerEvent(type, Object.assign(
        { bubbles: true, pointerId: 1, button: 0, isPrimary: true }, o)));
    }
    try { localStorage.clear(); } catch (e) {}
    // сбросить и модульные переменные (localStorage чистим ДО, но переменные уже инициализированы)
    coins = 120; works = []; owned = []; favs = []; ach = []; history = []; updateHUD();

    /* 1. титульный экран виден на десктопе */
    var ts = document.getElementById('titleScreen');
    ok('title-screen visible on desktop', getComputedStyle(ts).display !== 'none', getComputedStyle(ts).display);

    /* 2. конструктор: клик, перетаскивание, undo/redo */
    goHome(); openGame(1);
    var parts = function () { return document.querySelectorAll('#canvas .part').length; };
    ok('canvas empty on open', parts() === 0, parts());
    var tools = document.querySelectorAll('#partsBar .tool');
    ok('toolbar rendered', tools.length > 0, tools.length);
    for (var i = 0; i < 8; i++) tools[i].click();
    ok('8 parts added by click', parts() === 8, parts());

    var before = parts();
    var cr = document.getElementById('canvas').getBoundingClientRect();
    pd(tools[0], 'pointerdown', { clientX: cr.left + 5, clientY: cr.top + cr.height - 10 });
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: cr.left + 200, clientY: cr.top + 120, bubbles: true, pointerId: 1 }));
    var ghost = document.querySelectorAll('.dragGhost').length;
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: cr.left + 200, clientY: cr.top + 120, bubbles: true, pointerId: 1 }));
    ok('drag ghost shown', ghost === 1, ghost);
    ok('part dropped by drag', parts() === before + 1, parts());
    ok('drag ghost removed', document.querySelectorAll('.dragGhost').length === 0);
    undo(); ok('undo removes one part', parts() === before, parts());
    redo(); ok('redo restores it', parts() === before + 1, parts());

    /* 3. сохранение работы */
    var c0 = coins;
    saveClick();
    ok('coins increase after save', coins > c0, { before: c0, after: coins });
    ok('work saved', works.length > 0, works.length);
    ok('work html is loadable', !!(works[0] && works[0].html && works[0].html.indexOf('class="part"') >= 0));
    ok('achievement unlocked', ach.indexOf('first') >= 0, ach);
    openGame(1); loadWork(0); await wait(200);
    ok('saved work reloaded', parts() > 0, parts());

    /* 4. shakeIt */
    var cv = document.getElementById('canvas');
    cv.style.transform = '';
    shakeIt(10);
    await wait(30);
    var during = cv.style.transform;
    await wait(600);
    ok('shakeIt displaces then clears', during !== '' && during !== 'none' && cv.style.transform === '',
       { during: during, after: cv.style.transform });

    /* 5. магазин во время 3D-режима (бывший краш allParts) */
    openGame(15); await wait(120);
    var threw = null;
    try { openShop(); closeShop(); } catch (e) { threw = String(e); }
    ok('shop inside 3D mode', threw === null, threw);
    goHome();

    /* 6. пятнашки принимают ходы */
    /* 6. пазл-сдвиг: кликать нужно по соседу пустой клетки, иначе ход
       не засчитывается и результат зависит от случайной перетасовки */
    openGame(38);
    var slid = 0;
    for (var g = 0; g < 400; g++) {
      var cards = document.querySelectorAll('#canvas .memcard');
      if (!cards.length) break;
      var hidden = -1;
      for (var k = 0; k < cards.length; k++) {
        if (cards[k].style.visibility === 'hidden') { hidden = k; break; }
      }
      if (hidden < 0) break;
      var hx = hidden % 3, hy = (hidden / 3) | 0, nb = [];
      if (hx > 0) nb.push(hidden - 1);
      if (hx < 2) nb.push(hidden + 1);
      if (hy > 0) nb.push(hidden - 3);
      if (hy < 2) nb.push(hidden + 3);
      var pick = nb[g % nb.length];
      if (cards[pick]) { cards[pick].click(); slid++; }
    }
    ok('slide puzzle accepts moves', slid > 0, slid);
    goHome();

    /* 7. экономика */
    var cc = coins;
    dailyBonus(); ok('daily bonus pays', coins > cc, { before: cc, after: coins });
    var cc2 = coins;
    dailyBonus(); ok('daily bonus not repeatable', coins === cc2, { before: cc2, after: coins });
    openShop();
    var bi = -1;
    for (var b = 0; b < SHOP.length; b++) if (owned.indexOf(SHOP[b].e) < 0) { bi = b; break; }
    var cb = coins, own = owned.length;
    buyPart(bi);
    ok('buy part works', coins < cb && owned.length === own + 1,
       { idx: bi, before: cb, coins: coins, owned: owned.length });
    closeShop();

    /* 8. тема / звук / фильтры / поиск */
    var th = document.documentElement.dataset.theme;
    toggleTheme(); ok('theme toggles', document.documentElement.dataset.theme !== th);
    toggleTheme();
    toggleSound(); ok('sound toggles', true); toggleSound();

    /* setFilter рисует скелетоны и перерисовывает через 450 мс — ждём.
       NG берём из GAMES, чтобы добавление новых игр не требовало правки тестов. */
    var NG = GAMES.length;
    var settle = function () { return wait(600); };
    goHome();
    setFilter('all'); await settle();
    ok('filter all renders all games (' + NG + ')', document.querySelectorAll('#gridAll .card').length === NG,
       document.querySelectorAll('#gridAll .card').length);
    setFilter('pop'); await settle();
    var nPop = document.querySelectorAll('#gridAll .card').length;
    ok('filter pop renders some', nPop > 0 && nPop < NG, nPop);
    // «Мои» корректно пуст без избранного
    setFilter('fav'); await settle();
    ok('filter fav empty without favourites', document.querySelectorAll('#gridAll .card').length === 0,
       document.querySelectorAll('#gridAll .card').length);
    favs = [1, 15, NG];
    setFilter('fav'); await settle();
    ok('filter fav shows favourites', document.querySelectorAll('#gridAll .card').length === 3,
       document.querySelectorAll('#gridAll .card').length);
    favs = [];
    setFilter('all'); await settle();
    var sq = document.getElementById('search');
    sq.value = 'цве'; sq.dispatchEvent(new Event('input')); await wait(80);
    ok('search filters', document.querySelectorAll('#gridAll .card').length > 0,
       document.querySelectorAll('#gridAll .card').length);
    sq.value = ''; sq.dispatchEvent(new Event('input')); await wait(80);

    /* 9. каждая игра открывается/закрывается без утечек */
    var leaks = 0, fails = [];
    for (var id = 1; id <= NG; id++) {
      try { openGame(id); } catch (e) { fails.push(id + ':' + e); continue; }
      await wait(25);
      try { goHome(); } catch (e) { fails.push(id + ':' + e); }
      if (document.querySelectorAll('#canvas .mode').length) leaks++;
    }
    ok('no mode leaks across all games', leaks === 0, leaks);
    ok('no openGame/goHome failures', fails.length === 0, fails);

    /* 10. лобби целостен */
    ok('lobby restored', document.getElementById('lobbyMain').style.display !== 'none');
    ok('all cards rendered', document.querySelectorAll('#gridAll .card').length === NG,
       document.querySelectorAll('#gridAll .card').length);
    ok('sidebar games rendered', document.querySelectorAll('#sideGames .side-btn').length === NG,
       document.querySelectorAll('#sideGames .side-btn').length);
    /* каждая запись GAMES обязана быть открываема: mode существует либо это конструктор */
    var noMode = GAMES.filter(function (g) {
      if (!g.mode) return false;
      return typeof MODES[g.mode] !== 'function';
    });
    ok('every GAMES.mode maps to a real MODES entry', noMode.length === 0,
       noMode.map(function (g) { return g.id + ':' + g.mode; }));

    /* 10b. паркурсы обязаны быть проходимы и заканчиваться.
       Без этого «игру нельзя пройти» (например, кубы вне хода тележки)
       или «игра не кончается» проходили гейт молча. */
    var stuck = [], noExit = [];
    GAMES.filter(function (g) { return g.mode; }).forEach(function (g) {
      var before = modeFinish;
      openGame(g.id);
      /* modeFinish обязан быть выставлен — это кнопка «Готово! Оценить» */
      if (typeof modeFinish !== 'function') noExit.push(g.id + ':' + g.mode);
      goHome();
      modeFinish = before;
    });
    ok('every mode game offers a finish action', noExit.length === 0, noExit);

    /* 11. ачивки разрешаются (unlock() падает на неизвестном id) */
    var badAch = [];
    ACHS.forEach(function (a) { if (!a || !a.id || !a.n || !a.d) badAch.push(a); });
    ok('ACHS entries well-formed', badAch.length === 0, badAch.length);

    out.done = true; flush();
  }

  /* ------------------------------------------------------- тесты движка --- */
  /* Рендер игр недетерминирован (Math.random в логике), поэтому culling и
     clipping проверяем на фиксированных сценах: результат обязан совпасть
     байт-в-байт, иначе отсечение что-то портит. */
  function e3Test() {
    var res = [];
    function ok(k, cond, extra) {
      res.push({ check: k, pass: !!cond, extra: extra === undefined ? undefined : extra });
      flush();
    }
    try {
      e3Body(res, ok);
    } catch (e) {
      res.push({ check: 'engine test crashed', pass: false, extra: String(e) + ' @' + (e.lineno || '?') });
      flush();
    }
    out.push({ check: 'engine', engine: res });
    out.done = true; flush();
  }

  function e3Body(out, ok) {
    function mk(w, h) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h; c._lw = w; c._lh = h;
      return c;
    }
    function render(faces, cam, fl) {
      var cv = mk(320, 240);
      var x = cv.getContext('2d');
      x.fillStyle = '#101018'; x.fillRect(0, 0, 320, 240);
      E3.draw(x, faces, cam, fl || 400, LIGHT3);
      return cv;
    }
    /* доля покрытых (не фоновых) пикселей — culling не должен терять видимые грани,
       но вполне может убрать «задние» грани, которые всё равно перекрывались */
    function cover(faces, cam, fl) {
      var cv = render(faces, cam, fl);
      var d = cv.getContext('2d').getImageData(0, 0, 320, 240).data;
      var n = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 16) > 6 || Math.abs(d[i + 1] - 16) > 6 || Math.abs(d[i + 2] - 24) > 6) n++;
      }
      return n;
    }
    function facesDrawn(faces, cam, fl) {
      E3.draw(render(faces, cam, fl).getContext('2d'), faces, cam, fl || 400, LIGHT3);
      return E3.stats.faces;
    }
    function both(faces, cam, fl) {
      E3.cull = true; var a = cover(faces, cam, fl);
      E3.cull = false; var b = cover(faces, cam, fl);
      E3.cull = true;
      return [a, b];
    }
    var camFar = { x: 0, y: 3, z: -8, yaw: 0, pitch: .3 };
    var camLow = { x: 0, y: .6, z: -6, yaw: 0, pitch: .05 };

    /* 1. замкнутые объёмы: покрытие не должно падать, а граней рисоваться меньше */
    var one = E3.box(0, 1, 0, 2, 2, 2, '#ff5d8f');
    var c1 = both(one, camFar);
    ok('single box coverage kept', c1[0] >= c1[1] * 0.99, { on: c1[0], off: c1[1] });
    var two = [].concat(E3.box(-1.5, 1, 0, 2, 2, 2, '#ff5d8f'), E3.box(1.5, 1, 0, 2, 2, 2, '#00a2ff'));
    var c2 = both(two, camFar);
    ok('two boxes coverage kept', c2[0] >= c2[1] * 0.99, { on: c2[0], off: c2[1] });
    var solids = [].concat(
      E3.box(0, 1, 0, 2, 2, 2, '#ff5d8f'),
      E3.box(2.5, .5, 1, 1, 1, 1, '#00a2ff'),
      E3.gbox(-2.5, .2, 1, 3, .4, 1.2, .5, '#00c06f'),
      E3.rbox(0, .5, 3, 2, .6, .6, .4, '#ffd76b'));
    /* изолируем каждый примитив — ищем, кто теряет покрытие */
    var parts = [
      ['box', E3.box(0, 1, 0, 2, 2, 2, '#ff5d8f')],
      ['box-low', E3.box(2.5, .5, 1, 1, 1, 1, '#00a2ff')],
      ['gbox', E3.gbox(-2.5, .2, 1, 3, .4, 1.2, .5, '#00c06f')],
      ['rbox', E3.rbox(0, .5, 3, 2, .6, .6, .4, '#ffd76b')]
    ];
    parts.forEach(function (p) {
      var r = both(p[1], camFar);
      ok('coverage kept: ' + p[0], r[0] >= r[1] * 0.99, { on: r[0], off: r[1] });
    });
    var r1 = both(solids, camFar);
    ok('solid coverage kept with cull', r1[0] >= r1[1] * 0.98, { on: r1[0], off: r1[1] });
    E3.cull = true; var fOn = facesDrawn(solids, camFar);
    E3.cull = false; var fOff = facesDrawn(solids, camFar); E3.cull = true;
    ok('cull reduces drawn faces', fOn < fOff, { on: fOn, off: fOff });

    /* 2. большая плоскость пола (двусторонняя) — рисуется всегда */
    var ground = E3.quad([-14, 0, -3], [14, 0, -3], [14, 0, 14], [-14, 0, 14], '#2e7d4f', [0, 1, 0]);
    var r2 = both(ground, camFar);
    ok('ground quad coverage kept', r2[0] >= r2[1] * 0.98, { on: r2[0], off: r2[1] });

    /* 3. тела, пересекающие ближнюю плоскость, не должны отсекаться
          (камера СНАРУЖИ тел; широкий угол обзора, чтобы они были видны) */
    var near = [];
    for (var i = -2; i <= 2; i++) {
      if (!i) continue;
      near = near.concat(E3.box(i * 2, 1, -5.9, 1.6, 2, 2, '#8b5cf6'));
    }
    var camStrad = { x: 0, y: 1, z: -6, yaw: 0, pitch: 0 };
    var wide = 40;
    var r3 = both(near, camStrad, wide);
    ok('near-plane straddle actually visible', r3[1] > 300, { off: r3[1] });
    ok('near-plane-straddling faces survive cull', r3[0] >= r3[1] * 0.98, { on: r3[0], off: r3[1] });

    /* 4. двусторонняя плоскость (лепесток), видимая с изнанки — не отсекается */
    var petal = E3.quad([0, 2, 0], [1.4, 2.6, .7], [1.4, 2.2, 1.5], [0, 1.6, .8], '#ff8fab', [.4, .8, .4]);
    var r4 = both(petal, camFar);
    ok('two-sided sheet not culled', r4[0] >= r4[1] * 0.98, { on: r4[0], off: r4[1] });

    /* 5. треугольник рисуется и clipping его не съедает */
    var tri = E3.tri([-2, 0, 4], [0, 3, 4], [2, 0, 4], '#ffb700');
    ok('triangle drawn', cover([tri], camFar) > 200, cover([tri], camFar));
    var r5 = both([tri], camFar);
    ok('triangle unchanged by cull', r5[0] === r5[1]);

/* 6. полигон из 5 точек: раньше draw читал только первые 4 вершины
        и пятиугольник рисовался частично. Теперь E3.poly делает веер. */
     var poly5 = E3.poly([[-2, 0, 5], [2, 0, 5], [3, 2, 5], [0, 3, 5], [-3, 2, 5]], '#00f0ff');
     ok('5-gon becomes a 3-triangle fan', poly5.length === 3, poly5.length);
     ok('5-gon fan triangles', poly5.every(function (f) { return f.v.length === 3; }),
        poly5.map(function (f) { return f.v.length; }).join(','));
     ok('5-gon fully drawn', cover(poly5, camFar) > 200, cover(poly5, camFar));

     /* 6a. Четырёхугольник не должен распадаться на веер */
     var poly4 = E3.poly([[-2, 0, 5], [2, 0, 5], [2, 2, 5], [-2, 2, 5]], '#00f0ff');
     ok('quad stays one face', poly4.length === 1 && poly4[0].v.length === 4,
        poly4.length + '/' + (poly4[0] && poly4[0].v.length));

     /* 6b. Тень обязана быть четырехугольной: с флагом t:1 она
        рисовалась треугольником и теряла угол */
     var sh = E3.shadow(0, 0, 3, 2, {});
     ok('shadow has 4 corners', sh.length === 1 && sh[0].v.length === 4 &&
        sh[0].v[3] !== sh[0].v[0], sh[0] && sh[0].v.length);
     ok('shadow is not flagged as triangle', !sh[0].t, sh[0].t);

    /* 7. пирамида: 5 граней, нормали единичной длины */
    var py = E3.pyramid(0, 0, 6, 2, 2.4, 2, '#ffffff');
    ok('pyramid has 5 faces', py.length === 5, py.length);
    ok('pyramid normals unit', py.every(function (f) {
      return Math.abs(Math.hypot(f.n[0], f.n[1], f.n[2]) - 1) < 1e-6;
    }));
    ok('pyramid drawn', cover(py, camFar) > 200, cover(py, camFar));

    /* 8. faceN совпадает с заранее посчитанной */
    var n = E3.faceN([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    ok('faceN = +Z for CCW in XY', n[0] === 0 && n[1] === 0 && Math.abs(n[2] - 1) < 1e-9, n);

    /* 9. rotN сохраняет длину вектора */
    var rn = E3.rotN([.42, .75, .5], { x: 3, y: 2, z: -7, yaw: 1.1, pitch: .6 });
    ok('rotN preserves length', Math.abs(Math.hypot(rn[0], rn[1], rn[2]) - Math.hypot(.42, .75, .5)) < 1e-9, rn);

    /* 10. clipNear: грань, наполовину за камерой, обрезается, а не теряется */
    var cp = E3.clipNear([[-1, -1, 1], [1, -1, 1], [1, -1, -2], [-1, -1, -2]], .15);
    ok('clipNear keeps visible part', cp.length > 0 && cp.every(function (p) { return p[2] >= .15 - 1e-9; }),
       { n: cp.length });

    /* 11. clipNear: грань целиком за камерой даёт пусто */
    ok('clipNear empties behind-camera face',
       E3.clipNear([[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]], .15).length === 0);

    /* 12. статистика draw заполняется */
    E3.draw(mk(64, 64).getContext('2d'), E3.box(0, 0, 5, 1, 1, 1, '#fff'), camFar, 100, LIGHT3);
    ok('E3.stats filled', E3.stats.total === 6 && E3.stats.culled > 0, E3.stats);

    /* 13. спрайты с глубиной: ближний перекрывает дальний */
    var spr = [E3.sprite(-3, 1, 8, 2, 'A', '#ffffff'), E3.sprite(3, 1, 6, 2, 'B', '#ffffff')];
    var covSpr = cover(spr, camFar);
    ok('sprites drawn', covSpr > 50, covSpr);
    E3.draw(mk(64, 64).getContext('2d'), [spr[0]], camFar, 200, LIGHT3);
    ok('single sprite counted', E3.stats.faces === 1, E3.stats.faces);
    /* перекрытие: nearer sprite рисуется последним независимо от порядка входа.
       '█' — сплошной глиф, поэтому доли цвета считаются надёжно. */
    function colorCounts(list) {
      var cv = mk(200, 120), x = cv.getContext('2d');
      x.fillStyle = '#101018'; x.fillRect(0, 0, 200, 120);
      E3.draw(x, list, camFar, 200, LIGHT3);
      var d = x.getImageData(0, 0, 200, 120).data, red = 0, green = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i] > 180 && d[i + 1] < 80) red++;
        if (d[i + 1] > 180 && d[i] < 80) green++;
      }
      return { red: red, green: green };
    }
    var red = E3.sprite(0, 1, 9, 8, '█', '#ff0000');
    var green = E3.sprite(0, 1, 4, 2, '█', '#00ff00');
    var onlyRed = colorCounts([red]);
    var ab = colorCounts([red, green]);
    var ba = colorCounts([green, red]);
    ok('far sprite visible alone', onlyRed.red > 500, onlyRed);
    ok('near sprite occludes far one', ab.green > 50 && ab.red < onlyRed.red,
       { alone: onlyRed, withNear: ab });
    ok('sprite depth beats draw order', ab.red === ba.red && ab.green === ba.green,
       { ab: ab, ba: ba });

    /* 14. tiles — одна грань вместо шести.
        Грань должна остаться ЧЕТЫРЁхугольной: флаг t:1 означает треугольник
        и draw отбросил бы угол, нарисовав половину плоскости. */
    var tl = E3.tiles(20, 20, { y: 0, c: '#2e7d4f' });
    ok('tiles produce 1 face', tl.length === 1 && tl[0].pl === 1);
    ok('tiles face stays a quad', !tl[0].t && tl[0].v.length === 4, tl[0].v.length);
    ok('tiles drawn', cover(tl, camFar) > 20000, cover(tl, camFar));
    /* плоскость должна заливаться ровно как обычная грань с теми же углами.
       Именно сломанный t:1 давал треугольник вместо четырёхугольника. */
    var big = E3.tiles(60, 60, { y: 0, c: '#2e7d4f' })[0];
    var ref = E3.quad(big.v[0], big.v[1], big.v[2], big.v[3], '#2e7d4f', [0, 1, 0]);
    var cb1 = cover([big], camFar), cb2 = cover(ref, camFar);
    ok('tiles fills the same area as a plain quad', Math.abs(cb1 - cb2) < 200,
       { tiles: cb1, quad: cb2 });

    /* 15. tileMap рисует сетку цветов */
    var calls = 0;
    var tm = E3.tileMap(4, 4, 2, 2, function (gx, gz) { calls++; return (gx + gz) % 2 ? '#3a8f5f' : '#2e7d4f'; },
                        { y: 0, x: -4, z: -4 });
    var covTm = cover(tm, camFar);
    ok('tileMap visits all cells', calls === 16, calls);
    ok('tileMap drawn', covTm > 20000, covTm);

    /* 16. node: трансформирует вершины */
    var nd = E3.node({ x: 5, ry: Math.PI / 2, s: 2 });
    ok('node translates+scales', Math.abs(nd.P([1, 0, 0])[0] - 5) < 1e-6, nd.P([1, 0, 0]));
    var nb = nd.box(1, 1, 1, '#fff');
    ok('node box has 6 faces', nb.length === 6, nb.length);
    ok('node normals unit', nb.every(function (f) {
      return Math.abs(Math.hypot(f.n[0], f.n[1], f.n[2]) - 1) < 1e-6;
    }));

    /* 17. бюджет граней (E12) */
    E3.budget(4);
    var many = [];
    for (var q = 0; q < 20; q++) many = many.concat(E3.box(q, 1, 5, 1, 1, 1, '#fff'));
    E3.draw(mk(64, 64).getContext('2d'), many, camFar, 100, LIGHT3);
    var capped = E3.stats.faces;
    E3.budget(0);
    E3.draw(mk(64, 64).getContext('2d'), many, camFar, 100, LIGHT3);
    ok('face budget respected', capped <= 4 && E3.stats.faces > capped, { capped: capped, full: E3.stats.faces });

    /* 18. частицы: есть и обновляются */
    var ps = E3.particles(20, { txt: '❄' });
    ok('particles created', ps.length === 20);
    var y0 = ps[0].y;
    ps.step(0.5);
    ok('particles fall', ps[0].y !== y0, { before: y0, after: ps[0].y });
    ok('particles make faces', ps.faces().length === 20);

    /* 19. физика: гравитация и отскок */
    var P = E3.phys.o();
    P.y = 5; P.vy = 0; P.ground = 0; P.bounce = .5;
    for (var st = 0; st < 200; st++) E3.phys.step(P, 1 / 60, { g: 9.8 });
    ok('body rests on ground', Math.abs(P.y - P.r) < 0.02, { y: P.y, r: P.r });
    ok('vertical velocity settled', Math.abs(P.vy) < 0.6, P.vy);

    /* 20. физика: упругий удар двух сфер (A догоняет B) */
    var A = E3.phys.o(), B = E3.phys.o();
    A.x = 0; B.x = 0.8; A.z = B.z = 0; A.y = B.y = 1;
    A.r = B.r = .5; A.vx = 3; B.vx = 0;
    var imp = E3.phys.hit(A, B, .9);
    ok('collision detected', imp > 0, imp);
    ok('impulse transfers momentum', A.vx < 3 && B.vx > 0 && B.vx > A.vx,
       { a: A.vx, b: B.vx });
    ok('bodies separate', B.vx - A.vx > 2, B.vx - A.vx);
    /* двойной вызов не должен дать ещё один импульс (сферки уже разлетелись) */
    var A2 = E3.phys.o(), B2 = E3.phys.o();
    A2.x = 0; B2.x = 0.8; A2.z = B2.z = 0; A2.y = B2.y = 1;
    A2.r = B2.r = .5; A2.vx = 3; B2.vx = 0;
    E3.phys.hit(A2, B2, .9);
    var after1 = A2.vx;
    E3.phys.hit(A2, B2, .9);
    ok('no double impulse when separating', Math.abs(A2.vx - after1) < 1e-6, { a: after1, b: A2.vx });

    /* 21. физика: отскок от пола */
    var Q = E3.phys.o();
    Q.y = 2; Q.vy = -8; Q.ground = 0; Q.bounce = .5;
    for (var st2 = 0; st2 < 200; st2++) E3.phys.step(Q, 1 / 60, { g: 9.8 });
    ok('bounce stays above ground', Q.y >= Q.r - 0.01, Q.y);

    /* 22. текстуры-паттерны: грань с CanvasPattern должна рисоваться как есть,
           без попытки тонировать её как hex-строку */
    var pctx = mk(64, 64).getContext('2d');
    var pat = E3.pattern(pctx, 'checker', '#ffffff', '#dddddd');
    ok('pattern created', !!pat);
    var patFace = E3.box(0, 0, 5, 4, 4, 1, pat);
    var covPat = cover(patFace, camFar);
    ok('pattern face drawn without shading error', covPat > 500, covPat);
    /* текстура обязана быть именно текстурой: сетка из двух цветов, а не сплошная заливка */
    var pv = mk(64, 64), px = pv.getContext('2d');
    px.fillStyle = pat; px.fillRect(0, 0, 64, 64);
    var pd = px.getImageData(0, 0, 64, 64).data, light = 0, dark = 0;
    for (var pi = 0; pi < pd.length; pi += 4) {
      if (pd[pi] > 240) light++; else if (pd[pi] < 240) dark++;
    }
    ok('pattern has two tones', light > 1000 && dark > 1000, { light: light, dark: dark });

    /* 23. спрайты не должны попадать в сортировку по масштабу проекции */
    var far = E3.sprite(0, 1, 9, 8, '█', '#ff0000');
    var near = E3.sprite(0, 1, 4, 2, '█', '#00ff00');
    var c0 = mk(200, 120), c0x = c0.getContext('2d');
    c0x.fillStyle = '#101018'; c0x.fillRect(0, 0, 200, 120);
    E3.draw(c0x, [far, near], camFar, 200, LIGHT3);
    var d0 = c0x.getImageData(0, 0, 200, 120).data, nearPix = 0;
    for (var ni = 0; ni < d0.length; ni += 4) if (d0[ni + 1] > 180 && d0[ni] < 80) nearPix++;
    ok('near sprite not buried under far one', nearPix > 50, nearPix);

    /* 24. спрайт за near-плоскостью не рисуется.
       Внимание: точка на уровне z камеры, но ниже её, при pitch вниз
       оказывается ВПЕРЕДИ near-плоскости — поэтому уходим в минус по z. */
    E3.draw(mk(64, 64).getContext('2d'), [E3.sprite(0, 1, -20, 4, '█', '#ffffff')],
            camFar, 200, LIGHT3);
    ok('sprite behind camera skipped', E3.stats.faces === 0, E3.stats.faces);
    E3.draw(mk(64, 64).getContext('2d'), [E3.sprite(0, 1, 6, 4, '█', '#ffffff')],
            camFar, 200, LIGHT3);
    ok('sprite in front drawn', E3.stats.faces === 1, E3.stats.faces);

    /* 25. адаптив качества: сторож режет бюджет на тяжёлых кадрах
           и возвращает его, когда кадры снова лёгкие */
    var wasBudget = E3.maxFaces;
    E3.budget(0);
    var slow = E3.auto.stress(260, 40);   /* 40 мс на кадр -> просадка */
    ok('watchdog lowers budget on slow frames', slow > 0 && slow <= 1000, { slow: slow });
    var fast = E3.auto.stress(400, 6);    /* 6 мс -> всё успевает */
    ok('watchdog restores budget on fast frames', fast === 0, { fast: fast, slow: slow });
    ok('watchdog leaves engine fast', E3.auto.stress(100, 16) === 0, E3.maxFaces);
    ok('quality label is human readable',
       typeof E3.auto.q() === 'string' && E3.auto.q().length > 0, E3.auto.q());
    E3.budget(300);
    E3.draw(mk(64, 64).getContext('2d'),
            E3.box(0, 0, 4, 1, 1, 1, '#fff').concat(E3.box(3, 0, 8, 1, 1, 1, '#fff')),
            camFar, 100, LIGHT3);
    ok('budget still caps faces after watchdog added', E3.stats.faces <= 300, E3.stats.faces);
    E3.budget(wasBudget);
  }

  /* ----------------------------------------------------------- запуск --- */
  async function main() {
    flush();
    if (MODE === 'e3') return e3Test();
    if (MODE === 'beh') return behaviour();
    if (MODE === 'single') {
      var n = parseInt(P.get('game') || '1', 10);
      await playGame(n);
      out.done = true; flush();
      return;
    }
    if (MODE === 'shots') { out.done = true; flush(); return; }

    var only = P.get('games');
    var ids = only ? only.split(',').map(Number) : null;
    if (!ids) {
      ids = [];
      for (var i = 1; i <= GAMES.length; i++) ids.push(i);
    }
    for (var j = 0; j < ids.length; j++) await playGame(ids[j]);

    // лобби целиком
    errs.length = 0;
    try {
      goHome();
      ['all', 'pop', 'new', 'fav'].forEach(function (f) { setFilter(f); });
      var s = document.getElementById('search'); s.value = 'цве'; s.dispatchEvent(new Event('input'));
      var so = document.getElementById('sort'); so.value = 'az'; so.dispatchEvent(new Event('change'));
      for (var k = 1; k <= GAMES.length; k++) { openModal(k); closeModal(); }
      openShop(); buyBox(); buyBuff(); closeShop();
      toggleTheme(); toggleTheme(); toggleSound(); toggleSound();
      dailyBonus(); contGame(); setFilter('all');
    } catch (e) { errs.push('LOBBY ' + e); }
    out.push({ game: 0, lobby: errs.slice() });

    out.done = true;
    flush();
  }

  setTimeout(function () { main(); }, 200);
})();
