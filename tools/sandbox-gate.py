# -*- coding: utf-8 -*-
"""Гейт песочницы BloomScript: доступ по квадратным скобкам.

Стоит отдельно от limit-gate.py, потому что закрывает дыру, которую тот
не видел. Фильтр FORBIDDEN_MEMBERS стоял только на точке: a.constructor
ловился, а a["constructor"] проходило насквозь, и дальше
["constructor"]["constructor"] давало Function — то есть выполнение
произвольного кода в окружении страницы из пользовательской игры.

Проверка идёт ИСПОЛНЕНИЕМ, а не разглядыванием кода: иначе фильтр можно
случайно обойти другим путём, и гейт этого не заметит.
"""
import io
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

TEST = r"""
const I = new Interp({}); I.maxSteps = 200000;
let fail = 0;
function ok(c, m) { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fail++; }

function run(src) {
  const env = new Env(I.globals);
  /* Счётчики обнуляем перед каждой программой: иначе тесты делят один
     бюджет, и лимит памяти приходит от предыдущего теста, а не от своего. */
  I.resetLimits();
  I.steps = 0;
  let r = null, e = null;
  try { r = I.run(parse(src), env); } catch (x) { e = x; }
  let v = (r && r.sig === "ret") ? r.v : r;
  if (v && v.__slot === 1) v = v.v;
  return { v: v, e: e };
}
/* Должно быть заблокировано: программа не имеет права дотянуться до
   конструктора, прототипа или глобального объекта страницы. */
function blocked(name, src, hint) {
  const r = run(src);
  ok(!!r.e, "заблокировано: " + name + (r.e ? "" : " (получено " + r.v + ")"));
  if (r.e && hint) ok(String(r.e.message).indexOf(hint) >= 0,
     "  сообщение внятное: " + r.e.message);
}
function allowed(name, src) {
  const r = run(src);
  ok(!r.e, "работает как прежде: " + name + (r.e ? " — " + r.e.message : ""));
}

/* --- чтение --- */
blocked("точка a.constructor", "let a=[]\nreturn a.constructor", "запрещён");
blocked("a[\"constructor\"]", "let a=[]\nreturn a[\"constructor\"]", "запрещён");
blocked("a[\"constructor\"][\"constructor\"]",
        "let a=[]\nreturn a[\"constructor\"][\"constructor\"]", "запрещён");
blocked("Function(...) через скобки",
        "return [][\"constructor\"][\"constructor\"](\"return 1\")()", "запрещён");
blocked("достать globalThis",
        "return [][\"constructor\"][\"constructor\"](\"return this\")()", "запрещён");
blocked("a[\"__proto__\"]", "let a=[]\nreturn a[\"__proto__\"]", "запрещён");
blocked("a[\"prototype\"]", "let a=[]\nreturn a[\"prototype\"]", "запрещён");
blocked("вложенный доступ по индексу",
        "let o = []\no[0] = []\nreturn o[0][\"constructor\"]", "запрещён");
blocked("индекс из переменной",
        "let k=\"constructor\"\nlet a=[]\nreturn a[k]", "запрещён");

/* --- запись --- */
blocked("запись __proto__", "let a=[]\na[\"__proto__\"]=1\nreturn 1", "запрещена");
blocked("запись constructor", "let a=[]\na[\"constructor\"]=1\nreturn 1", "запрещена");
blocked("запись в объект по индексу",
        "let o = []\no[\"__proto__\"] = 1\nreturn 1", "запрещена");

/* --- обычная работа не должна сломаться --- */
allowed("индекс массива", "let a=[1,2]\na[\"0\"]=9\nreturn a[0]");
allowed("чтение по индексу", "let a=[1,2,3]\nreturn a[2]");
allowed("вложенные массивы", "let a=[[1,2],[3,4]]\nreturn a[1][0]");
allowed("map по массиву", "let a=[1,2,3]\nreturn a.map(fn(x): return x+1)[2]");
allowed("строковые ключи",
        "let o = []\no[\"name\"] = \"x\"\nreturn o[\"name\"]");
allowed("объявление через скобки не сломано", "let a=[]\na[0]=5\nreturn a[0]");

/* --- лимиты, которые раньше не ловились --- */
/* Проверяем, что выполнение ИМЕННО останавливается ошибкой. Прежняя
   проверка смотрела только на время: 24 удвоения без счётчика памяти
   укладываются в 10 мс, и гейт радовался. Порог времени заведомо
   generous — при параллельном прогоне 14 гейтов один только запуск
   Node занимает секунды, и 4 с превращались в ложную тревогу. Сигналом
   служит ошибка, время — лишь защита от настоящего зависания. */
function stops(name, src) {
  const t0 = Date.now();
  const r = run(src);
  const ms = Date.now() - t0;
  ok(ms < 15000 && !!r.e, name + " останавливается ошибкой за " + ms +
     " мс" + (r.e ? ": " + String(r.e.message).slice(0, 40) : " — ОШИБКИ НЕ БЫЛО"));
}
let dbl = ["let a = [0]"];
for (let k = 0; k < 24; k++) dbl.push("a = a.concat(a)");
stops("удвоение массива", dbl.join("\n"));
stops("повторение строки", "return \"a\".repeat(400000000)");
stops("вечный цикл с catch",
  ["let i = 0", "while true:", "    try:", "        i = i + 1",
   "    catch e:", "        continue"].join("\n"));
stops("обычный вечный цикл", "let i = 0\nwhile true:\n    i = i + 1");

/* --- рост массива через push ---
   push докладывал в счётчик ВСЮ длину массива вместо одного элемента:
   счётчик копился как 1+2+...+n и лимит памяти упирался где-то на
   полутора тысячах элементов — цикл, который честно кладет в массив
   пять тысяч чисел, падал с враньём «превышен объём». Проверяем ровно
   это: с маленьким лимитом честный рост проходит, а рост за лимит —
   останавливается. */
(function () {
  const saveMax = I.maxObjects;
  I.resetLimits(); I.steps = 0; I.maxObjects = 1000000;
  let e1 = null;
  try {
    I.run(parse("let a = []\nlet i = 0\nwhile i < 5000:\n    a.push(i)\n    i = i + 1"), new Env(I.globals));
  } catch (x) { e1 = x; }
  ok(!e1, "честный рост массива на 5000 проходит" + (e1 ? " — " + e1.message : ""));

  I.resetLimits(); I.steps = 0; I.maxObjects = 1000;
  let e2 = null;
  try {
    I.run(parse("let a = []\nlet i = 0\nwhile true:\n    a.push(i)\n    i = i + 1"), new Env(I.globals));
  } catch (x) { e2 = x; }
  ok(!!e2 && String(e2.message).indexOf("объём данных") >= 0,
     "рост через push упирается в память" + (e2 ? ": " + String(e2.message).slice(0, 40) : " — ОШИБКИ НЕ БЫЛО"));
  I.maxObjects = saveMax;
})();

/* --- split и replace --- Раньше обходили счётчик памяти: результат
   мог вырасти в разы, а лимит об этом не знал. Тот же приём: маленький
   лимит и результат, который в него не влезает. */
(function () {
  const saveMax = I.maxObjects;
  I.resetLimits(); I.steps = 0; I.maxObjects = 1000;
  let e1 = null;
  try {
    I.run(parse("let s = \"\"\nlet i = 0\nwhile i < 200:\n    s = s + \"abcdefghij\"\n    i = i + 1\nreturn s.split(\"\").length"), new Env(I.globals));
  } catch (x) { e1 = x; }
  ok(!!e1 && String(e1.message).indexOf("объём данных") >= 0,
     "split упирается в память" + (e1 ? ": " + String(e1.message).slice(0, 40) : " — ОШИБКИ НЕ БЫЛО"));

  I.resetLimits(); I.steps = 0; I.maxObjects = 1000;
  let e2 = null;
  /* x -> xx каждый проход удваивает строку: за 20 шагов это больше мегабайта. */
  try {
    I.run(parse("let s = \"x\"\nlet i = 0\nwhile i < 20:\n    s = s.replace(\"x\", \"xx\")\n    i = i + 1\nreturn s.length"), new Env(I.globals));
  } catch (x) { e2 = x; }
  ok(!!e2 && String(e2.message).indexOf("объём данных") >= 0,
     "replace упирается в память" + (e2 ? ": " + String(e2.message).slice(0, 40) : " — ОШИБКИ НЕ БЫЛО"));
  I.maxObjects = saveMax;
})();

/* --- часы кадра --- Лимит шагов ловит бесконечный цикл, но не ловит
   программу, где шагов мало, а каждый дорогой. Часы закрывают именно её. */
(function () {
  I.resetLimits(); I.steps = 0;
  I.startClock(1);   /* одна миллисекунда на весь запуск */
  let e = null;
  try {
    I.run(parse("let i = 0\nwhile true:\n    i = i + 1"), new Env(I.globals));
  } catch (x) { e = x; }
  I.deadline = 0;
  ok(!!e && String(e.message).indexOf("время кадра") >= 0,
     "тяжёлый кадр останавливается по часам" + (e ? ": " + String(e.message).slice(0, 40) : " — ОШИБКИ НЕ БЫЛО"));
})();

console.log("ИТОГ: FAIL " + fail);
process.exitCode = fail ? 1 : 0;
"""


def main():
    node = None
    for c in (r"C:\Program Files\nodejs\node.exe",
              r"C:\Program Files (x86)\nodejs\node.exe"):
        if os.path.isfile(c):
            node = c
            break
    if not node:
        print("FAIL  не найден node — гейт пропущен")
        return 1

    with io.open(os.path.join(ROOT, "src", "lang", "core.js"), encoding="utf-8") as f:
        core = f.read()
    tmp = os.path.join(tempfile.gettempdir(), "sandbox_harness.js")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(core)
        f.write("\n;\n")
        f.write(TEST)

    p = subprocess.run([node, tmp], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120)
    lines = [l.rstrip() for l in p.stdout.splitlines() if l.strip()]
    for l in lines:
        print(l[:110])
    if p.returncode != 0 and not lines:
        print("FAIL  скрипт не выдал вывод")
        print(p.stderr[-600:])
        return 1
    bad = [l for l in lines if l.startswith("FAIL")]
    if bad:
        print("ИТОГО: провалено " + str(len(bad)))
        return 1
    print("ИТОГО: все проверки прошли")
    return 0


if __name__ == "__main__":
    sys.exit(main())