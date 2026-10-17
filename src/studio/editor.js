/* AERIS Studio — интерфейс редактора.
 *
 * Три панели, как в Unity: иерархия, вьюпорт, инспектор. Отличие в том,
 * что здесь нет шага «сборки»: кнопка «Опубликовать» превращает сцену в
 * код BloomScript и кладёт её в общий каталог, который уже умеет её
 * запускать (src/lang/play.js).
 *
 * Режимы Edit и Play разделены, как в Unity, но строже: в Play правка
 * сцены запрещена. Иначе можно остановиться на состоянии, которое
 * никогда не сохранится, и потом не понять, откуда оно взялось.
 *
 * Сцена и кодогенерация — в src/studio/scene.js. Здесь только вид.
 */
(function () {

const $ = (id) => document.getElementById(id);
/* Камера: точка, вокруг которой вращаемся (pivot), плюс углы и расстояние.
   Раньше камера всегда смотрела из начала координат, поэтому улететь от
   сцены было нельзя, а большая сцена не помещалась в экран. Теперь точку
   вращения можно двигать клавишами — это и есть полёт. */
const st = {
  scene: null,
  sel: null,
  pivot: { x: 0, y: 1.5, z: 0 },   /* куда смотрим; двигается клавишами */
  yaw: 0.6,
  pitch: 0.45,
  dist: 11,
  playing: false,
  ang: 0,
  last: 0,
  dirty: false,
  hover: null,          /* объект под курсором — подсветка в иерархии и рамке */
  snap: true,           /* привязка к сетке при перетаскивании */
  undo: [],             /* стек снимков назад */
  redo: [],             /* стек снимков вперёд */
  keys: Object.create(null),   /* какие клавиши сейчас нажаты (полёт) */
  looking: false,               /* зажата ли правая кнопка мыши */
};
let cv, ctx;

/* Привязка к сетке: шаг 0.25, чтобы мышью попадать ровно. Числа округляются
   до сотых — иначе объект уезжает на 0.03 за один пиксель и сетка врёт. */
const SNAP = 0.25;
function snap(v) { return st.snap ? Math.round(v / SNAP) * SNAP : Math.round(v * 100) / 100; }

/* Снимок сцены для отката. Глубокая копия нужна, потому что undo хранит
   состояние «до» правки: ссылки на те же объекты откат бы не отменил. */
function snapshot() {
  return JSON.stringify({
    objects: st.scene.objects,
    sel: st.sel,
    title: st.scene.title,
    ground: st.scene.ground,
    camera: st.scene.camera,
    bg: st.scene.bg,
    animated: st.scene.animated,
  });
}
function restore(json) {
  const d = JSON.parse(json);
  st.scene.objects = d.objects;
  st.scene.title = d.title;
  st.scene.ground = d.ground;
  st.scene.camera = d.camera;
  st.scene.bg = d.bg;
  st.scene.animated = d.animated;
  st.sel = d.sel;
}

/* Кладём снимок «до» изменения в стек. Красный стек чистится: после нового
   шага вернуться в «прошлое» уже нельзя. */
function pushUndo() {
  st.undo.push(snapshot());
  if (st.undo.length > 60) st.undo.shift();
  st.redo.length = 0;
  syncUndoButtons();
}
function undo() {
  if (st.playing) return;
  if (!st.undo.length) { log("отменять нечего", "warn"); return; }
  st.redo.push(snapshot());
  restore(st.undo.pop());
  $("titleIn").value = st.scene.title;
  refreshHierarchy(); refreshInspector(); markDirty();
  log("отменено");
  syncUndoButtons();
}
function redo() {
  if (st.playing) return;
  if (!st.redo.length) { log("нечего возвращать", "warn"); return; }
  st.undo.push(snapshot());
  restore(st.redo.pop());
  $("titleIn").value = st.scene.title;
  refreshHierarchy(); refreshInspector(); markDirty();
  log("возвращено");
  syncUndoButtons();
}
function syncUndoButtons() {
  const u = $("btnUndo"), r = $("btnRedo");
  if (u) u.disabled = !st.undo.length;
  if (r) r.disabled = !st.redo.length;
}

function log(msg, kind) {
  const box = $("logBox");
  const line = document.createElement("div");
  line.className = "logLine" + (kind ? " " + kind : "");
  line.textContent = msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function markDirty() {
  st.dirty = true;
  $("status").textContent = "есть несохранённые изменения";
}
function round2(v) { return Math.round(v * 100) / 100; }

/* Копирование сцены в буфер обмена. Раньше сцена жила только в браузере:
   нажал «Очистить» — и всё, что собирал, пропало без возможности вернуть.
   Обычный Ctrl+C/Ctrl+V работает с любой программой, где сцену вставили. */
function copyScene() {
  const text = JSON.stringify(st.scene);
  try {
    /* Запасной путь: буфер может быть недоступен без разрешения. Пишем
       в скрытое поле, а не в alert()/prompt() — модальное окно блокирует
       поток и в автоматической проверке страница зависает навсегда. */
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(helper);
    log(ok ? "📋 сцена скопирована — вставь кнопкой «Вставить»"
            : "буфер обмена недоступен в этом браузере", ok ? "ok" : "warn");
  } catch (e) {
    log("не удалось скопировать: " + e.message, "err");
  }
}
async function pasteScene() {
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch (e) { text = ""; }
  if (!text) {
    log("буфер обмена пуст — скопируй сцену кнопкой «Копировать»", "warn");
    return;
  }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  if (!data || !Array.isArray(data.objects)) {
    log("это не сцена AERIS Studio", "err");
    return;
  }
  pushUndo();
  const fresh = Studio.normalize(data);
  st.scene.objects = fresh.objects;
  st.scene.ground = fresh.ground;
  st.scene.bg = fresh.bg;
  st.scene.animated = fresh.animated;
  st.sel = null;
  refreshHierarchy(); refreshInspector(); scenePanel(); markDirty();
  log("📥 сцена вставлена: объектов " + fresh.objects.length, "ok");
}

/* Вернуть камеру в исходное положение — после долгого полёта иначе
   пришлось бы гадать, где начало. */
function resetCamera() {
  st.pivot.x = 0; st.pivot.y = 1.5; st.pivot.z = 0;
  st.yaw = 0.6; st.pitch = 0.45; st.dist = 11;
  log("камера возвращена в начало");
}

/* ============================ ПОСТРОЕНИЕ СЦЕНЫ ============================ */
/* Сцена превращается в грани движка ровно так же, как это делает
   кодогенератор, — иначе вьюпорт врал бы игроку. */
function facesFor(animAng) {
  const s = st.scene;
  const faces = [];
  const lit = s.ground;
  faces.push(...E3.tiles(lit.w, lit.d, { c: lit.color }));
  for (const o of s.objects) {
    const bob = animAng === null ? 0 : 0.3 * Math.sin(animAng + o.phase);
    const y = o.y + bob - (o.kind === "sprite" ? 0 : o.h / 2);
    if (o.kind === "box") faces.push(...E3.box(o.x, y, o.z, o.w, o.h, o.d, o.color));
    else if (o.kind === "pyramid") faces.push(...E3.pyramid(o.x, y, o.z, o.w, o.h, o.d, o.color));
    else faces.push(E3.sprite(o.x, y, o.z, o.size, o.name, o.color));
  }
  return faces;
}

/* Положение камеры в мире: сидром от точки вращения плюс углы.
   Взгляд всегда направлен в pivot, поэтому «подлететь к объекту» и
   «отлететь от сцены» — одно и то же действие. */
function camObj() {
  const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  const d = st.dist;
  return {
    x: st.pivot.x + Math.sin(st.yaw) * cp * d,
    y: st.pivot.y + sp * d,
    z: st.pivot.z - Math.cos(st.yaw) * cp * d,
    yaw: st.yaw,
    pitch: st.pitch,
  };
}

/* Полёт: сдвигаем точку вращения вдоль взгляда и вбок. Скорость
   зависит от Shift — медленно для точной подстройки, быстро для
   перелёта через всю сцену. Шаг в кадре, чтобы движение не зависело
   от частоты экрана. */
const FLY_BASE = 7;
function flyStep(dt) {
  const k = st.keys;
  let fx = 0, fy = 0, fz = 0;
  if (k["KeyW"]) fx += 1;
  if (k["KeyS"]) fx -= 1;
  if (k["KeyA"]) fz += 1;
  if (k["KeyD"]) fz -= 1;
  if (k["KeyE"]) fy += 1;
  if (k["KeyQ"]) fy -= 1;
  if (!fx && !fy && !fz) return false;
  const speed = (k["ShiftLeft"] || k["ShiftRight"] ? FLY_BASE * 3 : FLY_BASE) * dt;
  const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  /* Вперёд по взгляду: горизонтальная часть плюс вертикаль от наклона. */
  const fwd = [Math.sin(st.yaw) * cp, sp, -Math.cos(st.yaw) * cp];
  /* Вбок: поворот направления взгляда на 90° вокруг вертикали. */
  const right = [Math.cos(st.yaw), 0, Math.sin(st.yaw)];
  st.pivot.x += (fwd[0] * fx + right[0] * fz) * speed;
  st.pivot.y += (fwd[1] * fx + fy) * speed;
  st.pivot.z += (fwd[2] * fx + right[2] * fz) * speed;
  return true;
}

/* Рамка объекта. В Unity это gizmo; здесь — честный каркас из рёбер,
   потому что поднимать настоящий манипулятор рано: он тянет за собой
   систему привязок и оси, а польза сомнительна. Функция принимает id,
   а не смотрит в состояние: ею обводят и выделение, и объект под курсором. */
function outlineFaces(id) {
  const o = Studio.findObject(st.scene, id);
  if (!o || st.playing) return [];
  const w = o.kind === "sprite" ? o.size : o.w;
  const h = o.kind === "sprite" ? o.size : o.h;
  const d = o.kind === "sprite" ? 0.1 : o.d;
  const x0 = o.x - w / 2 - .04, x1 = o.x + w / 2 + .04;
  const y0 = o.y - h - .04, y1 = o.y + .04;
  const z0 = o.z - d / 2 - .04, z1 = o.z + d / 2 + .04;
  const col = "#ffd54f";
  const e = [];
  const edge = (a, b) => E3.quad(a[0], a[1], a[2], b[0], b[1], b[2], col, [0, 0, 1]);
  const P = (X, Y, Z) => [X, Y, Z];
  e.push(...edge(P(x0, y0, z0), P(x1, y0, z0)), ...edge(P(x1, y0, z0), P(x1, y0, z1)));
  e.push(...edge(P(x1, y0, z1), P(x0, y0, z1)), ...edge(P(x0, y0, z1), P(x0, y0, z0)));
  e.push(...edge(P(x0, y1, z0), P(x1, y1, z0)), ...edge(P(x1, y1, z0), P(x1, y1, z1)));
  e.push(...edge(P(x1, y1, z1), P(x0, y1, z1)), ...edge(P(x0, y1, z1), P(x0, y1, z0)));
  e.push(...edge(P(x0, y0, z0), P(x0, y1, z0)), ...edge(P(x1, y0, z0), P(x1, y1, z0)));
  e.push(...edge(P(x0, y0, z1), P(x0, y1, z1)), ...edge(P(x1, y0, z1), P(x1, y1, z1)));
  return e;
}

function render() {
  const W = cv._lw, H = cv._lh;
  const s = st.scene;
  const dpr = cv._dpr || 1;
  /* Всё дальше рисуем в логических координатах: на бэксто�� они просто
     помножаются на плотность пикселей. */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, s.bg[0]);
  g.addColorStop(1, s.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const cam = camObj();
  const faces = facesFor(st.playing ? st.ang : null);
  E3.draw(ctx, faces, cam, 430, LIGHT3);
  /* Под курсором — блёклая рамка, выделенное — яркая. Раньше объект под
     мышью не подсвечивался: выбрать его можно было только вслепую. */
  if (st.hover && st.hover !== st.sel) {
    const hov = outlineFaces(st.hover);
    if (hov.length) E3.draw(ctx, hov, cam, 430, [0.35, 0.4, 0.5]);
  }
  const sel = outlineFaces(st.sel);
  if (sel.length) E3.draw(ctx, sel, cam, 430, [1, 1, 1]);

  if (!st.scene.objects.length) {
    ctx.fillStyle = "#9fb3c8";
    ctx.font = "bold 17px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Сцена пуста — добавь куб кнопкой сверху", W / 2, H / 2);
    ctx.textAlign = "left";
  }
  if (st.playing) {
    ctx.fillStyle = "#ff7043";
    ctx.font = "bold 15px system-ui,sans-serif";
    ctx.fillText("▶ PLAY — сцену править нельзя", 12, 24);
  }
}

/* =============================== ПАНЕЛИ ================================= */
function refreshHierarchy() {
  const box = $("hierBox");
  box.textContent = "";
  if (!st.scene.objects.length) {
    const e = document.createElement("div");
    e.className = "hint";
    e.textContent = "объектов нет";
    box.appendChild(e);
    return;
  }
  for (const o of st.scene.objects) {
    const row = document.createElement("div");
    row.className = "hrow" + (o.id === st.sel ? " sel" : "") + (o.id === st.hover ? " hov" : "");
    const dot = document.createElement("span");
    dot.className = "hdot";
    dot.style.background = o.color;
    const nm = document.createElement("span");
    nm.className = "hname";
    nm.textContent = o.name;
    row.appendChild(dot);
    row.appendChild(nm);
    row.onmouseenter = () => { st.hover = o.id; };
    row.onmouseleave = () => { if (st.hover === o.id) st.hover = null; };
    row.onclick = () => { st.sel = o.id; refreshHierarchy(); refreshInspector(); };
    box.appendChild(row);
  }
}

const FIELD_DEFS = [
  { k: "name",   t: "text",   label: "Имя" },
  { k: "x",      t: "num",    label: "X" },
  { k: "y",      t: "num",    label: "Y" },
  { k: "z",      t: "num",    label: "Z" },
  { k: "w",      t: "num",    label: "Ширина",  only: ["box", "pyramid"] },
  { k: "h",      t: "num",    label: "Высота",  only: ["box", "pyramid"] },
  { k: "d",      t: "num",    label: "Глубина", only: ["box", "pyramid"] },
  { k: "size",   t: "num",    label: "Размер",  only: ["sprite"] },
  { k: "color",  t: "color",  label: "Цвет" },
];

function refreshInspector() {
  const box = $("inspBox");
  box.textContent = "";
  const o = Studio.findObject(st.scene, st.sel);
  if (!o) {
    const e = document.createElement("div");
    e.className = "hint";
    e.textContent = st.scene.objects.length
      ? "выбери объект в иерархии"
      : "сцена пуста — нажми «+ Куб»";
    box.appendChild(e);
    return;
  }
  const head = document.createElement("div");
  head.className = "inspHead";
  head.textContent = (Studio.KINDS[o.kind] || {}).label || o.kind;
  box.appendChild(head);

  for (const f of FIELD_DEFS) {
    if (f.only && !f.only.includes(o.kind)) continue;
    const row = document.createElement("label");
    row.className = "irow";
    const nm = document.createElement("span");
    nm.textContent = f.label;
    const inp = document.createElement("input");
    inp.type = f.t === "color" ? "color" : "text";
    inp.value = String(o[f.k]);
    inp.disabled = st.playing;
    inp.oninput = () => {
      let v = inp.value;
      if (f.t === "num") {
        const n = parseFloat(v);
        if (!Number.isFinite(n)) return;
        v = n;
      }
      o[f.k] = v;
      if (f.k === "name" || f.k === "color") refreshHierarchy();
      markDirty();
    };
    row.appendChild(nm);
    row.appendChild(inp);
    box.appendChild(row);
  }

  const del = document.createElement("button");
  del.className = "btn danger";
  del.textContent = "Удалить объект";
del.disabled = st.playing;
    del.onclick = () => {
      /* Снимок берём ДО удаления: иначе откат вернул бы уже пустую сцену. */
      pushUndo();
      if (Studio.removeObject(st.scene, o.id)) {
        st.sel = null;
        refreshHierarchy(); refreshInspector(); markDirty();
        log("удалён объект " + o.name);
      } else {
        st.undo.pop(); syncUndoButtons();
      }
    };
  box.appendChild(del);
  box.appendChild(objectOps(o));
}

/* ======================== ДЕЙСТВИЯ НАД ОБЪЕКТОМ =========================
   Всё, что человек ждёт от редактора: копия, поставить в центр, опустить на
   землю, развернуть, поднять над нижним, выровнять по краю, случайный
   цвет. Раньше в инспекторе была только кнопка удаления — все остальные
   операции приходилось делать вручную по три поля, и большинство людей
   просто не знало, что это возможно. */
const RANDOM_COLORS = ["#ff7043", "#4fc3f7", "#81c784", "#ba68c8", "#ffd54f",
                       "#ff8a80", "#a1887f", "#90a4ae", "#f06292", "#64b5f6"];

function objectOps(o) {
  const wrap = document.createElement("div");
  wrap.className = "opGrid";
  const act = (label, title, fn) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.disabled = st.playing;
    b.onclick = () => {
      pushUndo();
      if (fn(o) !== false) {
        refreshHierarchy(); refreshInspector(); markDirty();
      } else {
        st.undo.pop(); syncUndoButtons();
      }
    };
    wrap.appendChild(b);
  };

  act("⧉ Копия", "Дублировать объект рядом", (t) => {
    const copy = JSON.parse(JSON.stringify(t));
    copy.id = "o" + Date.now().toString(36);
    copy.name = t.name + " копия";
    copy.x = t.x + 1;
    st.scene.objects.splice(st.scene.objects.indexOf(t) + 1, 0, copy);
    st.sel = copy.id;
    log("создана копия: " + copy.name);
  });

  act("⊙ В центр", "Поставить в центр сцены", (t) => {
    t.x = 0; t.z = 0;
    log(t.name + " в центре");
  });

  act("⇩ На землю", "Опустить на землю", (t) => {
    if (t.kind !== "sprite") t.y = (t.h || 2) / 2;
    else t.y = 0.5;
    log(t.name + " на земле");
  });

  act("⇧ Поднять", "Поднять на единицу", (t) => {
    t.y = Math.max(0.5, t.y + 1);
    log(t.name + " выше");
  });

  act("⇩ Опустить", "Опустить на единицу", (t) => {
    t.y = Math.max(0.5, t.y - 1);
    log(t.name + " ниже");
  });

  act("↻ Развернуть", "Повернуть на 90 градусов", (t) => {
    const w = t.w || 1, d = t.d || 1;
    t.w = d; t.d = w;
    log(t.name + " развёрнут");
  });

  act("✕× Крупнее", "Увеличить на четверть", (t) => {
    if (t.kind === "sprite") t.size = Math.min(30, t.size * 1.25);
    else { t.w = Math.min(30, t.w * 1.25); t.h = Math.min(30, t.h * 1.25); t.d = Math.min(30, t.d * 1.25); }
    log(t.name + " крупнее");
  });

  act("✕÷ Мельче", "Уменьшить на четверть", (t) => {
    if (t.kind === "sprite") t.size = Math.max(.2, t.size / 1.25);
    else { t.w = Math.max(.2, t.w / 1.25); t.h = Math.max(.2, t.h / 1.25); t.d = Math.max(.2, t.d / 1.25); }
    log(t.name + " мельче");
  });

  act("🎲 Цвет", "Случайный цвет", (t) => {
    t.color = RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
    log(t.name + " перекрашен");
  });

  act("⬆ Вперёд", "Переместить вперёд в списке", (t) => {
    const i = st.scene.objects.indexOf(t);
    if (i >= st.scene.objects.length - 1) return false;
    const arr = st.scene.objects;
    arr.splice(i, 1); arr.splice(i + 1, 0, t);
    log(t.name + " поднят в списке");
  });

  act("⬇ Назад", "Переместить назад в списке", (t) => {
    const i = st.scene.objects.indexOf(t);
    if (i <= 0) return false;
    const arr = st.scene.objects;
    arr.splice(i, 1); arr.splice(i - 1, 0, t);
    log(t.name + " опущен в списке");
  });

  return wrap;
}

/* ========================= ПАРАМЕТРЫ СЦЕНЫ ================================
   Земля, фон и анимация были в модели сцены с самого начала, но панели для
   них не существовало: настроить их было негде. Значит половина модели
   была недоступна человеку. Теперь всё это редактируется. */
function scenePanel() {
  const s = st.scene;
  const box = $("sceneBox");
  if (!box) return;
  box.textContent = "";

  const numRow = (label, val, onchange, min, max) => {
    const row = document.createElement("label");
    row.className = "irow";
    const nm = document.createElement("span");
    nm.textContent = label;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = String(val);
    inp.disabled = st.playing;
    inp.oninput = () => {
      const n = parseFloat(inp.value);
      if (!Number.isFinite(n)) return;
      pushUndo();
      onchange(Math.max(min === undefined ? -1e6 : min, Math.min(max === undefined ? 1e6 : max, n)));
      markDirty();
    };
    row.appendChild(nm); row.appendChild(inp);
    box.appendChild(row);
  };
  const colorRow = (label, val, onchange) => {
    const row = document.createElement("label");
    row.className = "irow";
    const nm = document.createElement("span");
    nm.textContent = label;
    const inp = document.createElement("input");
    inp.type = "color";
    inp.value = val;
    inp.disabled = st.playing;
    inp.oninput = () => { pushUndo(); onchange(inp.value); markDirty(); };
    row.appendChild(nm); row.appendChild(inp);
    box.appendChild(row);
  };

  colorRow("Небо", s.bg[0], (v) => { s.bg[0] = v; });
  colorRow("Горизонт", s.bg[1], (v) => { s.bg[1] = v; });
  colorRow("Земля", s.ground.color, (v) => { s.ground.color = v; });
  numRow("Размер земли", s.ground.w, (v) => { s.ground.w = v; s.ground.d = v; }, 4, 80);

  const chk = document.createElement("label");
  chk.className = "irow";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!s.animated;
  cb.disabled = st.playing;
  cb.onchange = () => { pushUndo(); s.animated = cb.checked; markDirty(); };
  const cl = document.createElement("span");
  cl.textContent = "Движение объектов";
  chk.appendChild(cb); chk.appendChild(cl);
  box.appendChild(chk);

  const cam = document.createElement("div");
  cam.className = "hint";
  cam.textContent = "Камера вьюпорта станет камерой игры при сохранении.";
  box.appendChild(cam);
}

/* =============================== ВВОД ==================================== */
function bindPointer() {
  let mode = null, px = 0, py = 0, dragObj = null, moved = false;

  cv.addEventListener("pointerdown", (e) => {
    /* Правая кнопка — осмотр. Так же, как в Unity: она никогда не
       передвигает объект, только поворачивает камеру. Без этого
       большую сцену не обойти — объекты сзади не выбрать. */
    if (e.button === 2) {
      st.looking = true;
      cv.style.cursor = "move";
      e.preventDefault();
    }
    cv.setPointerCapture(e.pointerId);
    px = e.clientX; py = e.clientY;
    moved = false;
    if (st.looking) { mode = "look"; return; }
    const hit = pick(e);
    if (hit && !st.playing) {
      dragObj = hit;
      st.sel = hit.id;
      /* Снимок «до» — один на всё перетаскивание, иначе откат шагал бы
         вместе с каждым кадром мыши и undo был бы бесполезен. */
      pushUndo();
      mode = "move";
      refreshHierarchy(); refreshInspector();
    } else {
      mode = "orbit";
    }
  });

  cv.addEventListener("pointermove", (e) => {
    const dx = e.clientX - px, dy = e.clientY - py;
    px = e.clientX; py = e.clientY;
    if (mode === "orbit" || mode === "look") {
      st.yaw -= dx * 0.008;
      st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch + dy * 0.006));
      return;
    }
    if (!dragObj) {
      /* Нет перетаскивания — просто подсветка объекта под курсором. */
      const h = pick(e);
      const id = h ? h.id : null;
      if (id !== st.hover) { st.hover = id; refreshHierarchy(); }
      return;
    }
    if (dx || dy) moved = true;
    const lift = e.shiftKey;
    if (lift) {
      /* Shift тянет по высоте: вверх по экрану — выше по Y. */
      dragObj.y = Math.max(0, snap(dragObj.y - dy * 0.05));
    } else {
      dragObj.x = snap(dragObj.x + dx * 0.055);
      dragObj.z = snap(dragObj.z - dy * 0.055);
    }
    if (e.altKey) scaleObject(dragObj, dy * 0.01);
    refreshInspector();
    markDirty();
  });

  const stop = (e) => {
    if (mode === "move") {
      if (moved) log("объект перемещён");
      else st.undo.pop();   /* клик без перетаскивания — не правка */
      syncUndoButtons();
    }
    mode = null; dragObj = null;
    if (st.looking) { st.looking = false; cv.style.cursor = "grab"; }
    try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  cv.addEventListener("pointerup", stop);
  cv.addEventListener("pointercancel", stop);

  cv.addEventListener("pointerleave", () => {
    if (st.hover) { st.hover = null; refreshHierarchy(); }
  });
  /* Правая кнопка не должна вызывать своё контекстное меню поверх
     осмотра — это самая частая жалоба при таком управлении. */
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    st.dist = Math.max(2, Math.min(160, st.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
  }, { passive: false });
}

