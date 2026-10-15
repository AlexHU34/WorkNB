/* NEBULA Studio — окно кода.
 *
 * Зачем оно здесь, если уже есть редактор: между «собрал сцену мышкой» и
 * «написал код руками» была дыра. Сцена даёт только то, что предусмотрено
 * кнопками, а редактор заставляет начинать с чистого листа. Здесь можноется
 * посмотреть сгенерированный код, подправить две строчки и тут же увидеть
 * результат — без перехода куда-то.
 *
 * Никаких обучающих подсказок и туров: человек, который открыл это окно,
 * уже знает, зачем пришёл. Помогает только одно — подсказки слов прямо
 * во время набора.
 */
(function () {

/* ======================= СЛОВА ДЛЯ ПОДСКАЗОК =======================
   Два слоя: слова языка и слова движка. Список движка короткий и
   специально приведён к тому, чем реально пользуются в сценах, — длинный
   список из 90 функций только мешал бы. */
const KEYWORDS = [
  ["let", "переменная"], ["const", "постоянная"], ["fn", "функция"],
  ["class", "класс"], ["extends", "наследование"], ["new", "создать"],
  ["this", "текущий объект"], ["super", "базовый класс"], ["return", "вернуть"],
  ["if", "условие"], ["elif", "иначе если"], ["else", "иначе"],
  ["while", "цикл"], ["for", "цикл"], ["in", "обход"],
  ["break", "выйти"], ["continue", "дальше"], ["try", "попробовать"],
  ["catch", "поймать"], ["finally", "всегда"], ["throw", "ошибка"],
  ["import", "подключить"], ["as", "псевдоним"], ["enum", "перечисление"],
  ["static", "статический"], ["typeof", "тип значения"],
  ["and", "и"], ["or", "или"], ["not", "не"],
  ["true", "истина"], ["false", "ложь"], ["null", "пусто"]
];
const ENGINE = [
  ["box", "куб"], ["pyramid", "пирамида"], ["tri", "треугольник"],
  ["quad", "плоскость"], ["ground", "земля"], ["sprite", "метка"],
  ["shadow", "тень"], ["group", "группа"], ["clear", "очистить"],
  ["camera", "камера"], ["bg", "фон"], ["lit", "освещение"],
  ["text", "текст"], ["bar", "полоска"],
  ["key", "клавиша нажата"], ["keyhit", "клавиша нажата"],
  ["mouseX", "мышь X"], ["mouseY", "мышь Y"], ["clicked", "клик"],
  ["time", "время"], ["width", "ширина"], ["height", "высота"],
  ["score", "очки"], ["win", "победа"], ["lose", "проигрыш"],
  ["set", "сохранить"], ["get", "прочитать"], ["has", "есть ли"],
  ["best", "рекорд"], ["save", "сохранить игру"], ["load", "загрузить игру"],
  ["after", "через"], ["every", "каждый"], ["cancel", "отменить"],
  ["screen", "экран"], ["setScreen", "сменить экран"],
  ["label", "надпись"], ["button", "кнопка"], ["slider", "ползунок"],
  ["toggle", "переключатель"], ["progress", "полоса прогресса"],
  ["sound", "звук"], ["tone", "тон"], ["noise", "шум"], ["mute", "тишина"],
  ["hitBox", "столкновение"], ["hitCircle", "столкновение круг"],
  ["approach", "плавно к цели"], ["wrap", "зациклить"], ["angleLerp", "поворот"],
  ["sin", "синус"], ["cos", "косинус"], ["sqrt", "корень"], ["abs", "модуль"],
  ["floor", "вниз"], ["ceil", "вверх"], ["round", "округлить"],
  ["min", "меньше"], ["max", "больше"], ["pow", "степень"],
  ["lerp", "плавно между"], ["clamp", "ограничить"], ["rnd", "случайное"],
  ["dist2", "квадрат расстояния"], ["len", "длина"], ["str", "в строку"],
  ["print", "вывод"], ["toast", "сообщение"]
];

/* Слова, объявленные прямо в открытом коде: переменные, функции, классы. */
function scanNames(src) {
  const out = [];
  const seen = Object.create(null);
  const add = (name, kind) => {
    if (!name || seen[name]) return;
    seen[name] = 1;
    out.push({ name: name, kind: kind, hint: "в этом коде" });
  };
  const re = /\b(fn|class|let|const)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === "let" || m[1] === "const") add(m[2], "своё");
    else add(m[2], "своё");
  }
  return out;
}

