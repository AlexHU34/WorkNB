/* Доступность: интерфейс должен быть годным без мыши.
 *
 * Что было замерено в проекте до этой правки:
 *   aria-*   — 0 вхождений
 *   role     — 0
 *   tabindex — 0
 *
 * То есть ни один элемент не был ни назван, ни достижим с клавиатуры.
 * Сотни кнопок-эмодзи выглядят одинаково для программы чтения с экрана:
 * «🔊» не значит ничего. Человек на клавиатуре не мог дойти до каталога.
 *
 * Здесь четыре вещи:
 *   1. Названия. Кнопка без текста, но с эмодзи или подсказкой получает
 *      aria-label из подсказки или из текста. Произвольная кнопка без
 *      имени честно помечается как «не названа» — лучше видно, где чинить.
 *   2. Достижимость. Всё, что нажимается мышью, должно нажиматься и с
 *      клавиатуры: настоящие <button> получают это сразу, а кликабельные
 *      <div> — фокус и Enter/Пробел.
 *   3. Видимый фокус. Раньше его не было вовсе: фокус уходил в неизвестно
 *      куда, и человек не понимал, где он находится.
 *   4. Уважение к «уменьшить анимацию». Если человек включил эту
 *      настройку в системе, анимации отключаются: при vestibular-расстройстве
 *      они вызывают тошноту.
 */