/* Масштаб объекта под курсором. Alt вверх — крупнее. Метка растёт
   размером, куб и пирамида — по трём габаритам сразу, иначе объект
   вытягивался бы в одну сторону и переставал быть похожим на себя. */
function scaleObject(o, k) {
  if (o.kind === "sprite") {
    o.size = Math.max(0.2, snap(o.size + k));
    return;
  }
  o.w = Math.max(0.2, snap(o.w + k));
  o.h = Math.max(0.2, snap(o.h + k));
  o.d = Math.max(0.2, snap(o.d + k));
}

/* Выбор объекта: проецируем центры на экран и берём ближайший. Точный
   рэйкаст здесь не нужен — сцена небольшая, а приближение достаточно
   для редактора и заметно дешевле. */
function pick(e) {
  const r = cv.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (cv._lw / r.width);
  const my = (e.clientY - r.top) * (cv._lh / r.height);
  const cam = camObj();
  let best = null, bestD = 46;
  for (const o of st.scene.objects) {
    const y = o.y - (o.kind === "sprite" ? 0 : o.h / 2);
    const p = E3.proj(E3.view([o.x, y, o.z], cam), 430, cv._lw, cv._lh);
    if (p[2] <= 0.12) continue;
    const d = Math.hypot(p[0] - mx, p[1] - my);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/* ============================ РЕЖИМ И КНОПКИ ============================== */
function setPlaying(on) {
  if (on && st.dirty) {
    log("⚠ есть несохранённые изменения — они останутся, но Play покажет старую сцену", "warn");
  }
  st.playing = on;
  $("btnPlay").textContent = on ? "■ Стоп" : "▶ Играть";
  $("btnPlay").classList.toggle("stop", on);
  // В Play сцену не трогают. Раньше здесь стоял обращающийся к barAdd
  // элемент, которого в разметке нет: исключение рвалось раньше
  // refreshInspector(), и поля оставались разблокированными.
  for (const id of ["btnBox", "btnPyr", "btnSprite"]) {
    $(id).disabled = on;
  }
  refreshInspector();
  log(on ? "запуск: движение объектов" : "остановлено");
}

function addObject(kind) {
  if (st.playing) return;
  pushUndo();
  const o = Studio.addObject(st.scene, kind);
  st.sel = o.id;
  refreshHierarchy(); refreshInspector(); markDirty();
  log("добавлен " + o.name);
}

function publish() {
  /* Камеру вьюпорта записываем в сцену перед публикацией: иначе игра
     запускалась бы с камерой по умолчанию, а человек собирал с другой. */
  const c = camObj();
  st.scene.camera.x = round2(c.x);
  st.scene.camera.y = round2(c.y);
  st.scene.camera.z = round2(c.z);
  st.scene.camera.yaw = round2(st.yaw);
  st.scene.camera.pitch = round2(st.pitch);
  const r = Studio.publish(st.scene);
  if (!r.ok) { log("❌ " + r.error, "err"); return; }
  log("✅ опубликовано в каталог. Открой Aeris → «Мои игры»", "ok");
  Studio.save(st.scene);
  st.dirty = false;
  $("status").textContent = "опубликовано " + new Date().toLocaleTimeString();
  /* Окно кода теперь правится руками, поэтому публикация не должна
     затирать написанное — только подсказать, что код изменился. */
  if (window.StudioCode && StudioCode.setValue) {
    StudioCode.setValue(r.src);
    if (!$("codeWrap").hidden) StudioCode.open();
  }
}

function save() {
  /* Камера — часть сцены: её положение должно уезжать вместе с ней,
     иначе после перезагрузки вьюпорт смотрел бы в другую точку. */
  const c = camObj();
  st.scene.camera.x = round2(c.x);
  st.scene.camera.y = round2(c.y);
  st.scene.camera.z = round2(c.z);
  st.scene.camera.yaw = round2(st.yaw);
  st.scene.camera.pitch = round2(st.pitch);
  if (Studio.save(st.scene)) {
    st.dirty = false;
    $("status").textContent = "сохранено " + new Date().toLocaleTimeString();
    log("сцена сохранена", "ok");
  } else {
    log("❌ не удалось сохранить", "err");
  }
}

function frame(now) {
  const dt = st.last ? Math.min(.05, (now - st.last) / 1000) : 0;
  st.last = now;
  if (st.playing) st.ang += dt;
  /* Полёт идёт каждый кадр: клавиши держат камеру, а не одно нажатие. */
  if (flyStep(dt)) cv.style.cursor = "crosshair";
  else if (st.looking) cv.style.cursor = "move";
  render();
  requestAnimationFrame(frame);
}

/* ================================ СТАРТ ================================== */
/* Резкость на HiDPI. Раньше холст ставился в размер прямоугольника в
   CSS-пикселях: на Retina и в Windows 125% линии и подписи мылись.
   Теперь бэксто�� рисуется в devicePixelRatio раз крупнее, а _lw/_lh
   остаются логическими координатами, поэтому вся геометрия движка
   продолжает считаться в привычных единицах. Потолок нужен: на 4K при
   dpr=2 холст стал бы 8K, и браузер перестал бы его ускорять. */
const MAX_DPR = 2;
function fit() {
  const r = $("viewport").getBoundingClientRect();
  const dpr = Math.min(MAX_DPR, (typeof devicePixelRatio !== "number" ? 1 : devicePixelRatio) || 1);
  cv._lw = Math.max(320, Math.round(r.width));
  cv._lh = Math.max(240, Math.round(r.height));
  cv.width = Math.round(cv._lw * dpr);
  cv.height = Math.round(cv._lh * dpr);
  cv._dpr = dpr;
}

/* Полное управление с клавиатуры. Раньше обработчика клавиш не было
   вовсе: выбрать объект, удалить, отменить и сохранить можно было только
   мышью, а колесом и стрелками управлять камерой — нельзя было никак. */
/* Клавиши полёта. Пишем коды клавиш, а не буквы: на русской раскладке
   e.code остаётся прежним, и WASD работает одинаково в любой раскладке. */
const FLY_KEYS = { KeyW: 1, KeyS: 1, KeyA: 1, KeyD: 1, KeyQ: 1, KeyE: 1 };
function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    /* Полёт камеры. Клавиши запоминаем и читаем каждый кадр: так движение
       не зависит от скорости повтора клавиатуры. Alt исключён — он у нас
       занят размером объекта, а русская «ф» на той же раскладке не мешает. */
    if (!mod && !e.altKey && FLY_KEYS[e.code] !== undefined) {
      st.keys[e.code] = true;
      if (e.code !== "KeyE" && e.code !== "KeyQ") e.preventDefault();
      return;
    }

    if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && k === "y") { e.preventDefault(); redo(); return; }
    if (mod && k === "s") { e.preventDefault(); save(); return; }

    switch (k) {
      case "delete":
      case "backspace": {
        e.preventDefault();
        const o = Studio.findObject(st.scene, st.sel);
        if (o && !st.playing) {
          pushUndo();
          Studio.removeObject(st.scene, o.id);
          st.sel = null;
          refreshHierarchy(); refreshInspector(); markDirty();
          log("удалён объект " + o.name);
        }
        return;
      }
      case "escape":
        if (st.playing) setPlaying(false);
        return;
      case " ":
        e.preventDefault();
        setPlaying(!st.playing);
        return;
      case "g":
        st.snap = !st.snap;
        log(st.snap ? "сетка включена" : "сетка выключена");
        return;
      case "arrowup": case "arrowdown": case "arrowleft": case "arrowright": {
        e.preventDefault();
        if (e.shiftKey) {
          st.pitch = Math.max(-0.2, Math.min(1.3, st.pitch + (k === "arrowup" ? 0.06 : k === "arrowdown" ? -0.06 : 0)));
          st.orbit += (k === "arrowleft" ? 0.08 : k === "arrowright" ? -0.08 : 0);
        } else {
          const o = Studio.findObject(st.scene, st.sel);
          if (o && !st.playing) {
            if (!st._kbMoved) { pushUndo(); st._kbMoved = true; }
            if (k === "arrowup") o.z = snap(o.z - 0.25);
            if (k === "arrowdown") o.z = snap(o.z + 0.25);
            if (k === "arrowleft") o.x = snap(o.x - 0.25);
            if (k === "arrowright") o.x = snap(o.x + 0.25);
            refreshInspector(); markDirty();
          }
        }
        return;
      }
      case "+": case "=":
        st.dist = Math.max(2, st.dist - 0.9); e.preventDefault(); return;
      case "-": case "_":
        st.dist = Math.min(160, st.dist + 0.9); e.preventDefault(); return;
    }
  });
  /* Снимок для серии нажатий стрел ставим один раз: он сбрасывается
     при смене выделения, чтобы откат не съедал всю серию шагом. */
  document.addEventListener("keyup", (e) => {
    if (FLY_KEYS[e.code] !== undefined) st.keys[e.code] = false;
    const k = e.key.toLowerCase();
    if (k === "arrowup" || k === "arrowdown" || k === "arrowleft" || k === "arrowright") st._kbMoved = false;
  });
  /* Потеря фокуса (переключили вкладку) оставила бы камеру вечно летящей:
     браузер не присылает keyup. Обнуляем — иначе сцена уезжает сама. */
  window.addEventListener("blur", () => { st.keys = Object.create(null); st.looking = false; });
}

