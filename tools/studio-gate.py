# -*- coding: utf-8 -*-
"""Гейт NEBULA Studio: модель сцены и компиляция в BloomScript.

Самый важный тест здесь последний в каждой группе: сгенерированный код
прогоняется через НАСТОЯЩИЙ парсер из src/lang/core.js. Если кодогенератор
выдаст что-то, чего язык не понимает, Studio опубликует игру, которая не
запустится, — и это обнаружится только у игрока в каталоге.

Модель сцены не обращается к DOM, поэтому гоняется в Node: миллисекунды
вместо полуминуты на запуск Chrome.
"""
import io
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

TEST = r"""
// localStorage-заглушка: публикацию проверяем по-настоящему.
const mem = Object.create(null);
const localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};

let fail = 0;
function ok(cond, msg) {
  console.log((cond ? "OK   " : "FAIL ") + msg);
  if (!cond) fail++;
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }

/* --- 1. Пустая сцена ---------------------------------------------------- */
const s0 = Studio.blank();
ok(s0.version === Studio.SCENE_VERSION, "у пустой сцене версия схемы");
ok(Array.isArray(s0.objects) && s0.objects.length === 0, "пустая сцена без объектов");
ok(!!s0.camera && !!s0.ground, "у сцены есть камера и земля");

/* --- 2. normalize чинит битое -------------------------------------------- */
const s1 = Studio.normalize({
  version: 1,
  title: "Ок",
  objects: [
    { id: "a", kind: "box", x: 1, y: 2, z: 3, color: "#fff" },
    { id: "a", kind: "box" },          // дубль id — не должен ломать
    { kind: "выдумка" },               // неизвестный вид -> куб
    null,                              // мусор
    "строка",                          // мусор
  ],
});
ok(s1.objects.length === 3, "из 5 записей осталось 3 (мусор отброшен), получено " + s1.objects.length);
const ids = s1.objects.map(o => o.id);
ok(new Set(ids).size === 3, "идентификаторы не повторяются: " + ids.join(","));
ok(s1.objects.every(o => o.kind === "box" || o.kind === "pyramid" || o.kind === "sprite"),
   "неизвестный вид подменён на известный");
ok(Studio.normalize(null).objects.length === 0, "null не ломает normalize");
ok(Studio.normalize("ерунда").objects.length === 0, "строка не ломает normalize");
ok(Studio.normalize({ objects: "не массив" }).objects.length === 0, "не-массив объектов не ломает normalize");
ok(Studio.normalize({ title: "" }).title !== "", "пустое имя заменено, а не оставлено пустым");

/* --- 3. Добавление и удаление ------------------------------------------- */
const s2 = Studio.blank();
const o1 = Studio.addObject(s2, "box");
const o2 = Studio.addObject(s2, "pyramid");
ok(!!o1.id && o1.id !== o2.id, "у добавленных объектов разные id");
ok(!near(o1.x, o2.x, 0), "новый объект не лезет на предыдущий: " + o1.x + " и " + o2.x);
ok(Studio.findObject(s2, o1.id) === o1, "объект находится по id");
ok(Studio.removeObject(s2, o1.id), "объект удаляется");
ok(!Studio.findObject(s2, o1.id), "после удаления объекта нет");
ok(!Studio.removeObject(s2, "несуществующий"), "удаление чужого id не выдаёт успеха");
ok(Studio.addObject(s2, "выдумка").kind === "box", "добавление неизвестного вида даёт куб");

/* --- 4. Кодогенерация: главная проверка -------------------------------- */
/* Собираем сцену «как человек собрал бы мышью» и проверяем, что
   настоящий интерпретатор понимает получившийся код. */
const s3 = Studio.blank();
s3.title = "Башня";
Studio.addObject(s3, "box");
const a = Studio.addObject(s3, "box");
a.x = 0; a.y = 3; a.z = 0; a.color = "#4fc3f7";
const p = Studio.addObject(s3, "pyramid");
p.x = -3; p.y = 2; p.color = "#81c784";
const sp = Studio.addObject(s3, "sprite");
sp.x = 2; sp.y = 3; sp.name = "Финиш";

const code = Studio.toBloomScript(s3);
ok(code.includes("// Башня"), "в коде есть имя сцены комментарием");
// Решётка встречается в цветах ("#ff7043"), поэтому проверяем не сам
// символ, а его использование как комментария — в начале строки.
ok(!/^\s*#/m.test(code), "в коде нет комментариев через решётку: в BloomScript это не комментарий");
ok(code.includes("fn setup():"), "есть хук setup");
ok(code.includes("fn update(dt):"), "есть хук update с dt");
ok(code.includes("fn draw():"), "есть хук draw");
ok(/box\(\(?-?[\d.]/.test(code), "есть вызов box");
ok(code.includes("pyramid("), "есть вызов pyramid");
ok(code.includes("sprite("), "есть вызов sprite");
ok(code.includes("ground("), "есть земля");
ok(code.includes("camera("), "есть камера");

let parsed = false, perr = "";
try { parse(code); parsed = true; } catch (e) { perr = e.message; }
ok(parsed, "СГЕНЕРИРОВАННЫЙ КОД ПАРСИТСЯ НАСТОЯЩИМ ИНТЕРПРЕТАТОРОМ" + (parsed ? "" : ": " + perr));

/* Код должен не только парситься, но и выполняться. */
let ran = false, rerr = "";
try {
  const I = new Interp({}); I.maxSteps = 2000000;
  const env = new Env(I.globals);
  I.run(parse(code), env);
  ran = true;
} catch (e) { rerr = e.message; }
ok(ran, "СГЕНЕРИРОВАННЫЙ КОД ВЫПОЛНЯЕТСЯ" + (ran ? "" : ": " + rerr));

/* Пустая сцена тоже должна давать рабочий код, а не пустоту. */
let emptyOk = false, eerr = "";
try {
  const ec = Studio.toBloomScript(Studio.blank());
  const I2 = new Interp({}); I2.maxSteps = 2000000;
  I2.run(parse(ec), new Env(I2.globals));
  emptyOk = true;
} catch (e) { eerr = e.message; }
ok(emptyOk, "пустая сцена даёт рабочий код" + (emptyOk ? "" : ": " + eerr));

/* Выключенная анимация: код обязан остаться рабочим. */
let stillOk = false, serr = "";
try {
  const s4 = Studio.blank(); s4.animated = false;
  Studio.addObject(s4, "box");
  const I3 = new Interp({}); I3.maxSteps = 2000000;
  I3.run(parse(Studio.toBloomScript(s4)), new Env(I3.globals));
  stillOk = true;
} catch (e) { serr = e.message; }
ok(stillOk, "сцена без анимации даёт рабочий код" + (stillOk ? "" : ": " + serr));

/* Кавычка в названии не должна порвать код. */
let quoteOk = false, qerr = "";
try {
  const s5 = Studio.blank(); s5.title = 'Игра "с кавычкой"';
  const ob = Studio.addObject(s5, "sprite"); ob.name = 'A"B';
  const I4 = new Interp({}); I4.maxSteps = 2000000;
  I4.run(parse(Studio.toBloomScript(s5)), new Env(I4.globals));
  quoteOk = true;
} catch (e) { qerr = e.message; }
ok(quoteOk, "кавычки в названиях не ломают код" + (quoteOk ? "" : ": " + qerr));

/* --- 5. Сохранение и публикация ---------------------------------------- */
const s6 = Studio.blank();
s6.title = "Моя сцена";
ok(Studio.save(s6), "сцена сохраняется");
ok(Studio.load().title === "Моя сцена", "сцена читается обратно");
mem[Studio.STORAGE_KEY] = "{ битый json";
ok(Studio.load().objects.length === 0, "битый JSON не ломает загрузку");

const pub = Studio.publish(s3);
ok(pub.ok, "публикация проходит: " + (pub.ok ? "" : pub.error));
const games = JSON.parse(mem["bb2_ugames.v1"] || "[]");
ok(Array.isArray(games) && games.length === 1, "игра попала в список каталога");
ok(games[0] && typeof games[0].id === "string" && typeof games[0].src === "string",
   "запись каталога имеет нужную форму {id, src}");
ok(games[0] && games[0].src.includes("fn draw():"), "в каталог ушёл рабочий код");
ok(mem["bb2_ugames.v1"], "использован ключ, который читает мост каталога");

/* Повторная публикация не должна затирать предыдущую. */
Studio.publish(s3);
const two = JSON.parse(mem["bb2_ugames.v1"] || "[]");
ok(two.length === 2, "вторая публикация добавляет, а не заменяет: " + two.length);

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

    parts = []
    for rel in ("src/lang/core.js", "src/studio/scene.js"):
        with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            parts.append(f.read())
    parts.append(TEST)

    tmp = os.path.join(tempfile.gettempdir(), "studio_harness.js")
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n;\n".join(parts))

    p = subprocess.run([node, tmp], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120)
    out = [l.rstrip() for l in p.stdout.splitlines() if l.strip()]
    for l in out:
        print(l[:110])
    if p.returncode != 0 and not out:
        print("FAIL  скрипт не выдал вывод")
        print(p.stderr[-800:])
        return 1
    bad = [l for l in out if l.startswith("FAIL")]
    if bad:
        print("ИТОГО: провалено " + str(len(bad)))
        return 1
    print("ИТОГО: все проверки прошли")
    return 0


if __name__ == "__main__":
    sys.exit(main())