function candidates(word, src) {
  const lw = word.toLowerCase();
  const all = []
    .concat(scanNames(src))
    .concat(ENGINE.map(x => ({ name: x[0], kind: "движок", hint: x[1] })))
    .concat(KEYWORDS.map(x => ({ name: x[0], kind: "язык", hint: x[1] })));
  const seen = Object.create(null), out = [];
  for (const c of all) {
    if (seen[c.name]) continue;
    seen[c.name] = 1;
    if (lw && c.name.toLowerCase().indexOf(lw) !== 0) continue;
    out.push(c);
  }
  /* Свои слова — вперёд: человек дописывает то, что назвал сам. */
  out.sort((a, b) => {
    const ra = a.kind === "своё" ? 0 : a.kind === "движок" ? 1 : 2;
    const rb = b.kind === "своё" ? 0 : b.kind === "движок" ? 1 : 2;
    return ra - rb || a.name.length - b.name.length || a.name.localeCompare(b.name);
  });
  return out;
}

/* ============================= СОСТОЯНИЕ ============================= */
let ta = null, box = null, msg = null;
let items = [], index = 0, wordStart = 0;
const VISIBLE = 3;   /* по умолчанию показываем три; если подходящих больше — список растёт */

/* Слово под курсором: идём от каретки влево по буквам/цифрам/подчёркиванию. */
function currentWord() {
  const pos = ta.selectionStart;
  let s = pos;
  while (s > 0 && /[A-Za-z0-9_$]/.test(ta.value[s - 1])) s--;
  return { start: s, word: ta.value.slice(s, pos) };
}

/* Подсказки показываются всегда, пока слово не пустое: раньше в редакторе
   список появлялся только после двух букв и то по нажатию. Здесь — сразу
   при наборе, без лишнего действия. */
function refreshItems() {
  const w = currentWord();
  if (!w.word) { hide(); return; }
  wordStart = w.start;
  items = candidates(w.word, ta.value);
  if (!items.length) { hide(); return; }
  index = 0;
  render();
  show();
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render() {
  let h = '<div class="acHead">↑↓ выбрать · Tab принять · Esc закрыть</div>';
  items.forEach((c, i) => {
    const cls = c.kind === "своё" ? "own" : c.kind === "язык" ? "kw" : "";
    h += '<button class="' + (i === index ? "on" : "") + '" data-i="' + i + '">' +
      '<span class="acName">' + esc(c.name) + "</span>" +
      '<span class="acKind ' + cls + '">' + esc(c.kind) + "</span>" +
      '<span class="acHint">' + esc(c.hint) + "</span></button>";
  });
  box.innerHTML = h;
  for (const b of box.querySelectorAll("button")) {
    b.onmousedown = (e) => { e.preventDefault(); accept(+b.getAttribute("data-i")); };
  }
}

/* Позиция подсказки — под словом, на котором печатают. Считаем через
   временную копию шрифта: иначе список уезжал бы в угол. */
function place() {
  const cs = getComputedStyle(ta);
  const probe = document.createElement("span");
  probe.style.font = cs.font;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.textContent = ta.value.slice(0, ta.selectionStart);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  document.body.removeChild(probe);
  const line = ta.value.slice(0, ta.selectionStart).split("\n").length;
  const lh = parseFloat(cs.lineHeight) || 20;
  box.style.left = Math.max(0, Math.min(w - ta.scrollLeft, ta.clientWidth - 120)) + "px";
  box.style.top = ((line - 1) * lh + lh + 2 - ta.scrollTop) + "px";
}

function show() { box.hidden = false; place(); }
function hide() { items = []; box.hidden = true; }

function accept(i) {
  const c = items[i === undefined ? index : i];
  if (!c) return false;
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, wordStart) + c.name + ta.value.slice(pos);
  const np = wordStart + c.name.length;
  ta.selectionStart = ta.selectionEnd = np;
  hide();
  return true;
}

