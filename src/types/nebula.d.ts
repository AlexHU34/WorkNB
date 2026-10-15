/* Описания типов движка и языка для редактора кода.
 *
 * Зачем. tsconfig.json указывал на папку src, но файлов .ts в проекте
 * НОЛЬ. Команда `npm run types` молча проходила, создавая иллюзию
 * защиты: казалось, что типы проверяются, а не проверялось ничего.
 *
 * Что здесь. Только описания — код не переписывается. Задача скромнее,
 * но достижимая: редактор начинает подсказывать имена и показывать, где
 * ожидается число, а где строка.
 *
 * Файл проверяется гейтом tools/types-gate.py: если описание разойдётся
 * с настоящим кодом (переименовали метод и забыли здесь), проверка падает.
 * Без такой проверки описания устареют за месяц и станут вредными —
 * подсказки будут врать.
 */

/* ============================== ДВИЖОК E3 ============================== */

/** Одна грань: четыре вершины, цвет, нормаль. Основной кирпич сцены. */
interface E3Face {
  v: number[][];      /* вершины [x,y,z] */
  c: string;          /* цвет: "#rrggbb" или CanvasPattern */
  n?: number[];       /* нормаль; нет — вычислится по вершинам */
  /** Заливка: 1 — плоская, 2 — тень. */
  e?: 0 | 1 | 2;
  a?: number;         /* прозрачность 0..1 */
  /** Признак замкнутого объёма: включает отсечение обратных граней. */
  s?: boolean;
  /** Спрайт-эмодзи. */
  k?: boolean;
  /** Экземпляр плоскости вместо грани. */
  pl?: boolean;
}

interface E3Cam {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
}

interface E3LitOptions {
  ao?: number;          /* затенение угла */
  sky?: number;         /* доля небесного света */
  l2?: number[];        /* второй источник света */
  l2w?: number;         /* сила второго источника */
  spec?: number;        /* блеск 0..1 */
  shin?: number;        /* резкость блика */
}

interface E3DrawOptions extends E3LitOptions { }

/** Профилировщик кадра: где именно уходит время. */
interface E3Profile {
  on: boolean;
  start(): void;
  stop(): void;
  reset(): void;
  push(rec: unknown): void;
  /** Среднее время кадра в мс. */
  avg(): number;
  /** Разбивка по этапам: подготовка, сортировка, заливка. */
  breakdown(): Record<string, number>;
  /** Готовый текст отчёта. */
  report(): string;
  onBudgetChange(): void;
}

/** Сторож частоты кадров: сам опускает бюджет граней при просадке. */
interface E3Auto {
  on: boolean;
  min: number;
  ms: number;
  last: number;
  frames: number[];
  tick(t: number): void;
  measure(dt: number, t?: number): void;
}

type E3Quality = "low" | "medium" | "high";

interface E3 {
  /** Проекция точки в видовое пространство камеры. */
  view(p: number[], cam: E3Cam): number[];
  /** Проекция из видового пространства в экранные координаты. */
  proj(p: number[], fl: number, W: number, H: number): number[];

  /** Затемнение цвета: shade("#ff0000", 0.5) — вдвое темнее. */
  shade(hex: string, f: number): string;

  tri(a: number[], b: number[], c: number[], col?: string, n?: number[]): E3Face;
  poly(pts: number[][], col?: string, n?: number[]): E3Face;
  /** Четырёхугольник по четырём точкам. */
  quad(a: number[], b: number[], c: number[], d: number[], col?: string, n?: number[]): E3Face;

