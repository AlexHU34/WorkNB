// Второй путь сборки: esbuild.
//
// Зачем он нужен при живом build.py. build.py инлайнит модули «как есть»
// и проверен гейтами (сборка целостности + офлайн-гейт). Ломать его,
// пока не доказано обратное, нельзя. esbuild даёт вторую, независимую
// сборку: минифицированную. По ней видно, сколько на самом деле стоит
// код после сжатия и сколько выиграем на размере, если решим перейти.
//
// Сейчас esbuild НИЧЕГО не подменяет: результат кладётся рядом с
// dist/ и используется только для отчёта о размере.
//
//   node tools/esbuild.mjs            отчёт о размере
//   node tools/esbuild.mjs --watch    пересборка при изменениях

import { transform } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Имена, без которых страница не запустится. Проверяются в готовом
// бандле. Без этой проверки esbuild выдаёт «успех» с почти пустым файлом:
// он вырезает неиспользуемые объявления, а страница падает уже в браузере.
//
// Список — на каждую цель СВОЙ. У Studio нет ни интерпретатора, ни
// шага/пула: она грузит только движок и свою модель. Единый список
// ругался бы на то, чего там и не должно быть.
const COMMON = ["E3"];
const REQUIRED_ALL = { app: COMMON, studio: COMMON, editor: COMMON };
REQUIRED_ALL.app = REQUIRED_ALL.app.concat([
  "E3Step", "E3Pool", "createRuntime", "Interp", "parse", "Env",
]);
REQUIRED_ALL.editor = REQUIRED_ALL.editor.concat([
  "E3Step", "E3Pool", "createRuntime", "Interp", "parse", "Env",
]);
REQUIRED_ALL.studio = REQUIRED_ALL.studio.concat(["Studio"]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT = join(DIST, "bundle");

// Страница -> модули в порядке подключения. Порядок значим: e3 нужен
// до интерпретатора, интерпретатор — до моста. esbuild сохраняет его.
const TARGETS = {
  app: {
    key: "app",
    entry: "NebulaBloom.js",
    ref: "NebulaBloom.html",
    modules: [
      "src/data/store.js",
      "src/engine/e3.js",
      "src/engine/e3gl.js",
      "src/engine/time.js",
      "src/lang/core.js",
      "src/lang/runtime.js",
      "src/lang/play.js",
      "src/app/games.js",
    ],
  },
  studio: {
    key: "studio",
    entry: "NebulaStudio.js",
    ref: "NebulaStudio.html",
    modules: ["src/engine/e3.js", "src/studio/scene.js", "src/studio/editor.js",
      "src/studio/codewin.js"],
  },
  editor: {
    key: "editor",
    entry: "BloomScript.js",
    ref: "BloomScript.html",
    modules: [
      "src/engine/e3.js",
      "src/engine/e3gl.js",
      "src/engine/time.js",
      "src/lang/core.js",
      "src/lang/runtime.js",
    ],
  },
};

const watch = process.argv.includes("--watch");

function kb(p) {
  try {
    return Math.round(statSync(p).size / 1024);
  } catch {
    return 0;
  }
}

// Модули — обычные скрипты, а не ES-модули: они ничего не export-ят,
// а просто объявляют классы и функции в общей области. Склейка и
// минификация идут пофайлово, см. bundle() — почему именно так, там же.
function stdinFor() {
  throw new Error("stdinFor больше не используется — см. bundle()");
}

// Бандл может выполниться без единой ошибки и при этом не содержать
// половины нужного: esbuild молча вырезает объявления, которые считает
// неиспользуемыми. Поэтому проверяем не «ошибок нет», а «всё на месте».
//
// Проверка идёт выражением typeof ИМЯ в глобальной области, а не чтением
// свойств объекта. Причина — два разных способа попасть в глобальную
// область. class Interp и class Env объявлены через class и лежат в
// глобальной лексической области, но НЕ являются свойствами window.
// А E3Step и E3Pool, наоборот, вешаются на window изнутри IIFE, и
// глобального имени у них нет. Поэтому имя считается найденным, если
// есть ЛИБО лексическая привязка, ЛИБО свойство window.
function verifyBundle(path, required) {
  const win = {};
  const sandbox = {
    window: win,
    globalThis: win,
    self: win,
    console,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    performance: { now: () => 0 },
    // Стенд без DOM проверяет, что склеенный файл вообще исполняется и
    // объявляет нужные имена, а не рисует интерфейс. document нужен
    // редактору уже при загрузке: он спрашивает readyState. Ставим
    // "loading", чтобы старт не пошёл на пустой разметке.
    document: {
      readyState: "loading",
      getElementById: () => null,
      addEventListener: () => {},
      createElement: () => ({
        style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        appendChild() {}, querySelector: () => null,
      }),
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  };
  try {
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(path, "utf8"), sandbox);
  } catch (e) {
    return ["бандл падает при выполнении: " + e.message.split("\n")[0]];
  }
  const missing = [];
  for (const k of required) {
    let lexical;
    try {
      lexical = vm.runInContext("typeof " + k, sandbox) !== "undefined";
    } catch {
      lexical = false;
    }
    if (!lexical && typeof win[k] === "undefined") missing.push("потерян " + k);
  }
  return missing;
}

// Минифицируем КАЖДЫЙ файл отдельно, а склеиваем сами.
//
// Почему не build(): esbuild считает точку входа ES-модулем и вырезает
// объявления, на которые никто не ссылается — class Interp и function
// tokenize он считает чистыми и выбрасывает весь интерпретатор. Проверено
// на четырёх вариантах (bundle:true, bundle:false, обёртка в функцию,
// экспорт через globalName): первый даёт 22 КБ вместо 81 и теряет E3,
// Interp, parse, Env, createRuntime. Обёртка чинит размер, но var E3
// становится локальной переменной функции и тоже вырезается.
//
// transform() работает с одним файлом и не разрешает импорты, поэтому
// вырезать ему нечего. Склейка — в том же порядке, что и в build.py,
// поведение не меняется.
//
// Отдельный плюс: файлы остаются обычными скриптами, а не ES-модулями.
// Это принципиально: ES-модули через file:// не грузятся (CORS), а
// продукт обязан открываться двойным щелчком с диска.
async function bundle(target) {
  const parts = [];
  for (const m of target.modules) {
    const code = readFileSync(join(ROOT, m), "utf8");
    const r = await transform(code, {
      loader: "js",
      minify: true,
      target: ["es2020"],
      legalComments: "none",
      charset: "utf8",
    });
    parts.push("/* " + m + " */\n" + r.code);
  }
  mkdirSync(OUT, { recursive: true });
  const dest = join(OUT, target.entry);
  writeFileSync(dest, parts.join("\n;\n"), "utf8");
  return { dest, minified: kb(dest), missing: verifyBundle(dest, REQUIRED_ALL[target.key]) };
}

async function main() {
  if (watch) {
    for (const t of Object.values(TARGETS)) await bundle(t);
    console.log("слежу за изменениями, пересобираю при изменениях");
    return;
  }

  const lines = [
    "отчёт о размере сборки",
    "сгенерировано: " + new Date().toISOString(),
    "",
    "столбцы: сборка build.py (эталон, проверен гейтами) | esbuild (минифицированная)",
    "",
  ];
  const rows = [];

  for (const [name, t] of Object.entries(TARGETS)) {
    const r = await bundle(t);
    const ref = join(DIST, t.ref);
    const refKb = kb(ref);
    rows.push({ name, refKb, min: r.minified, missing: r.missing });
    lines.push(
      `${name.padEnd(7)} build.py HTML: ${String(refKb).padStart(4)} КБ` +
        `   esbuild JS: ${String(r.minified).padStart(4)} КБ` +
        (r.missing.length ? `   БЕЗ: ${r.missing.join(", ")}` : "   целый")
    );
  }

  lines.push("");
  lines.push(
    "Эталон build.py включает разметку и CSS, esbuild — только код."
  );
  lines.push(
    "Поэтому меньший вес esbuild не означает меньшую сборку целиком:"
  );
  lines.push(
    "переход возможен, только если разметка тоже уедет в сборщик."
  );

  const broken = rows.filter((r) => r.missing.length);
  if (broken.length) {
    lines.push("");
    lines.push(
      "ВНИМАНИЕ: esbuild-путь даёт неполную сборку:" +
        broken.map((r) => r.name).join(", ")
    );
    lines.push(
      "Причина в колонке БЕЗ. Подробности — в stdout этой команды."
    );
    lines.push("Выкладка идёт через build.py — он проверен гейтами.");
  }

  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, "size-report.txt"), lines.join("\n") + "\n", "utf8");

  for (const r of rows) {
    console.log(`${r.name}: ${r.refKb} КБ HTML / ${r.min} КБ JS` +
      (r.missing.length ? `  БЕЗ: ${r.missing.join(", ")}` : "  целый"));
  }
  console.log("отчёт: dist/size-report.txt");

  // Тишина тут была бы враньём: сборка «прошла», а страница не грузится.
  if (rows.some((r) => r.missing.length)) {
    console.log("");
    console.log(
      "esbuild-путь непригоден: сборка неполна или не исполняется."
    );
    console.log(
      "Подробности — в колонке БЕЗ выше и в dist/size-report.txt."
    );
    console.log("Рабочая сборка — build.py, она проверена гейтами.");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("сборка не удалась:", e.message);
  process.exit(1);
});