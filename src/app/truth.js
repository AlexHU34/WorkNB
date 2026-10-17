/* Честный учёт того, что человек реально сделал на сайте.
 *
 * Зачем. На карточках игр стояли выдуманные числа: «👥 45 200» и
 * «👍 94%». Каждые семь секунд таймер прибавлял к ним случайные
 * единицы, а в шапке светилось «128K сейчас в игре». Это не данные,
 * а декорация. Для своего проекта хочется правды: на карточке должно
 * стоять то, что верно.
 *
 * Что стоит вместо. Три состояния, которые всегда правда:
 *   «не начата» — человек ещё не открывал игру;
 *   «в процессе» — открывал, но ещё не доиграл;
 *   «пройдена» — доиграл, и рядом звёзды, которые он честно получил.
 *
 * Плюс настоящий жанр игры из словаря, а не внутренний код.
 *
 * Про сервер. Эти данные лежат только в браузере человека: глобального
 * счётчика без сервера не бывает, и притворяться, что он есть, было
 * бы тем же враньём. Зато теперь каждое число на экране можно
 * проверить, и оно отвечает на вопрос «а это точно правда?».
 */
(function () {
  "use strict";

  const KEY = "bb2_truth.v1";

  /* Состояние хранится одним куском, потому что писать три раза в
     localStorage на каждое событие — лишняя работа. */
  let data = { played: {}, done: {}, best: {}, visits: 0, visitsDay: "" };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      data = {
        played: p.played && typeof p.played === "object" ? p.played : {},
        done: p.done && typeof p.done === "object" ? p.done : {},
        best: p.best && typeof p.best === "object" ? p.best : {},
        visits: Number(p.visits) || 0,
        visitsDay: typeof p.visitsDay === "string" ? p.visitsDay : ""
      };
    } catch (e) { /* битое хранилище — начинаем с чистого листа */ }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { /* приватный режим браузера: просто не сохраняем */ }
  }

  function id(g) { return typeof g === "number" ? String(g) : String(g && g.id); }

  load();

  const T = {
    /* Открыли игру — честно отмечаем, что она начата. */
    markPlayed: function (g) {
      const k = id(g);
      if (!k || data.played[k]) return;
      data.played[k] = 1;
      save();
    },

    /* Доиграли. stars — настоящие звёзды за этот заход. */
    markDone: function (g, stars) {
      const k = id(g);
      if (!k) return;
      data.played[k] = 1;
      data.done[k] = 1;
      const s = Number(stars) || 0;
      if (s > (data.best[k] || 0)) data.best[k] = s;
      save();
    },

    /* «не начата» / «в процессе» / «пройдена» */
    state: function (g) {
      const k = id(g);
      if (data.done[k]) return "done";
      if (data.played[k]) return "played";
      return "new";
    },

    stars: function (g) { return data.best[id(g)] || 0; },

    /* Короткая честная подпись под названием игры. */
    meta: function (g) {
      const st = T.state(g);
      const genre = (typeof modeLabel === "function") ? modeLabel(g) : null;
      const part = genre ? genre : "";
      if (st === "done") {
        const s = T.stars(g);
        return "пройдена" + (s ? " · " + "★".repeat(s) : "");
      }
      if (st === "played") return "в процессе" + (part ? " · " + part : "");
      return part ? part + " · не начата" : "не начата";
    },

    /* Настоящие числа для шапки: сколько игр человек уже открыл. */
    counts: function () {
      const played = Object.keys(data.played).length;
      const done = Object.keys(data.done).length;
      return { played: played, done: done };
    },

    /* Визиты считаем честно: один за день на браузер, а не за
       каждую перезагрузку — иначе число раздувается само себя. */
    markVisit: function () {
      const day = new Date().toDateString();
      if (data.visitsDay === day) return;
      data.visitsDay = day;
      data.visits = (Number(data.visits) || 0) + 1;
      save();
    },

    visits: function () { return data.visits || 0; },

    data: function () { return data; }
  };

  load();

  window.AERIS_TRUTH = T;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { T.markVisit(); });
  } else {
    T.markVisit();
  }
})();