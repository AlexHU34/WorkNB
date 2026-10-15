/* Диагностика: ошибки не должны пропадать молча.
 *
 * Зачем. В проекте на трёх страницах был ОДИН обработчик ошибок на
 * десять тысяч строк. Любая поломка выглядела одинаково: игра не
 * работает,原因 неизвестен, и чинить приходится вслепую.
 *
 * Здесь три вещи:
 *   1. Ловим всё: необработанные ошибки, отказы промисов, ошибки
 *      загрузки ресурсов.
 *   2. Показываем человеку читаемое сообщение — но один раз, а не на
 *      каждую ошибку в кадре: иначе при тысяче ошибок в секунду экран
 *      превратится в мигающий ад.
 *   3. Держим кольцевой журнал, который можно посмотреть на странице
 *      «Диагностика» без интернета и без сервера.
 *
 * Никаких отправок наружу: проект офлайновый, данные игрока никуда не
 * уходят. Журнал живёт в памяти и в localStorage той же машины.
 */
(function () {

const MAX_LOG = 100;          /* больше сотни записей в журнале не нужно */
const TOAST_GAP_MS = 4000;    /* не чаще одного сообщения в 4 секунды */
const KEY = "bb2_errors.v1";

const log = [];
let lastToastAt = 0;
let panel = null;

/* Ошибка приходит с кодом и ссылкой на место. Человеку нужно другое:
   что именно сломалось и где искать. */
function readable(e) {
  if (!e) return "Неизвестная ошибка";
  if (typeof e === "string") return e;
  const msg = e.message || String(e);
  const where = e.filename ? String(e.filename).split(/[\\/]/).pop() : "";
  const line = e.lineno || e.lineNumber;
  return where ? (msg + "  (" + where + (line ? ":" + line : "") + ")")
               : (msg + (line ? " (строка " + line + ")" : ""));
}

/* Ошибки одного и того же вида идут десятками за кадр (например,
   падение в цикле игры). Показывать каждую нельзя, а молчать нельзя.
   Поэтому: первая показывается, остальные только считаются. */
function countOf(key) {
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].key === key) { n = log[i].count; break; }
  }
  return n;
}

function record(kind, e, extra) {
  const text = readable(e);
  const key = kind + "|" + text;
  const n = countOf(key);
  if (n) {
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].key === key) { log[i].count++; log[i].last = Date.now(); return; }
    }
  }
  log.push({
    key: key, kind: kind, text: text, extra: extra || "",
    count: 1, at: Date.now(),
    page: location.pathname.split(/[\\/]/).pop() || "страница",
  });
  while (log.length > MAX_LOG) log.shift();
  try {
    localStorage.setItem(KEY, JSON.stringify(log.slice(-40)));
  } catch (err) { /* хранилище может быть недоступно — не повод падать */ }
}

/* Панель поверх страницы. Её можно закрыть, чтобы продолжить играть:
   ошибка показана, но игра не заблокирована. */
function show() {
  if (typeof document === "undefined" || !document.body) return;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "nbErrPanel";
    panel.innerHTML =
      '<div class="nbErrHead">⚠️ Что-то пошло не так</div>' +
      '<div class="nbErrBody"></div>' +
      '<div class="nbErrFoot">' +
      '<button class="nbErrBtn" data-a="copy">Скопировать</button>' +
      '<button class="nbErrBtn" data-a="diag">Диагностика</button>' +
      '<button class="nbErrBtn" data-a="close">Продолжить</button>' +
      "</div>";
    document.body.appendChild(panel);
    panel.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-a]");
      if (!b) return;
      const a = b.getAttribute("data-a");
      if (a === "close") panel.classList.remove("show");
      else if (a === "diag") openDiag();
      else if (a === "copy") copyText();
    });
  }
  const last = log[log.length - 1];
  if (!last) return;
  panel.querySelector(".nbErrBody").textContent = last.text;
  panel.classList.add("show");
  lastToastAt = Date.now();
}

function copyText() {
  const text = log.map((e) =>
    "[" + new Date(e.at).toLocaleString("ru-RU") + "] " +
    e.page + " " + e.kind + ": " + e.text +
    (e.count > 1 ? " (повторов: " + e.count + ")" : "") +
    (e.extra ? " | " + e.extra : "")
  ).join("\n");
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}

/* Отдельная страница. Открывается в том же файле: в офлайновой сборке
   нет сервера, поэтому отдельный документ был бы ещё одним файлом,
   который надо носить с собой. */
