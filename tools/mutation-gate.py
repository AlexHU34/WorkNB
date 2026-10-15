# -*- coding: utf-8 -*-
"""Проверка самих гейтов: а они вообще ловят поломки?

Зачем. Гейт, который зелёный на сломанном коде, хуже отсутствия гейта:
он даёт уверенность, которой нет. Замечание независимой проверки было
ровно об этом — два из трёх частичных отказов не ловились.

Как работает. Файл правится НАМЕРЕННО, гейт запускается, и гейт обязан
упасть. Если он остался зелёным — тест провален: значит в гейте дыра.

Исходник обязательно восстанавливается, даже если гейт зависнет или
интерпретатор упадёт: восстановление в finally, из резервной копии.
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")

GL = os.path.join(ROOT, "src", "engine", "e3gl.js")
CORE = os.path.join(ROOT, "src", "lang", "core.js")

# (что ломаем, файл, замена, гейт, ожидание)
MUTATIONS = [
    ("кадр не очищается", GL,
     "gl.clear(gl.COLOR_BUFFER_BIT);", "/*убрано*/",
     "e3gl-gate.py"),

    ("альфа зажата в единицу", GL,
     "outColor = vec4(c, vA);", "outColor = vec4(c, 1.0);",
     "e3gl-gate.py"),

    ("буфер меньше данных", GL,
     "gl.bufferData(gl.ARRAY_BUFFER, c * FLOATS * 4, gl.DYNAMIC_DRAW);",
     "gl.bufferData(gl.ARRAY_BUFFER, FLOATS * 4 * 16, gl.DYNAMIC_DRAW);",
     "e3gl-gate.py"),

    # Мутация «шаг сбит» была заменена: она смещала линии, но картинка
    # получалась почти та же (664 против 660 пикселей), и гейт обоснованно
    # её пропускал. Вместо неё — точная копия исходного бага: цвет обводки
    # берётся из координат вершины. Это то, что было на самом деле.
    ("цвет обводки берётся из координат", GL,
     "_l[o] = x0; _l[o + 1] = y0; _l[o + 2] = r; _l[o + 3] = g;",
     "_l[o] = x0; _l[o + 1] = y0; _l[o + 2] = x1; _l[o + 3] = y1;",
     "e3gl-gate.py"),

    ("грань e:1 снова освещается", GL,
     "  if (vF < 0.5) {", "  if (true) {",
     "e3gl-gate.py"),

    ("песочница: доступ по индексу открыт", CORE,
     'if (typeof i === "string" && FORBIDDEN_MEMBERS[i])',
     "if (false)",
     "sandbox-gate.py"),

    ("песочница: запись по индексу открыта", CORE,
     'if (typeof idx === "string" && FORBIDDEN_MEMBERS[idx])',
     "if (false)",
     "sandbox-gate.py"),

    ("лимит памяти на concat снят", CORE,
     "if (I0) I0.guardSize(r.length);", "/*снято*/",
     "sandbox-gate.py"),

    # Мутации на защиты, добавленные после: они обязаны тоже ловиться,
    # иначе «проверено» значит «никто не проверял».
    ("push считает длину вместо одного элемента", CORE,
     "case \"push\": return v => { o.push(v); if (I0) I0.guardSize(1); return o.length; };",
     "case \"push\": return v => { o.push(v); if (I0) I0.guardSize(o.length); return o.length; };",
     "sandbox-gate.py"),

    ("лимит памяти на split снят", CORE,
     "      const r = s.split(sep === undefined ? \"\" : str(sep));\n      if (I0) I0.guardSize(r.length);",
     "      const r = s.split(sep === undefined ? \"\" : str(sep));",
     "sandbox-gate.py"),

    ("лимит памяти на replace снят", CORE,
     "      const r = s.split(str(a)).join(str(b));\n      if (I0) I0.guardSize(r.length);",
     "      const r = s.split(str(a)).join(str(b));",
     "sandbox-gate.py"),

    ("часы кадра выключены", CORE,
     "if (this.deadline !== 0 && (this.steps & 1023) === 0 && nowMs() > this.deadline) {",
     "if (false) {",
     "sandbox-gate.py"),
]


def run_gate(name):
    p = subprocess.run([sys.executable, os.path.join(ROOT, "tools", name)],
                       cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=600)
    return p.returncode != 0


def main():
    fails = []

    # Контроль: на неизменённом коде гейты обязаны быть зелёными.
    for gate in ("e3gl-gate.py", "sandbox-gate.py"):
        if run_gate(gate):
            print("FAIL  контроль: " + gate + " падает на исправном коде")
            fails.append("контроль " + gate)
        else:
            print("OK    контроль: " + gate + " зелёный на исправном коде")

    for name, path, old, new, gate in MUTATIONS:
        src = io.open(path, encoding="utf-8").read()
        if old not in src:
            print("FAIL  " + name + ": не найдено место для правки — " +
                  "тест устарел, код изменился")
            fails.append(name + " (устарело)")
            continue
        bak = path + ".bak"
        shutil.copyfile(path, bak)
        try:
            io.open(path, "w", encoding="utf-8", newline="\n").write(
                src.replace(old, new, 1))
            caught = run_gate(gate)
        finally:
            shutil.move(bak, path)          # восстановление гарантировано
        if caught:
            print("OK    " + name + " — гейт поймал")
        else:
            print("FAIL  " + name + " — гейт остался зелёным на сломанном коде")
            fails.append(name)

    print("")
    if fails:
        print("ИТОГО: гейты пропускают " + str(len(fails)) + " из " +
              str(len(MUTATIONS)))
        for f in fails:
            print("   " + f)
        return 1
    print("ИТОГО: все " + str(len(MUTATIONS)) +
          " поломок пойманы, гейты годятся")
    return 0


if __name__ == "__main__":
    sys.exit(main())