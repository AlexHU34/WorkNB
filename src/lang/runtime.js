/* Игровая среда BloomScript: полотно, ввод, NAT-функции, цикл кадра.
 *
 * Фабрика createRuntime(opts) — общая часть редактора (lang.html) и
 * приложения (index.html). Сама она ничего не ищет в документе: полотно,
 * вывод, статус и обработчик ошибок приходят в opts. Обращаться к DOM
 * редактора внутри фабрики нельзя.
 */
function createRuntime(opts) {
  opts = opts || {};
  /* ============================================== ХОСТ: мост к движку и UI */
  /* Полотно приходит снаружи. Логическая сцена 640×380, полотно может быть
     крупнее — тогда картинка чётче, а код игр остаётся в привычных координатах. */
  const cv = opts.canvas;
  const SCALE = opts.scale || 2;
  cv._lw = opts.logicalWidth || (cv.width / SCALE);
  cv._lh = opts.logicalHeight || (cv.height / SCALE);
  const ctx = cv.getContext("2d");
  const statEl = opts.stat || null;

  /* Режим отрисовки. Три варианта:
     "off"  — привычный Canvas 2D, ничего не трогаем;
     "on"   — WebGL2 обязательно;
     "auto" — пробуем WebGL2 и сами решаем (по умолчанию).
   До этого был только ручной режим через ?gl=1, и потому по умолчанию
   все играли на медленном пути, хотя умеющий GPU простаивал.

   Авто НЕ доверяет WebGL2 слепо: на живой видеокарте путь не проверялся,
   а сломанный драйвер отдаёт пустую картинку или крашит вкладку. Поэтому
   включаем, смотрим первые кадры и при любой ошибке тихо уходим на 2D.
   Игрок ничего не заметит, кроме того, что играет.

   Редактор кода передаёт gl:"off" намеренно: там GL не нужен, а слой
   поверх канвы ломал вёрстку страницы (проверено: без этого режим
   авто ронял редактор). Ускорение требуется там, где играют, — в
   приложении. */
  let useGL = false;
  let glWatch = null;
  const log_ = opts.log || function () {};
  let glMode = opts.gl;
  if (glMode === undefined || glMode === null) glMode = "auto";
  if (typeof E3GL !== "undefined" && E3GL.request) {
    E3GL.request(glMode === "on" ? true : glMode === "off" ? false : null);
  }
  /* Адрес вида ?gl=1 остаётся самым сильным указанием: так гейты и
     отладка включают GL принудительно, независимо от настройки. */
  const urlGL = typeof location !== "undefined" && /[?&]gl=1(&|$)/.test(location.search || "");
  const wantGL = glMode === "on" || (glMode === "auto" && !document.body.classList.contains("no-gl")) || urlGL;

  if (wantGL && typeof E3GL !== "undefined" && !E3GL.ok) {
    try {
      if (E3GL.attach(ctx)) {
        useGL = E3GL.enable();
        if (useGL) {
          log_("WebGL2 включён автоматически" +
               (E3GL.stats().err ? ": " + E3GL.stats().err : ""), "ok");
          glWatch = { frames: 0, failed: false };
        } else {
          E3GL.request(false);
          log_("WebGL2 не заработал, работаем на 2D", "warn");
        }
      } else {
        E3GL.request(false);
        log_("WebGL2 недоступен, работаем на 2D: " + (E3GL.stats().err || ""), "warn");
      }
    } catch (e) {
      /* Слой не имеет права ронять страницу. Любая ошибка при подключении
         означает «GL здесь не работает» — уходим на 2D и запоминаем. */
      useGL = false;
      E3GL.request(false);
      log_("WebGL2 не удалось включить, работаем на 2D: " + (e && e.message), "warn");
    }
  }
  /* Сторож первых кадров: если GL-путь начал сыпать ошибками, уходим
     на 2D и больше не пробуем в этой игре. */
  function glHealthy() {
    if (!glWatch || glWatch.failed) return;
    glWatch.frames++;
    const err = E3GL.stats().err;
    /* Ждём три кадра: первый может быть тепловым. */
    if (err && glWatch.frames > 3) {
      glWatch.failed = true;
      log_("WebGL2 начал ошибаться, переключаюсь на 2D: " + err, "warn");
      glFallback();
    }
  }
  function glFallback() {
    if (!useGL) return;
    useGL = false;
    try {
      if (typeof E3GL !== "undefined") { E3GL.disable(); E3GL.request(false); }
    } catch (e) { /* отключение не должно ронять игру */ }
    glWatch = null;
  }
  const onResizeGL = () => {
    if (useGL) E3GL.resize(cv._lw, cv._lh);
  };
  if (useGL) window.addEventListener("resize", onResizeGL);

  /* Фиксированный шаг. Модуль был написан, подключён к страницам — и не
     использовался нигде, то есть висел в сборке мёртвым грузом. Теперь он
     включается по opts.fixedStep; по умолчанию поведение прежнее, чтобы
     привычные игры не поменяли ощущение от кадра. */
  const fixedStep = !!(opts.fixedStep) && typeof E3Step !== "undefined";
  if (fixedStep) { E3Step.setup(opts.fixedStep === true ? 60 : opts.fixedStep); E3Step.start(); }

  /* Вывод наружу. Редактор пишет в консоль, приложение — в свой лог.
     Без подписчика строки просто не показываются, но кадр от этого не падает. */
  function out(msg, cls) { if (opts.log) opts.log(msg, cls || "info"); }
  function clearLog() { if (opts.clear) opts.clear(); }

  const keysDown = new Set();
  const keysHit = new Set();
  const mouse = { x: 320, y: 190, down: false, clicked: false };
  /* Когда фокус в редакторе — не глотаем пробел и стрелки, иначе нельзя печатать. */
  function typingInEditor(e) {
    const t = e.target;
    return t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
  }
  addEventListener("keydown", e => {
    if (typingInEditor(e)) return;
    keysDown.add(e.code);
    keysHit.add(e.code);
    if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.code) >= 0) e.preventDefault();
  });
  addEventListener("keyup", e => keysDown.delete(e.code));

  cv.addEventListener("pointerdown", e => {
    const r = cv.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (cv._lw / r.width);
    mouse.y = (e.clientY - r.top) * (cv._lh / r.height);
    mouse.down = true; mouse.clicked = true;
  });
  addEventListener("pointerup", () => { mouse.down = false; });

  /* Состояние кадра, доступное из программы */
  const S = {
    faces: [],
    /* частицы: собственная очередь, шагается каждый кадр сама.
       Автору игры достаточно вызвать emit() — гравитация, сдвиг и
       угасание происходят без его участия. */
    parts: [],
    cam: { x: 0, y: 5, z: -14, yaw: 0, pitch: .22 },
    lit: { ao: .16, sky: .14 },
    t: 0,
    bg: null,
    hud: [],
    score: 0,
    over: false,
    mouse: mouse,
    get width() { return cv._lw; },
    get height() { return cv._lh; }
  };

  /* ============================================ ИГРОВАЯ СРЕДА: СОСТОЯНИЕ И ПРАВИЛА */
  /* Всё, что нужно «языку управлять всей игрой»: сохранения, таймеры, экраны,
     виджеты интерфейса, звук, коллизии. Всё живёт в G. */
  const G = {
    state: {},          /* постоянные данные игры: рекорды, открытые уровни */
    screen: "game",     /* текущий экран: "game", "menu", "pause", "win", "over" */
    widgets: [],        /* список UI-элементов, созданных за кадр */
    timers: [],         /* отложенные и повторяющиеся действия */
    sprites: [],        /* 2D-слой: то, что всегда поверх сцены */
    drag: null,         /* что сейчас тянут мышью */
    ended: false,
    stars: 0,
    audio: null,
    muted: false,
    capture: null      /* если массив — print() пишет туда исходные значения */
  };
  const SAVE_KEY = "bloomscript.save.v1";

  /* Ключ сохранения — свой у каждой игры. Раньше все игры пользователя
     писали в одну ячейку bloomscript.save.v1, поэтому прогресс второй
     игры молча затирал рекорды первой: играли в A, потом в B, возвращались
     в A — а рекорд уже чужой. Идентификатор приходит из среды (приложение
     знает id карточки, редактор — имя программы); без идентификатора
     остаётся прежняя общая ячейка, чтобы ничего не потерять. */
  let saveKeyCache = null;
  function gameIdOf() {
    const id = opts.gameId;
    if (id === undefined || id === null || id === "") return "default";
    return String(id);
  }
  function saveKey() {
    if (!saveKeyCache) saveKeyCache = SAVE_KEY + "." + gameIdOf();
    return saveKeyCache;
  }

  /* --- сохранения --- */
  function saveGame() {
    try {
      localStorage.setItem(saveKey(), JSON.stringify(G.state));
      return true;
    } catch (e) {
      return false;
    }
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem(saveKey());
      if (!raw) return false;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") { G.state = obj; return true; }
      return false;
    } catch (e) {
      return false;
    }
  }

  /* --- звук: простой синтез, без внешних файлов --- */
  function audioCtx() {
    if (G.audio) return G.audio;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      G.audio = new AC();
    } catch (e) {
      G.audio = null;
    }
    return G.audio;
  }
  function tone(freq, dur, kind, vol) {
    if (G.muted) return;
    const a = audioCtx();
    if (!a) return;
    if (a.state === "suspended") a.resume();
    const t = a.currentTime;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = kind || "square";
    o.frequency.setValueAtTime(Math.max(20, num(freq, 0)), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, Math.min(.6, vol === undefined ? .18 : vol)), t + .01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(.03, num(dur, 0)));
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + Math.max(.05, num(dur, 0) + .02));
  }
  function noise(dur, vol) {
    if (G.muted) return;
    const a = audioCtx();
    if (!a) return;
    const len = Math.max(1, Math.floor(a.sampleRate * Math.max(.02, num(dur, 0))));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    const g = a.createGain();
    g.gain.value = Math.max(.0002, Math.min(.5, vol === undefined ? .2 : vol));
    src.buffer = buf; src.connect(g); g.connect(a.destination);
    src.start();
  }

  /* Предустановленные звуки — короткие, узнаваемые. */
  const SFX = {
    click:   () => tone(660, .05, "square", .12),
    coin:    () => { tone(880, .07, "square", .14); tone(1320, .1, "square", .1); },
    jump:    () => tone(420, .12, "square", .12),
    hit:     () => { tone(180, .12, "sawtooth", .16); noise(.06, .12); },
    win:     () => { tone(523, .1, "triangle", .16); setTimeout(() => tone(659, .1, "triangle", .16), 100); setTimeout(() => tone(784, .2, "triangle", .16), 200); },
    lose:    () => { tone(300, .18, "sawtooth", .14); setTimeout(() => tone(180, .28, "sawtooth", .14), 150); },
    tick:    () => tone(1200, .03, "square", .08),
    pickup:  () => { tone(700, .06, "triangle", .13); setTimeout(() => tone(1046, .08, "triangle", .11), 60); },
    start:   () => { tone(392, .09, "triangle", .14); setTimeout(() => tone(587, .12, "triangle", .14), 90); }
  };

  const RND = () => Math.random();

  const NAT = Object.create(null);

  /* --- геометрия --- */
  NAT["add"] = (...fs) => {
    for (const f of fs) {
      if (Array.isArray(f)) S.faces.push(...f);
      else if (f && f.v) S.faces.push(f);
      else throw new LangError("add() ждёт грани или массив граней", 0);
    }
  };
  NAT["clear"] = () => { S.faces.length = 0; };
  NAT["box"] = (x,y,z,w,h,d,c) => { S.faces.push(...E3.box(x,y,z,w,h,d,c)); };
  NAT["pyramid"] = (x,y,z,w,h,d,c) => { S.faces.push(...E3.pyramid(x,y,z,w,h,d,c)); };
  NAT["tri"] = (ax,ay,az,bx,by,bz,cx,cy,cz,col) => {
    S.faces.push(E3.tri([ax,ay,az],[bx,by,bz],[cx,cy,cz],col));
  };
  NAT["quad"] = (ax,ay,az,bx,by,bz,cx,cy,cz,dx,dy,dz,col) => {
    S.faces.push(...E3.quad([ax,ay,az],[bx,by,bz],[cx,cy,cz],[dx,dy,dz],col,[0,1,0]));
  };
  NAT["ground"] = (w,d,c) => { S.faces.push(...E3.tiles(w,d,{ c:c })); };
  NAT["shadow"] = (x,z,r,h) => { S.faces.push(...E3.shadow(x,z,r,h)); };
  NAT["sprite"] = (x,y,z,size,text,col) => { S.faces.push(E3.sprite(x,y,z,size,text,col)); };

  /* --- частицы ----------------------------------------------------------- */
  /* emit(x, y, z, {…}) — выпустить облако искровых точек из точки.
     Необязательные ключи: n — сколько (12), sp — разброс скорости (2),
     up — подброс вверх (0.9*sp), grav — гравитация (8), life — время
     жизни (0.8 с), size — радиус точки (5), col — цвет ("#ffd27a").
     Очередь ограничена 240 частицами, старые выталкиваются. Шаг, гравитация
     и угасание выполняются сами каждый кадр. */
  NAT["emit"] = (x,y,z,o) => { E3.emit(S.parts, x, y, z, o || {}); };
  NAT["clearParts"] = () => { S.parts.length = 0; };

  /* --- группы (аналог node) --- */
  NAT["group"] = (x,y,z,ry) => {
    return {
      __nat: 1,
      x: num(x,0), y: num(y,0), z: num(z,0), ry: num(ry,0),
      faces: [],
      box(w,h,d,c) { return groupAdd(this, E3.box(0,0,0,w,h,d,c)); },
      pyr(w,h,d,c) { return groupAdd(this, E3.pyramid(0,0,0,w,h,d,c)); },
      at(gx,gy,gz) { this.x = num(gx,0); this.y = num(gy,0); this.z = num(gz,0); return this; },
      turn(rad) { this.ry = num(rad,0); return this; },
      sprite(size,text,c) { this.faces.push(E3.sprite(this.x,this.y,this.z,size,text,c)); return this; },
      shadow(r,h) { return groupAdd(this, E3.shadow(0,0,r,h)); },
      add(f) { if (Array.isArray(f)) this.faces.push(...f); else this.faces.push(f); return this; },
      clear() { this.faces.length = 0; return this; }
    };
  };

  /* --- камера и фон --- */
  NAT["camera"] = (x,y,z,yaw,pitch) => { S.cam = { x:x, y:y, z:z, yaw:yaw||0, pitch:pitch||0 }; };
  NAT["bg"] = (c1,c2) => { S.bg = [c1, c2]; };
  NAT["lit"] = (ao,sky) => { S.lit = { ao: ao===undefined?.16:ao, sky: sky===undefined?.14:sky }; };

  /* --- 2D поверх сцены --- */
  NAT["text"] = (x,y,s,size,col) => { S.hud.push({ x:x, y:y, s:str(s), size:size||16, c:col||"#fff" }); };
  NAT["bar"] = (x,y,w,h,col) => { S.hud.push({ bar:1, x:x, y:y, w:w, h:h, c:col||"#fff" }); };

  /* --- ввод --- */
  NAT["key"] = k => keysDown.has(k) ? 1 : 0;
  NAT["keyhit"] = k => keysHit.has(k) ? 1 : 0;
  NAT["mouseX"] = () => mouse.x;
  NAT["mouseY"] = () => mouse.y;
  NAT["clicked"] = () => mouse.clicked ? 1 : 0;

  /* --- время и счёт --- */
  NAT["time"] = () => S.t;
  NAT["width"] = () => cv._lw;
  NAT["height"] = () => cv._lh;
  const bestOf = (k, v) => {
    const key = str(k), cur = Number(G.state[key] || 0), val = num(v, 0);
    if (val > cur) { G.state[key] = val; saveGame(); return val; }
    return cur;
  };
  NAT["score"] = (...a) => {
    if (!a.length) return S.score;
    const v = num(a[0], 0);
    if (v > S.score) { S.score = v; bestOf("score", S.score); }
    return S.score;
  };
  NAT["win"] = stars => { G.ended = true; G.stars = Math.round(num(stars === undefined ? 3 : stars, 0)); G.screen = "win"; };
  NAT["lose"] = () => { G.ended = true; G.screen = "over"; };
  NAT["paused"] = () => (G.screen === "pause" ? 1 : 0);
  NAT["setPaused"] = on => { G.screen = on ? "pause" : "game"; };

  /* ============================================ ИГРОВАЯ STDLIB: СОСТОЯНИЕ */
  NAT["set"] = (k, v) => { G.state[str(k)] = v === undefined ? true : v; return v; };
  NAT["get"] = (k, dflt) => {
    const key = str(k);
    return Object.prototype.hasOwnProperty.call(G.state, key) ? G.state[key] : (dflt === undefined ? 0 : dflt);
  };
  NAT["has"] = k => (Object.prototype.hasOwnProperty.call(G.state, str(k)) ? 1 : 0);
  NAT["deleteKey"] = k => { delete G.state[str(k)]; return null; };
  NAT["stateKeys"] = () => Object.keys(G.state);
  NAT["save"] = () => saveGame();
  NAT["load"] = () => loadGame();
  NAT["best"] = (k, v) => bestOf(k, v);

  /* ============================================ ИГРОВАЯ STDLIB: ТАЙМЕРЫ */
  NAT["after"] = (sec, fn) => { G.timers.push({ at: S.t + Math.max(0, num(sec, 0)), fn: fn, rep: 0 }); return 1; };
  NAT["every"] = (sec, fn) => { G.timers.push({ at: S.t + Math.max(.01, num(sec, 0)), fn: fn, rep: Math.max(.01, num(sec, 0)) }); return 1; };
  NAT["cancel"] = () => { G.timers.length = 0; return null; };

  /* ============================================ ИГРОВАЯ STDLIB: ЭКРАНЫ */
  NAT["screen"] = () => G.screen;
  NAT["setScreen"] = s => { const v = str(s); if (v !== G.screen) G.screen = v; return v; };

  /* ============================================ ИГРОВАЯ STDLIB: ИНТЕРФЕЙС */
  NAT["label"] = (x, y, s, size, col, align) => { G.widgets.push({ kind: "label", x: num(x, 0), y: num(y, 0), s: str(s), size: num(size === undefined ? 16 : size, 0), c: col || "#fff", align: align || "left" }); };
  NAT["panel"] = (x, y, w, h, col, alpha) => { G.widgets.push({ kind: "panel", x: num(x, 0), y: num(y, 0), w: num(w, 0), h: num(h, 0), c: col || "#000", a: alpha === undefined ? .5 : num(alpha, 0) }); };
  NAT["button"] = (x, y, w, h, label, onClick, col) => {
    const b = { kind: "button", x: num(x, 0), y: num(y, 0), w: num(w, 0), h: num(h, 0), s: str(label), fn: onClick, c: col || "#3b82f6", hover: false, down: false };
    G.widgets.push(b);
    return b;
  };
  NAT["slider"] = (x, y, w, value, min, max, onChange) => {
    const s = { kind: "slider", x: num(x, 0), y: num(y, 0), w: num(w, 0), v: num(value, 0), min: num(min, 0), max: num(max, 100), fn: onChange };
    G.widgets.push(s);
    return s;
  };
  NAT["toggle"] = (x, y, w, label, value, onChange) => {
    const t = { kind: "toggle", x: num(x, 0), y: num(y, 0), w: num(w, 0), s: str(label), v: !!value, fn: onChange };
    G.widgets.push(t);
    return t;
  };
  NAT["progress"] = (x, y, w, h, frac, col) => { G.widgets.push({ kind: "progress", x: num(x, 0), y: num(y, 0), w: num(w, 0), h: num(h === undefined ? 10 : h, 0), f: Math.max(0, Math.min(1, num(frac, 0))), c: col || "#22c55e" }); };
  NAT["widgetValue"] = w => {
    if (!w) return 0;
    if (w.kind === "toggle") return w.v ? 1 : 0;
    return w.v;
  };
  NAT["widgetSet"] = (w, v) => { if (w) { if (w.kind === "toggle") w.v = !!v; else w.v = num(v, 0); } return null; };
  NAT["overButton"] = (x, y, w, h) => {
    const mx = mouse.x, my = mouse.y;
    return (mx >= x && mx <= x + w && my >= y && my <= y + h) ? 1 : 0;
  };

  /* ============================================ ИГРОВАЯ STDLIB: ЗВУК */
  NAT["sound"] = name => { const f = SFX[str(name)]; if (f) { f(); return 1; } return 0; };
  NAT["tone"] = (freq, dur, kind, vol) => { tone(freq, dur, kind, vol); return null; };
  NAT["noise"] = (dur, vol) => { noise(dur, vol); return null; };
  NAT["mute"] = on => { G.muted = on === undefined ? !G.muted : !!on; return G.muted ? 1 : 0; };
  NAT["muted"] = () => (G.muted ? 1 : 0);

  /* ============================================ ИГРОВАЯ STDLIB: КОЛЛИЗИИ И ФИЗИКА */
  NAT["hitBox"] = (ax, az, aw, bx, bz, bw) => (Math.abs(num(ax, 0) - num(bx, 0)) * 2 < num(aw, 0) + num(bw, 0)) ? 1 : 0;
  NAT["hitCircle"] = (ax, az, ar, bx, bz, br) => (Math.hypot(num(ax, 0) - num(bx, 0), num(az, 0) - num(bz, 0)) < num(ar, 0) + num(br, 0)) ? 1 : 0;
  NAT["approach"] = (v, target, step) => {
    const t = num(target, 0), s = Math.abs(num(step, 0));
    if (num(v, 0) < t) return Math.min(t, num(v, 0) + s);
    if (num(v, 0) > t) return Math.max(t, num(v, 0) - s);
    return t;
  };
  NAT["wrap"] = (v, limit) => { const x = num(v, 0), l = num(limit, 0); if (l <= 0) return x; return ((x % l) + l) % l; };
  NAT["angleLerp"] = (a, b, t) => {
    let d = (num(b, 0) - num(a, 0)) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return num(a, 0) + d * Math.max(0, Math.min(1, num(t, 0)));
  };

  /* --- вывод --- */
  NAT["print"] = (...a) => {
    if (G.capture) G.capture.push(a.length === 1 ? a[0] : a);
    out(a.map(str).join(" "), "val");
  };
  NAT["toast"] = (...a) => out(a.map(str).join(" "), "warn");

  /* --- математика --- */
  NAT["sin"] = x => Math.sin(num(x,0));
  NAT["cos"] = x => Math.cos(num(x,0));
  NAT["sqrt"] = x => { const v = num(x,0); if (v < 0) throw new LangError("sqrt от отрицательного", 0); return Math.sqrt(v); };
  NAT["abs"] = x => Math.abs(num(x,0));
  NAT["floor"] = x => Math.floor(num(x,0));
  NAT["ceil"] = x => Math.ceil(num(x,0));
  NAT["round"] = x => Math.round(num(x,0));
  NAT["int"] = x => Math.trunc(num(x,0));
  NAT["trunc"] = x => Math.trunc(num(x,0));
  NAT["sign"] = x => Math.sign(num(x,0));
  NAT["atan2"] = (a,b) => Math.atan2(num(a,0), num(b,0));
  NAT["hypot"] = (...a) => Math.hypot.apply(null, a.map(x=>num(x,0)));
  NAT["lerp"] = (a,b,t) => num(a,0) + (num(b,0) - num(a,0)) * num(t,0);
  NAT["clamp"] = (v,a,b) => { const x = num(v,0); return x < num(a,0) ? num(a,0) : (x > num(b,0) ? num(b,0) : x); };
  NAT["mod"] = (a,m) => { const d = num(m,0); if (d === 0) throw new LangError("mod: делитель 0", 0); return ((num(a,0) % d) + d) % d; };
  NAT["hypot2"] = (ax,az,bx,bz) => Math.hypot(num(ax,0)-num(bx,0), num(az,0)-num(bz,0));
  NAT["min"] = (...a) => Math.min.apply(null, a.map(x=>num(x,0)));
  NAT["max"] = (...a) => Math.max.apply(null, a.map(x=>num(x,0)));
  NAT["pow"] = (a,b) => Math.pow(num(a,0), num(b,0));
  NAT["rnd"] = (a,b) => a===undefined ? RND() : (b===undefined ? RND()*num(a,0) : num(a,0)+RND()*(num(b,0)-num(a,0)));
  NAT["dist2"] = (ax,az,bx,bz) => Math.hypot(num(ax,0)-num(bx,0), num(az,0)-num(bz,0));

  /* --- массивы и строки --- */
  NAT["push"] = (arr,v) => { if (!Array.isArray(arr)) throw new LangError("push ждёт массив", 0); arr.push(v); return arr.length; };
  NAT["len"] = a => a === undefined ? 0 : (a.length !== undefined ? a.length : 0);
  NAT["str"] = v => str(v);

  /* --- предикаты --- */
  NAT["isNum"] = v => typeof v === "number" ? 1 : 0;
  NAT["isStr"] = v => typeof v === "string" ? 1 : 0;

  /* методы нативных объектов */
  const NAT_METHODS = {
    gbox: function (w,h,d,c) { return groupAdd(this, E3.box(0,0,0,w,h,d,c)); },
    gpyr: function (w,h,d,c) { return groupAdd(this, E3.pyramid(0,0,0,w,h,d,c)); },
    gtri: function (a,b,c,col) { return groupAdd(this, E3.tri(a,b,c,col)); },
    gquad: function (a,b,c,d,col) { return groupAdd(this, E3.quad(a,b,c,d,col,[0,1,0])); },
    gsprite: function (size,text,c) { this.faces.push(E3.sprite(this.x,this.y,this.z,size,text,c)); return this; },
    gshadow: function (r,h) { return groupAdd(this, E3.shadow(0,0,r,h)); },
    gadd: function (f) { if (Array.isArray(f)) this.faces.push(...f); else this.faces.push(f); return this; }
  };
  function groupAdd(g, faces) {
    const nd = E3.node({ x:g.x, y:g.y, z:g.z, ry:g.ry });
    const list = Array.isArray(faces) ? faces : [faces];
    for (const f of list) {
      const vv = f.v.map(nd.P);
      g.faces.push({ v: vv, c: f.c, n: E3.faceN(vv[0], vv[1], vv[2]), s: 1 });
    }
    return g;
  }

  const HOST = {
    loadModule(path, line) {
      const key = String(path);
      const mod = compileModule(key);
      if (!mod) throw new LangError("модуль не найден: " + key + " (зарегистрируй его в редакторе модулей)", line);
      return mod;
    },
    setNativeMember(o, name, v) { o[name] = v; },
    nativeMember(o, name, line) {
      if (name === "faces" || name === "x" || name === "y" || name === "z" || name === "ry") return o[name];
      const m = NAT_METHODS[name];
      if (m) return m;
      if (typeof o[name] === "function") return o[name];
      if (o[name] !== undefined) return o[name];
      throw new LangError("у группы нет свойства или метода «" + name + "»", line);
    },
    call(n, env, I) {
      const f = I.eval(n.callee, env);
      return I.invoke(f, n.args, env, n.line, null);
    }
  };

  /* ======================================================== ПОДСИСТЕМА ИГРЫ */
  const interp = new Interp(HOST);
  defineGlobals(interp);
  let running = false, raf = 0, lastT = 0, tAcc = 0;
  const hooks = {};

  function defineGlobals(I) {
    I.globals = new Env(null);
    for (const k in NAT) I.globals.declare(k, NAT[k], false);
    I.globals.declare("PI", Math.PI, true);
    I.globals.declare("TAU", Math.PI * 2, true);
    I.globals.declare("KEY_LEFT", "ArrowLeft", true);
    I.globals.declare("KEY_RIGHT", "ArrowRight", true);
    I.globals.declare("KEY_UP", "ArrowUp", true);
    I.globals.declare("KEY_DOWN", "ArrowDown", true);
    I.globals.declare("KEY_SPACE", "Space", true);
  }

  function collectHooks(env) {
    const raw = k => { const s = env.get(k); return s && s.__slot === 1 ? s.v : s; };
    hooks.setup = raw("setup");
    hooks.update = raw("update");
    hooks.draw = raw("draw");
  }

  /* Счётчики защиты живут один кадр. Сбрасываем здесь: игровой цикл зовёт
       update/draw через invoke(), и автоматический сброс по «верхнему уровню»
       не срабатывал — счётчик копился и обычная игра падала на лимите.
       Сброс живёт в самом интерпретаторе, а не здесь: раньше был дубликат,
       и правка одного места не трогала второй. */
  function resetFrameLimits(I) { I.resetLimits(); I.startClock(); }

  /* Фиксированный шаг включается явно (opts.fixedStep). По умолчанию шаг
     плавает вместе с частотой монитора — как было, и как ожидают
     привычные игры. При включении логика всегда получает один и тот же
     dt, а «догоняющие» шаги ограничены: после паузы кадр не должен
     догонять полсекунды. */
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const real = Math.min(.05, (now - lastT) / 1000);
    lastT = now;

    let dt = real, steps = 1;
    if (fixedStep) {
      steps = E3Step.advance(real * 1000);
      if (!steps) { /* шаг не наступил: кадр пропускаем */ return; }
      dt = E3Step.renderDt();
    }

    for (let step = 0; step < steps; step++) {
      tAcc += dt;
      S.t = tAcc;
      interp.steps = 0;
      resetFrameLimits(interp);
      const env = interp.runEnv;

    try {
      /* --- таймеры --- */
      for (let i = G.timers.length - 1; i >= 0; i--) {
        const tm = G.timers[i];
        if (S.t >= tm.at) {
          if (tm.rep) tm.at = S.t + tm.rep;
          else G.timers.splice(i, 1);
          if (tm.fn) interp.invoke(tm.fn, [], env, 0, null);
        }
      }

      S.faces = [];
      S.hud = [];
      G.widgets = [];
      G.drag = null;
      if (hooks.update) interp.invoke(hooks.update, [{ t: "num", v: dt, line: 0 }], env, 0, null);

      S.faces = [];
      S.hud = [];
      G.widgets = [];
      G.drag = null;
      if (hooks.draw) interp.invoke(hooks.draw, [], env, 0, null);

      /* весь кадр рисуем в логических координатах 640×380 */
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);

      /* Фон всегда рисуем на 2D-канве, даже когда включён GL. Слой GL лежит
         СВЕРХУ и прозрачен, поэтому сквозь него виден фон снизу; если
         убрать эту заливку, под геометрией окажется чёрное. */
      {
        const c0 = S.bg ? S.bg[0] : "#111a2b";
        const c1 = S.bg ? S.bg[1] : "#1d2b45";
        const g = ctx.createLinearGradient(0, 0, 0, cv._lh);
        g.addColorStop(0, c0); g.addColorStop(1, c1);
        ctx.fillStyle = g; ctx.fillRect(0, 0, cv._lw, cv._lh);
      }
      /* частицы: шаг и подмешивание к списку граней. Конкатенация каждый
         кадр — маленькая, до 240 точек; зато глубина сортируется вместе с
         геометрией и искры честно скрываются за стенами. */
      E3.stepParts(S.parts, dt);
      const ALL = S.parts.length ? S.faces.concat(S.parts) : S.faces;
      if (useGL) { E3GL.draw(ctx, ALL, S.cam, 430, LIGHT3, S.lit); glHealthy(); }
      else E3.draw(ctx, ALL, S.cam, 430, LIGHT3, S.lit);      const n = E3.stats.faces;
      /* HUD: text() и bar() — слой над сценой. При включённом GL он идёт
         на отдельную канву ПОВЕРХ геометрии: игровая канва с HUD оказалась
         бы под ней, и цифры пропали бы там, где сцена на них налезает. */
      const hctx = (useGL && E3GL.hud()) ? E3GL.hud() : ctx;
      hctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      hctx.textAlign = "left"; hctx.textBaseline = "alphabetic";
      for (const h of S.hud) {
        if (h.bar) { hctx.fillStyle = h.c; hctx.fillRect(h.x, h.y, h.w, h.h); }
        else { hctx.font = "bold " + h.size + "px system-ui,sans-serif"; hctx.fillStyle = h.c; hctx.fillText(h.s, h.x, h.y); }
      }
      /* виджеты: label/panel/button/slider/toggle/progress */
      if (useGL) drawWidgets(E3GL.hud()); else drawWidgets();
      if (statEl) statEl.textContent = "граней " + S.faces.length + " · нарисовано " + n +
        " · t=" + tAcc.toFixed(1) + "с · FPS-кадр " + (real * 1000).toFixed(0) + "мс · экран " + G.screen;
      if (opts.status) opts.status(G.screen, real * 1000, n);
      if (G.ended && G.screen === "win") { out("Победа! Звёзд: " + G.stars + " · счёт " + S.score, "ok"); sound("win"); stopLoop(); }
      if (G.ended && G.screen === "over") { out("Поражение. Счёт: " + S.score, "warn"); sound("lose"); stopLoop(); }
    } catch (e) {
      if (e instanceof LangError) {
        out("строка " + e.line + ": " + e.message, "err");
        { const tip = typeof errHelp === "function" ? errHelp(e.message) : "";
          if (tip) out("как исправить: " + tip, "warn"); }
        if (opts.debug) out(String(e.stack || ""), "err");
      } else {
        out("внутренняя ошибка: " + e.message, "err");
      }
      stopLoop();
      break;
    }
    }
    keysHit.clear();
    mouse.clicked = false;
  }

  /* Рисует виджеты интерфейса поверх сцены. */
  /* Виджеты рисуем на переданный слой: в режиме GL это канва ПОВЕРХ
     геометрии, иначе игровая. Раньше ctx был единственным, и в GL-режиме
     виджеты оказывались под сценой. */
  function drawWidgets(into) {
    const c = into || ctx;
    c.textBaseline = "middle";
    for (const w of G.widgets) {
      if (w.kind === "panel") {
        c.globalAlpha = Math.max(0, Math.min(1, w.a));
        c.fillStyle = w.c;
        c.fillRect(w.x, w.y, w.w, w.h);
        c.globalAlpha = 1;
        continue;
      }
      if (w.kind === "label") {
        c.textAlign = w.align === "center" ? "center" : (w.align === "right" ? "right" : "left");
        c.font = "bold " + Math.round(w.size) + "px system-ui,sans-serif";
        c.fillStyle = w.c;
        c.fillText(w.s, w.x, w.y);
        continue;
      }
      if (w.kind === "button") {
        const hov = inRect(w) && !G.drag;
        c.fillStyle = hov ? shadeHex(w.c, 1.25) : w.c;
        roundRect(ctx, w.x, w.y, w.w, w.h, 8);
        c.fill();
        c.textAlign = "center";
        c.font = "bold 15px system-ui,sans-serif";
        c.fillStyle = "#fff";
        c.fillText(w.s, w.x + w.w / 2, w.y + w.h / 2);
        continue;
      }
      if (w.kind === "slider") {
        const track = 8, ty = w.y - track / 2;
        c.fillStyle = "rgba(255,255,255,.18)";
        roundRect(ctx, w.x, ty, w.w, track, track / 2); c.fill();
        const f = (w.v - w.min) / (w.max - w.min || 1);
        const kx = w.x + w.w * Math.max(0, Math.min(1, f));
        c.fillStyle = "#38bdf8";
        roundRect(ctx, w.x, ty, Math.max(track, kx - w.x), track, track / 2); c.fill();
        c.beginPath();
        c.arc(kx, w.y, 9, 0, Math.PI * 2);
        c.fillStyle = "#f8fafc"; c.fill();
        continue;
      }
      if (w.kind === "toggle") {
        const bw = 44, bh = 24;
        c.fillStyle = w.v ? "#22c55e" : "rgba(255,255,255,.22)";
        roundRect(ctx, w.x, w.y - bh / 2, bw, bh, bh / 2); c.fill();
        c.beginPath();
        c.arc(w.x + (w.v ? bw - bh / 2 : bh / 2), w.y, bh / 2 - 3, 0, Math.PI * 2);
        c.fillStyle = "#fff"; c.fill();
        c.textAlign = "left";
        c.font = "15px system-ui,sans-serif";
        c.fillStyle = "#e2e8f0";
        c.fillText(w.s, w.x + bw + 10, w.y);
        continue;
      }
      if (w.kind === "progress") {
        c.fillStyle = "rgba(255,255,255,.16)";
        roundRect(ctx, w.x, w.y, w.w, w.h, w.h / 2); c.fill();
        c.fillStyle = w.c;
        roundRect(ctx, w.x, w.y, Math.max(w.h, w.w * w.f), w.h, w.h / 2); c.fill();
        continue;
      }
    }
    c.globalAlpha = 1;
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
  }

  function inRect(w) {
    return mouse.x >= w.x && mouse.x <= w.x + w.w && mouse.y >= w.y - 10 && mouse.y <= w.y + w.h + 10;
  }
  function inRectStrict(w) {
    return mouse.x >= w.x && mouse.x <= w.x + w.w && mouse.y >= w.y && mouse.y <= w.y + w.h;
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function shadeHex(c, k) {
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    const v = parseInt(m[1], 16);
    const r = Math.min(255, Math.round(((v >> 16) & 255) * k));
    const g = Math.min(255, Math.round(((v >> 8) & 255) * k));
    const b = Math.min(255, Math.round((v & 255) * k));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  /* Обрабатывает клики и перетаскивания по виджетам текущего кадра. */
  function updateWidgetInput() {
    for (const w of G.widgets) {
      if (w.kind === "button" && mouse.clicked && inRectStrict(w)) {
        if (w.fn) { try { interp.invoke(w.fn, [], interp.runEnv, 0, null); } catch (e) { out(e.message, "err"); stopLoop(); return; } }
      } else if (w.kind === "toggle" && mouse.clicked && inRect(w)) {
        w.v = !w.v;
        if (w.fn) { try { interp.invoke(w.fn, [], interp.runEnv, 0, null); } catch (e) { out(e.message, "err"); stopLoop(); return; } }
      } else if (w.kind === "slider") {
        if (mouse.down && inRect(w)) {
          const f = (mouse.x - w.x) / (w.w || 1);
          w.v = w.min + Math.max(0, Math.min(1, f)) * (w.max - w.min);
          G.drag = w;
        }
      }
    }
  }

  /* Последняя ошибка запуска. Редактор раньше печатал её в консоль, но у игры
     пользователя в приложении консоли нет — поэтому наружу отдаётся и она. */
  let lastError = null;

  /* Компиляция и запуск. Исходный код передаёт вызывающий: редактор — из
     textarea, приложение — из сохранённой игры пользователя. */
  function launch(src) {
    stopLoop();
    clearLog();
  let ast;
  try {
    ast = parse(src);
  } catch (e) {
    lastError = e;
    out("строка " + (e.line || 0) + ": " + e.message, "err");
    if (opts.onError) opts.onError(e);
    return false;
  }
    const env = new Env(interp.globals);
    interp.runEnv = env;
    /* Первый запуск получает щедрый бюджет: инициализация игры один раз
       считает то, что потом пересчитывает каждый кадр, и 12 мс на неё
       несправедливы. Дальше каждый кадр считается на 12 мс. */
    interp.resetLimits();
    interp.startClock(1000);
    try {
      interp.run(ast, env);
} catch (e) {
    lastError = e;
    out("строка " + (e.line || 0) + ": " + e.message, "err");
    if (opts.onError) opts.onError(e);
    return false;
  }
  collectHooks(env);
    if (opts.onError) opts.onError(null);

    /* игровое окружение чистое до запуска setup() */
    G.ended = false; G.stars = 0; G.timers.length = 0; G.widgets = [];
    G.screen = "game"; G.drag = null; G.muted = false;
    S.score = 0; S.hud = [];

    try {
      if (hooks.setup) interp.invoke(hooks.setup, [], env, 0, null);
    } catch (e) {
      out((hooks.setup ? "setup(), строка " + (e.line || 0) + ": " : "setup(): ") + e.message, "err");
      if (opts.onError) opts.onError(e);
      return false;
    }

    /* экран, выбранный в setup(), сохраняется */
    const screenAfterSetup = G.screen;
    out("OK — " + (hooks.draw ? "сцена рисуется" : "нет функции draw(), сцена будет пустая"), "ok");
    G.widgets = [];
    S.t = 0; tAcc = 0; S.faces = []; S.hud = [];
    S.cam = { x: 0, y: 5, z: -14, yaw: 0, pitch: .22 };
    S.bg = null;
    G.screen = screenAfterSetup;
    lastT = performance.now();
    running = true;
    raf = requestAnimationFrame(frame);
    return true;
  }

  function stopLoop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  return {
    cv: cv, ctx: ctx, S: S, G: G, hooks: hooks, interp: interp,
    lastError: () => lastError,
    NAT: NAT, NAT_METHODS: NAT_METHODS, HOST: HOST,
    mouse: mouse, keysDown: keysDown, keysHit: keysHit,
    out: out, clearLog: clearLog, launch: launch, stopLoop: stopLoop,
    isRunning: () => running,
    collectHooks: collectHooks, defineGlobals: defineGlobals,
    drawWidgets: drawWidgets, updateWidgetInput: updateWidgetInput,
    inRect: inRect, inRectStrict: inRectStrict, roundRect: roundRect,
    shadeHex: shadeHex, saveGame: saveGame, loadGame: loadGame,
    tone: tone, noise: noise, SFX: SFX
  };
}
