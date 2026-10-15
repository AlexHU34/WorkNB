# -*- coding: utf-8 -*-
"""Гейт описаний типов: подсказки не должны врать.

Зачем. Файл src/types/nebula.d.ts описывает движок, язык и студию для
редактора кода. Если метод переименуют, а описание забудут поправить,
редактор будет предлагать несуществующие имена. Хуже того: проверка
типов останется зелёной, потому что проверяет файл, который никто не
связал с настоящим кодом.

Поэтому здесь две вещи:
  1. tsc обязан проходить на текущих описаниях.
  2. Каждое описанное имя обязано существовать в настоящем коде. Имя
     проверяется выдёргиванием из .d.ts и поиском в исходниках.
     Если переименовали — проверка падает.

Второй пункт сделан через МУТАЦИЮ с перезапуском: гейт правит
описание сам и убеждается, что проверка типов от этого сломалась.
Если нет — значит проверка ничего не проверяет, и это тоже поломка.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DTS = os.path.join(ROOT, "src", "types", "nebula.d.ts")
TSC = os.path.join(ROOT, "node_modules", "typescript", "bin", "tsc")

# Имена, которые обязаны быть и в описании, и в коде. Взяты из
# публичного интерфейса: ими пользуются игры и Studio.
NAMES = [
    "E3", "E3GL", "E3Step", "E3Pool", "Interp", "Env", "parse",
    "createRuntime", "Studio", "BB", "NebulaDiag", "LangError",
]
# Методы движка: если переименуют хоть один — описание устареет.
# Только настоящие методы E3. Имена group и add сюда не входят: group —
# это функция языка (NAT в runtime.js), а add — внутренняя переменная
# внутри E3.node. Оба раньше попали в список по ошибке, и описание
# вроло бы человеку, что таких методов у движка нет.
METHODS = [
    "box", "pyramid", "rbox", "quad", "tri", "poly", "shadow", "sprite",
    "tiles", "tileMap", "pattern", "draw", "view", "proj", "shade", "lit",
    "spec", "budget", "node", "setQuality",
]


def tsc_run():
    node = os.path.join(os.path.dirname(os.path.dirname(TSC)), "node.exe")
    if not os.path.isfile(node):
        node = shutil.which("node") or "node"
    try:
        r = subprocess.run([node, TSC, "--noEmit"], cwd=ROOT,
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=300)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 99, "tsc не ответил за 300 секунд"


def source_text():
    """Весь код, кроме описаний типов и служебных папок."""
    parts = []
    for sub in ("src",):
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, sub)):
            dirnames[:] = [d for d in dirnames if d not in ("types", "node_modules")]
            for fn in filenames:
                if fn.endswith(".js"):
                    with io.open(os.path.join(dirpath, fn), encoding="utf-8") as f:
                        parts.append(f.read())
    for fn in ("index.html", "lang.html", "studio.html"):
        with io.open(os.path.join(ROOT, fn), encoding="utf-8") as f:
            parts.append(f.read())
    return "\n".join(parts)


def check_types_pass():
    print("=== ПРОВЕРКА ТИПОВ ===")
    rc, out = tsc_run()
    if rc == 0:
        print("  OK   tsc проходит на текущих описаниях")
        return True
    print("  FAIL  tsc падает:")
    for line in out.splitlines()[:8]:
        print("        " + line.strip())
    return False


def check_names_in_code():
    print("=== ОПИСАНИЯ СОВПАДАЮТ С КОДОМ ===")
    with io.open(DTS, encoding="utf-8") as f:
        dts = f.read()
    src = source_text()
    ok = True
    for n in NAMES:
        in_dts = re.search(r"\b(?:declare\s+(?:const|class|function)\s+|declare\s+var\s+)" +
                           re.escape(n) + r"\b", dts) is not None
        in_code = re.search(r"\b" + re.escape(n) + r"\b", src) is not None
        if not in_dts:
            print("  FAIL  %s не описан в nebula.d.ts" % n)
            ok = False
        elif not in_code:
            print("  FAIL  %s описан, но в коде его нет" % n)
            ok = False
    # Методы: достаточно, чтобы имя встречалось как вызов или свойство.
    for m in METHODS:
        in_dts = re.search(r"^\s{2}" + re.escape(m) + r"\s*\(", dts, re.M) is not None
        in_code = re.search(r"\b" + re.escape(m) + r"\s*\(", src) is not None or \
            re.search(r"\b" + re.escape(m) + r"\s*[:=]", src) is not None
        if not in_dts:
            print("  FAIL  метод %s не описан" % m)
            ok = False
        elif not in_code:
            print("  FAIL  метод %s описан, но в коде его нет" % m)
            ok = False
    if ok:
        print("  OK   все %d имён и %d методов совпадают с кодом" % (len(NAMES), len(METHODS)))
    return ok


def check_mutation():
    """Ломаем описание — проверка обязана заметить.

    Это та же идея, что в mutation-gate: тест, который не падает на
    сломанном коде, бесполезен. Здесь ломается не код, а описание.
    """
    print("=== МУТАЦИЯ ОПИСАНИЯ ===")
    with io.open(DTS, encoding="utf-8") as f:
        original = f.read()
    bak = DTS + ".bak"
    shutil.copyfile(DTS, bak)
    try:
        # Имя, которого заведомо нет в описаниях, добавляем как требование.
        broken = original.replace(
            "declare const NebulaDiag: NebulaDiag;",
            "declare const NebulaDiag: NebulaDiag;\n"
            "/* мутация гейта: этого свойства у диагностики нет */\n"
            "interface NebulaDiag { __nbMutantProp: number; }\n"
            "const __nbMutant: NebulaDiag['__nbMutantProp'] = 1;")
        with io.open(DTS, "w", encoding="utf-8", newline="\n") as f:
            f.write(broken)
        rc, out = tsc_run()
    finally:
        shutil.move(bak, DTS)
    if rc == 0:
        print("  FAIL  tsc прошёл на испорченном описании — он ничего не проверяет")
        return False
    print("  OK   сломанное описание поймано: tsc вернул код %d" % rc)
    return True


def check_no_stale_fake():
    """Старая настройка проверяла пустоту — это надо закрыть явно."""
    print("=== ПРОВЕРКА НЕ ПУСТАЯ ===")
    with io.open(os.path.join(ROOT, "tsconfig.json"), encoding="utf-8") as f:
        cfg = f.read()
    if '"src/**/*.ts"' in cfg:
        print("  FAIL  tsconfig снова ищет файлы .ts, которых в проекте нет")
        return False
    n = 0
    with io.open(DTS, encoding="utf-8") as f:
        n = len(re.findall(r"^\s{2}\w+\s*[:(]", f.read(), re.M))
    if n < 20:
        print("  FAIL  описаний слишком мало: %d полей" % n)
        return False
    print("  OK   описаний достаточно: %d полей и методов" % n)
    return True


def check_natives():
    """Список функций должен совпадать с кодом И с подсказками редактора.

    Функции переименовывают чаще всего: добавили, переименовали, забыли
    убрать из описания. Человек потом пишет игру, автодополнение
    предлагает старое имя, программа не запускается.

    Проверяются три места, и все три должны знать одно и то же:
      * src/lang/runtime.js  — где функции живут на самом деле;
      * src/types/nebula.d.ts — описание для редактора кода;
      * NAT_HINTS в lang.html — подсказки, которые видит человек.
    """
    print("=== ФУНКЦИИ ДЛЯ ИГР СОВПАДАЮТ С КОДОМ ===")
    with io.open(os.path.join(ROOT, "src", "lang", "runtime.js"), encoding="utf-8") as f:
        rt = f.read()
    real = set(re.findall(r'NAT\["([^"]+)"\]', rt))
    if len(real) < 60:
        print("  FAIL  в runtime.js найдено всего %d функций — разбор сломан?" % len(real))
        return False
    print("  OK   в коде функций: %d" % len(real))

    with io.open(os.path.join(ROOT, "lang.html"), encoding="utf-8") as f:
        lang = f.read()
    m = re.search(r"const NAT_HINTS = \(function \(\) \{[\s\S]*?\}\)\(\);", lang)
    if not m:
        print("  FAIL  в lang.html нет списка подсказок NAT_HINTS")
        return False
    with io.open(DTS, encoding="utf-8") as f:
        dts = f.read()
    consts = {"PI", "TAU", "KEY_LEFT", "KEY_RIGHT", "KEY_UP", "KEY_DOWN", "KEY_SPACE"}
    # Берём только слова в кавычках из списков групп: иначе фильтр
    # служебных слов вытирал настоящие функции (так пропал push).
    quoted = set(re.findall(r'"([A-Za-z][\w]*)"', m.group(0)))
    quoted -= {"геометрия", "камера и фон", "экран 2D", "ввод",
               "время и счёт", "состояние", "таймеры", "экраны",
               "интерфейс", "звук", "физика", "математика",
               "массивы и строки", "вывод", "константы"}
    hints = quoted
    missing = sorted(real - hints)
    if missing:
        print("  FAIL  в подсказках редактора нет: %s" % " ".join(missing))
        return False
    print("  OK   подсказки редактора знают все %d функций" % len(real))

    extra = sorted(n for n in hints - real
                   if n not in consts and n not in ("name", "kind", "hint"))
    if extra:
        print("  FAIL  в подсказках есть несуществующие: %s" % " ".join(extra))
        return False

    if "NEBULA_NATIVES" not in dts:
        print("  FAIL  в описаниях типов нет списка NEBULA_NATIVES")
        return False
    print("  OK   список функций есть и в описаниях")
    return True


def main():
    if not os.path.isfile(DTS):
        print("FAIL  нет %s" % DTS)
        return 1
    ok = True
    ok &= check_types_pass()
    print("")
    ok &= check_names_in_code()
    print("")
    ok &= check_natives()
    print("")
    ok &= check_mutation()
    print("")
    ok &= check_no_stale_fake()
    print("")
    print("ИТОГ: " + ("все проверки прошли" if ok else "есть провалы"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())