  /** Куб. Точка — центр объёма, не угол. */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, c?: string): E3Face[];
  /** Пирамида. Точка — центр объёма. */
  pyramid(cx: number, cy: number, cz: number, w: number, h: number, d: number, c?: string): E3Face[];
  /** Сфера как набор граней. */
  rbox(cx: number, cy: number, cz: number, w: number, h: number, d: number, az?: number, c?: string): E3Face[];
  /** Пол земли из плиток. */
  tiles(w: number, d: number, o?: { c?: string }): E3Face[];

  /**
   * Пол-сетка: одна плоскость вместо gw*gh плиток.
   * Рисуется особым кодом, поэтому на большой сцене заметно быстрее tiles.
   * cb(x, z) возвращает цвет клетки.
   */
  tileMap(gw: number, gh: number, tw: number, th: number,
          cb: (x: number, z: number) => string,
          o?: { x?: number; y?: number; z?: number; c?: string }): E3Face[];

  /**
   * Узел с иерархией трансформа: манипуляторы, ноги и руки, стрела крана.
   * Внутри даёт свои box и sprite, уже с учётом поворота и масштаба.
   * f(api) вызывается сразу, если передан.
   */
  node(t?: { x?: number; y?: number; z?: number; ry?: number; rx?: number;
             rz?: number; s?: number },
       f?: (api: E3NodeApi) => void): E3NodeApi;

  /** Тень под объектом. */
  shadow(x: number, z: number, r: number, h?: number, o?: {
    y?: number; a?: number; sq?: number; c?: string;
  }): E3Face[];

  /** Спрайт-эмодзи, участвует в сортировке по глубине. */
  sprite(x: number, y: number, z: number, size: number,
         text: string, col?: string, glow?: number): E3Face;

  /** Текстура-паттерн: checker, stripes, grid, noise, water, bricks. */
  pattern(ctx: CanvasRenderingContext2D, kind: string, c1?: string, c2?: string): CanvasPattern;

  /** Освещение сцены: вычисляет цвет грани. */
  lit(n: number[], L: number[], o?: E3LitOptions): [number, number, number];

  /** Блик: яркость блика по нормали, направлению света и взгляду. */
  spec(n: number[], L: number[], V: number[], k: number, shin?: number): number;

  /** Главный кадр. faces — то, что собрали box/shadow/sprite. */
  draw(ctx: CanvasRenderingContext2D, faces: E3Face[], cam: E3Cam,
       fl: number, L: number[], opts?: E3DrawOptions): void;

  /** Поставить предел числа граней: 0 — без предела. */
  budget(n?: number): number;
  maxFaces: number;
  maxTiles: number;
  cull: boolean;
  fog: number[] | null;

  /** Профилировщик и сторож FPS. */
  profile: E3Profile;
  auto: E3Auto;

  /** Уровень графики: влияет на скорость, не на содержание. */
  setQuality(level: E3Quality): E3Quality;
  quality: E3Quality;

  /** Статистика последнего кадра. */
  stats: {
    faces: number;     /* нарисовано */
    culled: number;    /* отсечено как обратные */
    dropped: number;   /* выброшено по бюджету */
    total: number;     /* подано граней */
    tiles: number;
    ms: number;
  };
}

interface E3NodeApi {
  x: number; y: number; z: number;
  /** Точка узла в мировых координатах. */
  P(v: number[]): number[];
  /** Нормаль узла в мировых координатах. */
  n(v: number[]): number[];
  /** Куб внутри узла: размеры и цвет. */
  box(w: number, h: number, d: number, col?: string): E3Face[];
  /** Спрайт внутри узла. */
  sprite(zz: number, size: number, text: string, col?: string, glow?: number): E3Face;
}

declare const E3: E3;

/* ============================ ЗАДНИЙ ПУТЬ GL ============================ */

interface E3GL {
  /** Подключить слой к канве. false — WebGL2 недоступен. */
  attach(ctx: CanvasRenderingContext2D): boolean;
  /** Включить рисование на видеокарте. */
  enable(): boolean;
  disable(): void;
  ok: boolean;
  want: boolean;
  stats(): { err: string };
}

declare const E3GL: E3GL;

/* ======================== ФИКСИРОВАННЫЙ ШАГ И ПУЛ ======================== */

interface E3Step {
  /** Частота шагов в секунду: 60 по умолчанию. */
  setup(hz?: number): void;
  start(): void;
  /** Сколько шагов набежало за кадр. */
  advance(ms: number): number;
  /** Длительность шага в секундах. */
  renderDt(): number;
  reset(): void;
  report(): string;
  dt: number;
  steps: number;
  dropped: number;
}

declare const E3Step: E3Step;

/** Пул объектов: переиспользование вместо new в кадре.
 *  E3Pool.pool("particle", ...) создаёт вид объектов; дальше
 *  берутся через pool.take() и возвращаются через give(obj). */
interface E3PoolKind {
  take(): unknown;
  give(obj: unknown): void;
}
interface E3PoolApi {
  /** Создать или вернуть уже существующий вид объектов. */
  pool(name: string, factory: () => unknown): E3PoolKind;
  /** Сколько объектов живёт в пуле прямо сейчас. */
  count(name?: string): number;
}
declare const E3Pool: E3PoolApi;

/* ============================= ИНТЕРПРЕТАТОР ============================= */

declare class LangError extends Error {
  constructor(msg: string, line: number);
  line: number;
}

/** Узел разбора: {t: "num", v: 42}. */
type LangNode = { t: string; v?: unknown; line?: number; [k: string]: unknown };

declare class Env {
  constructor(parent: Env | null);
  get(name: string): unknown;
  has(name: string): boolean;
  set(name: string, val: unknown): void;
  declare(name: string, val: unknown, konst?: boolean): void;
}

