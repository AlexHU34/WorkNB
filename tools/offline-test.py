# -*- coding: utf-8 -*-
"""Настоящая проверка офлайна: поднимаем сайт и выдёргиваем провод.

Зачем проверять по-настоящему. До сих пор офлайн проверялся только
по коду: «файл воркера есть», «регистрация защищена протоколом». Это
проверяет намерение, а не результат. Ошибка могла прятаться в самом
кеше — например, игра положилась в кэш, а редактор нет, и человек
обнаружил бы это на середине работы.

Здесь проверка настоящая:
  1. поднимаем папку site/ обычным сервером на порту;
  2. открываем все три страницы, чтобы воркер всё закешировал;
  3. УБИВАЕМ сервер — с этого момента сети нет вообще;
  4. открываем страницы заново и требуем, чтобы они открылись.

Если воркер не сработал, шаг 4 покажет пустую страницу. Никакой
имитации «выключенной сети» тут нет — сервер действительно не отвечает.
"""
import io
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")

PAGES = [("index.html", "NEBULA BLOOM"),
         ("lang.html", "BLOOMSCRIPT"),
         ("studio.html", "NEBULA Studio")]


def find_chrome():
    for p in ("chrome", "google-chrome", "chromium"):
        w = shutil.which(p)
        if w:
            return w
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"):
        if os.path.isfile(p):
            return p
    raise SystemExit("Chrome не найден")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def fetch_chrome(chrome, profile, url, budget=15000):
    return subprocess.run(
        [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--user-data-dir=" + profile, "--hide-scrollbars",
         "--virtual-time-budget=%d" % budget, "--dump-dom", url],
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=240).stdout


def wait_port(port, limit=20.0):
    end = time.time() + limit
    while time.time() < end:
        try:
            s = socket.create_connection(("127.0.0.1", port), 0.4)
            s.close()
            return True
        except OSError:
            time.sleep(0.2)
    return False


def check_page(dom, marker):
    """Страница живая, если это наш заголовок, а не страница ошибки Chrome.

    Проверка по одному совпадению слова обманывала: страница ошибки
    Chrome тоже содержит адрес, поэтому редактор однажды прошёл при
    пустом экране. Теперь смотрим и на заголовок, и на размер."""
    if "ERR_CONNECTION_REFUSED" in dom or "ERR_" in dom[:4000]:
        return False
    return marker in dom and len(dom) > 40000


def same_page(a, b):
    """Без сети страница должна быть той же, что и с сетью.

    Разница в пару процентов нормальна: воркер подставляет своё тело
    ответа. А вот страница другого размера означает, что прилетело не
    то — именно так ловилась выдача каталога вместо редактора."""
    if not a or not b:
        return False
    return abs(len(a) - len(b)) <= max(2000, int(len(b) * 0.15))


def main():
    if not os.path.isdir(SITE):
        print("FAIL  нет папки site/ — сначала python build.py")
        return 1

    chrome = find_chrome()
    port = free_port()
    profile = tempfile.mkdtemp(prefix="nboff_")
    server = None
    rc = 0
    try:
        print("=== ПОДНИМАЕМ САЙТ ===")
        server = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
            cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not wait_port(port):
            print("FAIL  сервер не поднялся на порту %d" % port)
            return 1
        print("  сервер на порту %d, папка site/" % port)

        print("\n=== ПЕРВЫЙ ЗАХОД (сеть есть, воркер кладёт кэш) ===")
        online = {}
        for page, marker in PAGES:
            dom = fetch_chrome(chrome, profile, "http://127.0.0.1:%d/%s" % (port, page))
            online[page] = dom
            ok = check_page(dom, marker)
            print("  %-4s %-12s %6d байт разметки" % ("OK" if ok else "FAIL", page, len(dom)))
            if not ok:
                rc = 1

        # Даём ворку дописать кэш на диск, иначе следующий запуск
        # увидит пустую корзину.
        time.sleep(3)

        print("\n=== РВЁМ ПРОВОД ===")
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        server = None
        # Проверяем, что сервер действительно мёртв: иначе проверка
        # ни о чём не говорила бы.
        alive = False
        try:
            s = socket.create_connection(("127.0.0.1", port), 0.6)
            s.close()
            alive = True
        except OSError:
            pass
        if alive:
            print("FAIL  сервер всё ещё отвечает — тест бессмыслен")
            return 1
        print("  сервер остановлен, порт %d не отвечает" % port)

        print("\n=== ВТОРОЙ ЗАХОД (сети нет) ===")
        for page, marker in PAGES:
            dom = fetch_chrome(chrome, profile, "http://127.0.0.1:%d/%s" % (port, page))
            alive = check_page(dom, marker)
            exact = same_page(dom, online.get(page, ""))
            ok = alive and exact
            why = ""
            if not alive:
                why = "— ПУСТО, страница ошибки"
            elif not exact:
                why = "— подгрузилась ЧУЖАЯ страница (%d вместо %d)" % (
                    len(dom), len(online.get(page, "")))
            else:
                why = "— открылась без сети"
            print("  %-4s %-12s %6d байт %s" % ("OK" if ok else "FAIL", page, len(dom), why))
            if not ok:
                rc = 1
    finally:
        if server is not None:
            server.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print("\nИТОГ: " + ("приложение работает без сети" if rc == 0
                        else "работает НЕ полностью"))
    return rc


if __name__ == "__main__":
    sys.exit(main())