/* AERIS — офлайн.
 *
 * Зачем. Пока страницу открывают с сервера, каждый заход тянет пол
 * мегабайта: игра, редактор и студия — три отдельных файла. Рвётся
 * связь, и человек остаётся без игры на середине.
 *
 * Здесь три страницы и манифест кладутся в кэш при первом заходе.
 * Дальше приложение открывается без сети целиком.
 *
 * ВАЖНО. Сервис-воркер работает только на http:// и https://. При
 * открытии файла двойным щелчком (file://) его нет — и не нужно: файл
 * и так лежит на диске. Поэтому регистрация в приложении проверяет
 * протокол и молча выходит, а не падает. Офлайн-сборка с диска
 * продолжает работать как раньше.
 */

/* Версия кэша. Меняется при каждой выкладке: новая версия означает
   новый кэш, и старая удаляется при активации. */
var VERSION = "aeris-20261016-223835";
var SHELL = [
  "./",
  "./index.html",
  "./lang.html",
  "./studio.html",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      /* addAll падает целиком, если хоть один файл не скачался. Поэтому
         кладём по одному и не даём одной ошибке сорвать установку. */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Навигация: сначала сеть, при неудаче кэш. Так игрок получает свежую
     версию, если связь есть, и всё равно попадает в игру без неё.

     Важно: из кэша отдаётся та страница, которую просили, а не главная.
     Раньше здесь жёстко стоял index.html, и без связи запрос редактора
     или студии молча открывал каталог игр: адрес один, заголовок другой,
     и человек терял свою работу. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          return caches.match("./index.html").then(function (r) {
            return r || caches.match("./");
          });
        });
      })
    );
    return;
  }

  /* Остальное: сначала кэш. Игра и её картинки не меняются между
     вылазками, а сеть на телефоне медленная. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});