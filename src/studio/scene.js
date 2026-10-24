/* AERIS Studio — модель сцены и компиляция в BloomScript.
 *
 * Отделена от интерфейса намеренно: здесь нет DOM и нет localStorage,
 * поэтому её можно проверять в Node как обычные данные (см. studio-gate).
 *
 * Главная идея, взятая у Unity и переделанная под нас: сцена — это ДАННЫЕ,
 * а не код. Их можно сохранить, откатить и показать в инспекторе.
 * Отличие от Unity в том, что нам не нужен отдельный «шаг сборки» с
 * настройками: Studio компилирует сцену прямо в код BloomScript, который
 * каталог уже умеет запускать через src/lang/play.js. Поэтому публикация —
 * это одна кнопка, а не Build Settings.
 *
 * Вторая идея Unity, которую мы сознательно НЕ берём: префабы. У нас
 * объекты плоские и дешёвые, а лишняя абстракция только мешает.
 */
(function () {

const SCENE_VERSION = 1;
const STORAGE_KEY = "bb2_studio_scene.v1";

/* Виды объектов. keys — что уходит в сгенерированный вызов. */
const KINDS = {
  box:     { label: "Куб",     call: "box",     args: ["w", "h", "d"] },
  pyramid: { label: "Пирамида", call: "pyramid", args: ["w", "h", "d"] },
  sprite:  { label: "Метка",   call: "sprite",  args: ["size"] },
};

let seq = 1;
function nextId() {
  return "o" + (seq++).toString(36) + Date.now().toString(36).slice(-3);
}

/* Новая пустая сцена. Не одна функция create(), а конкретные значения:
   редактор должен открываться на чем-то, что сразу видно. */
function blank() {
  return {
    version: SCENE_VERSION,
    title: "Моя сцена",
    bg: ["#111a2b", "#1d2b45"],
    ground: { w: 28, d: 28, color: "#1d3a2a" },
    camera: { x: 0, y: 6, z: -10, yaw: 0, pitch: 0.42 },
    animated: true,
    objects: [],
  };
}

/* Разбор приходит из хранилища и может быть чем угодно: правленым,
   со старой версией, вовсе без version. Проверяем всё и чиним молча —
   иначе один битый байт обнуляет работу человека над сценой. */
function normalize(raw) {
  const s = blank();
  if (!raw || typeof raw !== "object") return s;
  if (typeof raw.title === "string" && raw.title) s.title = raw.title.slice(0, 60);
  if (Array.isArray(raw.bg) && raw.bg.length === 2) s.bg = [String(raw.bg[0]), String(raw.bg[1])];
  if (raw.ground && typeof raw.ground === "object") {
    s.ground = {
      w: num(raw.ground.w, 28), d: num(raw.ground.d, 28),
      color: str(raw.ground.color, "#1d3a2a"),
    };
  }
  if (raw.camera && typeof raw.camera === "object") {
    s.camera = {
      x: num(raw.camera.x, 0), y: num(raw.camera.y, 6), z: num(raw.camera.z, -10),
      yaw: num(raw.camera.yaw, 0), pitch: num(raw.camera.pitch, 0.42),
    };
  }
  s.animated = raw.animated !== false;
  const seen = Object.create(null);
  if (Array.isArray(raw.objects)) {
    for (const o of raw.objects) {
      if (!o || typeof o !== "object") continue;
      const kind = KINDS[o.kind] ? o.kind : "box";
      let id = String(o.id || "");
      if (!id || seen[id]) id = nextId();
      seen[id] = 1;
      s.objects.push({
        id: id,
        name: str(o.name, KINDS[kind].label).slice(0, 40),
        kind: kind,
        x: num(o.x, 0), y: num(o.y, 1), z: num(o.z, 0),
        w: num(o.w, 2), h: num(o.h, 2), d: num(o.d, 2),
        size: num(o.size, 2),
        color: str(o.color, "#ff7043"),
        phase: num(o.phase, 0),
      });
    }
  }
  return s;
}

function num(v, fallback) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v, fallback) {
  return typeof v === "string" && v ? v.slice(0, 24) : fallback;
}

/* Добавление объекта с разбросом по оси, чтобы новый куб не лез в
   предыдущий — иначе в иерархии сразу видно, что сцена пустая. */
function addObject(scene, kind) {
  const k = KINDS[kind] ? kind : "box";
  const n = scene.objects.length;
  const o = {
    id: nextId(),
    name: KINDS[k].label + " " + (n + 1),
    kind: k,
    x: Math.round((n % 5) * 2.6 * 100) / 100,
    y: k === "sprite" ? 2.5 : 1,
    z: 0,
    w: 2, h: 2, d: 2, size: 2,
    color: ["#ff7043", "#4fc3f7", "#81c784", "#ba68c8", "#ffd54f"][n % 5],
    phase: Math.round(n * 1.1 * 100) / 100,
  };
  scene.objects.push(o);
  return o;
}

function removeObject(scene, id) {
  const i = scene.objects.findIndex(o => o.id === id);
  if (i < 0) return false;
  scene.objects.splice(i, 1);
  return true;
}
function findObject(scene, id) {
  return scene.objects.find(o => o.id === id) || null;
}

/* ========================= КОМПИЛЯЦИЯ В BLOOMSCRIPT =========================
 * Главная связка всего проекта: то, что человек собрал мышью, становится
 * кодом, который каталог уже умеет запускать. Никакого отдельного
 * «формата игры» — только язык, который уже проверен гейтами.
 */
function toBloomScript(scene) {
  const L = [];
  const q = (s) => '"' + String(s).replace(/"/g, "'") + '"';

  L.push("// " + (scene.title || "Моя сцена"));
  L.push("// Сделано в AERIS Studio");
  L.push("");

  const anySprite = scene.objects.some(o => o.kind === "sprite");
  if (scene.animated && scene.objects.length) L.push("let ang = 0");

  L.push("fn setup():");
  L.push("    lit(0.16, 0.14)");
  L.push("    ground(" + n(scene.ground.w) + ", " + n(scene.ground.d) + ", " + q(scene.ground.color) + ")");
  const c = scene.camera;
  L.push("    camera(" + n(c.x) + ", " + n(c.y) + ", " + n(c.z) + ", " + n(c.yaw) + ", " + n(c.pitch) + ")");
  L.push("");

  if (scene.animated && scene.objects.length) {
    L.push("fn update(dt):");
    L.push("    ang = ang + dt");
    L.push("");
  }

  L.push("fn draw():");
  if (!scene.objects.length) {
    L.push("    // сцена пуста — добавь объекты в Studio");
    L.push("    text(10, 20, \"пусто\", 18, \"#9fb3c8\")");
  } else {
    for (const o of scene.objects) {
      if (o.kind === "sprite") {
        const bob = scene.animated ? " + 0.4 * sin(ang + " + n(o.phase) + ")" : "";
        L.push("    sprite(" + n(o.x) + ", " + exprY(o, bob) + ", " + n(o.z) +
               ", " + n(o.size) + ", " + q(o.name) + ", " + q(o.color) + ")");
      } else {
        const bob = scene.animated ? " + 0.25 * sin(ang + " + n(o.phase) + ")" : "";
        L.push("    " + KINDS[o.kind].call + "(" + n(o.x) + ", " + exprY(o, bob) + ", " +
               n(o.z) + ", " + n(o.w) + ", " + n(o.h) + ", " + n(o.d) + ", " + q(o.color) + ")");
      }
    }
    L.push("    text(10, 20, \"очки: \" + score(), 18, \"#ffffff\")");
  }
  return L.join("\n") + "\n";
}

/* box/pyramid ждут центр объёма, поэтому y — это центр, и половина высоты
   уходит вниз. Иначе куб «висит» над землёй на половину своего размера. */
function exprY(o, bob) {
  const half = o.kind === "sprite" ? 0 : (o.h || 2) / 2;
  return "(" + n(o.y) + (half ? " - " + n(half) : "") + (bob || "") + ")";
}

function n(v) {
  const r = Math.round((typeof v === "number" ? v : parseFloat(v) || 0) * 1000) / 1000;
  return String(r);
}

/* ================================ ХРАНИЛИЩЕ ================================ */
function save(scene) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
    return true;
  } catch (e) {
    return false;
  }
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch (e) {
    return blank();
  }
}