declare class Interp {
  constructor(host: object);
  /** Предел вложенных вызовов функций. */
  maxDepth: number;
  /** Предел объектов на запуск. */
  maxObjects: number;
  /** Предел времени кадра, мс. */
  maxMs: number;
  deadline: number;
  steps: number;
  maxSteps: number;
  globals: Env;
  runEnv: Env | null;
  run(ast: LangNode[], env: Env): unknown;
  /** Сбросить счётчики между кадрами. */
  resetLimits(): void;
  /** Запустить отсчёт времени кадра. */
  startClock(ms?: number): void;
}

/** Разобрать исходный код BloomScript в дерево. Бросает LangError. */
declare function parse(src: string): LangNode[];

/* ============================== ИГРОВАЯ СРЕДА ============================= */

/**
 * Игровая среда для кода. Один вызов на игру.
 *
 * gameId разделяет сохранения: без него все игры писали бы в одну
 * ячейку и затирали прогресс друг друга.
 */
declare function createRuntime(opts: {
  canvas: HTMLCanvasElement;
  logicalWidth?: number;
  logicalHeight?: number;
  scale?: number;
  stat?: HTMLElement | null;
  /** Стабильный ключ сохранения. */
  gameId?: string | number;
  /** Читает значение из локального хранилища. */
  loadModule?(path: string, line: number): string | null;
  log?(msg: string, cls?: string): void;
  clear?(): void;
  status?(screen: string, ms: number): void;
  /** Вызывается при ошибке запуска и при остановке. */
  onError?(e: LangError | null): void;
  /** Включить фиксированный шаг симуляции. */
  fixedStep?: boolean | number;
  /** Включить ускоренный путь WebGL2. */
  gl?: boolean;
}): {
  launch(src: string): boolean;
  stopLoop(): void;
  lastError: LangError | null;
  hooks: { setup?: unknown; update?: unknown; draw?: unknown };
  stats?: Record<string, unknown>;
};

/* ================================= STUDIO ================================ */

interface StudioObject {
  id: string;
  name: string;
  kind: "box" | "pyramid" | "sprite";
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  size: number;
  color: string;
  phase: number;
}

interface StudioScene {
  version: number;
  title: string;
  bg: [string, string];
  ground: { w: number; d: number; color: string };
  camera: { x: number; y: number; z: number; yaw: number; pitch: number };
  animated: boolean;
  objects: StudioObject[];
}

interface Studio {
  KINDS: Record<string, { label: string; call: string; args: string[] }>;
  blank(): StudioScene;
  /** Привести любое значение к корректной сцене. */
  normalize(raw: unknown): StudioScene;
  addObject(scene: StudioScene, kind: string): StudioObject;
  removeObject(scene: StudioScene, id: string): boolean;
  findObject(scene: StudioScene, id: string): StudioObject | null;
  /** Сцена -> код BloomScript. */
  toBloomScript(scene: StudioScene): string;
  save(scene: StudioScene): boolean;
  load(): StudioScene;
  publish(scene: StudioScene): { ok: boolean; id?: string; src?: string; error?: string };
}

declare const Studio: Studio;

/* ======================= ФУНКЦИИ ДЛЯ ИГР ==============================
 * Это всё, что можно вызвать из кода игры на BloomScript — 88 имён.
 * Список не для красоты: если переименуют или уберут функцию, гейт
 * tools/types-gate.py сравнит его с runtime.js и упадёт. Так описания
 * не смогут тихо устареть.
 *
 * Игровой код не компилируется TypeScript, поэтому список лежит здесь
 * как данные: редактор кода может его читать для подсказок.
 */
declare const NEBULA_NATIVES: readonly string[];

/* ============================== ХРАНИЛИЩЕ =============================== */

interface BBStore {
  schema: number;
  data: Record<string, unknown> | null;
  lastError: unknown;
  onError: ((e: unknown) => void) | null;
  load(): Record<string, unknown>;
  /** Немедленная запись. */
  save(): boolean;
  /** Отложенная запись: копит изменения и пишет раз в паузу. */
  scheduleSave(): void;
  /** Сбросить накопленное на диск — вызывается при уходе со страницы. */
  flush(): void;
  get(name: string, dflt?: unknown): unknown;
  set(name: string, value: unknown): unknown;
  reset(): boolean;
  exportText(): string;
  importText(text: string): { ok: boolean; error?: string };
  bytes(): number;
}

declare const BB: BBStore;

/* ============================== ДИАГНОСТИКА ============================== */

interface NebulaDiag {
  log: Array<{ kind: string; text: string; count: number; at: number; page: string }>;
  show(): void;
  open(): void;
  report(kind: string, text: unknown, extra?: string): void;
  count(): number;
  text(): string;
  clear(): void;
}

declare const NebulaDiag: NebulaDiag;