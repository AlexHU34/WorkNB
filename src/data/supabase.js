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
var TABLES={scores:"scores", pings:"pings"};

/* Живая связь: первая неудачная попытка выключает сеть до перезагрузки
   страницы, чтобы офлайн не сыпал ошибками в консоль на каждый клик. */
var alive=true;

function req(table,method,body,extra){
 if(!alive)return Promise.resolve(null);
 var opt={method:method||"GET",headers:{
   "apikey":SB_KEY,
   "Content-Type":"application/json",
   "Accept":"application/json"
 }};
 if(method==="POST"){opt.body=JSON.stringify(body);opt.headers.Prefer="return=minimal,resolution=ignore-duplicates"}
 if(extra)for(var k in extra)opt.headers[k]=extra[k];
 return fetch(SB_URL+"/rest/v1/"+table,opt).then(function(r){
  if(!r.ok){if(r.status>=500)alive=false;return null}
  var ct=r.headers.get("content-type")||"";
  var range=r.headers.get("content-range");/* для счётчиков */
  if(range)return range;
  return ct.indexOf("json")>=0?r.json():null;
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
 /* Рекорд: пишем каждую сданную работу — доска показывает лучшие. */
 sendScore:function(gameId,gameTitle,score){
  if(!alive)return;
  score=Math.max(0,Math.min(999,Math.round(score||0)));
  req(TABLES.scores,"POST",{game:String(gameId),name:((G.localStorage&&G.localStorage.getItem("bb2_name"))||"гость").slice(0,20),score:score})},
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
 off:function(){alive=false}
};
G.AERIS_SB=API;
})(window);
