# -*- coding: utf-8 -*-
"""Гейт на I0: счётчик шагов у того интерпретатора, который реально исполняется.

Что проверяем. Раньше глобальная I0 означала «интерпретатор, созданный
первым за всю жизнь», а не «тот, что исполняется сейчас». Интерпретаторов
в приложении больше одного: игра в редакторе lang.html и игра в index.html.
Как только их двое, колбэк из map/forEach вызывался через чужой интерпретатор:

  * счётчик шагов списывался не туда, где шла работа;
  * чужой счётчик копился и срывал посторонний запуск ошибкой
    «превышен лимит шагов», которой он не заслуживал;
  * бесконечный цикл во втором интерпретаторе не ловился вовсе —
    его собственный счётчик не рос.

Тесты гоняются в Node: core.js не обращается к DOM, поэтому Chrome не нужен
и проверка занимает миллисекунды.
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, "src", "lang", "core.js")

sys.stdout.reconfigure(encoding="utf-8")


def find_node():
    for c in (
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\nodejs\node.exe"),
    ):
        if os.path.isfile(c):
            return c
    return shutil.which("node")


TEST = r"""
// ---------- посторонние интерпретаторы ----------
function mk() {
  const I = new Interp({});
  I.maxSteps = 1000000;
  return I;
}
function val(r) {
  let x = (r && typeof r === "object" && r.sig === "ret") ? r.v : r;
  if (x && typeof x === "object" && x.__slot === 1) x = x.v;
  return x;
}
function runIn(I, src) {
  const env = new Env(I.globals);
  I.steps = 0;
  return val(I.run(parse(src), env));
}
function ok(cond, msg) { console.log((cond ? "OK   " : "FAIL ") + msg); if (!cond) process.exitCode = 1; }

// 400 вызовов колбэка. Ни одного обращения к len/print — только синтаксис языка.
const PROG_400 = "let acc = []\nfor i in 1..200:\n    [1,2].forEach(fn(x): acc.push(x))\nreturn acc.length";

// --- 1. Счётчик чужого интерпретатора не должен расти ---------------------
const A = mk();
const B = mk();
A.maxSteps = 50;                 // у A крошечный лимит: любой его рост виден
let r1 = null, err1 = null;
try { r1 = runIn(B, PROG_400); } catch (e) { err1 = e; }
ok(!err1, "программа второго интерпретатора выполнилась без ошибки" + (err1 ? ": " + err1.message : ""));
ok(r1 === 400, "400 вызовов колбэка дали 400 (получено " + r1 + ")");
ok(A.steps === 0, "счётчик постороннего интерпретатора не тронут (A.steps=" + A.steps + ")");
ok(B.steps > 0, "счётчик исполняющего интерпретатора рос (B.steps=" + B.steps + ")");

// --- 2. Свой лимит у каждого интерпретатора свой --------------------------
const C = mk();
const D = mk();
D.maxSteps = 500;
let err2 = null;
try { runIn(D, "let i = 0\nwhile true:\n    i = i + 1"); } catch (e) { err2 = e; }
ok(!!err2, "бесконечный цикл во втором интерпретаторе остановлен");
ok(err2 && String(err2.message).indexOf("шаг") >= 0,
   "ошибка именно о лимите шагов" + (err2 ? ": " + err2.message : ""));
ok(C.steps === 0, "соседний интерпретатор не пострадал (C.steps=" + C.steps + ")");

// --- 3. Один интерпретатор — поведение не изменилось -----------------------
const E = mk();
let r3 = null, err3 = null;
try {
  r3 = runIn(E, "let a = [1,2,3].map(fn(x): return x * 2)\nreturn a[2]");
} catch (e) { err3 = e; }
ok(!err3 && r3 === 6, "map работает как раньше (получено " + r3 + ")");

let r4 = null;
try {
  r4 = runIn(E, "let a = [1,2,3]\nlet s = 0\na.forEach(fn(x): s = s + x)\nreturn s");
} catch (e) { r4 = "исключение: " + e.message; }
ok(r4 === 6, "forEach работает как раньше (получено " + r4 + ")");

// --- 4. Вложенный вызов не оставляет I0 в мусоре -------------------------
const F = mk();
const G = mk();
let r5 = null;
try {
  r5 = runIn(F, "let a = [1,2,3].map(fn(x): return [10,20].map(fn(y): return x * y))\nreturn a[2][1]");
} catch (e) { r5 = "исключение: " + e.message; }
ok(r5 === 60, "вложенные map дают верный результат (получено " + r5 + ")");
ok(G.steps === 0, "после вложенного вызова чужой счётчик чист (G.steps=" + G.steps + ")");
"""


def main():
    node = find_node()
    if not node:
        print("FAIL  не найден node — гейт пропущен")
        print("ИТОГО: провалено 1")
        return 1

    core = io.open(CORE, encoding="utf-8").read()
    tmp = os.path.join(tempfile.gettempdir(), "i0_harness.js")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(core)
        f.write("\n")
        f.write(TEST)

    p = subprocess.run([node, tmp], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120)
    lines = [l.rstrip() for l in p.stdout.splitlines() if l.strip()]
    fail = 0
    for l in lines:
        if l.startswith("FAIL"):
            fail += 1
        print(l[:96])
    if not lines:
        print("FAIL  скрипт не выдал ни одной проверки")
        print(p.stderr[-600:])
        fail += 1
    print("ИТОГО: все проверки прошли" if not fail else "ИТОГО: провалено " + str(fail))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())