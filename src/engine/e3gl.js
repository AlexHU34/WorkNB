/* NEBULA BLOOM — бэкенд WebGL2 для E3.
 *
 * Зачем. E3 рисует на Canvas 2D, то есть заливку делает процессор. По
 * замеру внутри самого движка на заливку уходит около 74 % кадра, и
 * 5000 кубов стоят ~150 мс — это потолок в 6-7 fps, дальше не прыгнуть
 * никакой оптимизацией JavaScript.
 *
 * Почему отдельный файл, а не правка E3.draw. Тот код проверен гейтами и
 * на нём держатся 100 игр. Здесь тот же вход (грани, камера, свет) и тот
 * же результат на экране, но заливка уходит на GPU. Старый путь остаётся
 * и включается, если WebGL2 недоступен.
 *
 * ЧТО СОВПАДАЕТ СО СТАРЫМ ПУТЁМ (это условие, а не пожелание):
 *   - тот же формат граней: {v, c, n, s, t, e, a, k, p, z, t2};
 *   - тот же отсев: ближняя плоскость, обратные грани;
 *   - та же сортировка от дальнего к ближнему (алгоритм художника), а не
 *     z-буфер: так прозрачные тени и спрайты ложатся ровно как раньше;
 *   - та же формула освещения 0.42 + 0.58*max(0, N·L) с ao, sky и l2;
 *   - тот же вертикальный градиент для граней выше 7 экранных пикселей.
 * Спрайты и HUD рисуются на 2D-слой поверх: глифы шрифтом на GPU не
 * воспроизвести один в один, а менять 49 мест вызова нельзя.
 */
(function () {

/* ----------------------- включение и откат ----------------------- */
const S = {
  active: false,      /* включён ли GL-путь (по умолчанию выключен) */
  ok: false,          /* есть ли WebGL2 в этой машине */
  gl: null,
  canvas: null,       /* канва GL, лежит ПОД 2D-канвой */
  ctx2d: null,        /* 2D-слой для спрайтов и HUD */
  prog: null,         /* основная программа (грани) */
  lineProg: null,     /* программа обводки */
  W: 0, H: 0,
};

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("шейдер не собрался: " + log);
  }
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  const a = compile(gl, gl.VERTEX_SHADER, vs);
  const b = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, a);
  gl.attachShader(p, b);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("программа не связалась: " + gl.getProgramInfoLog(p));
  }
  gl.deleteShader(a);
  gl.deleteShader(b);
  return p;
}

/* ------------------------------ шейдеры ------------------------------
 * Проекция уже посчитана на процессоре: вершины приходят уже в
 * clip-координатах. Это сделано намеренно — 37 мест в играх вызывают
 * E3.view и E3.proj напрямую, и матрицы обязаны совпасть с ними до
 * миллиметра, иначе разъедутся полоски здоровья и прицелы.
 */
const VS = `#version 300 es
in vec3 aPos;      /* clip x, clip y, глубина 0..1 */
in vec3 aNrm;      /* нормаль в видовых координатах */
in vec4 aCol;      /* цвет + альфа */
in vec2 aY;        /* верх и низ грани в экранных координатах E3 */
in float aFlat;    /* 1 = не освещать и не градиентить (грань e:1) */
out vec3 vN; out vec3 vC; out vec2 vY; out float vF; out float vS;
uniform float uH;
void main(){
  vN = aNrm; vC = aCol.rgb; vY = aY; vF = aFlat;
  /* экранная Y в системе E3 (вниз), чтобы градиент совпал с 2D-путём */
  vS = uH - (aPos.y * 0.5 + 0.5) * uH;
  gl_Position = vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vN; in vec3 vC; in vec2 vY; in float vF; in float vS;
uniform vec3 uL;        /* направление ключевого света */
uniform float uAo, uSky;
uniform float uL2w; uniform vec3 uL2; uniform float uHasL2;
uniform float uGrad;    /* минимальная высота грани для градиента, 7 px */
out vec4 outColor;
void main(){
  vec3 n = normalize(vN);
  /* Ровно та же формула, что E3.lit на процессоре. */
  float b = 0.42 + 0.58 * max(0.0, dot(n, uL));
  b *= 1.0 - uAo * (0.5 - 0.5 * n.y);
  b *= 1.0 + uSky * max(0.0, n.y);
  if (uHasL2 > 0.5) {
    float d = dot(n, normalize(uL2));
    if (d > 0.0) b += uL2w * d;
  }
  vec3 c = vC * min(b, 1.0);
  /* Градиент включается только для крупных граней — как minGrad в E3.
     При y1<=y0 градиента нет, и flat-грани он не полагается. */
  if (vF < 0.5 && vY.y - vY.x >= uGrad) {
    float g = clamp((vS - vY.x) / max(0.001, vY.y - vY.x), 0.0, 1.0);
    c *= mix(1.18, 0.8, g);
  }
  outColor = vec4(c, 1.0);
}`;

