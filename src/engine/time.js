/* Фиксированный шаг (Фаза 1.3) + пул объектов (Фаза 1.3).
 *
 * Фиксированный шаг. Сейчас кадр = «сколько успели за кадр»: dt зависит от
 * частоты монитора и от просадок. Из-за этого физика и таймеры разъезжаются:
 * на 144 Гц всё быстрее, при просадке до 20 мс всё летит. Фиксированный шаг
 * делает симуляцию независимой от машины: логика всегда получает один и тот
 * же dt, а «догоняющие» шаги ограничены — иначе после паузы кадр
 * «догоняет» полсекунды и игра подвисает.
 *
 * Пул объектов. Частицы, осколки и враги создаются и исчезают каждый кадр;
 * без переиспользования это давление на сборщик мусора. Пул отдаёт структуры
 * из свободного списка. Объект не исчезает сам: он считается живым, пока
 * не вызван release() — иначе опечатка в игре тихо течёт память.
 */
(function () {

const BASE_DT = 1 / 60;      /* базовый шаг симуляции, секунды */
const MAX_CATCHUP = 5;       /* больше «догоняющих» шагов не делаем */
const POOL_MAX = 4096;       /* предел живых объектов пула */

/* ============================ ФИКСИРОВАННЫЙ ШАГ ============================ */
const E3Step = {
  hz: 60,
  dt: BASE_DT,
  max: MAX_CATCHUP,
  acc: 0,
  alpha: 0,
  steps: 0,
  dropped: 0,
  time: 0,

  /* Настроить шаг: 60 Гц по умолчанию, 30 для тяжёлых сцен. */
  setup(hz) {
    E3Step.hz = Math.max(1, Math.min(240, hz || 60));
    E3Step.dt = 1 / E3Step.hz;
    return E3Step.dt;
  },

  /* Начать отсчёт: обнулить накопитель, чтобы не «догонять» после паузы. */
  start() {
    E3Step.acc = 0;
    E3Step.time = 0;
    E3Step.steps = 0;
    E3Step.dropped = 0;
    return E3Step;
  },

  /* Сколько шагов сделать на кадре реальной длительностью dtMs.
     Возвращает целое число шагов; остаток лежит в alpha для интерполяции. */
  advance(dtMs) {
    let dt = dtMs / 1000;
    if (!(dt > 0)) return 0;
    if (dt > 0.25) dt = 0.25;          /* после заморозки вкладки не гонимся */
    E3Step.acc += dt;
    let n = 0;
    while (E3Step.acc >= E3Step.dt && n < E3Step.max) {
      E3Step.acc -= E3Step.dt;
      E3Step.time += E3Step.dt;
      n++;
    }
    /* Шагов не хватило — машина не тянет. Остаток отбрасываем и считаем:
       иначе долг растёт и через минуту кадр встаёт. */
    if (E3Step.acc >= E3Step.dt) {
      E3Step.dropped += E3Step.acc / E3Step.dt;
      E3Step.acc = 0;
    }
    E3Step.steps = n;
    E3Step.alpha = E3Step.acc / E3Step.dt;
    return n;
  },

  /* dt для отрисовки и HUD: всегда фиксированный. */
  renderDt() { return E3Step.dt; },

  /* Человекочитаемо: сколько шагов потеряно — признак нехватки кадров. */
  report() {
    return "шаг 1/" + E3Step.hz + " с, шагов в кадре " + E3Step.steps +
      ", потеряно " + Math.round(E3Step.dropped) + ", симуляционное время " +
      E3Step.time.toFixed(2) + " с";
  }
};

/* ================================ ПУЛ ОБЪЕКТОВ =============================
 * Один пул на вид объектов: E3Pool.pool("particle", ...) создаёт новый вид.
 * Готовые шаблоны (particle, debris, enemy, bullet) — то, что чаще всего
 * мусорит в кадре. */
function makePool(name, make, reset) {
  const pool = {
    name: name,
    live: 0,
    made: 0,
    reused: 0,
    free: [],
    peak: 0,
    /* Взять объект. null, если предел исчерпан: честнее, чем уход в ноль. */
    take() {
      let o = pool.free.pop();
      if (o === undefined) {
        if (pool.live + pool.free.length >= POOL_MAX) return null;
        o = make();
        pool.made++;
        o.__pool = pool;          /* чтобы release(obj) нашёл свой пул */
      } else {
        pool.reused++;
      }
      if (reset) reset(o);
      o.__alive = 1;
      pool.live++;
      if (pool.live > pool.peak) pool.peak = pool.live;
      return o;
    },
    /* Вернуть объект. Чужой или уже отпущенный игнорируем: двойной
       release — частая ошибка, и молчаливая порча хуже отказа. */
    release(o) {
      if (!o || o.__alive !== 1 || o.__pool !== pool) return false;
      o.__alive = 0;
      pool.live--;
      if (pool.free.length < POOL_MAX) pool.free.push(o);
      return true;
    },
    /* Отпустить всё разом: смена сцены, перезапуск игры. */
    releaseAll(list) {
      if (!list) return 0;
      let n = 0;
      for (const o of list) if (pool.release(o)) n++;
      list.length = 0;
      return n;
    },
    stats() {
      return { name: pool.name, live: pool.live, made: pool.made,
               reused: pool.reused, peak: pool.peak, free: pool.free.length };
    },
    clear() {
      pool.free.length = 0;
      pool.live = 0;
      pool.peak = 0;
    }
  };
  return pool;
}

/* Реестр пулов. Игра запрашивает пул один раз и держит ссылку. */
const POOLS = Object.create(null);

const E3Pool = {
  pool(name, make, reset) {
    let p = POOLS[name];
    if (!p) { p = makePool(name, make, reset); POOLS[name] = p; }
    return p;
  },
  get(name) { return POOLS[name] || null; },
  stats() {
    const pools = Object.keys(POOLS).map(k => POOLS[k].stats());
    const total = { live: 0, made: 0, reused: 0, peak: 0 };
    for (const s of pools) {
      total.live += s.live; total.made += s.made; total.reused += s.reused;
      if (s.peak > total.peak) total.peak = s.peak;
    }
    return { pools: pools, total: total };
  },
  clear() { for (const k in POOLS) POOLS[k].clear(); }
};

/* Готовые шаблоны. */
E3Pool.pool("particle",
  () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 1, c: "#fff" }),
  o => { o.x = o.y = o.z = 0; o.vx = o.vy = o.vz = 0; o.life = 1; o.size = 1; o.c = "#fff"; });
E3Pool.pool("debris",
  () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, spin: 0, life: 1 }),
  o => { o.x = o.y = o.z = 0; o.rx = o.ry = o.rz = 0; o.spin = 0; o.life = 1; });
E3Pool.pool("enemy",
  () => ({ x: 0, y: 0, z: 0, hp: 1, kind: 0, alive: true }),
  o => { o.x = o.y = o.z = 0; o.hp = 1; o.kind = 0; o.alive = true; });
E3Pool.pool("bullet",
  () => ({ x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, life: 1 }),
  o => { o.x = o.y = o.z = 0; o.dx = o.dy = o.dz = 0; o.life = 1; });

if (typeof window !== "undefined") {
  window.E3Step = E3Step;
  window.E3Pool = E3Pool;
}
})();