/* AERIS — бэкенд WebGL2 для E3.
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
  ok: false,          /* есть ли WebGL2 и удалось ли завести слой */
  force: null,        /* null — авто, true — включить, false — не включать */
  /* Последний провал attach: автоматика не долбит killed драйвер
     каждый кадр — после провала ждём 3 секунды до новой попытки.
     Новая игра сбрасывает это в unbind(). */
  glFail: false,
  glTryAt: 0,
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
out vec3 vN; out vec3 vC; out vec2 vY; out float vF; out float vS; out float vA;
uniform float uH;
void main(){
  vN = aNrm; vC = aCol.rgb; vA = aCol.a; vY = aY; vF = aFlat;
  /* экранная Y в системе E3 (вниз), чтобы градиент совпал с 2D-путём */
  vS = uH - (aPos.y * 0.5 + 0.5) * uH;
  gl_Position = vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vN; in vec3 vC; in vec2 vY; in float vF; in float vS; in float vA;
uniform vec3 uL;        /* направление ключевого света */
uniform float uAo, uSky;
uniform float uL2w; uniform vec3 uL2; uniform float uHasL2;
uniform float uGrad;    /* минимальная высота грани для градиента, 7 px */
out vec4 outColor;
void main(){
  vec3 n = normalize(vN);
  /* Ровно та же формула, что E3.lit на процессоре.
     Грань с флагом e:1 в 2D-пути не освещается вовсе (e3.js:313) —
     здесь она тоже идёт плоской, иначе тёмная до −58%. */
  vec3 c = vC;
  if (vF < 0.5) {
    float b = 0.42 + 0.58 * max(0.0, dot(n, uL));
    b *= 1.0 - uAo * (0.5 - 0.5 * n.y);
    b *= 1.0 + uSky * max(0.0, n.y);
    if (uHasL2 > 0.5) {
      float d = dot(n, normalize(uL2));
      if (d > 0.0) b += uL2w * d;
    }
    c *= min(b, 1.0);
    /* Градиент включается только для крупных граней — как minGrad в E3.
       При y1<=y0 градиента нет. */
    if (vY.y - vY.x >= uGrad) {
      float g = clamp((vS - vY.x) / max(0.001, vY.y - vY.x), 0.0, 1.0);
      c *= mix(1.18, 0.8, g);
    }
  }
  /* Альфа из атрибута, а не жёсткая единица. Иначе тени (e:2, a≈0.3)
     рисуются непрозрачными и закрывают всё, что за ними. */
  outColor = vec4(c, vA);
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
/* Кеш цветов ограничен. Игра, которая берёт новый оттенок каждый кадр
   (а такие есть: радуги, плавные переходы), без предела раздувала бы
   кеш на весь сеанс и держала строки в памяти. */
const HEX_CACHE_MAX = 512;
let _hexN = 0;
function rgb(hex) {
  let v = _hexCache[hex];
  if (v) return v;
  const h = String(hex);
  if (h.charAt(0) !== "#") {            /* rgba(...) и прочее: в 2D-пути
                                           такой цвет уходил в чёрный,
                                           здесь честно берём белый */
    v = [1, 1, 1];
  } else {
    const n = parseInt(h.slice(1, 7), 16);
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  if (_hexN >= HEX_CACHE_MAX) {          /* сбрасываем целиком: дешевле,
                                          чем следить за счётчиком каждого */
    for (const k in _hexCache) delete _hexCache[k];
    _hexN = 0;
  }
  _hexCache[hex] = v;
  _hexN++;
  return v;
}

/* Потеря контекста обрабатывается явно. Раньше обработчиков не было
   вовсе: после сбоя GPU S.ok навсегда оставался true, сцена исчезала,
   и ни ошибки, ни следа. */
function onLost(ev) {
  if (ev) ev.preventDefault();
  S.ok = false;
  S.lost = true;
  S.err = "контекст WebGL потерян";
}
function onBack() {
  S.lost = false;
  S.err = "контекст WebGL восстановлен — нужен повторный attach";
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
  const now = (typeof performance !== "undefined" ? performance.now() : 0);
  /* Провал свежее трёх секунд — не торопимся: попытка создать контекст
     стоит миллисекунды, а мы звались из середины кадра. Автоматика
     поэтому молчит до следующей игры; жёсткий «включить» от человека
     тоже обождёт — чуть-чуть, зато без долбежки. */
  if (S.glFail && now - S.glTryAt < 3000) return false;
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
      /* Убираем ОБА канвы. Раньше HUD-слой вставлялся в документ ДО
         попытки взять контекст, и при отказе оставался в DOM навсегда —
         E3.draw звал attach каждый кадр, то есть 60 новых канв в секунду. */
      if (c.parentNode) c.parentNode.removeChild(c);
      if (S.hudCanvas && S.hudCanvas.parentNode)
        S.hudCanvas.parentNode.removeChild(S.hudCanvas);
      S.hudCanvas = null;
      S.hudCtx = null;
      S.err = "WebGL2 недоступен";
      S.glFail = true;
      S.glTryAt = now;
      return false;
    }
    S.canvas = c;
  } catch (e) {
    S.err = String(e.message || e);
    S.glFail = true;
    S.glTryAt = now;
    return false;
  }

  try {
    S.prog = program(gl, VS, FS);
    S.lineProg = program(gl, LVS, LFS);
  } catch (e) {
    S.err = String(e.message || e);
    S.glFail = true;
    S.glTryAt = now;
    return false;
  }

  S.gl = gl;
  S.top = top;
  S.ctx2d = ctx2d;
  S.ok = true;
  S.canvas.addEventListener("webglcontextlost", onLost, false);
  S.canvas.addEventListener("webglcontextrestored", onBack, false);
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
  /* Устройство пикселей. Игровая канва масштабируется sharp() под DPR,
     а GL-канва раньше оставалась в логическом размере: на ноутбуке с
     DPR 2 геометрия выходила вдвое ниже разрешения рядом с чётким HUD. */
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
  if (S.canvas.width !== pw || S.canvas.height !== ph) {
    S.canvas.width = pw;
    S.canvas.height = ph;
  }
  if (S.hudCanvas && (S.hudCanvas.width !== w || S.hudCanvas.height !== h)) {
    S.hudCanvas.width = w;
    S.hudCanvas.height = h;
  }
  /* Прямоугольник кэшируется: getBoundingClientRect() в цикле кадра
     вызывает принудительную перерисовку раскладки — самый дорогой
     вызов в горячем пути. Размер меняется только при resize. */
  if (S.top && S.top.getBoundingClientRect) {
    const r = S.top.getBoundingClientRect();
    S.cssW = r.width; S.cssH = r.height;
    S.canvas.style.width = r.width + "px";
    S.canvas.style.height = r.height + "px";
    if (S.hudCanvas) {
      S.hudCanvas.style.width = r.width + "px";
      S.hudCanvas.style.height = r.height + "px";
    }
  }
  gl.viewport(0, 0, pw, ph);
}

/* Набор атрибутов и буферов создаётся один раз и переиспользуется:
   каждый кадр новые буферы означали бы сборку мусора в самом горячем
   месте, ради чего всё затевалось. */
/* Ёмкость считается в ВЕРШИНАХ и в отрезках, а не в байтах.
   Раньше bufferData получал FLOATS*4*4096 — это 4096 вершин, — тогда как
   массив JS создавался как Float32Array(FLOATS*4*4096), то есть вчетверо
   больше. Массив рос сам, буфер — нет, и bufferSubData уходил за пределы:
   сцена молча обрезалась, а getError никто не смотрел. */
const V_CAP0 = 4096;        /* начальная ёмкость вершин */
const L_CAP0 = 1024;        /* начальная ёмкость отрезков */
const L_STRIDE = 12;        /* флоатов на отрезок: две вершины по (поз2+цвет4) */

function ensureV(n) {
  if (n <= S.vCap) return;
  let c = S.vCap || V_CAP0;
  while (c < n) c *= 2;
  const gl = S.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, S.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, c * FLOATS * 4, gl.DYNAMIC_DRAW);
  S.vCap = c;
  checkGL("рост буфера вершин");
}
function ensureL(n) {
  if (n <= S.lCap) return;
  let c = S.lCap || L_CAP0;
  while (c < n) c *= 2;
  const gl = S.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, S.lvbo);
  gl.bufferData(gl.ARRAY_BUFFER, c * L_STRIDE * 4, gl.DYNAMIC_DRAW);
  S.lCap = c;
  checkGL("рост буфера обводки");
}

