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