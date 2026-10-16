# -*- coding: utf-8 -*-
"""Новая светлая палитра для трёх страниц.

Задача. Тёмная тема зашита в стилях намертво: переменные плюс 241
различный цвет, из них 466 вхождений. Перекрашивать руками — значит
 hundred раз ошибиться и получить нечитаемый текст.

Поэтому делаем пересчёт по яркости. Смысл простой: в тёмной теме
тёмные цвета — это фон и кнопки, а светлые — текст. Значит, чтобы
перевернуть тему, тёмное надо сделать светлым, а светлое — тёмным.
Оттенок при этом сохраняется, поэтому синий остаётся синим, розовый
розовым, просто в другой светлоте.

Что поправляется вручную (таблица MAP): цвета, у которых roles
определяется не по яркости, а по смыслу. Например, #fff остаётся
белым — он и в светл��й теме используется как фон карточек и как
текст на тёмной кнопке.

Чего НЕ делаем: править цвета внутри src/. Там краски игровых сцен,
диаграмм и подсветки кода. Это не интерфейс, а содержание.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- новая палитра -------------------------------------------------
# Взята с образца: холодный серо-голубой и графит.
PALETTE = {
    "--dark":  "#d7d8db",  # бывшая «тень» — теперь светлая плоскость
    "--dark2": "#c9cacb",
    "--dark3": "#b9bbbf",
    "--bg":    "#f1f1f2",
    "--bg2":   "#e7e7e9",
    "--card":  "#ffffff",
    "--txt":   "#2a2a2c",
    "--muted": "#6c6f76",
    "--line":  "#dcdce0",
    "--blue":    "#4f6d94",
    "--green":   "#5f8a72",
    "--pink":    "#a97185",
    "--yellow":  "#9c8547",
    "--violet":  "#7b6fa6",
    "--accent":  "#5a6377",
    "--glow":    "#7a829633",
    "--glass":   "rgba(255,255,255,.72)",
    "--radius":  "14px",
    "--font":    "'Segoe UI',system-ui,Wingdings,Apple Color Emoji,sans-serif",
    "--shadow":  "0 2px 10px rgba(42,42,44,.08)",
    "--shadow2": "0 18px 50px -28px rgba(42,42,44,.35)",
    "--bg-gradient": "linear-gradient(135deg,#f8f8f9 0%,#e3e4e7 100%)",
}

# --- цвета со смыслом, их пересчитывать нельзя ---------------------
MAP = {
    # фон и поверхности
    "#0d0e10": "#f1f1f2", "#0f0f13": "#f1f1f2", "#0e1420": "#ededee",
    "#0d1420": "#ededee", "#141518": "#ffffff", "#141620": "#f4f4f5",
    "#1a1c20": "#e9e9eb", "#1e2127": "#ffffff", "#25272d": "#dcdce0",
    "#1e2b42": "#eef1f6", "#22304a": "#e3e8f0",
    "#252526": "#dcdce0", "#26282d": "#dbdbde", "#3c3c3c": "#9b9da2",
    # текст
    "#e8eaed": "#2a2a2c", "#e6eef7": "#2f333b", "#9fb3c8": "#6b7280",
    "#7f93ad": "#5a6377", "#9cdcfe": "#3f5f80", "#43464c": "#5f6268",
    "#5a5d65": "#6c6f76", "#ce9178": "#8a6a55",
    # акценты: неон приглушаем до спокойных
    "#00d4ff": "#4f6d94", "#00a2ff": "#4f6d94", "#00ffab": "#5a6377",
    "#00e07f": "#5f8a72", "#ff5d8f": "#a97185", "#ff4d7a": "#a97185",
    "#ffb700": "#9c8547", "#ffdf6b": "#b59a5e", "#e79b00": "#9c8547",
    "#8b5cf6": "#7b6fa6", "#a855f7": "#7b6fa6",
}
KEEP = {"#fff", "#ffffff", "#ed2", "#ffff00", "#fff0"}

# белые полупрозрачные слои в тёмной теме были подсветкой границ;
# на светлом фоне их не видно, поэтому становится тёмная подложка
RGBA = [
    (r"rgba\(255,255,255,\.(0?0[0-9]|1[0-9]|2[0-9])\)", r"rgba(42,42,44,.10)"),
    (r"rgba\(255,255,255,\.(3[0-9]|4[0-5])\)", r"rgba(42,42,44,.16)"),
    (r"rgba\(0,0,0,\.(2[5-9]|3[0-9]|4[0-5])\)", r"rgba(42,42,44,.30)"),
    (r"rgba\(0,0,0,\.(5[0-9]|6[0-9]|7[0-5])\)", r"rgba(42,42,44,.42)"),
]


def lum(r, g, b):
    """Относительная яркость, 0 — чёрный, 1 — белый."""
    def f(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def hex_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_hex(r, g, b):
    return "#%02x%02x%02x" % (max(0, min(255, r)), max(0, min(255, g)),
                              max(0, min(255, b)))


def flip(hexval):
    """Тёмное → светлое, светлое → тёмное, оттенок сохраняется."""
    r, g, b = hex_rgb(hexval)
    L = lum(r, g, b)
    if L < 0.18:
        t = 0.94          # почти чёрный фон → светлая плоскость
    elif L < 0.35:
        t = 0.88          # тёмная поверхность → светлая поверхность
    elif L < 0.62:
        t = 0.42          # средние → тёмный текст
    else:
        t = 0.22          # светлый текст → тёмный текст
    # сохраняем оттенок: смешиваем с серым, чтобы не было кислотности
    k = 0.62
    base = t
    r2 = int(r + (base - r) * (1 - k) + (128 - r) * 0.0)
    g2 = int(g + (base - g) * (1 - k))
    b2 = int(b + (base - b) * (1 - k))
    r2, g2, b2 = (int(c * (1 - 0.28) + (0.42 if c >= 0.5 else 0.94) * 255 * 0.28)
                  for c in (r2, g2, b2))
    return rgb_hex(r2, g2, b2)


def restyle(css, report):
    # 1. переменные темы
    def root_sub(m):
        body = m.group(1)
        for k, v in PALETTE.items():
            body = re.sub(r"%s\s*:\s*[^;]*" % re.escape(k), "%s:%s" % (k, v),
                          body)
        if not re.search(r"--accent\s*:", body):
            body += ";".join("%s:%s" % (k, v) for k, v in PALETTE.items())
        return ":root{" + body + "}"

    css = re.sub(r":root\s*\{([^}]*)\}", root_sub, css, count=1)

    # 2. полупрозрачные слои
    for pat, rep in RGBA:
        css = re.sub(pat, rep, css)

    # 3. цвета: сперва таблица, потом пересчёт по яркости
    def hex_sub(m):
        raw = m.group(0)
        low = raw.lower()
        if low in KEEP:
            return raw
        if low in MAP:
            report[low] = report.get(low, 0) + 1
            return MAP[low]
        if re.fullmatch(r"#[0-9a-fA-F]{6}", raw):
            report["пересчёт"] = report.get("пересчёт", 0) + 1
            return flip(low)
        return raw

    css = re.sub(r"#[0-9a-fA-F]{3,8}\b", hex_sub, css)
    return css


def process(rel):
    p = os.path.join(ROOT, rel)
    t = io.open(p, encoding="utf-8").read()
    report = {}
    m = re.search(r"(?s)(<style[^>]*>)(.*?)(</style>)", t)
    if not m:
        print(f"{rel:<14} нет блока <style>")
        return
    css = restyle(m.group(2), report)
    t = t[:m.start(2)] + css + t[m.end(2):]
    io.open(p, "w", encoding="utf-8", newline="\n").write(t)
    top = ", ".join(f"{k}×{v}" for k, v in
                    sorted(report.items(), key=lambda x: -x[1])[:6])
    print(f"{rel:<14} цветов затронуто: {sum(report.values())}  ({top})")


for f in ("index.html", "lang.html", "studio.html", "404.html"):
    process(f)