function keydown(e) {
  const open = !box.hidden && items.length;
  if (open) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      index = (index + 1) % items.length;
      render(); place();
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      index = (index - 1 + items.length) % items.length;
      render(); place();
      return true;
    }
    if (e.key === "Tab" || e.key === "Enter") {
      /* Enter не перехватываем, если выбран вариант не первый: человек
         может просто нажать Enter, чтобы согласиться с самым частым. */
      e.preventDefault();
      accept();
      return true;
    }
    if (e.key === "Escape") { e.preventDefault(); hide(); return true; }
  }
  return false;
}

/* ============================= ДЕЙСТВИЯ ============================= */
function scene() {
  const scene = Studio.load();
  return scene;
}
function currentScene() {
  /* editor.js держит актуальную сцену; берём её оттуда, иначе из хранилища. */
  if (window.StudioEditor && StudioEditor.scene) return StudioEditor.scene;
  return Studio.load();
}

function pullFromScene() {
  ta.value = Studio.toBloomScript(currentScene());
  hide();
  say("Код взят из сцены");
}

/* Запуск кода в том же вьюпорте. Без интерпретатора в Studio сделать это
   нельзя, поэтому используем iframe с редактором: он уже умеет запускать. */
function run() {
  const src = ta.value;
  if (!src.trim()) { say("Пусто — писать нечего", true); return; }
  try {
    localStorage.setItem("bb2_studio_run", src);
  } catch (e) {
    say("Браузер не даёт доступ к хранилищу", true);
    return;
  }
  say("Открываю предпросмотр…");
  window.open("lang.html?run=1", "_blank");
}

function toEditor() {
  const src = ta.value;
  if (!src.trim()) { say("Пусто — передавать нечего", true); return; }
  try {
    localStorage.setItem("bb2_studio_to_editor",
      JSON.stringify({ src: src, title: currentScene().title, at: Date.now() }));
  } catch (e) {
    say("Браузер не даёт доступ к хранилищу", true);
    return;
  }
  say("Открываю редактор…");
  window.open("lang.html", "_blank");
}

function say(text, isErr) {
  if (!msg) return;
  msg.textContent = text;
  msg.style.color = isErr ? "#ff8a80" : "#7f93ad";
}

function init() {
  ta = document.getElementById("codeIn");
  box = document.getElementById("acStudio");
  msg = document.getElementById("codeMsg");
  if (!ta || !box) return;

  document.getElementById("btnCodeFromScene").onclick = pullFromScene;
  document.getElementById("btnCodeRun").onclick = run;
  document.getElementById("btnCodeEditor").onclick = toEditor;

  /* Открытие окна сразу показывает код сцены — иначе человек увидит
     пустое поле и решит, что сломалось. */
  document.getElementById("btnCode").onclick = () => {
    const wrap = document.getElementById("codeWrap");
    wrap.hidden = !wrap.hidden;
    if (!wrap.hidden && !ta.value.trim()) pullFromScene();
    if (!wrap.hidden) refreshItems();
  };

  ta.addEventListener("input", refreshItems);
  ta.addEventListener("click", refreshItems);
  ta.addEventListener("keydown", e => { if (!keydown(e)) insertIndent(e); });
  ta.addEventListener("blur", () => setTimeout(hide, 150));
  ta.addEventListener("scroll", place);
}

/* Tab во втором отступном месте должен двигать курсор, а не вставлять
   пробел: иначе невозможно набрать блок. */
function insertIndent(e) {
  if (e.key !== "Tab" || e.shiftKey) return;
  e.preventDefault();
  const s = ta.selectionStart, en = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(en);
  ta.selectionStart = ta.selectionEnd = s + 2;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.StudioCode = {
  open: function () {
    const w = document.getElementById("codeWrap");
    if (w) { w.hidden = false; if (ta && !ta.value.trim()) pullFromScene(); }
  },
  getValue: function () { return ta ? ta.value : ""; },
  setValue: function (v) { if (ta) { ta.value = v; hide(); } }
};

})();