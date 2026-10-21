/* Хранилище с версией схемы и миграциями (Фаза 0.5).
 *
 * Зачем версия. Ключи bb2_* писались по мере добавления игр: формат менялся
 * молча, и у игрока после обновления пропадали монеты, работы или достижения.
 * Теперь у данных есть номер схемы, а при чтении выполняются миграции:
 *   v1 -> v2 -> ... -> CURRENT
 * Миграция обязана быть чистой функцией данных: (старый объект) -> новый.
 * Она обязана работать на любом промежуточном шаге, потому что игрок мог
 * пропустить сколько угодно обновлений.
 *
 * Старые плоские ключи (bb2_coins и подобные) поддерживаются чтением:
 * если данных под версией ещё нет, берём их из старого места и переносим.
 * Иначе обновление обнулило бы прогресс всем, кто играл раньше.
 */
/* Глобальный объект страницы. Имя не BB — ниже объявлен сам BB,
   двойное объявление const сломало бы весь файл. */
const BB_GLOBAL = (typeof window !== "undefined" ? window : globalThis);

/* Выставляем наружу: файл подключается как обычный <script src>, поэтому
   объявления верхнего уровня не попадают в window. Именно поэтому проверка
   хранилища видела "BB is not defined". */
/* Текущая версия. Повышаем на единицу, когда меняется формат данных,
   и дописываем миграцию в MIGRATIONS. */
const BB_SCHEMA = 3;

const BB_PREFIX = "bb2.v3.";

function bbKey(k) { return BB_PREFIX + k; }

/* Значения по умолчанию. Один источник правды: и миграции, и создание
   нового хранилища смотрят сюда. */
const BB_DEFAULTS = {
  favs: [], coins: 120, xp: 0, works: [], owned: [], own: [], ach: [],
  hist: [], sound: true, earn: 0, spent: 0, ecoDay: "", firsts: {},
  q: {}, theme: "dark", buff: {}, daily: "", played: false,
  memBest: 0, quizBest: -1, scents: [], wheel: 0, seen: false,
  last: 0, streak: 1, ugames: [],
  /* Ник профиля: живёт в сейве, пароля нет вообще. Пусто = «гость». */
  name: "",
  /* Настройки из окна ⚙️. Значения по умолчанию — то, что страница ставит
     сама при первом запуске; здесь они нужны, чтобы новые поля не были
     пустыми у тех, кто обновился со старой версии. */
  vol: 70, ui: 1, quality: "medium"
};

/* Старые имена -> новые. Таблица односторонняя: переносим один раз. */
const BB_RENAME = {
  "bb2_favs": "favs", "bb2_coins": "coins", "bb2_xp": "xp",
  "bb2_works": "works", "bb2_owned": "owned", "bb2_own": "own",
  "bb2_ach": "ach", "bb2_hist": "hist", "bb2_sound": "sound",
  "bb2_earn": "earn", "bb2_spent": "spent", "bb2_eco_day": "ecoDay",
  "bb2_firsts": "firsts", "bb2_q": "q", "bb2_theme": "theme",
  "bb2_buff": "buff", "bb2_daily": "daily", "bb2_played": "played",
  "bb2_mem_best": "memBest", "bb2_quiz_best": "quizBest",
  "bb2_scents": "scents", "bb2_wheel": "wheel", "bb2_seen": "seen",
  "bb2_last": "last", "bb2_streak": "streak",
  "bb2_name": "name",
  "bb2_ugames.v1": "ugames"
};

/* Миграции: индекс = версия, в которую переходим.
   Каждая читает данные предыдущей схемы и возвращает новые. */
const BB_MIGRATIONS = [
  /* 1 -> 2: рекорды памяти и викторины переехали из разрозненных ключей
     в именованные. Значения по умолчанию остаются теми же. */
  null,
  /* 2 -> 3: добавлены «мои игры» (ugames) и счётчик колеса.
     Старые значения переносим, новые заполняем по умолчанию. */
  function (d) {
    return Object.assign({}, d, {
      ugames: Array.isArray(d.ugames) ? d.ugames : [],
      wheel: typeof d.wheel === "number" ? d.wheel : 0
    });
  }
];