/* Публикация в общий каталог. Ключ и формат — те же, что у моста
   src/lang/play.js, поэтому игра сразу появляется в лобби рядом со
   встроенными и запускается оттуда. */
function publish(scene) {
  const src = toBloomScript(scene);
  const list = readGames();
  const id = "studio-" + Date.now().toString(36);
  list.push({ id: id, src: src });
  try {
    localStorage.setItem("bb2_ugames.v1", JSON.stringify(list));
  } catch (e) {
    return { ok: false, error: "не удалось записать в хранилище" };
  }
  return { ok: true, id: id, src: src };
}
function readGames() {
  try {
    const raw = localStorage.getItem("bb2_ugames.v1");
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/* =============== БИБЛИОТЕКА СЦЕН ===============
 *
 * Раньше сцена была одна и переживалась только сама с собой:
 * закрыл вкладку — и всё, что не успел сохранить, пропало. Буфер
 * обмена тут не спасает: он не переживает перезагрузку страницы и
 * не переносится на другой компьютер.
 *
 * Теперь сцену можно назвать, положить в список, открыть позже и
 * удалить. Список хранится отдельным ключом, поэтому прежние
 * сохранения остаются нетронутыми.
 */
const LIB_KEY = "bb2_scenes.v1";

function libRead() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function libWrite(list) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

/* Кладёт сцену в список. Одна и та же сцена не дублируется: если
   с таким именем уже есть, она обновляется, иначе список забился бы
   копиями одного и того же. */
function libSave(scene, name) {
  const title = String(name || scene.name || "Без названия").trim()
    .slice(0, 60) || "Без названия";
  const list = libRead();
  const code = toBloomScript(scene);
  const at = list.findIndex(s => s.name === title);
  const rec = { name: title, code: code, when: Date.now() };
  if (at >= 0) list[at] = rec;
  else list.unshift(rec);
  if (list.length > 60) list.length = 60;
  return libWrite(list) ? { ok: true, name: title, count: list.length }
                        : { ok: false, error: "в хранилище нет места" };
}

function libOpen(name) {
  const rec = libRead().find(s => s.name === name);
  return rec ? rec : null;
}

function libDelete(name) {
  const list = libRead().filter(s => s.name !== name);
  return libWrite(list);
}

function libList() {
  return libRead().map(s => ({
    name: s.name,
    when: s.when,
    lines: String(s.code || "").split("\n").length
  }));
}

/* ---------- ФАЙЛЫ ----------
 *
 * Сцена выгружается обычным текстом: код на языке BloomScript. Файл
 * можно открыть в блокноте, переслать другу и положить в папку —
 * ничего особенного, обычный текст.
 *
 * Почему не .json, как в хранилище: в файле должно быть видно глазами.
 * Сцена в коде читается, её можно поправить вручную.
 */
function sceneToText(scene, name) {
  const title = String(name || scene.name || "Моя сцена");
  return ["// " + title,
          "// Сцена из AERIS Studio. Открой файл в редакторе AERIS,",
          "// чтобы изменить её, или перенеси эти строки в редактор кода.",
          ""].concat(String(toBloomScript(scene)).split("\n")).join("\n");
}

function sceneDownload(scene, name) {
  try {
    const text = sceneToText(scene, name);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = String(name || "сцена").replace(/[^\wа-яА-ЯёЁ -]+/g, "")
      .trim().slice(0, 40) || "сцена";
    a.href = url;
    a.download = safe + ".bs";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function scenePickFile() {
  return new Promise(function (resolve) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".bs,.txt,text/plain";
    inp.onchange = function () {
      const f = inp.files && inp.files[0];
      if (!f) { resolve({ ok: false, error: "файл не выбран" }); return; }
      const fr = new FileReader();
      fr.onload = function () { resolve({ ok: true, text: String(fr.result || "") }); };
      fr.onerror = function () { resolve({ ok: false, error: "файл не прочитан" }); };
      fr.readAsText(f, "utf-8");
    };
    inp.click();
  });
}

/* Из текста вытаскиваем код сцены: у файла сверху может быть
   комментарий-заголовок, а сам код начинается с fn. */
function sceneFromText(text) {
  const lines = String(text || "").split("\n");
  const at = lines.findIndex(l => /^\s*fn\b/.test(l));
  const code = (at >= 0 ? lines.slice(at) : lines).join("\n");
  const head = lines.find(l => /^\s*\/\/\s*(.+)$/.test(l));
  return {
    code: code,
    name: head ? head.replace(/^\s*\/\/\s*/, "").trim().slice(0, 60)
               : "Загруженная сцена"
  };
}

/* ---------- ИГРА ОДНОЙ СТРАНИЦЕЙ ----------
 *
 * Сцену в файл можно отдать текстом — но друг без AERIS просто
 * откроет блокнот. Здесь же собирается страница-пускашка: внутри
 * одного файла вшиты движок, среда и код игры, и такой файл
 * запускается двойным щелчком без сети и без настройки.
 *
 * Модули движка берём двумя способами, по очереди:
 *   1) если страница уже собрана в один файл (после сборки код
 *      движка лежит в самих скриптах страницы), находим блоки по
 *      первым строчкам: имена E3, E3GL, E3Step, LangError,
 *      createRuntime живут в общем охвате страницы, и ужатие их
 *      не трогает, поэтому приметы надёжны;
 *   2) если страница живёт во многих файлах — читаем соседей
 *      обычным запросом (работает по сети; с диска так нельзя).
 */
const RUNNER_FILES = [
  { name: "e3.js",      path: "src/engine/e3.js",      want: /\b(const|let|var)\s+E3\b\s*=/ },
  /* У e3gl две приметы: в исходнике это «const E3GL =», а в ужатой
     странице локальное имя сжимается, и наружу остаётся
     «window.E3GL = ». Глобальные имена ужатие не трогает, поэтому
     приметы надёжны. */
  { name: "e3gl.js",    path: "src/engine/e3gl.js",
    want: /(\b(const|let|var)\s+E3GL\b\s*=|window\.E3GL\s*=)/ },
  { name: "time.js",    path: "src/engine/time.js",    want: /\bE3Step\b/ },
  { name: "core.js",    path: "src/lang/core.js",      want: /\bclass\s+LangError\b/ },
  { name: "runtime.js", path: "src/lang/runtime.js",   want: /\bfunction\s+createRuntime\b/ }
];

function runnerPickModules() {
  const inline = [];
  const all = document.scripts || [];
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    if (s.src) continue;               /* внешние — не они */
    const code = String(s.textContent || "");
    if (code.length >= 200) inline.push(code); /* мелкие заглушки — не они */
  }
  const found = [], missing = [];
  for (let n = 0; n < RUNNER_FILES.length; n++) {
    const f = RUNNER_FILES[n];
    let got = null;
    for (let i = 0; i < inline.length && !got; i++) {
      if (f.want.test(inline[i])) got = inline[i];
    }
    if (!got) {
      /* Многофайловая страница: тянем модуль соседним файлом.
         С диска (file:) такой запрос не пройдёт — это честно
         скажет проверка: приметы в ответе должны найтись. */
      try {
        const x = new XMLHttpRequest();
        x.open("GET", f.path, false);
        x.send(null);
        if (x.responseText) got = String(x.responseText);
      } catch (e) { /* диску это не положено */ }
    }
    if (got && f.want.test(got)) found.push({ name: f.name, code: got });
    else missing.push(f.name);
  }
  return { found: found, missing: missing };
}

function runnerHtml(scene, name) {
  const title = String(name || scene.name || "Своя игра")
    .replace(/[\r\n<>&]+/g, " ").trim().slice(0, 80) || "Своя игра";
  const parts = runnerPickModules();
  if (parts.missing.length) {
    return { ok: false, error: "не нашёлся движок: " + parts.missing.join(", ") };
  }
  /* Работающий код игры: полный текст с заголовком-комментарием,
     поэтому файл-пускашка и лобби приложения зовут игру одним
     и тем же именем. */
  const src = sceneToText(scene, name);
  /* Скелет страницы собирается из честных строк, а переводы строк
     берём из рабочей функции, а не из литералов: ужатие сворачивает
     склейки «текст + перевод строки» в шаблон и тащит физические
     переводы исходника прямо в значение — от этого страница студии
     переставала открываться. Здесь для него нечего сворачивать.
     Скобки-закрывашки тоже собраны в работе: ужатие ищет пары
     «стиль открыт — стиль закрыт» по всему тексту страницы, не
     различая настоящую разметку и наши рабочие строки. */
  const NL = function () { return String.fromCharCode(10); };
  const SRC_CLOSE = String.fromCharCode(60) + "/script>";
  const blocks = parts.found.map(function (b) {
    const code = String(b.code).replace(/<\/script/gi, "<\\/script");
    return "<script>" + code + SRC_CLOSE;
  }).join(NL());
  const payload = JSON.stringify(src).replace(/<\//g, "<\\/");
  const boot = [
    "<script>",
    "(function(){",
    "var cv=document.getElementById('cv');cv._lw=640;cv._lh=380;",
    "var hint=document.getElementById('hint');",
    "var rt=createRuntime({canvas:cv,scale:1,logicalWidth:640,logicalHeight:380,",
    " gameId:'runner',gl:'auto',",
    " log:function(m,c){if(c==='err')console.error('[игра] '+m)},",
    " onError:function(e){if(e)hint.textContent='ошибка в строке '+(e.line||'?');}});",
    "var okRun=rt.launch(__GAME_CODE__);",
    "if(okRun)hint.textContent='идёт';else hint.textContent='не запустилось — подробности в консоли';",
    "})();",
    SRC_CLOSE
  ].join(NL()).replace("__GAME_CODE__", function () { return payload; });
  const html = [
    "<!DOCTYPE html>",
    "<html lang=\"ru\">",
    "<head>",
    "<meta charset=\"UTF-8\">",
    "<meta name=\"viewport\" content=\"width=1280\">",
    "<title>" + title + " — AERIS</title>",
    String.fromCharCode(60) + "style>",
    " html,body{height:100%}",
    " body{margin:0;background:#191634;color:#fff;font-family:system-ui,sans-serif;",
    "  display:flex;flex-direction:column;align-items:center;justify-content:center}",
    " canvas{border-radius:10px;box-shadow:0 18px 70px rgba(0,0,0,.55)}",
    " #hint{opacity:.55;font-size:13px;margin-top:12px}",
    String.fromCharCode(60) + "/style>",
    "</head>",
    "<body>",
    "<canvas id=\"cv\" width=\"640\" height=\"380\"></canvas>",
    "<div id=\"hint\">AERIS — своя игра</div>",
    blocks,
    boot,
    "</body>",
    "</html>"
  ].join(NL());
  return { ok: true, html: html, title: title };
}

function gameDownload(scene, name) {
  try {
    const r = runnerHtml(scene, name);
    if (!r.ok) return r;
    const blob = new Blob([r.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = String(name || r.title).replace(/[^\wа-яА-ЯёЁ -]+/g, "")
      .trim().slice(0, 40) || "игра";
    a.href = url;
    a.download = safe + ".html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

const Studio = {
  libList: libList,
  libSave: libSave,
  libOpen: libOpen,
  libDelete: libDelete,
  sceneDownload: sceneDownload,
  scenePickFile: scenePickFile,
  sceneFromText: sceneFromText,
  SCENE_VERSION: SCENE_VERSION,
  STORAGE_KEY: STORAGE_KEY,
  KINDS: KINDS,
  blank: blank,
  normalize: normalize,
  addObject: addObject,
  removeObject: removeObject,
  findObject: findObject,
  toBloomScript: toBloomScript,
  save: save,
  load: load,
  publish: publish,
  gameDownload: gameDownload,
  gameRunnerHtml: runnerHtml,
};

if (typeof window !== "undefined") window.Studio = Studio;
else if (typeof globalThis !== "undefined") globalThis.Studio = Studio;
})();