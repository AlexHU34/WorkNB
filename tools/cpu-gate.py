# -*- coding: utf-8 -*-
"""Проверка нагрузки на процессор.

Почему по коду, а не по кадрам в секунду. Пытались посчитать кадры в
headless-браузере: он показывает 3 кадра за 5 секунд, потому что
виртуальное время душит анимацию. Число выходит правдоподобным, но
ни о чём не говорит. Замер в обратную сторону тоже не годится:
headless не рисует и не грузит шрифты, а нагрузка в обычном окне
идёт совсем от других мест.

Поэтому проверяем то, что можно проверить однозначно: что дорогие
работы не идут всегда и не дублируются. Каждая проверка смотрит на
конкретное место в коде и объясняет, что именно она ловит.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

rc = 0


def read(rel):
    return io.open(os.path.join(ROOT, rel), encoding="utf-8").read()


def check(cond, msg):
    global rc
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        rc = 1


app = read("src/app/app.js")
e3 = read("src/engine/e3.js")
html = read("index.html")

print("=== ДВИЖОК НЕ КРУТИТСЯ ДВАЖДЫ ===")
# В e3.js цикл сам себя перезапускает. Лишний запуск из app.js
# удваивал всю работу за кадр и вдвое портил замер времени кадра.
starts = len(re.findall(r"requestAnimationFrame\(t\s*=>\s*E3\.auto\.tick",
                        app)) + len(re.findall(r"requestAnimationFrame\(\s*\w+\s*=>\s*E3\.auto\.tick",
                                               app))
check(starts == 0, "в приложении нет своего запуска цикла движка "
                   "(найдено: %d)" % starts)
check("requestAnimationFrame(function(s){E3.auto.tick(s)})" in e3,
      "цикл движка сам себя перезапускает — так и должно быть")

print("")
print("=== ДВИЖОК ОСТАНАВЛИВАЕТСЯ В СКРЫТОЙ ВКЛАДКЕ ===")
check("document.hidden" in e3, "цикл проверяет, скрыта ли вкладка")
check("visibilitychange" in e3, "цикл просыпается, когда вкладку вернули")
check("resume" in e3, "есть отдельная функция resume")

print("")
print("=== ЛЕПЕСТКИ НЕ КРУТЯТСЯ ЗРЯ ===")
check("setTimeout(()=>requestAnimationFrame(loop),33)" in app,
      "лепестки рисуются 30 раз в секунду, а не 60")
check("setTimeout(()=>requestAnimationFrame(loop),250)" in app,
      "когда вкладка скрыта или открыта игра, лепестки засыпают")

print("")
print("=== ФОНОВЫЕ ТАЙМЕРЫ НЕ РАБОТАЮТ ВПУСТУЮ ===")
# Правило: каждый оставшийся таймер обязан смотреть на скрытую вкладку.
# Раньше требовалось «не меньше двух», потому что одним из них был
# таймер выдуманных игроков — его удалили за ненадобностью. Теперь
# важно не количество, а чтобы не осталось ни одного без проверки.
int_matches = re.findall(r"setInterval\(\(\)=>\{(.{0,160})", app)
guarded = [m for m in int_matches if "document.hidden" in m]
check(len(int_matches) >= 1, "в приложении вообще есть фоновый таймер")
check(len(guarded) == len(int_matches),
      "все таймеры проверяют скрытую вкладку (%d из %d)"
      % (len(guarded), len(int_matches)))
check("Math.random()*36-12" not in app,
      "таймера выдуманных игроков не вернулось")

print("")
print("=== НЕТ САМОГО ДОРОГОГО ===")
n = html.count("backdrop-filter:blur(")
check(n <= 2, "размытие фона почти убрано (осталось мест: %d из 6)" % n)

print("")
print("=== НЕТ ОСТАТКОВ ТЁМНОЙ ТЕМЫ ===")
# Ровно эта ошибка ломала сайт: белый текст и тёмные заливки, оставшиеся
# от прежней темы, на светлом фоне.
#
# Проверяем не все вхождения «color:#fff», а только те, где фон —
# светлый и записан буквально. На розовой или синей кнопке белый текст
# нужен, а если фон задан через var(--pink), его значение здесь
# неизвестно, и гадать нельзя.


def _rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _light(c):
    c = c.strip()
    m = re.match(r"rgba?\(([^)]+)\)", c)
    if m:
        parts = [x.strip() for x in m.group(1).split(",")]
        try:
            r, g, b = (int(float(parts[i])) / 255.0 for i in range(3))
            a = float(parts[3]) if len(parts) > 3 else 1.0
        except (ValueError, IndexError):
            return False
        if a < 0.25:
            return True
        return max(r, g, b) > 0.72
    if re.fullmatch(r"#[0-9a-fA-F]{3,6}", c):
        return min(_rgb(c)) > 0.72
    return False


bad = []
for m in re.finditer(r"([^{}\n]{1,110})\{([^{}]*color:#fff[^{}]*)\}", html):
    sel, body = m.group(1), m.group(2)
    bg = re.search(r"background(?:-color)?:([^;]+)", body)
    if not bg:
        continue
    val = bg.group(1)
    if "var(" in val:          # значение неизвестно — не судим
        continue
    if _light(val):
        bad.append(sel.strip()[:46])
check(not bad, "белого текста на светлых поверхностях нет" +
      ("" if not bad else " (%d: %s)" % (len(bad), "; ".join(bad[:4]))))
check('data-theme="dark"' not in html,
      "правил тёмной темы в стилях не осталось")
check('data-v="dark"' not in html,
      "переключателя тёмной темы в интерфейсе не осталось")

print("")
print("ИТОГ: " + ("нагрузка в норме" if rc == 0 else "есть замечания"))
sys.exit(rc)