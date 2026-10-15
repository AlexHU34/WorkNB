/* Мост: приложение запускает код, написанный на BloomScript.
 *
 * Код и среда уже общие с редактором (src/lang/core.js, src/lang/runtime.js) —
 * здесь только хранение игр пользователя и запуск их в режиме приложения.
 * Ограничения те же, что и в редакторе: AST-интерпретатор без eval,
 * лимит шагов на кадр, песочница без доступа к DOM.
 */
const UGAME_KEY = "bb2_ugames.v1";

function uloadGames() {
  try {
    const raw = localStorage.getItem(UGAME_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}
function usaveGames(list) {
  try {
    localStorage.setItem(UGAME_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}
/* Название из первой строки-комментария или из fn-имени.
   Комментарии в BloomScript — // и /* *\/, решётка не является комментарием
   (на этом Studio однажды выдал код, который не парсился). Старый вариант
   с # не срабатывал никогда, поэтому // стоит первым, а # оставлен для
   возможных чужих генераторов. */
function utitleOf(src, fallback) {
  const s = String(src);
  const m = s.match(/^\s*\/\/\s*(.+)$/m) || s.match(/^\s*#\s*(.+)$/m);
  if (m) return m[1].trim().slice(0, 40);
  const f = s.match(/^\s*fn\s+(\w+)/m);
  return f ? f[1] : (fallback || "Моя игра");
}
function umakeCard(id, src) {
  const card = document.createElement("button");
  card.className = "card ugame-card";
  card.dataset.ug = id;
  card.innerHTML = "<div class='cardTop'><span class='cardEmoji'>🧑‍💻</span>" +
    "<span class='cardBadge'>СВОЯ</span></div>" +
    "<div class='cardTitle'></div>" +
    "<div class='cardTask'>Код на BloomScript</div>" +
    "<div class='cardMeta'><span>▶ запустить</span><span>✎ изменить</span></div>";
  card.querySelector(".cardTitle").textContent = utitleOf(src);
  card.onclick = () => uopenGame(id);
  return card;
}

/* Запуск игры пользователя внутри режима приложения. */
function uopenGame(id) {
  const list = uloadGames();
  const ug = list.find(g => g.id === id);
  if (!ug) { toast("Игра не найдена"); return; }
  stopMode();
  currentGame = 0;
  selected = null;
  undoStack = [];
  redoStack = [];
  sfx.click();

  const r = modeRoot("<h3>🧑‍💻 Своя игра — " + "</h3>" +
    "<div class='mrow'><button class='mbtn primary' id='ugStop'>Остановить</button>" +
    "<button class='mbtn' id='ugRestart'>Заново</button>" +
    "<button class='mbtn' id='ugEdit'>Редактор</button>" +
    "<span id='ugInfo' style='font-weight:800'></span></div>");
  const cv = document.createElement("canvas");
  cv.width = 640; cv.height = 380; cv.className = "playfield";
  r.appendChild(cv);
  const info = r.querySelector("#ugInfo");

  const x = sharp(cv, 640, 380);
  cv._lw = 640; cv._lh = 380;

  const rt = createRuntime({
    canvas: cv,
    scale: 1,
    logicalWidth: 640,
    logicalHeight: 380,
    gameId: id,
    /* Режим ускорения из окна настроек: авто / включён / выключен.
       В режиме "auto" среда сама попробует видеокарту и откатится на 2D. */
    gl: (typeof glMode !== "undefined" ? glMode : "auto"),
    log: (msg, cls) => {
      if (cls === "err") console.error("[игра] " + msg);
    },
    onError: e => {
      if (e) info.textContent = "ошибка в строке " + (e.line || "?");
    }
  });

  const src = String(ug.src || "");
  if (typeof window !== "undefined") window.__rtRef = rt;
  const okRun = rt.launch(src);
  info.textContent = okRun ? "идёт" : ("ошибка: " + ((rt.lastError && rt.lastError.message) || "см. консоль"));

  r.querySelector("#ugStop").onclick = () => { rt.stopLoop(); info.textContent = "остановлено"; };
  r.querySelector("#ugRestart").onclick = () => {
    rt.stopLoop();
    info.textContent = rt.launch(src) ? "идёт" : "ошибка в коде";
  };
  r.querySelector("#ugEdit").onclick = () => {
    try { localStorage.setItem("bb2_ugame_to_edit", String(id)); } catch (e) {}
    toast("Открой редактор BloomScript — игра уже выбрана для правки");
    goHome();
  };

  $("lobbyMain").style.display = "none";
  $("gameView").classList.add("show");
  $("gameView").classList.add("mode-on");
  $("gTitle").textContent = "🧑‍💻 " + utitleOf(src);
  $("gPlayers").textContent = "своя игра";
  $("gTask").textContent = "Код на BloomScript";
  setProg(50);
  modeFinish = () => { rt.stopLoop(); toast("Игра остановлена"); };
  modeCleanup = () => { rt.stopLoop(); };
  modeReplay = "";
}

/* Плитка «Мои игры» в лобби. Создаётся один раз, обновляется по данным. */
let ugGrid = null;
function umountMyGames() {
  if (ugGrid) { ugGrid.remove(); ugGrid = null; }
  const list = uloadGames();
  if (!list.length) return;
  ugGrid = document.createElement("div");
  ugGrid.id = "ugGrid";
  ugGrid.className = "grid";
  for (const g of list) ugGrid.appendChild(umakeCard(g.id, g.src));
  const host = document.getElementById("gridAll");
  if (host) host.prepend(ugGrid);
}
