# -*- coding: utf-8 -*-
"""Проверка подсказок к ошибкам.

Пишем намеренно сломанный код — как это сделал бы новичок — и
смотрим, что п��явит редактор. Проверяем две вещи: сообщение осталось
точным (оно завязано на проверки качества) и рядом появилась
подсказка «что делать».
"""
import io
import os
import re
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

core = io.open(os.path.join(ROOT, "src", "lang", "core.js"), encoding="utf-8").read()

rc = 0


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


print("=== СПИСОК ПОДСКАЗОК ===")
rules = re.findall(r"\[/(.+?)/i,\s*\n\s*\"(.+?)\"\]", core, re.S)
check(len(rules) >= 5, "правил не меньше пяти, найдено: %d" % len(rules))
for pat, text in rules:
    check(len(text) > 40, "подсказка «%s…» не слишком короткая" % text[:34])
    check(text.endswith("."), "подсказка заканчивается точкой")

print("")
print("=== СООБЩЕНИЕ НЕ СЛОМАНО ===")
check("LangError" in core, "класс ошибки на месте")
check(core.count("не совпадает с блоком выше") >= 1,
      "точные сообщения интерпретатора не тронуты")

print("")
print("=== ПОДСКАЗКА ПОДХОДИТ К СВОЕЙ ОШИБКЕ ===")
# Прогоняем узлы проверки в том же движке, что и редактор.
node = os.path.join("node_modules", ".bin", "node.cmd")
script = """
const fs=require('fs');
let src=fs.readFileSync('src/lang/core.js','utf8');
src += '\\nmodule.exports={errHelp};';
const mod={exports:{}};
new Function('module','exports',src)(mod,mod.exports);
const H=mod.exports.errHelp;
const cases=[
 ['отступ 4 не совпадает с блоком выше','отступ'],
 ['не закрыт /* */','закрывающ'],
 ['фигурные скобки не нужны — блок задаётся отступом','отступом'],
 ['неизвестная команда','Справка'],
 ['ожидалось число','запятая'],
];
let bad=0;
for(const [msg,needle] of cases){
  const tip=H(msg);
  const ok=tip && tip.indexOf(needle)>=0;
  if(!ok){bad++;console.log('НЕТ подсказки для: '+msg);}
}
console.log(bad? 'провалов: '+bad : 'все подсказки подобраны верно');
"""
r = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True,
                   text=True, encoding="utf-8", errors="replace", timeout=120)
out = (r.stdout or "").strip()
print("  " + out.replace("\n", "\n  "))
check("все подсказки подобраны верно" in out, "каждая ошибка получила свою подсказку")

print("")
print("=== ЧУЖАЯ ОШИБКА БЕЗ ПОДСКАЗКИ ===")
script2 = script.replace(
    "console.log(bad? 'провалов: '+bad : 'все подсказки подобраны верно');",
    "const weird=H('что-то совсем незнакомое');"
    "console.log(weird===''?'пусто, как и должно быть':'не должно быть: '+weird);")
r2 = subprocess.run(["node", "-e", script2], cwd=ROOT, capture_output=True,
                    text=True, encoding="utf-8", errors="replace", timeout=120)
out2 = (r2.stdout or "").strip()
print("  " + out2)
check("пусто, как и должно быть" in out2,
      "на незнакомую ошибку подсказка не выдумывается")

print("")
print("ИТОГ: " + ("подсказки работают" if rc == 0 else "есть провалы"))
sys.exit(rc)