(function () {

/* Порядок обхода вкладкой соответствует чтению сверху вниз. */
let ORDER = ["topbar", "sidebar", "gameView", "setOverlay", "shopOverlay", "overlay"];

function isFocusable(el) {
  if (el.disabled) return false;
  const t = el.tagName;
  if (t === "BUTTON" || t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return true;
  if (t === "A" && el.getAttribute("href") !== undefined) return true;
  return el.getAttribute("tabindex") !== null && el.getAttribute("tabindex") !== "-1";
}

/* Название для программы чтения с экрана: сначала то, что человек и так
   видит, потом подсказка, потом содержимое иконки. */
/* Словарь символов. Кнопки внутри игр собираются строкой в ста играх
   разных мест: «◀», «▶», «▲», «✕» там значат одно и то же, но написаны
   сотни раз. Чтобы не править каждую игру, названия живут здесь: кнопка
   с одиноким символом получает имя из словаря. */
const GLYPH_NAMES = {
  "◀": "влево", "◄": "влево", "‹": "назад", "←": "влево",
  "▶": "вправо", "►": "вправо", "›": "вперёд", "→": "вправо",
  "▲": "вверх", "↑": "вверх", "▼": "вниз", "↓": "вниз",
  "✕": "закрыть", "✖": "закрыть", "❌": "закрыть",
  "🎲": "случайная деталь", "🪞": "отразить", "🎯": "камера",
  "➕": "добавить", "➖": "убрать", "⏸": "пауза", "⏵": "продолжить",
  "🤍": "в избранное", "❤️": "в избранном",
  "🔊": "звук", "🔇": "звук выключен", "🌓": "тема",
  "⚙️": "настройки", "⚙": "настройки", "🔔": "уведомления",
  "🗑": "удалить", "🧹": "очистить", "🛍": "магазин", "🛒": "магазин",
  "💰": "продать", "📋": "копировать", "📥": "вставить", "📤": "экспорт",
  "⏱": "таймер", "↩": "отменить", "↪": "вернуть", "⟳": "обновить",
  "↻": "повернуть", "⇧": "поднять", "⇩": "опустить", "⊕": "в центр",
  "🧲": "привязка к сетке", "▶": "играть",
};

function labelFor(el) {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return null;            /* уже назван */
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  const title = (el.getAttribute("title") || "").trim();
  /* Текст из одной эмодзи ничего не сообщает: нужен настоящий title. */
  const isGlyph = text.length > 0 && !/[A-Za-zА-Яа-яЁё0-9]/.test(text);
  if (text && !isGlyph) return null;
  if (title) return title;
  /* Одинокий символ со словарём: «◀» читается как «влево». */
  if (isGlyph && GLYPH_NAMES[text]) return GLYPH_NAMES[text];
  /* data-hint — соглашение, которым пользуются сами игры. */
  const hint = (el.getAttribute("data-hint") || "").trim();
  if (hint) return hint;
  const kind = el.tagName.toLowerCase();
  return "кнопка без названия (" + kind + ")";
}

/* Разметку читать нечем: страница собрана из div и кнопок без ролей.
   Добавляем роли там, где поведение очевидно. */
function fixRoles(root) {
  const navs = root.querySelectorAll("nav, .nav-links");
  for (const n of navs) n.setAttribute("role", "navigation");
  const main = root.querySelector("main, #gameView");
  if (main) main.setAttribute("role", "main");
  const asides = root.querySelectorAll("aside, .sidebar");
  for (const a of asides) a.setAttribute("role", "complementary");
  const overlays = root.querySelectorAll(".overlay");
  for (const o of overlays) {
    o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
  }
  const search = root.querySelector('input[type="search"], input[placeholder*="оиск"]');
  if (search && !search.getAttribute("aria-label")) search.setAttribute("aria-label", "Поиск игр");
}

/* Кликабельные div и span. Настоящую <button> не трогаем: она уже
   работает с клавиатуры сама. */
function fixClickables(root) {
  const all = root.querySelectorAll("div,span,li,a");
  for (const el of all) {
    if (el.tagName === "BUTTON" || el.tagName === "INPUT" || el.tagName === "A") continue;
    if (!el.getAttribute("onclick") && !el.getAttribute("data-on")) continue;
    if (el.getAttribute("tabindex") !== null) continue;
    /* Вложенная кнопка внутри кликабельного div: Enter на кнопке уже
       сработает, лишний обработчик только задублирует действие. */
    if (el.querySelector("button, input, select, textarea")) continue;
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", el.tagName === "LI" ? "listitem" : "button");
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      el.click();
    });
  }
}

function fixLabels(root) {
  let unnamed = 0, named = 0;
  for (const el of root.querySelectorAll("button, [role=button], .side-btn, .ctrl, .mini, .iconbtn, .tab, .cat, .mbtn")) {
    const want = labelFor(el);
    if (want === null) { named++; continue; }
    el.setAttribute("aria-label", want);
    unnamed++;
  }
  return { named: named, unnamed: unnamed };
}

function addFocusStyle() {
  if (document.getElementById("nbA11yStyle")) return;
  const st = document.createElement("style");
  st.id = "nbA11yStyle";
  st.textContent =
    /* Фокус должен быть виден всегда: без него человек с клавиатурой
       не знает, где находится. Раньше его не было нигде. */
    "#topbar :focus-visible,#sidebar :focus-visible,#gameView :focus-visible," +
    ".overlay :focus-visible,#nbErrPanel :focus-visible{" +
    "outline:3px solid #00d4ff;outline-offset:2px;border-radius:8px}" +
    "[tabindex=\"0\"]:focus-visible{outline:3px solid #00d4ff;outline-offset:2px}" +
    "button:focus:not(:focus-visible){outline:none}";
  document.head.appendChild(st);
}

/* Прыжок к главному содержимому: клавиатура сначала проходит по шапке,
   а список из сотни карточек начинается с середины страницы. */
function skipLink() {
  if (document.getElementById("nbSkip")) return;
  const a = document.createElement("a");
  a.id = "nbSkip";
  a.href = "#nbMain";
  a.textContent = "К играм";
  a.style.cssText =
    "position:absolute;left:8px;top:-60px;z-index:10001;background:#0d1420;" +
    "color:#e6eef7;border:1px solid #2c3d5e;padding:9px 14px;border-radius:9px;" +
    "font:700 14px system-ui,sans-serif;transition:top .15s";
  a.addEventListener("focus", () => { a.style.top = "8px"; });
  a.addEventListener("blur", () => { a.style.top = "-60px"; });
  document.body.insertBefore(a, document.body.firstChild);
  const main = document.getElementById("lobbyMain") || document.querySelector("main");
  if (main && !main.id) main.id = "nbMain";
}

/* «Уменьшить анимацию». Настройка системы важнее нашей: человек сам
   сказал, что анимации ему вредны. */
function respectMotion() {
  if (typeof matchMedia !== "function") return;
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const apply = () => {
    if (mq.matches) document.documentElement.setAttribute("data-motion", "reduced");
    else document.documentElement.removeAttribute("data-motion");
  };
  apply();
  if (mq.addEventListener) mq.addEventListener("change", apply);
  const st = document.createElement("style");
  st.id = "nbMotion";
  st.textContent =
    'html[data-motion="reduced"] *{animation-duration:.01ms !important;' +
    "animation-iteration-count:1 !important;transition-duration:.01ms !important}";
  document.head.appendChild(st);
}

let lastReport = null;

function scan() {
  fixRoles(document);
  fixClickables(document);
  addFocusStyle();
  skipLink();
  respectMotion();
  return fixLabels(document);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
  /* Каталог и лобби перерисовываются целиком: новые карточки приходят
     уже собранными строкой и без фокуса. Сканируем после каждой
     перерисовки — иначе половина каталога останется недоступной. */
  let timer = 0;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; scan(); }, 120);
  };
  if (typeof MutationObserver === "function") {
    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
}

