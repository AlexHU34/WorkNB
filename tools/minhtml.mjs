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

  const scripts = [];
  html = html.replace(SCRIPT_RE, (m, attrs, code) => {
    scripts.push({ m, attrs, code });
    return m;
  });
  for (let i = 0; i < scripts.length; i++) {
    const { m, attrs, code } = scripts[i];
    if (!code.trim()) continue;
    try {
      const r = await transform(code, {
        loader: "js",
        minify: true,
        target: ["es2020"],
        legalComments: "none",
        charset: "utf8",
      });
      scriptBytes += code.length - r.code.length;
      scripts[i].done = r.code;
    } catch (e) {
      problems.push("скрипт #" + (i + 1) + ": " + (e.errors?.[0]?.text || e.message));
      scripts[i].done = code;
    }
  }
  let k = 0;
  html = html.replace(SCRIPT_RE, () => {
    const s = scripts[k++];
    return "<script" + s.attrs + ">\n" + escapeGuard(s.done) + "\n</script>";
  });

  const styles = [];
  html = html.replace(STYLE_RE, (m, attrs, code) => {
    styles.push({ m, attrs, code });
    return m;
  });
  for (let i = 0; i < styles.length; i++) {
    const { code } = styles[i];
    if (!code.trim()) continue;
    try {
      const r = await transform(code, {
        loader: "css",
        minify: true,
        target: ["es2020"],
        legalComments: "none",
        charset: "utf8",
      });
      styleBytes += code.length - r.code.length;
      styles[i].done = r.code;
    } catch (e) {
      problems.push("стиль #" + (i + 1) + ": " + (e.errors?.[0]?.text || e.message));
      styles[i].done = code;
    }
  }
  let j = 0;
  html = html.replace(STYLE_RE, () => {
    const s = styles[j++];
    return "<style" + s.attrs + ">" + s.done + "</style>";
  });

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