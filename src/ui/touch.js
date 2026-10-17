/* Экранное управление: чтобы игры игрались пальцем на телефоне.
 *
 * Зачем. 34 игры из 73 читают только клавиатуру. Без подсказки на
 * экране на телефоне они не запускаются вообще, а телефон — это
 * половина возможных посетителей сайта.
 *
 * Почему не переписали 34 игры. Каждая игра из каталога вешает свой
 * обработчик keydown и читает e.key. Если экранная кнопка отправляет
 * окну настоящее клавиатурное событие, её увидит любая из них — и
 * ещё движок редактора, который тоже слушает окно. Одна кнопка
 * работает сразу со всеми играми, а код игр не трогается совсем.
 *
 * Как это устроено. Кнопка пишет в keysDown (для удержания) и в
 * keysHit (для нажатия) — это те же поля, что и у настоящей
 * клавиатуры. Стрелки удерживаются, «Прыжок» срабатывает один раз.
 *
 * Про нагрузку. Модуль ничего не создаёт, пока игра не запущена и
 * устройство без сенсорного экрана. Своего таймера нет — кнопки
 * просто пишут в поля ввода, а дальше всё делает обычный кадр игры.
 */
(function () {
  "use strict";

  const KEYS = {
    left:  { key: "ArrowLeft",  code: "ArrowLeft",  label: "◀", cls: "t-left" },
    up:    { key: "ArrowUp",    code: "ArrowUp",    label: "▲", cls: "t-up" },
    down:  { key: "ArrowDown",  code: "ArrowDown",  label: "▼", cls: "t-down" },
    right: { key: "ArrowRight", code: "ArrowRight", label: "▶", cls: "t-right" },
    jump:  { key: " ",          code: "Space",      label: "▲", cls: "t-jump", wide: true }
  };

  /* Клавиши, которые нужно держать, и действие, которое нужно нажать. */
  const HOLD = ["left", "up", "down", "right"];
  const ONCE = ["jump"];

  const held = new Set();      /* какие экранные кнопки сейчас зажаты */
  let pad = null;              /* сам блок кнопок */
  let lastFocus = null;        /* где был фокус до нажатия экранной кнопки */
  let manual = false;          /* человек включил панель сам */

  /* --- отправка клавиатурных событий ------------------------------- */

  function fire(type, spec) {
    /* Событие уходит в окно: его слышат и игры каталога, и редактор. */
    const ev = new KeyboardEvent(type, {
      key: spec.key,
      code: spec.code,
      bubbles: true,
      cancelable: true
    });
    try {
      Object.defineProperty(ev, "keyCode", {
        value: spec.key === " " ? 32 : keyNumber(spec.code)
      });
    } catch (e) { /* свойство не дали — игра без него всё равно работает */ }
    window.dispatchEvent(ev);
  }

  /* Старые игры иногда спрашивают keyCode. Номера нужны только эти. */
  function keyNumber(code) {
    return {
      ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32
    }[code] || 0;
  }

  function press(id) {
    if (held.has(id)) return;
    const spec = KEYS[id];
    if (!spec) return;
    held.add(id);
    /* Поле ввода не должно терять фокус из-за нажатия кнопки. */
    lastFocus = document.activeElement;
    if (lastFocus && lastFocus.blur) lastFocus.blur();
    fire("keydown", spec);
    if (ONCE.indexOf(id) >= 0) return; /* пробел срабатывает один раз */
    pad.querySelector("[data-id=" + id + "]").classList.add("held");
  }

  function release(id) {
    if (!held.has(id)) return;
    held.delete(id);
    const spec = KEYS[id];
    if (HOLD.indexOf(id) >= 0) fire("keyup", spec);
    const b = pad && pad.querySelector("[data-id=" + id + "]");
    if (b) b.classList.remove("held");
  }

  /* Если кто-то ушёл со страницы или открыл паузу, держим клавиши
     отпущенными — иначе персонаж убежит сам. */
  function releaseAll() {
    Array.from(held).forEach(release);
    held.clear();
  }

  /* --- сам блок кнопок --------------------------------------------- */

  const CSS =
    "#aerisPad{position:fixed;left:0;right:0;bottom:0;z-index:70;" +
    "display:none;justify-content:space-between;align-items:flex-end;" +
    "padding:0 16px 20px;pointer-events:none;" +
    "-webkit-user-select:none;user-select:none}" +
    "#aerisPad.on{display:flex}" +
    "#aerisPad .tSet{display:grid;grid-template-columns:repeat(3,58px);" +
    "grid-template-rows:repeat(2,58px);gap:7px;pointer-events:auto}" +
    "#aerisPad button{background:rgba(255,255,255,.9);color:#2a2a2c;" +
    "border:2px solid #4f6d94;border-radius:16px;font:800 24px/1 inherit;" +
    "display:grid;place-items:center;cursor:pointer;touch-action:none;" +
    "padding:0;-webkit-tap-highlight-color:transparent;" +
    "box-shadow:0 4px 14px rgba(42,42,44,.2)}" +
    "#aerisPad button.held{background:#4f6d94;color:#fff;transform:scale(.94)}" +
    "#aerisPad .t-left{grid-area:2/1}#aerisPad .t-up{grid-area:1/2}" +
    "#aerisPad .t-down{grid-area:2/2}#aerisPad .t-right{grid-area:2/3}" +
    "#aerisPad .t-side{pointer-events:auto;display:flex;flex-direction:column;" +
    "align-items:flex-end;gap:8px}" +
    "#aerisPad .t-jump{width:86px;height:86px;border-radius:50%;font-size:17px;" +
    "background:rgba(79,109,148,.92);color:#fff;border-color:#33465f}" +
    "#aerisPad .t-hide{background:none;border:0;box-shadow:none;" +
    "color:#6c6f76;font-size:14px;padding:4px 8px;opacity:.6}";

  function build() {
    if (pad || !document.body) return;
    if (!document.getElementById("aerisPadCss")) {
      const st = document.createElement("style");
      st.id = "aerisPadCss";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const box = document.createElement("div");
    box.id = "aerisPad";

    let html = '<div class="tSet">';
    for (const id of ["up", "left", "down", "right"]) {
      html += '<button type="button" data-id="' + id +
              '" aria-label="кнопка ' + KEYS[id].key + '">' +
              KEYS[id].label + "</button>";
    }
    html += "</div>";
    html += '<div class="t-side">' +
            '<button type="button" class="t-hide">Скрыть</button>' +
            '<button type="button" data-id="jump" aria-label="прыжок">Прыжок</button>' +
            "</div>";

    box.innerHTML = html;
    document.body.appendChild(pad = box);

    /* Обработчики на всём блоке: палец можно вести за кнопку, а два
       пальца работают одновременно — стрелка и «Прыжок». */
    box.addEventListener("pointerdown", e => {
      const b = e.target.closest && e.target.closest("button[data-id]");
      if (b) {
        e.preventDefault();
        e.stopPropagation();
        if (b.setPointerCapture) { try { b.setPointerCapture(e.pointerId); } catch (_) {} }
        press(b.dataset.id);
      }
    }, true);

    const up = e => {
      const b = e.target.closest && e.target.closest("button[data-id]");
      if (b) { e.preventDefault(); release(b.dataset.id); }
    };
    box.addEventListener("pointerup", up, true);
    box.addEventListener("pointercancel", up, true);
    box.addEventListener("lostpointercapture", up, true);

    box.querySelector(".t-hide").addEventListener("click", () => {
      manual = false;
      hide();
    });

    /* Подсказка с клавиатуры: чтобы кнопки были доступны с клавиатуры
       и экранным читалкам, а не только пальцем. */
    for (const b of box.querySelectorAll("button[data-id]")) {
      b.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") press(b.dataset.id);
      });
      b.addEventListener("keyup", e => {
        if (e.key === "Enter" || e.key === " ") release(b.dataset.id);
      });
    }
  }

  /* --- показ и скрытие -------------------------------------------- */

  function show() {
    build();
    if (!pad) return;
    pad.classList.add("on");
  }

  function hide() {
    if (!pad) return;
    pad.classList.remove("on");
    releaseAll();
  }

  function isTouch() {
    return (navigator.maxTouchPoints || 0) > 0 ||
      (window.matchMedia && window.matchMedia("(pointer:coarse)").matches);
  }

  /* Вызывается при открытии игры. На компьютере без сенсора панель не
     появляется сама — иначе она занимала бы место у людей с мышкой. */
  function onGameOpen() {
    if (manual || isTouch()) show();
  }

  function onGameClose() { releaseAll(); hide(); }

  addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });

  window.AERIS_TOUCH = {
    show: show,
    hide: hide,
    onGameOpen: onGameOpen,
    onGameClose: onGameClose,
    isTouch: isTouch,
    /* Ручной переключатель: на обычном ноутбуке панель включается
       кнопкой — заодно так её можно проверить без телефона. */
    toggle: function () { manual = !padOn(); manual ? show() : hide(); return manual; },
    isOn: function () { return !!(pad && pad.classList.contains("on")); }
  };

  function padOn() { return !!(pad && pad.classList.contains("on")); }
})();