if (typeof window !== "undefined") {
  window.NebulaA11y = {
    scan: scan,
    /* Сколько кнопок осталось без имени. Считает честно: элемент с
       настоящим текстом именем считается, одна эмодзи — нет.
       Список непокрытых показывается, чтобы правка шла по списку,
       а не наугад. */
    report: function () {
      let total = 0, ok = 0;
      const missed = [];
      const SEL = "button,[role=button],.side-btn,.ctrl,.mini,.iconbtn,.tab,.cat,.mbtn";
      for (const el of document.querySelectorAll(SEL)) {
        total++;
        const l = el.getAttribute("aria-label") || "";
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        const readable = /[A-Za-zА-Яа-яЁё0-9]/.test(t);
        if (readable || (l && l.indexOf("без названия") < 0)) { ok++; continue; }
        /* Точки-слайдеры на главном экране не содержат ничего: номер
           слайда стоит только в обработчике. Подписываем по номеру —
           человек с клавиатурой должен понимать, куда попадёт. */
        const click = (el.getAttribute("onclick") || "").trim();
        /* Проверяем не пустоту подписи, а её заглушку: fixLabels уже
           поставила «без названия», поэтому условие на пустую строку
           никогда не срабатывало. */
        const unnamedLabel = !l || l.indexOf("без названия") >= 0;
        if (unnamedLabel && /^heroGo\(\d+\)$/.test(click)) {
          const n = Number((click.match(/\d+/) || ["0"])[0]) + 1;
          el.setAttribute("aria-label", "Слайд " + n);
          el.setAttribute("role", "button");
          if (el.getAttribute("tabindex") === null) el.setAttribute("tabindex", "0");
          el.addEventListener("keydown", function (k) {
            if (k.key === "Enter" || k.key === " ") { k.preventDefault(); this.click(); }
          });
          ok++;
          continue;
        }
        missed.push(el.tagName.toLowerCase() +
          "[" + (el.className || "") + "]" +
          (click ? " onclick=" + click.slice(0, 40) : ""));
      }
      return { total: total, named: ok, unnamed: total - ok, missed: missed };
    },
    focusable: function () {
      const all = Array.prototype.slice.call(document.querySelectorAll("*"));
      return all.filter(isFocusable).length;
    },
    ORDER: ORDER,
  };
}

if (typeof globalThis !== "undefined") globalThis.NebulaA11y = window.NebulaA11y;

})();