function start() {
  cv = $("scene");
  ctx = cv.getContext("2d");
  st.scene = Studio.load();
  fit();
  window.addEventListener("resize", fit);

  $("titleIn").value = st.scene.title;
  $("titleIn").oninput = () => { st.scene.title = $("titleIn").value; markDirty(); };

  $("btnBox").onclick = () => addObject("box");
  $("btnPyr").onclick = () => addObject("pyramid");
  $("btnSprite").onclick = () => addObject("sprite");
  $("btnPlay").onclick = () => setPlaying(!st.playing);
  $("btnCamReset").onclick = () => resetCamera();
  $("btnCopy").onclick = () => copyScene();
  $("btnPaste").onclick = () => pasteScene();
  $("btnSnap").onclick = () => {
    st.snap = !st.snap;
    $("btnSnap").classList.toggle("on", st.snap);
    log(st.snap ? "сетка включена — шаг 0.25" : "сетка выключена");
  };
  $("btnSnap").classList.toggle("on", st.snap);
  $("btnSave").onclick = save;

/* ============ БИБЛИОТЕКА СЦЕН И ФАЙЛЫ ============
 *
 * Кнопки появились в тот же момент, что и функции в scene.js. Без
 * этого обработчика они были бы просто картинками.
 */
function sceneName() {
  const el = $("titleIn");
  return (el && el.value || "").trim() || "Без названия";
}

function showSceneList() {
  const S = window.Studio;
  if (!S || !S.libList) { toast("Библиотека недоступна"); return; }
  const list = S.libList();
  document.querySelectorAll(".sceneWin").forEach(n => n.remove());
  const old = $("sceneWin");
  if (old) old.remove();

  const win = document.createElement("div");
  win.className = "sceneWin";
  win.id = "sceneWin";
  const head = document.createElement("div");
  head.className = "sceneWinHead";
  head.innerHTML = "<b>Мои сцены</b><span>" +
    (list.length ? list.length + " шт." : "пока пусто") +
    "</span><button class=\"btn\" style=\"margin:0;padding:2px 9px\">✕</button>";
  head.querySelector("button").onclick = () => win.remove();
  win.appendChild(head);

  const body = document.createElement("div");
  body.className = "sceneWinBody";
  if (!list.length) {
    const hint = document.createElement("div");
    hint.className = "sceneEmpty";
    hint.textContent = "Сцена ещё не сохранена. Нажми «Сохранить» — " +
      "и она появится здесь.";
    body.appendChild(hint);
  } else {
    list.forEach(s => {
      const row = document.createElement("div");
      row.className = "sceneRow";
      const when = new Date(s.when || 0);
      const d = isNaN(when.getTime()) ? "" :
        when.toLocaleDateString("ru-RU") + " " +
        String(when.getHours()).padStart(2, "0") + ":" +
        String(when.getMinutes()).padStart(2, "0");
      const nm = document.createElement("span");
      nm.className = "sceneName";
      nm.textContent = s.name;
      const meta = document.createElement("small");
      meta.textContent = (d ? d + " · " : "") + s.lines + " строк";
      const open = document.createElement("button");
      open.className = "btn";
      open.textContent = "Открыть";
      open.onclick = () => {
        const rec = window.Studio.libOpen(s.name);
        if (!rec) { toast("Сцена не найдена"); return; }
        loadSceneFromCode(rec.code, s.name);
        win.remove();
        toast("Открыто: " + s.name);
      };
      const del = document.createElement("button");
      del.className = "btn";
      del.textContent = "Удалить";
      del.onclick = () => {
        if (!confirm("Удалить сцену «" + s.name + "»?")) return;
        window.Studio.libDelete(s.name);
        win.remove();
        showSceneList();
      };
      row.appendChild(nm);
      row.appendChild(meta);
      row.appendChild(open);
      row.appendChild(del);
      body.appendChild(row);
    });
  }
  win.appendChild(body);
  document.body.appendChild(win);
}

/* Кладёт код в окно редактора и открывает его.
 *
 * Файл со сценой — это код на BloomScript, поэтому его место в окне
 * кода, а не в иерархии сцены. Обратного разбора кода в объекты сцены
 * здесь нет: сцена пишется кодом, значит и возвращается кодом. Из
 * окна кода его можно запустить одной кнопкой.
 */
function loadSceneFromCode(code, name) {
  const box = $("codeIn");
  if (!box) { toast("Окно кода недоступно"); return; }
  box.value = String(code || "");
  const wrap = $("codeWrap");
  if (wrap) wrap.hidden = false;
  const msg = $("codeMsg");
  if (msg) msg.textContent = name ? ("открыто: " + name) : "открыто из файла";
  const el = $("titleIn");
  if (el && name) el.value = name;
  toast("Код загружен. Нажми «Запустить», чтобы увидеть сцену");
}

$("btnLibrary").onclick = showSceneList;
$("btnFileOut").onclick = function () {
  const r = window.Studio.sceneDownload(st.scene, sceneName());
  toast(r.ok ? "Файл сохранён" : "Не удалось: " + r.error);
};
$("btnFileIn").onclick = function () {
  window.Studio.scenePickFile().then(function (r) {
    if (!r.ok) { toast(r.error); return; }
    const p = window.Studio.sceneFromText(r.text);
    loadSceneFromCode(p.code, p.name);
  });
};
  $("btnPublish").onclick = publish;
  $("btnUndo").onclick = () => undo();
  $("btnRedo").onclick = () => redo();
  syncUndoButtons();
  /* Кнопку «Код» обслуживает src/studio/codewin.js: там же окно кода,
     подсказки и переход в редактор. Здесь только отдаём ему сцену. */
  setupClear();
  /* Подтверждение без confirm(). Модальное окно здесь вредно по двум
   причинам: оно блокирует поток (в автоматической проверке страница
   виснет навсегда, пока кто-то не нажмёт кнопку) и выглядит чужеродно
   в редакторе. Поэтому кнопка спрашивает дважды. */
let clearArmed = 0;
function setupClear() {
  const b = $("btnClear");
  const reset = () => { b.textContent = "Очистить"; b.classList.remove("danger"); clearArmed = 0; };
  b.onclick = () => {
    if (st.playing) return;
    if (Date.now() - clearArmed > 4000) {
      clearArmed = Date.now();
      b.textContent = "Точно очистить?";
      b.classList.add("danger");
      log("нажми ещё раз, чтобы очистить сцену", "warn");
      setTimeout(reset, 4000);
      return;
    }
    reset();
    st.scene.objects.length = 0;
    st.sel = null;
    refreshHierarchy(); refreshInspector(); markDirty();
    log("сцена очищена");
  };
}

  bindPointer();
  bindKeyboard();
  refreshHierarchy();
  refreshInspector();
  scenePanel();
  $("status").textContent = "готово";
  log("Studio открыта. Объекты: " + st.scene.objects.length);
  log("Камера: WASD — лететь, ПКМ — осмотреть, колесо — приблизить");
  requestAnimationFrame(frame);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

/* Модулю окна кода нужна живая сцена, а не копия из хранилища: человек
   может править сцену и не нажимать «Сохранить». Отдаём ссылку на неё. */
window.StudioEditor = {
  get scene() { return st.scene; },
  toCode: function () { return Studio.toBloomScript(st.scene); }
};

})();