function buffers() {
  const gl = S.gl;
  if (S.vao) return;
  S.vCap = 0; S.lCap = 0;
  S.vao = gl.createVertexArray();
  gl.bindVertexArray(S.vao);

  S.vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, S.vbo);

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
  gl.enableVertexAttribArray(gl.getAttribLocation(S.lineProg, "aPos"));
  gl.vertexAttribPointer(gl.getAttribLocation(S.lineProg, "aPos"), 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(gl.getAttribLocation(S.lineProg, "aCol"));
  gl.vertexAttribPointer(gl.getAttribLocation(S.lineProg, "aCol"), 4, gl.FLOAT, false, 24, 8);

  gl.bindVertexArray(null);
}

/* ------------------------------ буферы ------------------------------ */
let _v = new Float32Array(FLOATS * 4 * 4096);
let _vN = 0, _l = new Float32Array(L_STRIDE * L_CAP0), _lN = 0;
const _items = [];      /* грани после отсева, для сортировки */
const _sprites = [];    /* спрайты уходят на 2D-слой */
/* Плоские буферы вместо массивов на вершину. E3.view и E3.proj создавали
   новый массив на КАЖДУЮ вершину КАЖДОЙ грани: на тысячу граней это
   четырнадцать тысяч выделений в кадре. Здесь переиспользуемые буферы. */
