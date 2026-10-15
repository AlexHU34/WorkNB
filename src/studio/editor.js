/* NEBULA Studio — интерфейс редактора.
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
const st = {
  scene: null,
  sel: null,
  orbit: 0.6,
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

function camObj() {
  return {
    x: Math.sin(st.orbit) * st.dist,
    y: 4.5,
    z: -Math.cos(st.orbit) * st.dist,
    yaw: st.orbit,
    pitch: st.pitch,
  };
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
}

/* =============================== ВВОД ==================================== */
function bindPointer() {
  let mode = null, px = 0, py = 0, dragObj = null, moved = false;

  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    px = e.clientX; py = e.clientY;
    moved = false;
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
    if (mode === "orbit") {
      st.orbit -= dx * 0.008;
      st.pitch = Math.max(-0.2, Math.min(1.3, st.pitch + dy * 0.006));
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
    try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  cv.addEventListener("pointerup", stop);
  cv.addEventListener("pointercancel", stop);

  cv.addEventListener("pointerleave", () => {
    if (st.hover) { st.hover = null; refreshHierarchy(); }
  });

  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    st.dist = Math.max(4, Math.min(28, st.dist + (e.deltaY > 0 ? 0.7 : -0.7)));
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
  const r = Studio.publish(st.scene);
  if (!r.ok) { log("❌ " + r.error, "err"); return; }
  log("✅ опубликовано в каталог. Открой NebulaBloom → «Мои игры»", "ok");
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
function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

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
        st.dist = Math.max(4, st.dist - 0.7); e.preventDefault(); return;
      case "-": case "_":
        st.dist = Math.min(28, st.dist + 0.7); e.preventDefault(); return;
    }
  });
  /* Снимок для серии нажатий стрел ставим один раз: он сбрасывается
     при смене выделения, чтобы откат не съедал всю серию шагом. */
  document.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowup" || k === "arrowdown" || k === "arrowleft" || k === "arrowright") st._kbMoved = false;
  });
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
  $("btnSave").onclick = save;
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
  $("status").textContent = "готово";
  log("Studio открыта. Объекты: " + st.scene.objects.length);
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