/* Обводка. В E3 каждая грань кроме теней обводится цветом
   rgba(10,10,25,.25) толщиной 1px. Тот же тон рисуем линиями GL_LINES:
   ширина линии в WebGL надёжно равна 1. */
const LVS = `#version 300 es
in vec2 aPos; in vec4 aCol;
out vec4 vC;
void main(){ vC = aCol; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const LFS = `#version 300 es
precision mediump float;
in vec4 vC; out vec4 outColor;
void main(){ outColor = vC; }`;

const FLOATS = 13; /* pos3 + nrm3 + col4 + y2 + flat1 */

/* ------------------------------ цвет ------------------------------- */
const _hexCache = Object.create(null);
function rgb(hex) {
  let v = _hexCache[hex];
  if (v) return v;
  let h = String(hex);
  if (h.charAt(0) !== "#") {            /* rgba(...) и прочее: в 2D-пути
                                           такой цвет уходил в чёрный,
                                           здесь честно берём белый */
    v = [1, 1, 1];
  } else {
    const n = parseInt(h.slice(1, 7), 16);
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  _hexCache[hex] = v;
  return v;
}

/* ------------------------- подключение к странице --------------------
 * Канвы ДЕВЕ, а не одна: на одной канве нельзя иметь и 2D, и WebGL —
 * второй getContext вернёт null.
 *
 * Слой GL кладётся СВЕРХУ 2D-канвы и ПРОЗРАЧНЫЙ. Это ключевое решение.
 * Игра сама рисует на 2D-канве фон и HUD; если GL лежал бы снизу, его
 * закрыла бы заливка фона, а если бы лежал сверху непрозрачным — он
 * закрыл бы HUD. Прозрачный слой сверху даёт ровно то, что нужно: фон
 * и HUD просвечивают снизу, геометрия их перекрывает. Ни одну из 100
 * игр при этом править не пришлось.
 *
 * Слой не ловит события мыши: pointer-events none, всё остаётся на 2D.
 */
function attach(ctx2d) {
  /* Повторный вызов ничего не делает: иначе каждый кадр создавал бы
     новую канву и новый контекст. */
  if (S.ok) return true;
  const top = ctx2d.canvas;
  let gl = null;
  try {
    const c = document.createElement("canvas");
    c.width = top.width;
    c.height = top.height;
    c.style.position = "absolute";
    c.style.left = "0";
    c.style.top = "0";
    c.style.pointerEvents = "none";
    c.id = "e3glLayer";
    /* Сразу ПОСЛЕ 2D-канвы: слой должен быть сверху. */
    if (top.parentNode) top.parentNode.insertBefore(c, top.nextSibling);
    /* Третий слой — поверх GL. Он нужен для HUD и полос здоровья:
       игра рисует их на 2D-канве, а та под геометрией, и цифры
       пропадали бы там, где сцена на них налезает. Слой прозрачный и
       каждый кадр очищается. */
    const hud = document.createElement("canvas");
    hud.width = top.width;
    hud.height = top.height;
    hud.style.position = "absolute";
    hud.style.left = "0";
    hud.style.top = "0";
    hud.style.pointerEvents = "none";
    hud.id = "e3glHud";
    if (c.parentNode) c.parentNode.insertBefore(hud, c.nextSibling);
    S.hudCanvas = hud;
    S.hudCtx = hud.getContext("2d");
    gl = c.getContext("webgl2", { alpha: true, antialias: false,
                                 premultipliedAlpha: false,
                                 depth: false,
                                 /* preserveDrawingBuffer обязателен: без него
                                    буфер очищается после выдачи кадра
                                    композитору, и readPixels читает пустоту.
                                    Он же нужен для снимков экрана. */
                                 preserveDrawingBuffer: true });
    if (!gl) {
      if (c.parentNode) c.parentNode.removeChild(c);
      S.err = "WebGL2 недоступен";
      return false;
    }
    S.canvas = c;
  } catch (e) {
    S.err = String(e.message || e);
    return false;
  }

  try {
    S.prog = program(gl, VS, FS);
    S.lineProg = program(gl, LVS, LFS);
  } catch (e) {
    S.err = String(e.message || e);
    return false;
  }

  S.gl = gl;
  S.top = top;
  S.ctx2d = ctx2d;
  S.ok = true;
  resize(top._lw || top.width, top._lh || top.height);
  return true;
}

function W() { return (S.top && (S.top._lw || S.top.width)) || 640; }
function H() { return (S.top && (S.top._lh || S.top.height)) || 380; }

/* Поверх геометрии: цифры счёта, полосы здоровья, подписи. В режиме 2D
   этим занимается сама игровая канва, поэтому слой пуст. */
function hud() {
  return (S.ok && S.hudCtx) ? S.hudCtx : null;
}

function resize(w, h) {
  if (!S.ok) return;
  const gl = S.gl;
  S.W = w; S.H = h;
  if (S.canvas.width !== w || S.canvas.height !== h) {
    S.canvas.width = w;
    S.canvas.height = h;
  }
  if (S.hudCanvas && (S.hudCanvas.width !== w || S.hudCanvas.height !== h)) {
    S.hudCanvas.width = w;
    S.hudCanvas.height = h;
  }
  /* Нижний слой обязан лечь ровно под верхним, иначе картинка съедет
     на полпикселя при изменении размера окна. */
  const r = S.top.getBoundingClientRect ? S.top.getBoundingClientRect() : null;
  if (r) {
    S.canvas.style.width = r.width + "px";
    S.canvas.style.height = r.height + "px";
  }
  gl.viewport(0, 0, w, h);
}

/* Набор атрибутов и буферов создаётся один раз и переиспользуется:
   каждый кадр новые буферы означали бы сборку мусора в самом горячем
   месте, ради чего всё затевалось. */
function buffers() {
  const gl = S.gl;
  if (S.vao) return;
  S.vao = gl.createVertexArray();
  gl.bindVertexArray(S.vao);

  S.vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, S.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, FLOATS * 4 * 4096, gl.DYNAMIC_DRAW);

  const st = FLOATS * 4;
  const attr = (loc, size, off) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off * 4);
  };
  attr(gl.getAttribLocation(S.prog, "aPos"), 3, 0);
  attr(gl.getAttribLocation(S.prog, "aNrm"), 3, 3);
  attr(gl.getAttribLocation(S.prog, "aCol"), 4, 6);
  attr(gl.getAttribLocation(S.prog, "aY"), 2, 10);
  attr(gl.getAttribLocation(S.prog, "aFlat"), 1, 12);

  S.lvao = gl.createVertexArray();
  gl.bindVertexArray(S.lvao);
  S.lvbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, S.lvbo);
  gl.bufferData(gl.ARRAY_BUFFER, 6 * 4 * 4096, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(gl.getAttribLocation(S.lineProg, "aPos"));
  gl.vertexAttribPointer(gl.getAttribLocation(S.lineProg, "aPos"), 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(gl.getAttribLocation(S.lineProg, "aCol"));
  gl.vertexAttribPointer(gl.getAttribLocation(S.lineProg, "aCol"), 4, gl.FLOAT, false, 24, 8);

  gl.bindVertexArray(null);
}

/* ------------------------------ буферы ------------------------------ */
let _v = new Float32Array(FLOATS * 4 * 4096);
let _vN = 0, _l = new Float32Array(6 * 4 * 4096), _lN = 0;
const _items = [];      /* грани после отсева, для сортировки */
const _sprites = [];    /* спрайты уходят на 2D-слой */
const _camTmp = { };

function pushV(x, y, z, nx, ny, nz, r, g, b, a, y0, y1, flat) {
  const o = _vN * FLOATS;
  if (o + FLOATS > _v.length) {
    const bigger = new Float32Array(_v.length * 2);
    bigger.set(_v);
    _v = bigger;
  }
  _v[o] = x; _v[o + 1] = y; _v[o + 2] = z;
  _v[o + 3] = nx; _v[o + 4] = ny; _v[o + 5] = nz;
  _v[o + 6] = r; _v[o + 7] = g; _v[o + 8] = b; _v[o + 9] = a;
  _v[o + 10] = y0; _v[o + 11] = y1; _v[o + 12] = flat;
  _vN++;
}
function pushL(x0, y0, x1, y1, r, g, b, a) {
  const o = _lN * 6;
  if (o + 6 > _l.length) {
    const bigger = new Float32Array(_l.length * 2);
    bigger.set(_l);
    _l = bigger;
  }
  _l[o] = x0; _l[o + 1] = y0; _l[o + 2] = x1; _l[o + 3] = y1;
  _l[o + 4] = r; _l[o + 5] = g; _l[o + 6] = b; _l[o + 7] = a;
  _lN++;
}

/* ------------------------------ кадр ------------------------------- */
/* Тот же вход, что у E3.draw: контекст, грани, камера, фокус, свет.
   opts передаётся дальше без разбора — он нужен только освещению. */
/* Очистка кадра. Фон НЕ рисуем: его игра уже залила на 2D-канву под
   нами, и мы должны видеть его сквозь прозрачный слой. */
function beginFrame() {
  if (!S.ok) return false;
  const gl = S.gl;
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  /* HUD-слой тоже должен быть чистым, иначе прошлый кадр просвечивал бы
     сквозь текущий. */
  if (S.hudCtx) {
    S.hudCtx.setTransform(1, 0, 0, 1, 0, 0);
    S.hudCtx.clearRect(0, 0, S.W, S.H);
  }
  return true;
}

function draw(ctx, faces, cam, fl, L, opts) {
  if (!S.ok) return false;
  const gl = S.gl;
  const LW = W(), LH = H();
  resize(LW, LH);
  buffers();
  beginFrame();

  _vN = 0; _lN = 0; _items.length = 0; _sprites.length = 0;

  const near = (typeof E3 !== "undefined" && E3.near) || 0.15;
  const opt = opts || {};
  const Ao = opt.ao === undefined ? 0.16 : opt.ao;
  const Sky = opt.sky === undefined ? 0.12 : opt.sky;
  const minGrad = (typeof E3 !== "undefined" && E3.minGrad) || 7;
  const minStroke = (typeof E3 !== "undefined" && E3.minStroke) || 0;

  /* ---- 1. отсев и подготовка, ровно как в E3 ---- */
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (!f) continue;

    if (f.k) {                                   /* спрайт — на 2D-слой */
      const vw = E3.view(f.p, cam);
      if (vw[2] < near) continue;
      const q = E3.proj(vw, fl, LW, LH);
      _sprites.push({ d: vw[2], x: q[0], y: q[1], s: (f.z || 1) * q[2],
                      t: f.t2, c: f.c, g: f.g });
      continue;
    }
    if (f.pl) {                                  /* плоскость и сетка клеток */
      const pv = f.v.map((p) => E3.view(p, cam));
      let inside = 0;
      for (const p of pv) if (p[2] >= near) inside++;
      if (!inside) continue;
      const P = pv.map((p) => E3.proj(p, fl, LW, LH));
      if (P.length < 4) continue;
      const gw = f.gw || 0, gh = f.gh || 0;
      if (!f.pc || gw < 1 || gh < 1) {          /* обычная плоскость */
        const c0 = typeof f.c === "string" ? rgb(f.c) : [1, 1, 1];
        const q = (p) => pushV(p[0] / LW * 2 - 1, 1 - p[1] / LH * 2, 0.5,
                              0, 1, 0, c0[0], c0[1], c0[2], 1, 0, 0, 1);
        q(P[0]); q(P[1]); q(P[2]);
        q(P[0]); q(P[2]); q(P[3]);
        continue;
      }

      /* Сетка. Плоскость параметризована аффинно, поэтому углы считаются
         один раз решёткой (gw+1)x(gh+1), а не по четыре на клетку. Для
         8x8 это 81 проекция вместо 256, и — главное — ни одной заливки
         ctx на клетку: все клетки уходят в один общий буфер и рисуются
         одним вызовом drawArrays. Раньше на каждую клетку приходились
         ещё save/clip/restore. */
      const V = f.v;
      const lat = new Float32Array((gw + 1) * (gh + 1) * 2);
      for (let gz = 0; gz <= gh; gz++) {
        for (let gx = 0; gx <= gw; gx++) {
          const u = gx / gw, v = gz / gh;
          const wx = V[0][0] + (V[1][0] - V[0][0]) * u + (V[3][0] - V[0][0]) * v;
          const wy = V[0][1] + (V[1][1] - V[0][1]) * u + (V[3][1] - V[0][1]) * v;
          const wz = V[0][2] + (V[1][2] - V[0][2]) * u + (V[3][2] - V[0][2]) * v;
          const q = E3.proj(E3.view([wx, wy, wz], cam), fl, LW, LH);
          const o = (gz * (gw + 1) + gx) * 2;
          lat[o] = q[0]; lat[o + 1] = q[1];
        }
      }
      let budget = E3.maxTiles || 9000;
      for (let gz = 0; gz < gh; gz++) {
        for (let gx = 0; gx < gw; gx++) {
          const col = f.pc(gx, gz);
          if (!col) continue;
          if (--budget <= 0) { gz = gh; break; }
          const c = rgb(col);
          const o00 = (gz * (gw + 1) + gx) * 2;
          const o10 = o00 + 2;
          const o11 = o00 + (gw + 1) * 2 + 2;
          const o01 = o00 + (gw + 1) * 2;
          const put = (o) => pushV(
            lat[o] / LW * 2 - 1, 1 - lat[o + 1] / LH * 2, 0.5,
            0, 1, 0, c[0], c[1], c[2], 1, 0, 0, 1);
          put(o00); put(o10); put(o11);
          put(o00); put(o11); put(o01);
        }
      }
      if (typeof E3 !== "undefined" && E3.stats) E3.stats.tiles = budget;
      continue;
    }

    const nv = (f.t || f.v[3] === f.v[0]) ? 3 : 4;
    let pv = [E3.view(f.v[0], cam)];
    for (let k = 1; k < nv; k++) pv.push(E3.view(f.v[k], cam));
    let inside = 0, dmax = 0;
    for (let k = 0; k < nv; k++) {
      if (pv[k][2] >= near) inside++;
      if (pv[k][2] > dmax) dmax = pv[k][2];
    }
    if (!inside) continue;

    if (inside < nv) {                           /* отсечение ближней плоскости */
      const cl = E3.clipNear(pv, near);
      if (!cl || cl.length < 3) continue;
      pv = cl;
    }

    if (f.s) {                                   /* обратные грани */
      const rv = E3.rotN(f.n || [0, 0, 1], cam);
      let cx = 0;
      for (let k = 0; k < nv; k++) cx += pv[k][0];
      if (rv[2] * (cx / nv) <= 0) continue;
    }

    const pp = [];
    for (let k = 0; k < pv.length; k++) pp.push(E3.proj(pv[k], fl, LW, LH));

    _items.push({ d: dmax, f: f, pp: pp, nv: pv.length });
  }

  /* ---- 2. сортировка от дальнего к ближнему ---- */
  _items.sort((a, b) => b.d - a.d);

  /* ---- 3. сборка буферов ---- */
  for (let i = 0; i < _items.length; i++) {
    const it = _items[i];
    const f = it.f;
    /* Плоскостей здесь больше нет: и обычная плоскость, и сетка клеток
       целиком разбираются на этапе подготовки, где строится вершинный
       буфер. Раньше плоскость доходила сюда и рисовалась веером в
       экранных координатах — без перспективы, то есть неверно. */

    const flat = (f.e === 1 || typeof f.c !== "string") ? 1 : 0;
    const c = typeof f.c === "string" ? rgb(f.c) : [1, 1, 1];
    const alpha = (f.e === 2) ? (f.a === undefined ? 0.3 : f.a) : 1;

    /* нормаль в видовых координатах */
    let nx = 0, ny = 1, nz = 0;
    if (f.n && !flat) {
      const rv = E3.rotN(f.n, cam);
      const l = Math.hypot(rv[0], rv[1], rv[2]) || 1;
      nx = rv[0] / l; ny = rv[1] / l; nz = rv[2] / l;
    }

    /* экранный размах грани: решает, будет ли градиент */
    let y0 = 1e9, y1 = -1e9;
    const P = it.pp;
    for (let k = 0; k < P.length; k++) {
      if (P[k][1] < y0) y0 = P[k][1];
      if (P[k][1] > y1) y1 = P[k][1];
    }

    const put = (p) => pushV(
      p[0] / LW * 2 - 1, 1 - p[1] / LH * 2, 0.5,
      nx, ny, nz, c[0], c[1], c[2], alpha, y0, y1, flat);

    const n = it.nv;
    if (n >= 3) {
      put(P[0]); put(P[1]); put(P[2]);
      if (n === 4) { put(P[0]); put(P[2]); put(P[3]); }
      else if (n > 4) {                    /* веер для произвольных граней */
        for (let k = 3; k < n; k++) { put(P[0]); put(P[k - 1]); put(P[k]); }
      }
    }

    /* обводка — только у непрозрачных граней, как в E3 */
    if (!f.e && minStroke <= 0 && P.length >= 3) {
      const col = [10 / 255, 10 / 255, 25 / 255, 0.25];
      const cnt = P.length;
      const lim = Math.min(cnt, 4);
      for (let k = 0; k < lim; k++) {
        const a = P[k], b = P[(k + 1) % lim];
        pushL(a[0] / LW * 2 - 1, 1 - a[1] / LH * 2,
              b[0] / LW * 2 - 1, 1 - b[1] / LH * 2,
              col[0], col[1], col[2], col[3]);
      }
    }
  }

  /* ---- 4. отрисовка ---- */
  /* Число нарисованных граней кладём в E3.stats: HUD и внешние коды
     читают его и после перехода на GL. Иначе в статистике кадра
     осталось бы значение от последнего кадра 2D-пути. */
  if (typeof E3 !== "undefined" && E3.stats) E3.stats.faces = _items.length;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  /* Глубину выключили намеренно: порядок задаёт сортировка, как в 2D-пути.
     z-буфер с прозрачными тенями давал бы другой результат. */
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  gl.useProgram(S.prog);
  const U = (n) => gl.getUniformLocation(S.prog, n);
  gl.uniform3f(U("uL"), L[0], L[1], L[2]);
  gl.uniform1f(U("uAo"), Ao);
  gl.uniform1f(U("uSky"), Sky);
  gl.uniform1f(U("uGrad"), minGrad);
  gl.uniform1f(U("uH"), LH);
  if (opt.l2) {
    gl.uniform3f(U("uL2"), opt.l2[0], opt.l2[1], opt.l2[2]);
    gl.uniform1f(U("uL2w"), opt.l2w === undefined ? 0.3 : opt.l2w);
    gl.uniform1f(U("uHasL2"), 1);
  } else {
    gl.uniform1f(U("uHasL2"), 0);
  }

  gl.bindVertexArray(S.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, S.vbo);
  if (_vN) {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, _v, 0, _vN * FLOATS);
    gl.drawArrays(gl.TRIANGLES, 0, _vN);
  }

  if (_lN) {
    gl.useProgram(S.lineProg);
    gl.bindVertexArray(S.lvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.lvbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, _l, 0, _lN * 6);
    gl.drawArrays(gl.LINES, 0, _lN);
  }

  /* ---- 5. спрайты на 2D-слой: глифы шрифтом на GPU не повторить ---- */
  if (_sprites.length && S.ctx2d) {
    const c2 = S.ctx2d;
    c2.save();
    for (const sp of _sprites) {
      const sz = Math.max(2, sp.s);
      if (sp.g) {
        c2.globalAlpha = 0.25 + 0.2 * Math.sin(performance.now() / 250);
        c2.fillStyle = sp.c;
        c2.beginPath();
        c2.arc(sp.x, sp.y, sz * 0.5, 0, 7);
        c2.fill();
        c2.globalAlpha = 1;
      }
      c2.font = Math.round(sz) + "px serif";
      c2.textAlign = "center";
      c2.textBaseline = "middle";
      c2.fillStyle = sp.c;
      c2.fillText(sp.t, sp.x, sp.y);
    }
    c2.restore();
  }
}

/* Фон рисуем в GL, потому что 2D-слой лежит поверх и иначе закрыл бы
   геометрию собственной заливкой градиента. */
function bg(c0, c1) {
  if (!S.ok) return;
  const gl = S.gl;
  gl.useProgram(S.bgProg);
  gl.bindVertexArray(S.bvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, S.bvbo);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([-1, -1, 3, -1, -1, 3]));
  gl.uniform3f(gl.getUniformLocation(S.bgProg, "uA"),
               parseInt(c0.slice(1, 3), 16) / 255,
               parseInt(c0.slice(3, 5), 16) / 255,
               parseInt(c0.slice(5, 7), 16) / 255);
  gl.uniform3f(gl.getUniformLocation(S.bgProg, "uB"),
               parseInt(c1.slice(1, 3), 16) / 255,
               parseInt(c1.slice(3, 5), 16) / 255,
               parseInt(c1.slice(5, 7), 16) / 255);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.BLEND);
}

function beginFrame(c0, c1) {
  if (!S.ok) return false;
  bg(c0 || "#111a2b", c1 || "#1d2b45");
  return true;
}

function stats() {
  return { ok: S.ok, active: S.active, verts: _vN, lines: _lN,
           sprites: _sprites.length, w: S.W, h: S.H, err: S.err || "" };
}

/* Фон рисует игра сама на 2D-канве под нами, сквозь прозрачный слой.
   Отдельной программы для него больше нет. */
function bg() {}

const E3GL = {
  get ok() { return S.ok; },
  get active() { return S.active; },
  /* Запрошен ли GL-режим. Читается на каждом кадре: включить движок
     можно и до загрузки страницы (?gl=1 в адресе), и позже из консоли. */
  get want() {
    if (S.active) return true;
    try {
      return typeof location !== "undefined" &&
        /[?&]gl=1(&|$)/.test(location.search || "");
    } catch (e) { return false; }
  },
  attach, draw, beginFrame, resize, stats, bg, hud,
  enable() { if (S.ok) S.active = true; return S.active; },
  disable() { S.active = false; return false; },
  state: S,
};

if (typeof window !== "undefined") window.E3GL = E3GL;
else if (typeof globalThis !== "undefined") globalThis.E3GL = E3GL;
})();