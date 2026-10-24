# -*- coding: utf-8 -*-
"""Гейт облачной очереди: сданное не теряется на обрыве связи.

Проверка двух сортов:
  * по тексту файла — потолок очереди, пачки, выдержка повторов,
    предел отправок, отсутствие секретов, тишина при обрыве;
  * по поведению — маленький прогон в узле: очередь копит без сети,
    не задваивает одинаковое, помнит потолок и после возвращения сети
    уходит пачками не больше двадцати, оставляя пустую очередь.

Браузер здесь не нужен намеренно: гейт должен идти быстро и без
нагрузки на машину.
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
SRC = os.path.join(ROOT, "src", "data", "supabase.js")

rc = 0


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


txt = io.open(SRC, encoding="utf-8").read()

print("=== БЕЗ СЕКРЕТОВ ===")
check("sb_publishable_" in txt, "ключ публичный, как и положено")
check("service_role" not in txt, "служебного ключа базы нет")
check(not re.search(r"sb_secret|password|пароль", txt, re.I),
      "секретных слов и паролей нет")

print("")
print("=== ОЧЕРЕДЬ ====")
check(re.search(r"QMAX\s*=\s*200", txt) is not None, "потолок очереди — 200")
check(re.search(r"QBATCH\s*=\s*20", txt) is not None, "пачка отправки — 20")
check(re.search(r"QMINUTE\s*=\s*30", txt) is not None, "предел — 30 отправок в минуту")
check("qKey" in txt and "qAdd" in txt, "одинаковые записи не задваиваются")
check("[5000,15000,60000,180000,600000]" in txt.replace(" ", ""),
      "выдержка повторов 5с, 15с, 60с, 180с, 600с")
check("Array.isArray(data)" in txt, "старый вид очереди принимается (миграция)")
check(re.search(r"QKEY\s*=\s*\"bb2_sbq\.v1\"", txt) is not None,
      "лист очереди в хранилище один и с номером")
check("qBusy" in txt, "одна отправка в полёте (очередь не бьёт толпой)")

print("")
print("=== ТИШИНА ПРИ ОБРЫВЕ ===")
check("alert(" not in txt, "окон с ошибками нет")
check("throw " not in txt and "throw(" not in txt, "исключения наружу не летят")
fetches = len(re.findall(r"\bfetch\(", txt))
catches = len(re.findall(r"\.catch\(", txt))
check(fetches == catches, "у каждого запроса есть тихий перехват (%d/%d)" %
      (fetches, catches))
check(txt.count("try{") >= 3 and "catch(e)" in txt,
      "хранилище и запуск очереди укрыты от падений")
check("AERIS_SB=API" in txt, "наружу выставлен AERIS_SB")

print("")
print("=== ПОВЕДЕНИЕ ОЧЕРЕДИ (узел) ===")
node = shutil.which("node") or "node"
harness = r"""
const fs = require("fs");
const code = fs.readFileSync("src/data/supabase.js", "utf8");
global.window = global;
global.localStorage = {
  _m: {},
  getItem(k) { return this._m[k] === undefined ? null : this._m[k]; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; },
};
let fail = true, posts = [], inFlight = 0, peak = 0;
global.fetch = function (url, opt) {
  inFlight++; if (inFlight > peak) peak = inFlight;
  const done = () => { inFlight--; };
  if (fail) return Promise.reject(new Error("сети нет")).finally(done);
  posts.push(JSON.parse(opt.body));
  return Promise.resolve({ ok: true, status: 201,
    headers: { get() { return null; } }, text: () => Promise.resolve("") }).finally(done);
};
eval(code);
const SB = global.AERIS_SB;
function say(k, v) { console.log(k + "=" + v); }
for (let i = 0; i < 25; i++) SB.sendScore("g1", "Игра", i, "Вася");
let q = JSON.parse(localStorage.getItem("bb2_sbq.v1"));
say("копит", q.items.length);
SB.sendScore("g1", "Игра", 5, "Вася");
q = JSON.parse(localStorage.getItem("bb2_sbq.v1"));
say("дубль", q.items.length === 25 ? "нет" : "есть");
for (let i = 0; i < 250; i++) SB.sendScore("g2", "Игра", i, "Петя");
q = JSON.parse(localStorage.getItem("bb2_sbq.v1"));
say("потолок", q.items.length);
fail = false;
setTimeout(() => {
  const sizes = posts.map(b => Array.isArray(b) ? b.length : 1);
  say("пачки", sizes.join(","));
  say("разом", peak);
  q = JSON.parse(localStorage.getItem("bb2_sbq.v1"));
  say("осталось", q.items.length);
  setTimeout(() => process.exit(0), 1200);
}, 8000);
"""
tmp = tempfile.mkdtemp(prefix="nbsbq_")
try:
    hp = os.path.join(tmp, "q.js")
    with io.open(hp, "w", encoding="utf-8", newline="\n") as f:
        f.write(harness)
    r = subprocess.run([node, hp], cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120)
    out = {}
    for line in (r.stdout or "").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    check(out.get("копит") == "25", "без сети копит всё: " + out.get("копит", "?"))
    check(out.get("дубль") == "нет", "дубль не добавился")
    check(out.get("потолок") == "200", "потолок держится: " + out.get("потолок", "?"))
    sizes = [x for x in out.get("пачки", "").split(",") if x]
    check(bool(sizes) and all(int(x) <= 20 for x in sizes),
          "после возвращения сети пачки не больше 20: " + out.get("пачки", "нет"))
    check(out.get("разом") == "1", "в полёте всегда одна отправка")
    check(out.get("осталось") == "0", "очередь опустела: " + out.get("осталось", "?"))
    if r.returncode != 0 and not out:
        print("      прогон не отдал отчёт: " + (r.stderr or "")[:200])
        rc = 1
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("")
print("ИТОГ: " + ("все проверки прошли" if rc == 0 else "есть провалы"))
sys.exit(rc)
