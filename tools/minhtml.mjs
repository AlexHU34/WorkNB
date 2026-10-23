// Минификация собранного файла целиком.
//
// Зачем. build.py собирает dist/*.html по модулям и проверяется гейтами,
// но игрок получает именно этот файл — 700 КБ. esbuild.mjs умеет жать
// только JS-модули, а в собранной странице самая тяжёлая часть — встроенный
// скрипт самой страницы (в приложении это 6000+ строк) и CSS. Здесь жмётся
// и то, и другое.
//
// Чего этот скрипт НЕ делает намеренно:
//   * не трогает разметку между тегами. Удаление пробелов в HTML ломает
//     вёрстку там, где элементы стоят встык (<span>a</span><span>b</span>)
//     и должны прилипать друг к другу. Выигрыш от этого мал, а риск
//     поломанной вёрстки велик;
//   * не переименовывает глобальные имена. Скрипты лежат в глобальной
//     области, гейты и другие страницы обращаются к E3, Interp, Studio
//     напрямую. Переименование ломает всё, и заметить это можно только
//     вручную. Размер теряется, целостность важнее.
//
// Проверка результата — не на глаз: tools/min-gate.py запускает настоящий
// минифицированный файл в браузере и требует, чтобы он работал.

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const [, , inRel, outRel] = process.argv;
if (!inRel || !outRel) {
  console.error("использование: node tools/minhtml.mjs <вход> <выход>");
  process.exit(2);
}

const kb = (p) => Math.round(statSync(p).size / 1024);

// Встроенный скрипт: <script> ... </script> без src.
const SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
// Стили: <style> ... </style>
const STYLE_RE = /<style([^>]*)>([\s\S]*?)<\/style>/g;

let scriptBytes = 0, styleBytes = 0;
const problems = [];

function escapeGuard(code) {
  // Внутри встроенного скрипта последовательность </script> закрыла бы тег.
  return code.replace(/<\/script>/gi, "<\\/script>");
}

async function main() {
  let html = readFileSync(inRel, "utf8");
  const before = statSync(inRel).size;

  /* Зоны встроенных скриптов ищем по позициям, а не заменой.
     Стили после этого ищем только ВНЕ этих зон: внутри ужатого
     кода законно живут собственные строковые литералы со скобками
     </style>, и наивный глобальный поиск портит скрипт, втыкая
     в его середину пересобранный «стиль». Проверенный случай:
     страница студии переставала открываться именно так. */
  const scriptSpans = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    scriptSpans.push({ start: m.index, end: m.index + m[0].length, attrs: m[1], code: m[2] });
  }
  const insideScript = (pos) =>
    scriptSpans.some((sp) => pos >= sp.start && pos < sp.end);

  const edits = []; /* {start, end, text} — непересекающиеся замены */

  for (const sp of scriptSpans) {
    if (!sp.code.trim()) continue;
    try {
      const r = await transform(sp.code, {
        loader: "js",
        minify: true,
        target: ["es2020"],
        legalComments: "none",
        charset: "utf8",
      });
      scriptBytes += sp.code.length - r.code.length;
      edits.push({
        start: sp.start,
        end: sp.end,
        text: "<script" + sp.attrs + ">\n" + escapeGuard(r.code) + "\n</script>",
      });
    } catch (e) {
      problems.push("скрипт: " + (e.errors?.[0]?.text || e.message));
    }
  }

  const styleSpans = [];
  for (const m of html.matchAll(STYLE_RE)) {
    if (insideScript(m.index)) continue; /* чужая строка внутри кода — не стиль */
    styleSpans.push({ start: m.index, end: m.index + m[0].length, attrs: m[1], code: m[2] });
  }
  for (const sp of styleSpans) {
    if (!sp.code.trim()) continue;
    try {
      const r = await transform(sp.code, {
        loader: "css",
        minify: true,
        target: ["es2020"],
        legalComments: "none",
        charset: "utf8",
      });
      styleBytes += sp.code.length - r.code.length;
      edits.push({
        start: sp.start,
        end: sp.end,
        text: "<style" + sp.attrs + ">" + r.code + "</style>",
      });
    } catch (e) {
      problems.push("стиль: " + (e.errors?.[0]?.text || e.message));
    }
  }

  /* Замены накладываем сзади наперёд, чтобы позиции не съехали. */
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    html = html.slice(0, e.start) + e.text + html.slice(e.end);
  }

  mkdirSync(dirname(outRel), { recursive: true });
  writeFileSync(outRel, html, "utf8");
  const after = statSync(outRel).size;

  console.log(
    `  ${outRel.split(/[\\/]/).pop()}: ${kb(inRel)} -> ${kb(outRel)} КБ` +
      ` (скрипты −${Math.round(scriptBytes / 1024)} КБ, стили −${Math.round(styleBytes / 1024)} КБ)`
  );
  if (problems.length) {
    console.error("  ПРОБЛЕМЫ при минификации:");
    for (const p of problems) console.error("    " + p);
    process.exitCode = 1;
  }
  return { before, after };
}

main().catch((e) => {
  console.error("минификация не удалась:", e.message);
  process.exit(1);
});