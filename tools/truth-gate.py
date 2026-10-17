# -*- coding: utf-8 -*-
"""Гейт: на сайте нет выдуманных чисел.

Зачем. На карточках игр стояли «👥 45 200» и «👍 94%», в шапке светило
«128K сейчас в игре», а каждые семь секунд таймер прибавлял к этим
числам случайные единицы. Это была декорация, а не данные. Своего
проекта стыдно показывать выдуманные цифры, тем более когда речь о
своих посетителях.

Что проверяется в настоящем Chrome:
  1. нигде на странице нет «👥» с числом рядом и нет «👍 N%»;
  2. в шапке стоит настоящее число игр, которое человек открыл;
  3. после открытия игры это число растёт на единицу;
  4. после финала игры растёт число пройденных;
  5. в данных каталога больше нет полей players и likes;
  6. счётчик визитов не растёт при каждой перезагрузке.
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


def find_chrome():
    for c in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.isfile(c):
            return c
    w = shutil.which("chrome") or shutil.which("chromium")
    if w:
        return w
    sys.exit("Chrome/Edge не найден")


# Проба внутри настоящей собранной страницы.
PROBE = """
<script>
window.__rep = [];
function rep(k, v) { window.__rep.push(k + "=" + v); }
window.addEventListener("error", function (e) { rep("js_error", e.message); });

(function run() {
  try {
    rep("has_truth", typeof AERIS_TRUTH);
    rep("started_0", AERIS_TRUTH.counts().played);
    rep("done_0", AERIS_TRUTH.counts().done);

    /* 1. Ищем выдуманные числа в том, что человек реально видит. */
    var body = document.body.innerText;
    rep("emoji_people", /👥\\s*[\\d\\u00a0 ]{2,}/.test(body) ? "есть" : "нет");
    rep("likes_percent", /👍\\s*\\d+\\s*%/.test(body) ? "есть" : "нет");
    rep("big_online", /\\d+[KМ]\\s*сейчас в игре/i.test(body) ? "есть" : "нет");

    /* 2. Подпись под карточкой должна быть честной фразой. */
    var meta = document.querySelector(".card .meta");
    rep("card_meta", meta ? meta.innerText.trim() : "нет карточек");

    /* 3. Открываем игру — число открытых должно вырасти на 1. */
    var g0 = AERIS_TRUTH.counts().played;
    openGame(1);
    rep("after_open", AERIS_TRUTH.counts().played);
    rep("opened_by_one", AERIS_TRUTH.counts().played === g0 + 1 ? "да" : "нет");
    rep("state_open", AERIS_TRUTH.state(1));

    /* 4. Отмечаем финал так, как это делает любая игра. */
    awardResult(3, "🌸", 30, null, "проба");
    rep("after_win", AERIS_TRUTH.counts().done);
    rep("state_done", AERIS_TRUTH.state(1));
    rep("stars_kept", AERIS_TRUTH.stars(1));

    /* 5. Шапка показывает настоящие числа. */
    goHome();
    rep("head_played", document.getElementById("stOnline").innerText);
    rep("head_done", (document.getElementById("stTruth")||{}).innerText);

    /* 6. Визиты не растут при повторной загрузке в тот же день.
          Первый вызов только регистрирует визит, второй уже ничего
          не должен менять — иначе число раздувалось бы само себя. */
    AERIS_TRUTH.markVisit();
    var v1 = AERIS_TRUTH.visits();
    AERIS_TRUTH.markVisit();
    AERIS_TRUTH.markVisit();
    rep("visit_stable", AERIS_TRUTH.visits() === v1 ? "да" : "нет");
    rep("visits_at_least_1", AERIS_TRUTH.visits() >= 1 ? "да" : "нет");
  } catch (e) {
    rep("caught", e && e.message);
  }
  var el = document.createElement("pre");
  el.id = "truthrep";
  el.textContent = window.__rep.join("|");
  document.body.appendChild(el);
})();
</script>
"""


def chrome_dump(html, tag):
    tmp = os.path.join(ROOT, "_tmp_%s.html" % tag)
    io.open(tmp, "w", encoding="utf-8", newline="\n").write(html)
    prof = tempfile.mkdtemp(prefix="nbtruth_")
    try:
        out = subprocess.run(
            [find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox",
             "--user-data-dir=" + prof, "--hide-scrollbars",
             "--window-size=1200,900", "--virtual-time-budget=15000",
             "--allow-file-access-from-files", "--dump-dom",
             "file:///" + tmp.replace("\\", "/")],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=180).stdout
    finally:
        shutil.rmtree(prof, ignore_errors=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
    return out


# Проверяем собранную страницу, а не исходник: человек видит именно её.
built = os.path.join(ROOT, "dist", "min", "Aeris.html")
if not os.path.isfile(built):
    sys.exit("сначала собери проект: python build.py")

page = io.open(built, encoding="utf-8").read()
page = page.replace("</body>", PROBE + "\n</body>", 1)
dom = chrome_dump(page, "truth")

m = re.search(r'<pre id="truthrep">(.*?)</pre>', dom, re.S)
if not m:
    print("Chrome не отдал страницу — проба не выполнилась")
    print(dom[:800])
    raise SystemExit(1)

got = dict(x.split("=", 1) for x in m.group(1).split("|") if "=" in x)
for k, v in got.items():
    print("  %-16s %s" % (k, v))

bad = []


def need(key, want, label):
    have = got.get(key, "<нет>")
    ok = have == want
    if not ok:
        bad.append(label)
    print("  %-42s %s" % (label, "ок" if ok else "НЕ ТАК: " + str(have)))


print()
need("has_truth", "object", "модуль честного учёта подключён")
need("emoji_people", "нет", "выдуманных «👥 N» на странице нет")
need("likes_percent", "нет", "выдуманных «👍 N%» на странице нет")
need("big_online", "нет", "выдуманного «онлайн» в шапке нет")
need("opened_by_one", "да", "открытая игра честно засчитывается")
need("state_open", "played", "состояние «в процессе»")
need("state_done", "done", "состояние «пройдена» после финала")
need("stars_kept", "3", "честные звёзды сохраняются")
need("visit_stable", "да", "визиты не растут при перезагрузке")
need("visits_at_least_1", "да", "визит засчитан")

if got.get("js_error") or got.get("caught"):
    bad.append("ошибка в странице: %s / %s" % (got.get("js_error"),
                                              got.get("caught")))

meta = got.get("card_meta", "")
if "👥" in meta or "%" in meta:
    bad.append("в подписи карточки остались выдуманные числа")
else:
    print("  %-42s ок" % ("подпись карточки честная: «%s»" % meta))

# В данных каталога выдуманных полей быть не должно
data = io.open(os.path.join(ROOT, "src", "app", "data.js"),
               encoding="utf-8").read()
if re.search(r"\bplayers\s*:", data):
    bad.append("в данных снова появились players")
else:
    print("  %-42s ок" % "в данных нет поля players")
if re.search(r"\blikes\s*:", data):
    bad.append("в данных снова появились likes")
else:
    print("  %-42s ок" % "в данных нет поля likes")

app = io.open(os.path.join(ROOT, "src", "app", "app.js"),
              encoding="utf-8").read()
if "Math.random()*36-12" in app:
    bad.append("вернулся таймер выдуманных игроков")
else:
    print("  %-42s ок" % "таймер выдуманных игроков удалён")

if bad:
    print("\nПРОВАЛ:")
    for b in bad:
        print("  -", b)
    raise SystemExit(1)

print("\nна сайте остались только настоящие числа")