const _pv = new Float64Array(3 * 8);   /* вершины в видовых координатах */
const _pp = new Float64Array(2 * 8);   /* проекция на экран */
let _pool = new Float64Array(5 * 4096);/* данные принятых граней */
let _poolUsed = 0;
let _uni = null;                       /* адреса униформ, ищутся один раз */

/* Редкий случай: грань пересекает ближнюю плоскость и её надо обрезать.
   E3.clipNear ждёт массив пар, поэтому на этот случай собираем его. */
const _clipTmp = [];
function _pvToArrays(n) {
  _clipTmp.length = 0;
  for (let k = 0; k < n; k++) _clipTmp.push([_pv[k * 3], _pv[k * 3 + 1], _pv[k * 3 + 2]]);
  return _clipTmp;
}

function uniforms(gl) {
  if (_uni) return _uni;
  const P = S.prog;
  _uni = {
    uL: gl.getUniformLocation(P, "uL"), uAo: gl.getUniformLocation(P, "uAo"),
    uSky: gl.getUniformLocation(P, "uSky"), uGrad: gl.getUniformLocation(P, "uGrad"),
    uH: gl.getUniformLocation(P, "uH"), uL2: gl.getUniformLocation(P, "uL2"),
    uL2w: gl.getUniformLocation(P, "uL2w"), uHasL2: gl.getUniformLocation(P, "uHasL2"),
  };
  return _uni;
}
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
  ensureV(_vN);
}

/* Обводка. Отрезок — это ДВЕ вершины, у каждой позиция (2) и цвет (4),
   то есть 12 флоатов на отрезок и шаг 24 байта. Раньше писалось
   8 значений при шаге 6: соседние отрезки наезжали друг на друга, а
   цвет обводки читался из координат вершины. */