function bbClone(v) {
  if (v === null || typeof v !== "object") return v;
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

function bbDefaults() { return bbClone(BB_DEFAULTS); }

/* Сырое чтение из localStorage без миграций. */
function bbReadRaw(name) {
  try {
    const s = localStorage.getItem(bbKey(name));
    if (s === null) return undefined;
    return JSON.parse(s);
  } catch (e) {
    return undefined;
  }
}

/* Перенос со старых плоских ключей. Вызывается один раз при первом
   обращении к данным: если нового хранилища ещё нет, но старые ключи есть —
   это игрок, который играл до версионирования. */
function bbImportLegacy() {
  const out = bbDefaults();
  let found = false;
  for (const oldKey in BB_RENAME) {
    const name = BB_RENAME[oldKey];
    let raw = null;
    try { raw = localStorage.getItem(oldKey); } catch (e) { continue; }
    if (raw === null) continue;
    try {
      const v = JSON.parse(raw);
      if (v !== null && v !== undefined) { out[name] = v; found = true; }
    } catch (e) {
      // битое значение: не мешаем, но и не переносим мусор
    }
  }
  return found ? out : null;
}

/* Задержка склейки записи. Игрок не должен ждать диск на каждое действие:
   покупка, лайк и переключение темы шли в localStorage по одной записи,
   и каждая сериализовала весь прогресс целиком. Теперь изменения
   накапливаются, а запись происходит один раз за паузу. 600 мс выбраны так,
   чтобы даже активная серия нажатий уложилась в одну запись. */
const BB_SAVE_DEBOUNCE = 600;

const BB = {
  schema: BB_SCHEMA,
  data: null,
  /* Отложенная запись: таймер, флаг «есть что писать» и последняя ошибка. */
  _timer: null,
  _pending: false,
  lastError: null,
  /* Подписчик на ошибку записи. Приложение показывает toast, иначе сбой
     квоты молча терял бы прогресс — игрок узнавал об этом только после
     перезапуска. */
  onError: null,

  /* Загрузка с миграциями. Вызывается один раз при старте страницы. */
  load() {
    if (this.data) return this.data;
    /* Двойное хранение: основная запись + резервная копия того же
       сериала (data_bak). Если основная битая (экстренный выключатель
       света во время записи, сбой диска, ручная порча),
       восстанавливаем из резерва — это дешевле, чем потерять работы. */
    const stored = bbReadRaw("data");
    if (stored && typeof stored === "object") {
      this.data = this._migrate(stored);
      return this.data;
    }
    const backup = bbReadRaw("data_bak");
    if (backup && typeof backup === "object") {
      this.data = this._migrate(backup);
      this.save(); /* чиним основную запись сразу же */
      this.repaired = true;
      return this.data;
    }
    /* Ни основной, ни резервной: пробуем старые ключи. */
    const legacy = bbImportLegacy();
    if (legacy) {
      legacy.version = this.schema;
      this.data = legacy;
      this.save();
      return legacy;
    }
    this.data = bbDefaults();
    this.save();
    return this.data;
  },

  /* Версии иdefaults поверх: общий шаг для основной записи и резерва. */
  _migrate(stored) {
    let d = stored;
    let v = typeof d.version === "number" ? d.version : 1;
    while (v < this.schema) {
      const mig = BB_MIGRATIONS[v];
      if (mig) d = mig(d) || d;
      v++;
    }
    const def = bbDefaults();
    for (const k in def) if (d[k] === undefined) d[k] = def[k];
    d.version = this.schema;
    return d;
  },

  /* Немедленная запись. Возвращает успех; ошибку запоминает и сообщает. */
  save() {
    if (!this.data) return false;
    this.data.version = this.schema;
    this._pending = false;
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
    try {
      const text = JSON.stringify(this.data);
      localStorage.setItem(bbKey("data"), text);
      this.lastError = null;
      /* Резервная копия — та же строка в другом ключе. Своя порция
         try/catch: случай «влезло только одной записи» не должен
         аннулировать успех основной записи. */
      try { localStorage.setItem(bbKey("data_bak"), text); } catch (e2) {}
      return true;
    } catch (e) {
      /* Переполнение квоты или приватный режим: прогресс уже не сохранить.
         Это надо показать игроку, а не проглотить. */
      this.lastError = e;
      if (typeof this.onError === "function") {
        try { this.onError(e); } catch (_e) {}
      }
      return false;
    }
  },

  /* Отложенная запись: копит изменения и пишет один раз за паузу. */
  scheduleSave() {
    this._pending = true;
    if (this._timer !== null) return;
    this._timer = setTimeout(() => { this._timer = null; this.save(); }, BB_SAVE_DEBOUNCE);
  },

  /* Немедленно сбросить накопившееся на диск. Нужно перед закрытием
     вкладки: без этого последние 600 мс правок пропали бы. */
  flush() {
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
    if (this._pending) this.save();
    return true;
  },

  get(name, dflt) {
    const d = this.load();
    return d[name] !== undefined ? d[name] : dflt;
  },
  set(name, value) {
    const d = this.load();
    d[name] = value;
    this.scheduleSave();
    return value;
  },

  /* Полный сброс. Только для настроек «начать заново». */
  reset() {
    this.data = bbDefaults();
    return this.save();
  },

  /* Экспорт в файл: пользователь может забрать прогресс и вернуть его.
     Обязательно для офлайн-приложения, где нет аккаунтов и сервера. */
  exportText() { return JSON.stringify(this.load(), null, 2); },

  /* Импорт из строки. Проверяет версию и откатывается к текущей:
     неизвестная будущая схема лучше отбрасывается, чем ломает игру. */
  importText(text) {
    let obj = null;
    try { obj = JSON.parse(text); } catch (e) {
      return { ok: false, error: "Это не сохранение: файл повреждён" };
    }
    if (!obj || typeof obj !== "object") {
      return { ok: false, error: "Это не сохранение: ожидался объект" };
    }
    let v = typeof obj.version === "number" ? obj.version : 1;
    if (v > this.schema) {
      return { ok: false, error: "Сохранение из более новой версии программы — обнови программу" };
    }
    while (v < this.schema) {
      const mig = BB_MIGRATIONS[v];
      if (mig) obj = mig(obj) || obj;
      v++;
    }
    const def = bbDefaults();
    for (const k in def) if (obj[k] === undefined) obj[k] = def[k];
    /* Лишние поля сохраняем: новые ключи не должны теряться при откате. */
    obj.version = this.schema;
    this.data = obj;
    this.save();
    return { ok: true };
  },

  /* Размер хранилища: полезно понимать, не переполняем ли мы квоту. */
  bytes() {
    try {
      const s = localStorage.getItem(bbKey("data"));
      return s ? s.length : 0;
    } catch (e) {
      return 0;
    }
  }
};

/* Выставляем наружу: файл подключается обычным <script src>, поэтому
   const верхнего уровня не становится свойством window. Раньше проверка
   хранилища видела «BB is not defined» — именно поэтому. */
BB_GLOBAL.BB = BB;
BB.load();

/* Сброс отложенной записи перед уходом со страницы. Без этого последние
   правки могли не дойти до диска: debounce держит их в памяти. */
if (typeof addEventListener === "function") {
  addEventListener("pagehide", function () { BB.flush(); });
  addEventListener("visibilitychange", function () {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") BB.flush();
  });
}