function openDiag() {
  let w = document.getElementById("nbDiag");
  if (!w) {
    w = document.createElement("div");
    w.id = "nbDiag";
    w.innerHTML =
      '<div class="nbDiagBox">' +
      '<h2>Диагностика</h2>' +
      '<p class="nbDiagHint">Что пошло не так. Копируется одним нажатием.</p>' +
      '<div class="nbDiagRows"></div>' +
      '<div class="nbDiagFoot">' +
      '<button class="nbErrBtn" data-a="copy">Скопировать всё</button>' +
      '<button class="nbErrBtn" data-a="reload">Обновить страницу</button>' +
      '<button class="nbErrBtn" data-a="close">Закрыть</button>' +
      "</div></div>";
    document.body.appendChild(w);
    w.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-a]");
      if (!b) return;
      const a = b.getAttribute("data-a");
      if (a === "close") w.classList.remove("show");
      else if (a === "reload") location.reload();
      else copyText();
    });
  }
  const rows = [];
  let stored = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) || [];
  } catch (e) { stored = []; }
  /* Из памяти + из хранилища: в памяти — ошибки этой сессии,
     из хранилища — прошлых, если страница не перезагружали. */
  const seen = Object.create(null);
  stored.concat(log).forEach((e) => {
    if (!e || !e.text || seen[e.key + e.at]) return;
    seen[e.key + e.at] = 1;
    rows.push("<div class='nbDiagRow'><b>" +
      (e.kind === "error" ? "Ошибка" : e.kind === "promise" ? "Обещание" : "Ресурс") +
      "</b> · " + (e.page || "") +
      "<div>" + escapeHtml(e.text) +
      (e.count > 1 ? " <i>(повторов: " + e.count + ")</i>" : "") +
      (e.extra ? "<small>" + escapeHtml(e.extra) + "</small>" : "") +
      "</div><time>" + new Date(e.at).toLocaleString("ru-RU") + "</time></div>");
  });
  w.querySelector(".nbDiagRows").innerHTML =
    rows.length ? rows.join("") : '<div class="nbDiagEmpty">Ошибок не было 🎉</div>';
  w.classList.add("show");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function install() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    record("error", e && e.error ? e.error : (e && e.message), e && e.filename);
    maybeShow();
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    record("promise", r);
    maybeShow();
  });
  /* Скрипт или картинка не загрузились. На file:// это бывает при
     правке пути — самая частая причина «страница пустая». */
  window.addEventListener("error", (e) => {
    if (e && e.target && e.target !== window && e.target.tagName) {
      const el = e.target;
      record("resource", "не загрузилось: " + (el.tagName || "?") +
        (el.src ? " — " + String(el.src).split(/[\\/]/).pop() : ""));
    }
  }, true);
}

function maybeShow() {
  /* Показываем не сразу и не чаще, чем раз в 4 секунды: иначе при
     серии ошибок экран захлёбывается сообщениями. */
  if (Date.now() - lastToastAt < TOAST_GAP_MS) return;
  show();
}

const Diag = {
  log: log,
  show: show,
  open: openDiag,
  report: function (kind, text, extra) {
    record(kind || "info", text, extra);
    maybeShow();
  },
  count: function () { return log.length; },
  text: function () {
    return log.map((e) => e.kind + ": " + e.text +
      (e.count > 1 ? " x" + e.count : "")).join("\n");
  },
  clear: function () {
    log.length = 0;
    try { localStorage.removeItem(KEY); } catch (e) {}
    if (panel) panel.classList.remove("show");
  },
};

if (typeof window !== "undefined") {
  window.NebulaDiag = Diag;
  install();
  /* Стили добавляем файлом, а не строкой: их видно в исходнике. */
  const css =
    "#nbErrPanel{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;" +
    "z-index:9999;max-width:min(680px,94vw);background:#2a1416;color:#ffd7d2;" +
    "border:1px solid #7a2b2b;border-radius:14px;padding:12px 14px;display:none;" +
    "box-shadow:0 18px 46px #0009;font:14px/1.45 system-ui,sans-serif}" +
    "#nbErrPanel.show{display:block}" +
    "#nbErrPanel .nbErrHead{font-weight:800;margin-bottom:6px}" +
    "#nbErrPanel .nbErrBody{font:12.5px/1.5 ui-monospace,Consolas,monospace;" +
    "background:#1a0e10;border-radius:8px;padding:8px;max-height:110px;overflow:auto;" +
    "word-break:break-word}" +
    "#nbErrPanel .nbErrFoot{display:flex;gap:8px;margin-top:10px}" +
    ".nbErrBtn{background:#3a1f22;border:1px solid #7a2b2b;color:#ffd7d2;" +
    "border-radius:8px;padding:6px 11px;font:inherit;font-size:12.5px;cursor:pointer}" +
    ".nbErrBtn:hover{background:#4a2629}" +
    "#nbDiag{position:fixed;inset:0;z-index:10000;background:rgba(8,8,12,.78);" +
    "display:none;align-items:center;justify-content:center;padding:18px}" +
    "#nbDiag.show{display:flex}" +
    ".nbDiagBox{background:#111a29;color:#e6eef7;border:1px solid #22304a;" +
    "border-radius:18px;padding:18px;width:min(820px,100%);max-height:88vh;" +
    "overflow:auto;font:14px/1.5 system-ui,sans-serif}" +
    ".nbDiagBox h2{margin:0 0 4px}" +
    ".nbDiagHint{color:#7f93ad;font-size:12.5px;margin:0 0 12px}" +
    ".nbDiagRows{display:flex;flex-direction:column;gap:8px}" +
    ".nbDiagRow{background:#0d1420;border:1px solid #1e2b42;border-radius:10px;" +
    "padding:9px 11px;font-size:12.5px}" +
    ".nbDiagRow b{color:#ff8a80}" +
    ".nbDiagRow div{font-family:ui-monospace,Consolas,monospace;margin:4px 0;" +
    "word-break:break-word}" +
    ".nbDiagRow small{display:block;color:#7f93ad;margin-top:3px}" +
    ".nbDiagRow time{color:#5f7a99}" +
    ".nbDiagEmpty{color:#7f93ad;padding:20px;text-align:center}" +
    ".nbDiagFoot{display:flex;gap:8px;margin-top:14px}";
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
}

if (typeof globalThis !== "undefined") globalThis.NebulaDiag = Diag;

})();