function pushL(x0, y0, x1, y1, r, g, b, a) {
  const o = _lN * L_STRIDE;
  if (o + L_STRIDE > _l.length) {
    const bigger = new Float32Array(_l.length * 2);
    bigger.set(_l);
    _l = bigger;
  }
  _l[o] = x0; _l[o + 1] = y0; _l[o + 2] = r; _l[o + 3] = g;
  _l[o + 4] = b; _l[o + 5] = a;
  _l[o + 6] = x1; _l[o + 7] = y1; _l[o + 8] = r; _l[o + 9] = g;
  _l[o + 10] = b; _l[o + 11] = a;
  _lN++;
  ensureL(_lN);
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

  _vN = 0; _lN = 0; _poolUsed = 0; _items.length = 0; _sprites.length = 0;

  const near = (typeof E3 !== "undefined" && E3.near) || 0.15;
  const opt = opts || {};
  const Ao = opt.ao === undefined ? 0.16 : opt.ao;
  const Sky = opt.sky === undefined ? 0.12 : opt.sky;

  /* Поворот камеры и центр экрана считаются ОДИН раз на кадр. Раньше
     E3.view() звал cos/sin четыре раза на каждую вершину: на тысячу
     граней это 16 тысяч вызовов ради четырёх значений. Здесь те же
     формулы (порядок: сначала поворот по yaw, потом по pitch — так же,
     как в E3.view), но без выделений: вершины пишутся в плоские буферы. */
  const cyaw = Math.cos(-cam.yaw), syaw = Math.sin(-cam.yaw);
  const cpit = Math.cos(-cam.pitch), spit = Math.sin(-cam.pitch);
  const cxp = cam.x, cyp = cam.y, czp = cam.z;
  const hx = LW / 2, hy = LH / 2;
  const minGrad = (typeof E3 !== "undefined" && E3.minGrad) || 7;
  const minStroke = (typeof E3 !== "undefined" && E3.minStroke) || 0;

  /* ---- 1. отсев и подготовка, ровно как в E3 ---- */
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (!f) continue;

    if (f.k===2) {                               /* частица — круг свечения */
      const vw = E3.view(f.p, cam);
      if (vw[2] < near) continue;
      const q = E3.proj(vw, fl, LW, LH);
      _sprites.push({ d: vw[2], x: q[0], y: q[1], s: (f.z || 1) * q[2],
                      t: "", c: f.c, g: 1 });
      continue;
    }
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
    let nOut = nv;
    let inside = 0, dmax = 0;
    for (let k = 0; k < nv; k++) {
      const p = f.v[k];
      const dx = p[0] - cxp, dy = p[1] - cyp, dz = p[2] - czp;
      const x1 = dx * cyaw - dz * syaw;
      const z1 = dx * syaw + dz * cyaw;
      const ox = x1, oy = dy * cpit - z1 * spit, oz = dy * spit + z1 * cpit;
      const o = k * 3;
      _pv[o] = ox; _pv[o + 1] = oy; _pv[o + 2] = oz;
      if (oz >= near) inside++;
      if (oz > dmax) dmax = oz;
    }
    if (!inside) continue;

    /* Отсечение ближней плоскости нужно редко, поэтому ради него
       собираем обычные массивы — E3.clipNear их и ждёт. */
    if (inside < nv) {
      const cl = E3.clipNear(_pvToArrays(nv), near);
      if (!cl || cl.length < 3) continue;
      nOut = cl.length;
      for (let k = 0; k < nOut; k++) {
        const p = cl[k];
        _pv[k * 3] = p[0]; _pv[k * 3 + 1] = p[1]; _pv[k * 3 + 2] = p[2];
      }
      dmax = 0;
      for (let k = 0; k < nOut; k++) {
        const z = _pv[k * 3 + 2];
        if (z > dmax) dmax = z;
      }
    }

    /* Отсев обратных граней — ровно как в 2D-пути (e3.js:303). Раньше здесь
       смотрели только на Z отрезка: от rn[2]*(сумма x / n) вместо полного
       скалярного произведения. Из-за этого отсекались грани, которые
       видны, и кадр выходил пустым. Плюс у 2D есть условие «грани
       целиком перед камерой» — без него грань на самом краю пропадала. */
    if (f.s && E3.cull !== false && dmax > near + 0.05) {
      const rn = E3.rotN(f.n, cam);
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < nOut; k++) {
        cx += _pv[k * 3]; cy += _pv[k * 3 + 1]; cz += _pv[k * 3 + 2];
      }
      if (rn[0] * cx + rn[1] * cy + rn[2] * cz > 0) continue;
    }

    for (let k = 0; k < nOut; k++) {
      const z = _pv[k * 3 + 2];
      const s = fl / (z > 0.12 ? z : 0.12);
      _pp[k * 2] = hx + _pv[k * 3] * s;
      _pp[k * 2 + 1] = hy - _pv[k * 3 + 1] * s;
    }

    /* Регулятор качества. В 2D-пути E3.maxFaces ограничивает число граней;
       здесь тот же предел, иначе на тяжёлых сценах кадр просто выпадает. */
    if (E3.maxFaces && _items.length >= E3.maxFaces) {
      if (typeof E3 !== "undefined" && E3.stats) E3.stats.dropped++;
      continue;
    }

    /* Данные грани кладём в общий переиспользуемый пул, а не в массивы.
       Если хранить ссылку на _pv/_pp, следующая грань затрёт предыдущую,
       а если копировать в массивы — вернёмся к выделениям. Пул живёт
       между кадрами и растёт по мере надобности. */
    const need = nOut * 5;
    if (_poolUsed + need > _pool.length) {
      const bigger = new Float64Array(Math.max(_pool.length * 2, _poolUsed + need));
      bigger.set(_pool);
      _pool = bigger;
    }
    const off = _poolUsed;
    for (let k = 0; k < nOut; k++) {
      const o = k * 3, q = off + k * 5;
      _pool[q] = _pv[o]; _pool[q + 1] = _pv[o + 1]; _pool[q + 2] = _pv[o + 2];
      _pool[q + 3] = _pp[k * 2]; _pool[q + 4] = _pp[k * 2 + 1];
    }
    _poolUsed += need;
    _items.push({ d: dmax, f: f, o: off, nv: nOut });
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
    let c = typeof f.c === "string" ? rgb(f.c) : [1, 1, 1];
    const alpha = (f.e === 2) ? (f.a === undefined ? 0.3 : f.a) : 1;

    /* Туман и блик считаем на процессоре, как в 2D-пути, и запекаем в
       цвет вершины. В шейдере их считать было бы быстрее, но тогда
       пришлось бы передавать глубину и направление взгляда, а ради
       совпадения картинки важнее одно число. Шесть игр ставят E3.fog. */
    if (!flat && f.c && f.c.charAt(0) === "#") {
      if (E3.fog) {
        const fk = Math.max(0, Math.min(1,
          (it.d - E3.fog[3]) / ((E3.fog[4] - E3.fog[3]) || 1)));
        if (fk > 0) {
          const k = fk;
          const fr = E3.fog[0] / 255, fg = E3.fog[1] / 255, fb = E3.fog[2] / 255;
          c = [c[0] * (1 - k) + fr * k, c[1] * (1 - k) + fg * k, c[2] * (1 - k) + fb * k];
        }
      }
      if (opt.spec) {
        const rv = E3.rotN(f.n, cam);
        const lv = E3.rotN(L, cam);
        let vx = 0, vy = 0, vz = 0;
        for (let k = 0; k < it.nv; k++) {
          vx -= _pool[it.o + k * 5];
          vy -= _pool[it.o + k * 5 + 1];
          vz -= _pool[it.o + k * 5 + 2];
        }
        const vl = Math.hypot(vx, vy, vz) || 1;
        const sp = E3.spec(rv, lv, [vx / vl, vy / vl, vz / vl], opt.spec, opt.shin);
        if (sp > 0) {
          const s = Math.min(.9, sp);
          c = [c[0] * (1 - s) + 1 * s, c[1] * (1 - s) + 1 * s, c[2] * (1 - s) + 1 * s];
        }
      }
    }

    /* Нормаль — МИРОВАЯ, как в 2D-пути: E3.lit на строке 314 получает
       нормаль грани без поворота. Раньше сюда клалась повёрнутая
       в видовое пространство (E3.rotN), а свет передавался мировым, —
       то есть скалярное произведение считалось в разных базисах и свет
       падал не туда. Для блика, наоборот, 2D крутит и свет, и нормаль
       в видовое, поэтому блик по-прежнему считается на процессоре. */
    let nx = 0, ny = 1, nz = 0;
    if (f.n && !flat) {
      const nl = Math.hypot(f.n[0], f.n[1], f.n[2]) || 1;
      nx = f.n[0] / nl; ny = f.n[1] / nl; nz = f.n[2] / nl;
    }

    /* экранный размах грани: решает, будет ли градиент */
    const o0 = it.o, nn = it.nv;
    let y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < nn; k++) {
      const py = _pool[o0 + k * 5 + 4];
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }

    /* Bloom (GL): свечение меряем той же яркостью закраски, что в 2D:
       E3.lum(c) по уже смешанному с блик/туманом цвету (c здесь — массив
       RGB). Цвет вершины ограничен единицей, поэтому горение — это
       простой подъём к потолку. */
    if (!flat && E3.bloom !== false) {
      const bt = E3.bloomAt || .92;
      const l2 = E3.lum(c);
      if (l2 > bt) {
        const bb = Math.min(1, (l2 - bt) / (1 - bt)) * .5;
        c = [Math.min(1, c[0] + bb), Math.min(1, c[1] + bb), Math.min(1, c[2] + bb)];
      }
    }

    const put = (k) => {
      const q = o0 + k * 5;
      pushV(_pool[q + 3] / LW * 2 - 1, 1 - _pool[q + 4] / LH * 2, 0.5,
            nx, ny, nz, c[0], c[1], c[2], alpha, y0, y1, flat);
    };

    if (nn >= 3) {
      if (f.e === 2 && alpha > 0) {
        /* Мягкая тень на пути WebGL: веер из центра, у края альфа ноль.
           Шейдер смешивает альфу по вершинам, и чёрный блин получает
           плавный край без отдельной текстуры. */
        let cx2 = 0, cy2 = 0;
        for (let k = 0; k < nn; k++) {
          cx2 += _pool[o0 + k * 5 + 3];
          cy2 += _pool[o0 + k * 5 + 4];
        }
        cx2 /= nn; cy2 /= nn;
        const putC = () => pushV(cx2 / LW * 2 - 1, 1 - cy2 / LH * 2, 0.5,
                                 nx, ny, nz, c[0], c[1], c[2], alpha, y0, y1, 1);
        const putE = (k) => {
          const q = o0 + k * 5;
          pushV(_pool[q + 3] / LW * 2 - 1, 1 - _pool[q + 4] / LH * 2, 0.5,
                nx, ny, nz, c[0], c[1], c[2], 0, y0, y1, 1);
        };
        for (let k = 0; k < nn; k++) { putC(); putE(k); putE((k + 1) % nn); }
      } else if (nn > 4) {                  /* веер для произвольных граней */
        for (let k = 3; k < nn; k++) { put(0); put(k - 1); put(k); }
      } else {
        put(0); put(1); put(2);
        if (nn === 4) { put(0); put(2); put(3); }
      }
    }

    /* обводка — только у непрозрачных граней, как в E3 */
    if (!f.e && minStroke <= 0 && nn >= 3) {
      const col = [10 / 255, 10 / 255, 25 / 255, 0.25];
      const lim = Math.min(nn, 4);
      for (let k = 0; k < lim; k++) {
        const a = o0 + k * 5 + 3, b = o0 + ((k + 1) % lim) * 5 + 3;
        pushL(_pool[a] / LW * 2 - 1, 1 - _pool[a + 1] / LH * 2,
              _pool[b] / LW * 2 - 1, 1 - _pool[b + 1] / LH * 2,
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
  const U = uniforms(gl);
  gl.uniform3f(U.uL, L[0], L[1], L[2]);
  gl.uniform1f(U.uAo, Ao);
  gl.uniform1f(U.uSky, Sky);
  gl.uniform1f(U.uGrad, minGrad);
  gl.uniform1f(U.uH, LH);
  if (opt.l2) {
    gl.uniform3f(U.uL2, opt.l2[0], opt.l2[1], opt.l2[2]);
    gl.uniform1f(U.uL2w, opt.l2w === undefined ? 0.3 : opt.l2w);
    gl.uniform1f(U.uHasL2, 1);
  } else {
    gl.uniform1f(U.uHasL2, 0);
  }

  gl.bindVertexArray(S.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, S.vbo);
  if (_vN) {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, _v, 0, _vN * FLOATS);
    gl.drawArrays(gl.TRIANGLES, 0, _vN);
    checkGL("геометрия");
  }

  if (_lN) {
    gl.useProgram(S.lineProg);
    gl.bindVertexArray(S.lvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.lvbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, _l, 0, _lN * L_STRIDE);
    gl.drawArrays(gl.LINES, 0, _lN * 2);
    checkGL("обводка");
  }

  /* ---- 5. спрайты на слой ПОВЕРХ геометрии ----
     Глифы шрифтом на GPU не воспроизвести один в один, поэтому спрайты
     рисуются на 2D-канве. Раньше это была игровая канва ПОД слоем GL,
     и геометрия накрывала их; теперь — HUD-слой сверху. */
  if (_sprites.length) {
    const c2 = S.hudCtx || S.ctx2d;
    if (c2) {
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
}

function stats() {
  return { ok: S.ok, active: S.active, verts: _vN, lines: _lN,
           sprites: _sprites.length, w: S.W, h: S.H, err: S.err || "",
           glErrors: S.glErrors || 0,
           firstError: S.firstError || "", firstErrorAt: S.firstErrorAt || "" };
}

/* Фон рисует игра сама на 2D-канве под нами, сквозь прозрачный слой,
   поэтому отдельной программы для него в файле нет. Раньше здесь стояли
   ещё bg() и beginFrame(c0,c1) — вторые объявления перекрывали первые, и
   настоящая очистка кадра становилась недостижимой: прошлый кадр
   наслаивался сам на себя, сцена темнела, цифры счёта дублировались. */

/* Проверка ошибок GL. Без неё критичные баги были молчаливыми:
   bufferSubData отбрасывал данные, рисовалось меньше геометрии — и это
   выглядело всего лишь как «просто медленнее». */
function checkGL(where) {
  if (!S.gl) return 0;
  const e = S.gl.getError();
  if (e !== 0) {
    S.glErrors = (S.glErrors || 0) + 1;
    if (!S.firstError) {
      const names = { 1280: "INVALID_ENUM", 1281: "INVALID_VALUE",
                      1282: "INVALID_OPERATION", 1285: "OUT_OF_MEMORY",
                      1286: "INVALID_FRAMEBUFFER_OPERATION" };
      S.firstError = names[e] || ("код " + e);
      S.firstErrorAt = where;
    }
  }
  return e;
}

const E3GL = {
  get ok() { return S.ok; },
  get active() { return S.active; },
  /* Режим: null — решает вызывающая сторона, true — включить, false —
     не включать. Человеку выбор важнее автоматики: у кого-то WebGL2 на
     драйвере глючит, и он хочет тихую 2D без сюрпризов. */
  get force() { return S.force; },
  request(on) {
    S.force = on === null ? null : !!on;
    /* «Включить» руками — верим человеку: сбрасываем память о провале,
       иначе запрет автоматических попыток пережил бы его приказ. */
    if (S.force) { S.glFail = false; S.glTryAt = 0; }
    return S.force;
  },
  /* Запрошен ли GL-режим. Читается на каждом кадре. Приоритет, от
     старшего к младшему: жёсткий приказ «выключить» от человека; класс no-gl на
     body (тестам и киоскам способ сказать «не надо» без настроек);
     адрес ?gl=0; уже активный GL; свежий провал attach (авто молчит
     три секунды, чтобы не долбить мёртвый драйвер); жёсткое «включить»;
     иначе авто — по умолчанию пробуем видеокарту. Это P2.2: раньше
     авто-выбор был только у сред игр, а свои режимы так и остались
     бы на 2D до ручного ?gl=1. */
  get want() {
    if (S.force === false) return false;
    try {
      if (typeof document !== "undefined" && document.body &&
          document.body.classList.contains("no-gl")) return false;
      const srch = (typeof location !== "undefined" && location.search) || "";
      if (/[?&]gl=0(&|$)/.test(srch)) return false;
    } catch (e) { return false; }
    if (S.active) return true;
    if (S.glFail && S.force !== true) return false;
    return true;
  },
  attach, draw, beginFrame, resize, stats, hud,
  enable() { if (S.ok) S.active = true; return S.active; },
  disable() { S.active = false; return false; },
  /* Смена игры: её холст уходит из документа вместе с GL-слоем, а
     состояние ещё считает свой холст живым. Полный сброс: следующая
     игра прикрепится по-новой, со свежим шансом на видеокарту — и без
     чужой памяти о провале. */
  unbind() {
    S.active = false;
    S.ok = false;
    S.gl = null; S.prog = null; S.lineProg = null;
    S.top = null; S.ctx2d = null;
    if (typeof document !== "undefined") {
      if (S.canvas && S.canvas.parentNode) S.canvas.parentNode.removeChild(S.canvas);
      if (S.hudCanvas && S.hudCanvas.parentNode) S.hudCanvas.parentNode.removeChild(S.hudCanvas);
    }
    S.canvas = null; S.hudCanvas = null; S.hudCtx = null;
    S.glFail = false; S.glTryAt = 0;
    return false;
  },
  state: S,
};

if (typeof window !== "undefined") window.E3GL = E3GL;
else if (typeof globalThis !== "undefined") globalThis.E3GL = E3GL;
})();