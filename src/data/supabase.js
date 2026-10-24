/* AERIS • supabase.js — глобальные рекорды и флажки событий.
   Хостится бесплатно на supabase.com; здесь только ПУБЛИЧНЫЕ значения:
   адрес проекта и publishable-ключ (он не секрет — сидит в коде сайта
   и виден всем, для того и Row Level Security). Секретные ключи базы
   в этом файле НЕ хранятся и храниться не будут.
   Всё работает молча: нет интернета / таблицы ещё не созданы — сайт
   играется как раньше, без ошибок. */
(function(G){
"use strict";
var SB_URL="https://xqujfjlktbdpxsaylfpn.supabase.co";
var SB_KEY="sb_publishable_gtAKhIpMmpjPdupENQFvTA_iJX7Ds46";
var TABLES={scores:"scores", pings:"pings", profiles:"profiles"};

/* Живая связь: первая неудачная попытка выключает сеть до перезагрузки
   страницы, чтобы офлайн не сыпал ошибками в консоль на каждый клик. */
var alive=true;

/* ---- Очередь отправки: сданное не теряется на обрыве ----------------
   Рекорд сначала ложится в очередь в localStorage (не больше 200
   записей), а потом уходит в базу пачками по 20. Не вышло — повтор
   с выдержкой 5с, 15с, 60с, 180с, 600с, дальше с той же последней.
   Одинаковые записи (та же игра, тот же счёт, то же имя) не
   задваиваются. Отправок не больше 30 в минуту — и в очередь,
   и в события. Очередь переживает перезагрузку страницы. */
var QKEY="bb2_sbq.v1", QMAX=200, QBATCH=20, QMINUTE=30;
var qMem=null, qFails=0, qTimer=0, qOff=false, qBusy=false;
var qTimes=[]; /* времена отправок за последнюю минуту */

function req(table,method,body,extra){
 if(!alive)return Promise.resolve(null);
 /* Общий предел отправок: сеть не должна получать больше тридцати
    записей в минуту ни из очереди, ни из флажков событий. */
 if(method==="POST"&&!qCanSend())return Promise.resolve(null);
 var opt={method:method||"GET",headers:{
   "apikey":SB_KEY,
   "Content-Type":"application/json",
   "Accept":"application/json"
 }};
 if(method==="POST"){opt.body=JSON.stringify(body);opt.headers.Prefer="return=minimal,resolution=ignore-duplicates"}
 if(extra)for(var k in extra)opt.headers[k]=extra[k];
 /* Постгрест ставит Content-Range со звёздочками даже обычному GET c limit.
    Счётчиком считаем его ТОЛЬКО когда сами просили count=exact,
    иначе списку рекордов возвращается строка вместо массива. */
 var needCount=!!(extra&&extra.Prefer&&String(extra.Prefer).indexOf("count=exact")>=0);
 return fetch(SB_URL+"/rest/v1/"+table,opt).then(function(r){
  if(!r.ok){if(r.status>=500)alive=false;return null}
  if(needCount){var rg=r.headers.get("content-range");if(rg)return rg;return null}
  /* POST с return=minimal отвечает 201 и ПУСТЫМ телом: r.json() на нём
     бросает «Unexpected end of JSON», поэтому текст читаем и
     парсим мягко — пустое тело это LEGIT «ничего не вернул», а не ошибка. */
  return r.text().then(function(txt){
   if(!txt)return null;
   try{return JSON.parse(txt)}catch(e){return null}
  });
 }).catch(function(){alive=false;return null});
}

var API={
 on:function(){return alive},
 /* Флажок события: «открыли такую-то игру». Пишется не чаще одного раза
    в полминуты на одно событие за сессию — базу не забиваем. */
 _last:{},
 ping:function(ev){
  if(!alive||!ev)return;
  var t=Date.now();
  if(API._last[ev]&&t-API._last[ev]<30000)return;
  API._last[ev]=t;
  req(TABLES.pings,"POST",{event:String(ev).slice(0,40)})},
 /* Рекорд: пишем каждую сданную работу — доска показывает лучшие.
    Имя игрока берём из профиля (аргумент), из старого плоского ключа
    (до версий хранилища) или «гость». Работа сначала ложится в очередь:
    обрыв связи или закрытая вкладка её не теряют, а заодно одинаковые
    записи не задваиваются. */
 sendScore:function(gameId,gameTitle,score,name){
  score=Math.max(0,Math.min(999,Math.round(score||0)));
  var who=(name||((G.localStorage&&G.localStorage.getItem("bb2_name"))||"гость")).slice(0,20);
  qAdd({game:String(gameId).slice(0,40),name:String(who).slice(0,20),score:score});
 },
 /* Лучшие в игре: cb(список) или cb([]), максимум 8 строк. */
 top:function(gameId,cb){
  req(TABLES.scores+"?game=eq."+encodeURIComponent(gameId)+
   "&select=name,score,created&order=score.desc,created.asc&limit=8","GET")
  .then(function(list){cb(list||[])})},
 /* Счётчик открытий: PostgREST отдаёт общее число строк в заголовке
    Content-Range как "0-0/1234" — берём хвост. */
 total:function(cb){
  req(TABLES.pings+"?select=event&limit=1","GET",null,{Prefer:"count=exact"})
  .then(function(range){
   if(!range){cb(0);return}
   var n=parseInt(String(range).split("/")[1],10);
   cb(isNaN(n)?0:n)})},
 /* Задеморить таблицы без запросов (=сеть мертва — встаём в режим без базы) */
 off:function(){alive=false;qOff=true}
};
/* ---- Работа очереди -------------------------------------------------- */
function qLoad(){
 if(qMem)return qMem;
 qMem=[];
 try{
  var raw=G.localStorage&&G.localStorage.getItem(QKEY);
  if(!raw)return qMem;
  var data=JSON.parse(raw);
  /* Старый вид очереди был просто списком записей, новый — с номером.
     Принимаем обе правды: обновление сайта не теряет сданное. */
  var list=Array.isArray(data)?data:(data&&Array.isArray(data.items)?data.items:[]);
  for(var i=0;i<list.length&&qMem.length<QMAX;i++){
   var it=list[i];
   if(!it||!it.game)continue;
   qMem.push({game:String(it.game).slice(0,40),
    name:String(it.name||"гость").slice(0,20),
    score:Math.max(0,Math.min(999,Math.round(it.score||0)))});
  }
 }catch(e){qMem=[]}
 return qMem;
}
function qSave(){
 try{
  if(G.localStorage)G.localStorage.setItem(QKEY,JSON.stringify({v:1,items:qLoad()}));
 }catch(e){}
}
function qKey(it){return it.game+"|"+it.name+"|"+it.score}
function qAdd(it){
 /* Одинаковая запись уже в очереди — второй раз не кладём. */
 var q=qLoad(), k=qKey(it);
 for(var i=0;i<q.length;i++)if(qKey(q[i])===k)return;
 q.push(it);
 while(q.length>QMAX)q.shift(); /* старое вылетает первым */
 qSave();
 qFlush();
}
function qCanSend(){
 var t=Date.now();
 while(qTimes.length&&t-qTimes[0]>=60000)qTimes.shift();
 if(qTimes.length>=QMINUTE)return false;
 qTimes.push(t);
 return true;
}
function qAgain(ms){
 if(qTimer)G.clearTimeout(qTimer);
 var waits=[5000,15000,60000,180000,600000];
 qTimer=G.setTimeout(function(){qTimer=0;qFlush()},
  ms||waits[Math.min(Math.max(qFails-1,0),waits.length-1)]);
}
function qFlush(){
 if(qOff||qBusy)return;
 var q=qLoad();
 if(!q.length)return;
 if(qTimer)return;
 if(!qCanSend()){qAgain(60000);return}
 var part=q.slice(0,QBATCH);
 qBusy=true; /* в полёте одна отправка: очередь не бьёт в сеть толпой */
 fetch(SB_URL+"/rest/v1/"+TABLES.scores,{
  method:"POST",
  headers:{"apikey":SB_KEY,"Content-Type":"application/json",
   "Prefer":"return=minimal,resolution=ignore-duplicates"},
  body:JSON.stringify(part.map(function(it){
   return {game:it.game,name:it.name,score:it.score};
  }))
 }).then(function(r){
  qBusy=false;
  /* 4xx — про правила таблицы, а не про связь: рекордный канал
     продолжает жить, очередь ждёт с выдержкой. 5xx — сеть/база. */
  if(!r.ok){qFails++;if(r.status>=500)alive=false;qAgain();return}
  alive=true;qFails=0;
  /* Убираем только ушедшее: добавленное в это время остаётся. */
  var sent={};
  for(var i=0;i<part.length;i++)sent[qKey(part[i])]=1;
  qMem=qLoad().filter(function(it){return !sent[qKey(it)]});
  qSave();
  if(qMem.length)qFlush();
 }).catch(function(){qBusy=false;qFails++;alive=false;qAgain()});
}
/* Очередь просыпается вместе со страницей: тихо, без сообщений. */
try{qFlush()}catch(e){}
/* ---- Канал ошибок (не рекорды): отдельный флаг, чтобы проблемы
   таблицы client_errors не выключали рекордный канал. Ошибки шлём
   не чаще двух одинаковых за сессию и не больше 10 всего. ---- */
var ERR_TABLE="client_errors";
var errOk=true,errTotal=0,errSeen={};
function errReq(body){
 if(!errOk||errTotal>=10)return;
 fetch(SB_URL+"/rest/v1/"+ERR_TABLE,{
  method:"POST",
  headers:{"apikey":SB_KEY,"Content-Type":"application/json"},
  body:JSON.stringify(body)
 }).then(function(r){if(!r.ok)errOk=false}).catch(function(){errOk=false});
}
API.report=function(page,msg){
 if(!errOk||errTotal>=10||!msg)return;
 var k=String(msg).slice(0,140);
 if(errSeen[k])return; /* дубль за сессию — один раз достаточно */
 errSeen[k]=1;errTotal++;
 errReq({page:String(page||"").slice(0,30),msg:k});
};
/* ---- Канал ников (профили без пароля): третий свой флаг. Уникальность
   гарантирует база (нижний регистр), поэтому даже если проверка «свободен?»
   ошиблась на гонке — вторая вставка честно вернёт «занят». ---- */
var profOk=true;
function nickClean(s){
 var n=String(s||"").trim().replace(/\s+/g," ");
 if(!/^[0-9A-Za-zА-Яа-яЁё_ -]{2,16}$/.test(n))return "";
 if(/^[ _-]|[ _-]$/.test(n))return ""; /* пробел/дефис не на торцах */
 return n;
}
/* Свободен ли ник: cb(ошибка, свободен). ошибка: "" | "сеть" | "правила". */
API.nickFree=function(name,cb){
 var n=nickClean(name);
 if(!n){cb("правила",false);return}
 if(!profOk){cb("сеть",false);return}
 fetch(SB_URL+"/rest/v1/"+TABLES.profiles+"?select=name&name=ilike."+
  encodeURIComponent(n)+"&limit=1",{headers:{"apikey":SB_KEY}})
 .then(function(r){
  if(!r.ok){profOk=(r.status>=500);cb("сеть",false);return}
  return r.text();
 })
 .then(function(t){
  if(t===undefined)return; /* уже ответили Networking-веткой */
  var rows=null;try{rows=JSON.parse(t)}catch(e){}
  cb(null,Array.isArray(rows)&&rows.length===0);
 })
 .catch(function(){profOk=false;cb("сеть",false)});
};
/* Занять ник: cb(ошибка, ok). "правила" — не прошёл формат/условия базы. */
API.claimNick=function(name,cb){
 var n=nickClean(name);
 if(!n){cb("правила",false);return}
 if(!profOk){cb("сеть",false);return}
 fetch(SB_URL+"/rest/v1/"+TABLES.profiles,{
  method:"POST",
  headers:{"apikey":SB_KEY,"Content-Type":"application/json"},
  body:JSON.stringify({name:n})
 }).then(function(r){
  if(r.ok){cb(null,true)}
  else if(r.status===409){cb(null,false)} /* уникальный индекс: занято */
  else if(r.status===400||r.status===401||r.status===403){cb("правила",false)} /* политика формата шлёт кривой ник как 401/403 — это про ник, не про связь */
  else{profOk=(r.status<500);cb("сеть",false)}
 }).catch(function(){profOk=false;cb("сеть",false)});
};
/* Чистка ника наружу: приложение проверяет формат до запросов. */
API.cleanNick=nickClean;
G.AERIS_SB=API;
})(window);
