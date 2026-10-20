/* Приложение AERIS: лобби, экономика, конструктор, настройки.
 *
 * Вынесено из index.html. Данные каталога лежат в data.js, сто игр —
 * в games.js, а здесь всё, что связывает их: поиск, фильтры, магазин,
 * монеты, достижения, поле для сборки, окно настроек и запуск.
 *
 * Файл подключается последним из src/app: он обращается и к данным,
 * и к играм, поэтому оба должны быть уже объявлены.
 */

/* ============ DATA ============ */
/* ============ STORE ============ */
/* store — тонкая обёртка над версионированным хранилищем (Фаза 0.5).
   Имена ключей исторически bb2_*; перевод на новые делается миграцией
   внутри store.js, поэтому здесь перечисление один раз. */
/* Если браузер не даёт записать (память кончилась, приватный режим),
   хранилище сообщает об этом сюда. Раньше ошибка глоталась: монеты и
   работы выглядели сохранёнными и пропадали после перезагрузки. */
BB.onError=()=>toast("⚠️ Не удалось сохранить: память браузера переполнена. Часть прогресса может пропасть.");
const STORE_MAP={
 "bb2_favs":"favs","bb2_coins":"coins","bb2_xp":"xp",
 "bb2_works":"works","bb2_owned":"owned","bb2_own":"own","bb2_ach":"ach",
 "bb2_hist":"hist","bb2_sound":"sound","bb2_earn":"earn","bb2_spent":"spent",
 "bb2_eco_day":"ecoDay","bb2_firsts":"firsts","bb2_q":"q","bb2_theme":"theme",
 "bb2_buff":"buff","bb2_daily":"daily","bb2_played":"played","bb2_seen":"seen",
 "bb2_mem_best":"memBest","bb2_quiz_best":"quizBest","bb2_scents":"scents",
 "bb2_wheel":"wheel","bb2_last":"last","bb2_streak":"streak",
 /* Настройки из окна ⚙️. Без этих строк store.set("bb2_vol") молча
    ничего не делал: ключ не был известен, значение уходило в никуда,
    и после перезагрузки настройка возвращалась к исходной. */
 "bb2_vol":"vol","bb2_ui":"ui","bb2_quality":"quality"
};
const store={
 get:(k,d)=>{const n=STORE_MAP[k];return n===undefined?d:BB.get(n,d)},
 set:(k,v)=>{const n=STORE_MAP[k];if(n!==undefined)BB.set(n,v);return v}
};
let filter="all", favs=store.get("bb2_favs",[]), coins=store.get("bb2_coins",120),
 xp=store.get("bb2_xp",0), works=store.get("bb2_works",[]), owned=store.get("bb2_owned",[]),ownedG=store.get("bb2_own",[]),
 ach=store.get("bb2_ach",[]), history=store.get("bb2_hist",[]),
 currentGame=1, selected=null, zTop=10, curColor=COLORS[0], curCat="Всё",
 undoStack=[], redoStack=[], combo=0, comboT=null, timerOn=false, timerSec=60, timerInt=null,
 soundOn=store.get("bb2_sound",true), heroI=0;
const $=id=>document.getElementById(id);
/* ===== ЭКОНОМИКА: учёт дня, бонус первого за день, траты ===== */
let ecoEarn=store.get("bb2_earn",0),ecoSpent=store.get("bb2_spent",0),ecoDay=store.get("bb2_eco_day",""),firsts=store.get("bb2_firsts",{day:"",ids:[]});
function ecoRoll(){const t=new Date().toDateString();if(ecoDay!==t){ecoDay=t;ecoEarn=0;ecoSpent=0;store.set("bb2_eco_day",t);store.set("bb2_earn",0);store.set("bb2_spent",0)}if(!firsts||firsts.day!==t){firsts={day:t,ids:[]};store.set("bb2_firsts",firsts)}}
function ecoTrack(n){ecoRoll();ecoEarn+=n;store.set("bb2_earn",ecoEarn)}
function ecoPay(n){ecoRoll();if(coins<n){toast("Не хватает 🪙! Нужно "+n);sfx.del();return false}coins-=n;ecoSpent+=n;store.set("bb2_spent",ecoSpent);updateHUD();return true}
function ecoFirstBonus(){ecoRoll();if(firsts.ids.indexOf(currentGame)>=0)return 0;firsts.ids.push(currentGame);store.set("bb2_firsts",firsts);return .5}
function disc(n){return Math.floor(xp/200)+1>=5?Math.ceil(n*.9):n}
/* ===== КВЕСТЫ ДНЯ ===== */
let quests=store.get("bb2_q",{day:"",plays:[],s3:false,done:0,claimed:{}});
function questCheck(stars){ecoRoll();const t=new Date().toDateString();
 if(!quests||quests.day!==t)quests={day:t,plays:[],s3:false,done:0,claimed:{}};
 if(quests.plays.indexOf(currentGame)<0)quests.plays.push(currentGame);
 if(stars>=3)quests.s3=true;quests.done++;const gm=GAMES.find(x=>x.id===currentGame);if(gm&&gm.mode)quests.m3d=true;
 const give=(id,amt,txt)=>{if(!quests.claimed[id]){quests.claimed[id]=1;coins+=amt;ecoTrack(amt);setTimeout(()=>{sfx.win();boom(90);toast("📜 Квест: "+txt+" +"+amt+" 🪙!")},900)}};
 if(quests.plays.length>=3)give("p3",120,"3 разные игры");
 if(quests.s3)give("s3",100,"3 звезды");
 if(quests.done>=5)give("d5",150,"5 работ");
 if(quests.m3d)give("m5",90,"3D-игра");
 if(ecoSpent>=200)give("q4",80,"шопинг 200");
 store.set("bb2_q",quests);updateHUD(true);renderQuests()}
function renderQuests(){const el=$("questList");if(!el)return;ecoRoll();const t=new Date().toDateString();
 if(!quests||quests.day!==t)quests={day:t,plays:[],s3:false,done:0,claimed:{}};
 const row=(done,txt)=>"<div style='padding:5px 4px;"+(done?"":"opacity:.55")+"'>"+(done?"✅":"🔲")+" "+txt+"</div>";
 el.innerHTML=row(quests.claimed.p3,"3 разные игры ("+Math.min(3,quests.plays.length)+"/3) +120")+row(quests.claimed.s3,"3 звезды +100")+row(quests.claimed.d5,"5 работ ("+Math.min(5,quests.done)+"/5) +150")+row(quests.claimed.q4,"шопинг на 200 ("+Math.min(200,ecoSpent)+"/200) +80")+row(quests.claimed.m5,"3D-игра +90")}
const fmt=n=>n>=1000?(n/1000).toFixed(1)+"K":n;
/* ============ AUDIO ============ */
let AC=null;
function beep(f,d,type,g){if(!soundOn)return;try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();const o=AC.createOscillator(),gn=AC.createGain();o.type=type||"sine";o.frequency.value=f;gn.gain.value=(g==null?.12:g)*vol;o.connect(gn);gn.connect(AC.destination);o.start();gn.gain.exponentialRampToValueAtTime(.001,AC.currentTime+d);o.stop(AC.currentTime+d)}catch(e){}}
const sfx={click:()=>beep(600,.08,"square",.05),pop:()=>{beep(500,.09,"sine");setTimeout(()=>beep(760,.12,"sine"),70)},del:()=>beep(220,.15,"sawtooth",.06),coin:()=>{beep(880,.1,"sine");setTimeout(()=>beep(1320,.16,"sine"),90)},win:()=>{[523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,.22,"triangle",.1),i*130))},star:i=>beep(700+i*180,.18,"triangle",.1)};
function toggleSound(){soundOn=!soundOn;store.set("bb2_sound",soundOn);$("soundBtn").textContent=soundOn?"🔊":"🔇";toast(soundOn?"Звук включён 🔊":"Звук выключен 🔇")}
/* ============ THEME/PARTICLES/CONFETTI ============ */
function toggleTheme(){const h=document.documentElement;h.dataset.theme=h.dataset.theme==="light"?"dark":"light";store.set("bb2_theme",h.dataset.theme);sfx.click()}
document.documentElement.dataset.theme="light";/* Старые версии сохраняли тему. Читать её больше нельзя: на светлом
   фоне тёмные переменные давали чёрные карточки и невидимые подписи. */
store.set("bb2_theme","light");

/* ============ НАСТРОЙКИ ============ */
/* Звук, громкость, размер интерфейса, тема и графика живут в одном окне.
   Каждая настройка сохраняется сразу и применяется без перезагрузки:
   подкрутил ползунок — слышно разницу в тот же момент. */
let vol=Math.min(1,Math.max(0,(store.get("bb2_vol",70)||0)/100));
let uiScale=store.get("bb2_ui",1)*1||1;
let quality=store.get("bb2_quality","medium")||"medium";
let glMode=store.get("bb2_gl","auto")||"auto";

function openSettings(){
  $("setOverlay").classList.add("show");
  syncSettings();
}
function closeSettings(){$("setOverlay").classList.remove("show")}
$("setOverlay").addEventListener("click",e=>{if(e.target.id==="setOverlay")closeSettings()});

function seg(id,val){
  const box=$(id); if(!box)return;
  for(const b of box.children) b.classList.toggle("on",String(b.dataset.v)===String(val));
}
function syncSettings(){
  seg("segSound",soundOn?1:0);
  seg("segScale",uiScale);
  seg("segTheme",document.documentElement.dataset.theme);
  seg("segQuality",quality);
  seg("segGl",glMode);
  $("volSlider").value=Math.round(vol*100);
  $("volVal").textContent=Math.round(vol*100);
}
function setSoundUI(on){soundOn=!!on;store.set("bb2_sound",soundOn);$("soundBtn").textContent=soundOn?"🔊":"🔇";seg("segSound",soundOn?1:0)}
function setVolume(v){vol=Math.min(1,Math.max(0,v/100));store.set("bb2_vol",v);$("volSlider").value=v;$("volVal").textContent=v}
/* Размер всего интерфейса. В проекте 111 размеров шрифта в пикселях,
   поэтому обычный трюк с rem не сработал бы: увеличение корневого шрифта
   на них не влияет. zoom, в отличие от transform, честно пересчитывает
   вёрстку, поэтому полосы прокрутки и позиционирование остаются верными. */
function setScale(v){
  uiScale=parseFloat(v)||1;
  store.set("bb2_ui",uiScale);
  document.documentElement.style.zoom=uiScale===1?"":uiScale;
  seg("segScale",uiScale);
}
function setTheme(t){t="light";document.documentElement.dataset.theme=t;store.set("bb2_theme",t);seg("segTheme",t);sfx.click()}
/* Графика: три уровня нагрузки. Что именно они делают — в applyQuality. */
function setQuality(q){quality=q;store.set("bb2_quality",q);applyQuality();seg("segQuality",q)}
function applyQuality(){ if(typeof E3!=="undefined"&&E3.setQuality) E3.setQuality(quality) }
/* Ускорение видеокартой. "auto" пробует GL и сам откатывается на 2D,
   если что-то пошло не так. Переключение действует на следующую
   запущенную игру: путь отрисовки выбирается при старте среды. */
function setGl(v){
  glMode=v; store.set("bb2_gl",v); seg("segGl",v);
  if(typeof E3GL!=="undefined"&&E3GL.request) E3GL.request(v==="on"?true:v==="off"?false:null);
  toast(v==="on"?"Ускорение включится при следующей игре"
      :v==="off"?"Ускорение выключено, работаем как раньше"
      :"Ускорение выбирается автоматически");
}
/* Открыть журнал ошибок из окна настроек. Модуль диагностики подключён
   первым, но на всякий случай проверяем: без него кнопка была бы мёртвой. */
function openDiag(){
  if (typeof NebulaDiag === "undefined") {
    toast("Диагностика не загрузилась — проверь, что файл src/data/diag.js на месте");
    return;
  }
  NebulaDiag.open();
}
function resetProgress(){
  if(!confirm("Точно сбросить весь прогресс? Это нельзя отменить."))return;
  try{
    const kill=[];
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
      if(k&&(k.indexOf("bb2")===0||k.indexOf("bloomscript")===0||k.indexOf("nb_")===0))kill.push(k)}
    kill.forEach(k=>localStorage.removeItem(k));
  }catch(e){}
  location.reload();
}
(function petals(){const c=$("petals"),x=c.getContext("2d");let W,H,ps=[];function rs(){W=c.width=innerWidth;H=c.height=innerHeight}rs();addEventListener("resize",rs);
 const EM=["🌸","🌷","💮","🏵","🌼"];for(let i=0;i<22;i++)ps.push({e:EM[i%5],x:Math.random()*innerWidth,y:Math.random()*innerHeight,s:10+Math.random()*16,v:.3+Math.random()*.7,ph:Math.random()*6,sw:.5+Math.random()});
 (function loop(t){if(document.hidden||!$('gameView')||$('gameView').classList.contains('show')){/* Рисовать некому — отдаём буфер, это 8 МБ на весь экран */if(c.width){c.width=0;c.height=0}setTimeout(()=>requestAnimationFrame(loop),250);return}if(!c.width){W=c.width=innerWidth;H=c.height=innerHeight}x.clearRect(0,0,W,H);x.globalAlpha=.5;ps.forEach(p=>{p.y+=p.v;p.ph+=.01;p.x+=Math.sin(p.ph)*p.sw*.4;if(p.y>H+30){p.y=-30;p.x=Math.random()*W}x.font=p.s+"px serif";x.fillText(p.e,p.x,p.y)});x.globalAlpha=1;setTimeout(()=>requestAnimationFrame(loop),33)})();
})();
let confetti=[];
function boom(n,CC){const c=$("confetti");if(!c.width){c.width=innerWidth;c.height=innerHeight}const x=c.getContext("2d");const C=CC||["#ff5d8f","#ffb700","#00c06f","#00a2ff","#8b5cf6"];for(let i=0;i<(n||120);i++)confetti.push({x:innerWidth/2+(Math.random()-.5)*200,y:innerHeight* .45,vx:(Math.random()-.5)*11,vy:-4-Math.random()*8,s:4+Math.random()*6,c:C[i%5],r:Math.random()*6,l:1});
 if(!boom.run){boom.run=true;(function loop(){x.clearRect(0,0,c.width,c.height);confetti=confetti.filter(p=>p.l>0);confetti.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=.3;p.r+=.15;p.l-=.008;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.globalAlpha=Math.max(0,p.l);x.fillStyle=p.c;x.fillRect(-p.s/2,-p.s/2,p.s,p.s*.6);x.restore()});if(confetti.length)requestAnimationFrame(loop);else{boom.run=false;c.width=c.height=0}})()}}
/* тряска игрового поля (вызывается из 3D-режимов при столкновениях/уроне) */
function shakeIt(mag){
 const c=$("canvas");if(!c)return;
 const m=Math.min(18,typeof mag==="number"?mag:10);
 shakeIt.m=Math.max(shakeIt.m||0,m);
 shakeIt.t=.34;shakeIt.ph=(shakeIt.ph||0)+1.7;
 if(shakeIt.raf)return;
 let last=0;
 const step=()=>{const now=performance.now(),dt=Math.min(.05,(now-last)/1000)||.016;last=now;
  shakeIt.t-=dt;
  if(shakeIt.t>0){const k=shakeIt.t/.34,a=shakeIt.ph;
   const sx=Math.sin(a)*shakeIt.m*k,sy=Math.cos(a*1.7)*shakeIt.m*k*.55;
   c.style.transform="translate("+sx.toFixed(2)+"px,"+sy.toFixed(2)+"px)";shakeIt.raf=requestAnimationFrame(step)}
  else{c.style.transform="";shakeIt.m=0;shakeIt.raf=0}};
 last=performance.now();
 shakeIt.raf=requestAnimationFrame(step);
}
/* ============ HELPERS ============ */
function toast(t){const el=$("toast");el.textContent=t;el.classList.add("show");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),2300)}
/* Шапка показывает настоящие числа: сколько игр человек уже открыл и прошёл. */
function renderTruthStats(){const c=AERIS_TRUTH.counts();const e=$("stOnline");if(e)e.textContent=c.played;const d=$("stTruth");if(d)d.textContent=c.done}
function saveAll(){store.set("bb2_favs",favs);store.set("bb2_coins",coins);store.set("bb2_xp",xp);store.set("bb2_works",works);store.set("bb2_owned",owned);store.set("bb2_ach",ach);store.set("bb2_hist",history);store.set("bb2_own",ownedG)}
let lastLvl=0;function updateHUD(pop){$("coins").textContent="🪙 "+coins;const lvl=Math.floor(xp/200)+1;if(lastLvl&&lvl>lastLvl){setTimeout(()=>{sfx.win();boom(160);toast("🎉 Новый уровень "+lvl+"! Так держать!")},700)}lastLvl=lvl;$("lvlPill").textContent="⭐ "+lvl;$("lvlTxt").textContent=`Уровень ${lvl} • ${xp} XP`;$("lvlBar").style.width=((xp%200)/2)+"%";$("stCoins").textContent=coins;$("stWorks").textContent=works.length;const gc=$("gameCount");if(gc)gc.textContent="• "+GAMES.length+" игр";$("favCount").textContent=favs.length?`(${favs.length})`:"";$("achCount").textContent=`${ach.length}/${ACHS.length}`;if(pop){$("coins").classList.remove("pop");void $("coins").offsetWidth;$("coins").classList.add("pop")}saveAll()}
function unlock(id){if(ach.includes(id))return;ach.push(id);saveAll();sfx.coin();toast("🏆 Достижение: "+ACHS.find(a=>a.id===id).n);renderAch();boom(60)}
function comboHit(){combo++;clearTimeout(comboT);if(combo>=3){unlock("streak");coins+=5;ecoTrack(5);updateHUD(true);$("comboTxt").textContent=`🔥 Комбо x${combo} +5 🪙`}else $("comboTxt").textContent="";comboT=setTimeout(()=>{combo=0;$("comboTxt").textContent=""},2500)}
/* ============ LOBBY ============ */
function heroRender(){const s=HERO[heroI];$("hero").innerHTML=`<div class="slide on" style="background:${s.g}"><div class="float-e">${s.e}</div><div class="cssbloom">${"<span></span>".repeat(8)}</div><h1>${s.t}</h1><p>${s.p}</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-green" style="background:#fff;color:#111;box-shadow:none" onclick="heroPlay()">▶ Играть</button><button class="btn" style="background:rgba(255,255,255,.2);color:#fff;border:1.5px solid rgba(255,255,255,.6)" onclick="heroNext()">Дальше ›</button></div></div><div class="dots">${HERO.map((_,i)=>`<span class="${i===heroI?"on":""}" onclick="heroGo(${i})"></span>`).join("")}</div>`}
function heroPlay(){const a=HERO[heroI].act;if(a===0)openShop();else openGame(a||1)}
function heroNext(){heroI=(heroI+1)%HERO.length;heroRender()}
function heroGo(i){heroI=i;heroRender()}
setInterval(()=>{if(document.hidden)return;if(!$("gameView").classList.contains("show")){heroI=(heroI+1)%HERO.length;heroRender()}},7000);
function cardHTML(g,i){const loved=favs.includes(g.id),locked=g.price&&ownedG.indexOf(g.id)<0;return `<div class="card tilt${locked?" locked":""}${g.price?" vip":""}${g.isNew?" fresh":""}" data-id="${g.id}" onclick="openModal(${g.id})" style="animation:cardIn .45s backwards;animation-delay:${((i||0)%12)*45}ms">${locked?`<div class="badge">🔒 ${g.price} 🪙</div>`:(g.badge?`<div class="badge">${g.badge}</div>`:"")}<button class="fav ${loved?"loved":""}" onclick="event.stopPropagation();toggleFav(${g.id})">${loved?"❤️":"🤍"}</button><div class="thumb" style="background:${g.grad}"><div class="shine"></div><span class="big">${g.emoji}</span><div class="play"><div class="play-btn">▶</div></div></div><div class="card-body"><b>${g.title}</b><div class="meta"><span>${AERIS_TRUTH.meta(g)}</span></div><div class="stars">${"★".repeat(g.stars)}${"☆".repeat(5-g.stars)}</div></div></div>`}
function skeleton(n){return Array(n).fill('<div class="skel"></div>').join("")}
/* Статичные части лобби (популярное, недавние, боковой список) не зависят от
   строки поиска и фильтра — только от history/favs/игр. Раньше каждый ввод в
   поиск пересобирал их заново через innerHTML. Теперь они кэшируются и
   перерисовываются, только когда реально изменились данные. */
const lobbyCache={row1:"",rowRecent:"",side:"",sig:"",n:0,q:"",sort:"",filter:"",shown:24};
function renderLobby(skel){renderTruthStats();
  const grid=$("gridAll");if(skel){grid.innerHTML=skeleton(6);setTimeout(()=>renderLobby(false),450);return}
  const q=($("search").value||"").toLowerCase(),sort=$("sort").value;
  let list=GAMES.filter(g=>g.title.toLowerCase().includes(q));
  if(filter==="pop")list=list.filter(g=>AERIS_TRUTH.state(g)==="new");
  if(filter==="new")list=list.filter(g=>g.isNew);
  if(filter==="fav")list=list.filter(g=>favs.includes(g.id));
  list.sort((a,b)=>sort==="like"?b.stars-a.stars:sort==="az"?a.title.localeCompare(b.title,"ru"):(AERIS_TRUTH.state(b)==="new")-(AERIS_TRUTH.state(a)==="new"));
  const sig=history.join(",")+"|"+favs.join(",");
  if(sig!==lobbyCache.sig){
    lobbyCache.row1=[...GAMES].sort((a,b)=>(AERIS_TRUTH.state(b)==="new")-(AERIS_TRUTH.state(a)==="new")||b.stars-a.stars).map(cardHTML).join("");
    lobbyCache.rowRecent=history.length?history.map(id=>{const g=GAMES.find(x=>x.id===id);return g?cardHTML(g):""}).join(""):`<div style="color:var(--muted);font-size:13.5px;padding:14px;font-weight:600">Сыграй во что-нибудь — и оно появится здесь 🕘</div>`;
    /* В боковом списке раньше было сто кнопок — длиннее экрана.
     Показываем первые двенадцать и пишем, сколько всего. */
   const SIDE_N=12;
   lobbyCache.side=GAMES.slice(0,SIDE_N).map(g=>`<button class="side-btn" onclick="openGame(${g.id})"><span class="ic">${g.emoji}</span> ${g.title}</button>`).join("")+(GAMES.length>SIDE_N?`<div class="sideMore">и ещё ${GAMES.length-SIDE_N} — все в каталоге</div>`:``);
    lobbyCache.sig=sig;
  }
  if($("row1").innerHTML!==lobbyCache.row1)$("row1").innerHTML=lobbyCache.row1;
  if($("rowRecent").innerHTML!==lobbyCache.rowRecent)$("rowRecent").innerHTML=lobbyCache.rowRecent;
  /* Каталог собирается порциями: первый экран готов сразу, остальное
     по кнопке. Сто карточек за раз — это сто элементов, сто фонов
     и сто подписей, и всё это строится заново при поиске. */
  const PAGE=24;
  if(lobbyCache.n!==list.length||lobbyCache.q!==q||lobbyCache.sort!==sort||lobbyCache.filter!==filter){
    lobbyCache.n=list.length;lobbyCache.q=q;
    lobbyCache.sort=sort;lobbyCache.filter=filter;lobbyCache.shown=PAGE}
  if(!list.length){lobbyCache.shown=0;grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:30px">Ничего не найдено 😢</div>`}
  else{
    const slice=list.slice(0,lobbyCache.shown);
    let html=slice.map(cardHTML).join("");
    if(list.length>lobbyCache.shown)html+=
      `<button class="moreBtn" id="moreBtn">Показать ещё `+
      Math.min(PAGE,list.length-lobbyCache.shown)+` · всего `+list.length+`</button>`;
    grid.innerHTML=html;
    const more=$("moreBtn");
    if(more)more.onclick=function(){lobbyCache.shown+=PAGE;renderLobby(false)};
  }
  if($("sideGames").innerHTML!==lobbyCache.side)$("sideGames").innerHTML=lobbyCache.side;
  umountMyGames();bindTilt();updateHUD();
}
/* Наклон карточек — одним обработчиком на всю сетку, а не по одному
   на карточку. Раньше их было больше трёхсот, и они пересоздавались
   при каждом поиске: наведение на новую карточку начинало работать
   только после перерисовки. */
function bindTilt(){
  const grid=$("gridAll");
  if(!grid||grid.dataset.tilt==="1")return;
  grid.dataset.tilt="1";
  if(matchMedia("(hover:none)").matches)return;
  let cur=null;
  grid.addEventListener("pointermove",function(e){
    const el=e.target;
    const c=el&&el.closest?el.closest(".tilt"):null;
    if(!c){if(cur){cur.style.transform="";cur=null}return}
    if(c!==cur){if(cur)cur.style.transform="";cur=c}
    const r=c.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5;
    const y=(e.clientY-r.top)/r.height-.5;
    c.style.transform="perspective(700px) rotateY("+(x*10)+"deg) rotateX("+(-y*10)+"deg) translateY(-5px)";
  });
  grid.addEventListener("pointerleave",function(){
    if(cur){cur.style.transform="";cur=null}
  });
}
function scrollRow(id,dx){$(id).scrollBy({left:dx,behavior:"smooth"})}
function contGame(){if(!history.length){toast("Сыграй во что-нибудь! 🎲");return}openGame(history[0])}
function goHome(){stopMode();renderTruthStats();if(window.AERIS_TOUCH)AERIS_TOUCH.onGameClose();$("gameView").classList.remove("show");$("gameView").classList.remove("mode-on");$("lobbyMain").style.display="block";stopTimer();renderLobby();scrollTo({top:0,behavior:"smooth"});const ts=document.getElementById("titleScreen");if(ts)ts.style.display="none"}
function randomGame(){openModal(GAMES[Math.floor(Math.random()*GAMES.length)].id)}
function toggleFav(id){sfx.click();favs=favs.includes(id)?favs.filter(f=>f!==id):[...favs,id];if(!history.includes(id)){}renderLobby();toast(favs.includes(id)?"В избранном ❤️":"Убрано из избранного")}
function setFilter(f){filter=f;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.f===f));sfx.click();renderLobby(true)}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>setFilter(b.dataset.f));
/* Поиск с задержкой. На каждую букву пересобирались и лобби, и подсказки —
   при быстром наборе это десятки перерисовок в секунду на 100 карточках.
   180 мс — достаточно, чтобы подсказка казалась мгновенной, но ввод перестал
   дёргать страницу. */
let searchTimer=0;
$("search").addEventListener("input",()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{
    renderLobby();
    const q=$("search").value.toLowerCase(),s=$("suggest");
    if(!q){s.classList.remove("show");return}
    const m=GAMES.filter(g=>g.title.toLowerCase().includes(q));
    s.innerHTML=m.map(g=>`<button onclick="openModal(${g.id})">${g.emoji} ${g.title} <span style='margin-left:auto;color:var(--muted);font-size:12px'>${AERIS_TRUTH.meta(g)}</span></button>`).join("")||"<button>Ничего не найдено</button>";
    s.classList.add("show");
  },180);
});
document.addEventListener("click",e=>{if(!e.target.closest(".search"))$("suggest").classList.remove("show")});
/* Человеческое название жанра для карточки игры. В данных у игры лежит
   внутреннее имя режима — «run3d», «td», «hockey». В интерфейсе такие
   слова выглядят как мусор, поэтому здесь перевод. Игры без своего режима
   все до одной — конструкторы, и им подходит общее название. */
const MODE_LABEL={mem:"память",color:"цвета",green:"сад",quiz:"викторина",
run3d:"3D-забег",tycoon:"бизнес",lab:"лаборатория",flower3d:"3D-цветок",
maze:"лабиринт",tower:"башня",wheel:"колесо фортуны",catch:"ловля",
shoot:"стрельба",cubes:"кубики",snake:"змейка",slide:"скольжение",
bowl:"боулинг",ark:"ковчег",golf:"гольф",pin:"пинбол",tet:"тетрис",
jump:"прыжки",pool:"пул",hoops:"баскетбол",heli:"вертолёт",train:"поезд",
fish:"рыбалка",plane:"самолёт",sumo:"сумо",pac:"поймай призрака",
tanks:"танки",td:"оборона башни",ski:"лыжи",race:"гонки",parkour:"паркур",
hockey:"хоккей",drift:"дрифт",zombie:"зомби",cosmo:"космос",surf:"сёрфинг",
chess:"шахматы",climb:"восхождение",city:"строительство города",
curling:"кёрлинг",skate:"скейт",kite:"воздушный змей",archery:"лук",
freestyle:"фристайл",crane:"кран",orbit:"орбита",glider:"планер",
balloon:"воздушный шар",mono:"монополия",rocket:"ракета",dino:"динозавры",
skip:"прыжки по кругам",boomerang:"бумеранг",falcon:"сокол",volcano:"вулкан",
magnet:"магнит",ferry:"паром",mole:"крот",hive:"улей",house:"дом",hoop:"кольцо",
aquarium:"аквариум",orient:"ориентирование",butterfly:"бабочка",mine:"шахта",
dna:"ДНК",ghost:"призрак",firework:"фейерверк",rainbow:"радуга"};
function modeLabel(g){return MODE_LABEL[g.mode]||"конструктор"}
function openModal(id){const g=GAMES.find(x=>x.id===id);sfx.click();$("mThumb").style.background=g.grad;$("mThumb").querySelector(".big")?.remove();const b=document.createElement("span");b.className="big";b.textContent=g.emoji;$("mThumb").prepend(b);$("mTitle").textContent=g.title;$("mSub").textContent="AERIS • "+modeLabel(g)+" • без скачивания";$("mPlayers").textContent=AERIS_TRUTH.meta(g);$("mLikes").textContent="";$("mStars").textContent="★".repeat(g.stars);$("mDesc").textContent=g.desc;$("mAch").innerHTML=ACHS.map(a=>`<span class="ach ${ach.includes(a.id)?"got":""}">${a.n}</span>`).join("");$("mFav").textContent=favs.includes(id)?"❤️ В избранном":"🤍 В избранное";$("mFav").onclick=()=>{toggleFav(id);openModal(id)};if(g.price&&ownedG.indexOf(id)<0){$("mPlay").textContent="🔓 Купить за "+g.price+" 🪙";$("mPlay").onclick=()=>{if(!ecoPay(g.price))return;ownedG.push(id);saveAll();sfx.win();boom(100);toast("Куплено: "+g.title+"! Приятной игры 👑");openModal(id)}}else{$("mPlay").textContent="▶ Играть";$("mPlay").onclick=()=>{closeModal();openGame(id)}};$("overlay").classList.add("show")}
function closeModal(){$("overlay").classList.remove("show")}
$("overlay").addEventListener("click",e=>{if(e.target.id==="overlay")closeModal()});
/* ============ SHOP ============ */
function openShop(){sfx.click();renderShop();$("shopOverlay").classList.add("show")}
function closeShop(){$("shopOverlay").classList.remove("show");if($("gameView").classList.contains("show"))renderToolbar()}
$("shopOverlay").addEventListener("click",e=>{if(e.target.id==="shopOverlay")closeShop()});
function renderShop(){$("shopCoins").textContent="🪙 "+coins;ecoRoll();$("shopEco").textContent="+"+ecoEarn+" / −"+ecoSpent;$("shopGrid").innerHTML="<div class='shop-item' style='border-color:#e79b00'><div class='em'>🎁</div><b>Сюрприз-бокс</b><small style='color:var(--muted)'>случайная деталь • 🌸 80</small><br><button onclick='buyBox()'>Открыть</button></div><div class='shop-item' style='border-color:#8b5cf6'><div class='em'>⚡</div><b>Бафф x2</b><small style='color:var(--muted)'>след. награда x2 • 🪙 150</small><br><button onclick='buyBuff()'>Купить</button></div>"+SHOP.map((s,i)=>{const o=owned.includes(s.e);return `<div class="shop-item ${o?"owned":""}"><div class="em">${s.e}</div><b>${s.n}</b><small style="color:var(--muted)">${o?"куплено ✓":"🪙 "+s.price}</small><br><button onclick="buyPart(${i})">${o?"✓ Есть":"Купить"}</button></div>`}).join("")}
function buyPart(i){const s=SHOP[i];if(owned.includes(s.e)){toast("Уже куплено ✓");return}if(!ecoPay(disc(s.price)))return;owned.push(s.e);unlock("shop");updateHUD(true);sfx.coin();renderShop();toast(`Куплено ${s.e} ${s.n}!`)}
function buyBox(){ecoRoll();if(!ecoPay(disc(80)))return;const pool=[];for(let i=0;i<SHOP.length;i++)if(owned.indexOf(SHOP[i].e)<0)pool.push(i);
 if(!pool.length){coins+=35;ecoTrack(35);updateHUD(true);sfx.coin();renderShop();toast("🎁 Всё собрано! Возврат +35 🪙");return}
 const s=SHOP[pool[Math.floor(Math.random()*pool.length)]];owned.push(s.e);unlock("shop");updateHUD(true);saveAll();sfx.win();boom(100);renderShop();toast("🎁 Выпало: "+s.e+" "+s.n+"!")}
function buyBuff(){if(store.get("bb2_buff",0)){toast("Бафф уже активен! ⚡");return}if(!ecoPay(disc(150)))return;store.set("bb2_buff",1);sfx.coin();renderShop();toast("⚡ Куплено! Следующая награда x2")}
function dailyBonus(){const t=new Date().toDateString(),last=store.get("bb2_daily","");if(last===t){toast(`Баланс: 🪙 ${coins}. Бонус уже забран, приходи завтра! 🎁`);return}store.set("bb2_daily",t);let strk=1;try{strk=JSON.parse(localStorage.getItem("bb2_streak"))||1}catch(e){}const bonus=100+Math.min(50,(strk-1)*10);const intr=Math.min(100,Math.floor(coins*.02));coins+=bonus+intr;ecoTrack(bonus+intr);updateHUD(true);sfx.win();boom(80);toast("🎁 Бонус +"+bonus+" 🪙 + банк "+intr+" 🪙! Серия: "+strk+" дн.")}
/* ============ GAME ENGINE ============ */
function isModeGame(){const g=GAMES.find(x=>x.id===currentGame);return !!(g&&g.mode)}
function allParts(){const base=[...(PARTS[currentGame]||[])];owned.forEach(e=>base.push({n:"Премиум",e,c:"Декор"}));return base}
function openGame(id){const gg=GAMES.find(x=>x.id===id);if(gg.price&&ownedG.indexOf(id)<0){toast("Игра платная — купи её за "+gg.price+" 🪙 🔒");openModal(id);return}stopMode();if(window.AERIS_TOUCH)AERIS_TOUCH.onGameOpen();AERIS_TRUTH.markPlayed(id);currentGame=id;selected=null;zTop=10;curCat="Всё";undoStack=[];redoStack=[];sfx.click();
 const g=GAMES.find(x=>x.id===id);if(!history.includes(id)){history.unshift(id);history=history.slice(0,5)}
 $("lobbyMain").style.display="none";$("gameView").classList.add("show");$("gameView").classList.toggle("mode-on",!!g.mode);$("gTitle").textContent=g.emoji+" "+g.title;$("gPlayers").textContent=AERIS_TRUTH.meta(g);$("gTask").textContent=g.task;$("canvasBase").innerHTML=g.mode?"":g.base;
 document.querySelectorAll("#canvas .part").forEach(e=>e.remove());setBg(g.mode?"night":"day");renderWorks();
 if(g.mode){$("starsPrev").innerHTML="";setProg(3);MODES[g.mode]();modeReplay=g.mode}
 else{renderCats();renderToolbar();renderPalette();updateProgress();liveStars();pushUndo()}
 stopTimer();timerOn=false;$("btnTimer").classList.remove("on");scrollTo({top:0});
 if(window.AERIS_SB){AERIS_SB.ping("play:"+g.id);AERIS_SB.total(function(n){const e=$("hallTotal");if(e)e.textContent=n?"🌐 открытий на сайте: "+n:""});renderHall(g)}
 if(!store.get("bb2_played",false)){store.set("bb2_played",true);setTimeout(()=>toast(g.mode?"🎮 Управление — внутри поля игры!":"👆 Тапай детали снизу — они появятся на поле!"),600)}}
function renderHall(g){const list=$("hallList");if(!list||!window.AERIS_SB)return;
 AERIS_SB.top(String(g.id),function(rows){
  if(!rows.length){list.textContent="Пока пусто — сдай работу первым! ✨";return}
  list.innerHTML=rows.map(function(r,i){return (i+1)+". "+String(r.name||"гость")+" — ⭐"+(r.score||0)}).join("<br>")}
 )}
function renderCats(){const g=GAMES.find(x=>x.id===currentGame);
 $("catTabs").innerHTML=(g.cats||["Всё"]).map(c=>`<button class="cat ${c===curCat?"on":""}" onclick="setCat('${c}')">${c}</button>`).join("")}
function setCat(c){curCat=c;sfx.click();renderCats();renderToolbar()}
function renderToolbar(){const bar=$("partsBar");if(!bar)return;bar.innerHTML="";if(isModeGame())return;
 allParts().filter(p=>curCat==="Всё"||(p.c||"Декор")===curCat).forEach(p=>{const b=document.createElement("button");b.className="tool";b.title=p.n;
  if(p.shape)b.innerHTML=`<div class="shape ${p.shape}" style="background:${p.col};width:32px;height:32px;font-size:15px"><span>✿</span></div><small>${p.n}</small>`;
  else if(p.t)b.innerHTML=`<span style="font-size:15px;font-weight:900">Aa</span><small>${p.n}</small>`;else b.innerHTML=`${p.e}<small>${p.n}</small>`;
  b.addEventListener("pointerdown",e=>toolDragStart(e,p));
  b.onclick=e=>{if(e.detail===0)addPart(p,false)};bar.appendChild(b)});
 SHOP.filter(s=>!owned.includes(s.e)).slice(0,2).forEach(s=>{const b=document.createElement("button");b.className="tool locked";b.dataset.price="🪙"+s.price;b.innerHTML=`${s.e}<small>shop</small>`;b.onclick=openShop;bar.appendChild(b)})}
/* деталь можно не только нажать, но и перетащить из палитры на поле */
function toolDragStart(e,p){
 if(e.button!==0)return;
 e.preventDefault();
 const gh=document.createElement("div");gh.className="dragGhost";
 if(p.shape)gh.innerHTML=`<div class="shape ${p.shape}" style="background:${p.col||curColor};width:34px;height:34px;font-size:16px"><span>✿</span></div>`;
 else if(p.t){gh.textContent=p.t;gh.style.cssText+=";font-size:20px;font-weight:900"}
 else gh.textContent=p.e;
 document.body.appendChild(gh);
 const mv=ev=>{gh.style.left=ev.clientX+"px";gh.style.top=ev.clientY+"px"};mv(e);
 const up=ev=>{document.removeEventListener("pointermove",mv);document.removeEventListener("pointerup",up);gh.remove();
  const c=$("canvas");if(!c)return;const r=c.getBoundingClientRect();
  if(ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom)
   addPart(p,{x:ev.clientX-r.left-30,y:ev.clientY-r.top-30});
  else addPart(p,false)};
 document.addEventListener("pointermove",mv);document.addEventListener("pointerup",up)}
function renderPalette(){$("palette").innerHTML="";COLORS.forEach(c=>{const s=document.createElement("div");s.className="swatch"+(c===curColor?" sel":"");s.style.background=c;s.onclick=()=>{curColor=c;sfx.click();renderPalette();applyColorToSel()};$("palette").appendChild(s)})}
function applyColorToSel(){if(!selected){return}const sh=selected.querySelector(".shape");if(sh)sh.style.background=curColor;else selected.style.filter=`drop-shadow(0 0 8px ${curColor})`;pushUndo();liveStars()}
function pushUndo(){undoStack.push(packParts([...document.querySelectorAll("#canvas .part")],200000));if(undoStack.length>40)undoStack.shift();redoStack=[];updUndo()}
function restore(h){document.querySelectorAll("#canvas .part").forEach(e=>e.remove());if(h){const t=document.createElement("template");t.innerHTML=h.trim();t.content.querySelectorAll(".part").forEach(e=>{$("canvas").appendChild(e);makeDraggable(e)})}selected=null;$("slSize").value=100;$("slRot").value=0;$("slOp").value=100;$("selName").textContent="ничего не выбрано";updateProgress();liveStars()}
function undo(){if(undoStack.length<2)return;redoStack.push(undoStack.pop());restore(undoStack[undoStack.length-1]);sfx.click();updUndo()}
function redo(){if(!redoStack.length)return;const h=redoStack.pop();undoStack.push(h);restore(h);sfx.click();updUndo()}
function updUndo(){$("btnUndo").disabled=undoStack.length<2;$("btnRedo").disabled=!redoStack.length}
function addPart(p,atXY){const c=$("canvas"),r=c.getBoundingClientRect();const el=document.createElement("div");el.className="part";el.dataset.rot=0;el.dataset.scale=1;el.dataset.op=100;el.dataset.col=curColor||"";
 if(p.shape)el.innerHTML=`<div class="shape ${p.shape}" style="background:${p.col||curColor}"><span>${p.e||"✿"}</span></div>`;
 else if(p.t){el.style.fontSize="25px";el.style.fontWeight="900";el.style.color=curColor==="#ffffff"?"#e0507a":curColor;el.style.background="rgba(255,255,255,.88)";el.style.padding="6px 14px";el.style.borderRadius="12px";el.textContent=p.t}
 else{el.style.fontSize=(46+Math.random()*12)+"px";el.textContent=p.e}
 el.style.left=(atXY?atXY.x:(r.width/2-30+(Math.random()*80-40)))+"px";el.style.top=(atXY?atXY.y:(r.height/2-30+(Math.random()*80-40)))+"px";el.style.zIndex=++zTop;
 el.style.animation="pop .3s";c.appendChild(el);makeDraggable(el);select(el);sfx.pop();comboHit();pushUndo();updateProgress();liveStars();
 if(countParts()>=10)unlock("ten");return el}
function select(el){document.querySelectorAll("#canvas .part").forEach(e=>e.classList.remove("selected"));selected=el;
 if(el){el.classList.add("selected");const t=(el.textContent||"деталь").trim().slice(0,14);$("selName").textContent=t;$("slSize").value=Math.round((+el.dataset.scale||1)*100);$("slRot").value=(+el.dataset.rot||0+360)%360;$("slOp").value=+el.dataset.op||100}
 else $("selName").textContent="ничего не выбрано"}
function makeDraggable(el){let sx,sy,ox,oy,drag=false,pid=null;
 el.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();select(el);drag=true;pid=e.pointerId;try{el.setPointerCapture(pid)}catch(_){}sx=e.clientX;sy=e.clientY;ox=parseFloat(el.style.left);oy=parseFloat(el.style.top);el.style.cursor="grabbing";sfx.click()});
 el.addEventListener("pointermove",e=>{if(!drag||e.pointerId!==pid)return;const c=$("canvas").getBoundingClientRect();let nx=ox+e.clientX-sx,ny=oy+e.clientY-sy;nx=Math.max(-30,Math.min(c.width-30,nx));ny=Math.max(-30,Math.min(c.height-30,ny));el.style.left=nx+"px";el.style.top=ny+"px";
  const cx=c.width/2,cy=c.height/2;const nearX=Math.abs(nx+30-cx)<14,nearY=Math.abs(ny+30-cy)<14;$("gv").classList.toggle("show",nearX);$("gh").classList.toggle("show",nearY);if(nearX)el.style.left=(cx-30)+"px";if(nearY)el.style.top=(cy-30)+"px"});
 const end=e=>{if(!drag)return;drag=false;el.style.cursor="grab";$("gv").classList.remove("show");$("gh").classList.remove("show");pushUndo()};
 el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end);
 el.addEventListener("dblclick",e=>{e.stopPropagation();transformSel("rotL")})}
function applyT(el){el.style.transform=`rotate(${el.dataset.rot}deg) scale(${el.dataset.scale})`;el.style.opacity=(+el.dataset.op||100)/100}
function transformSel(act){if(!selected){toast("Сначала выбери деталь на поле 👆");return}const el=selected;sfx.click();
 if(act==="rotL")el.dataset.rot=+el.dataset.rot+22;if(act==="rotR")el.dataset.rot=+el.dataset.rot-22;
 if(act==="plus")el.dataset.scale=Math.min(2.5,+el.dataset.scale+.15);if(act==="minus")el.dataset.scale=Math.max(.4,+el.dataset.scale-.15);
 if(act==="up")el.style.zIndex=++zTop;if(act==="down")el.style.zIndex=Math.max(1,+el.style.zIndex-1);
 if(act==="dup"){const cp=el.cloneNode(true);cp.style.left=(parseFloat(el.style.left)+28)+"px";cp.style.top=(parseFloat(el.style.top)+28)+"px";cp.style.zIndex=++zTop;cp.classList.remove("selected");$("canvas").appendChild(cp);makeDraggable(cp);select(cp);sfx.pop();pushUndo();updateProgress();liveStars();return}
 if(act==="del"){el.remove();selected=null;sfx.del();pushUndo();updateProgress();liveStars();return}
 applyT(el);select(el);pushUndo();liveStars()}
function mirrorSel(){if(!selected){toast("Выбери деталь на поле 👆");return}const el=selected,c=$("canvas").getBoundingClientRect(),cx=c.width/2;const cp=el.cloneNode(true);cp.style.left=Math.max(-20,Math.min(c.width-20,2*cx-parseFloat(el.style.left)-60))+"px";cp.style.zIndex=++zTop;cp.classList.remove("selected");$("canvas").appendChild(cp);makeDraggable(cp);select(cp);sfx.pop();pushUndo();updateProgress();liveStars()}
function sliderApply(){if(!selected)return;selected.dataset.scale=$("slSize").value/100;selected.dataset.rot=$("slRot").value;selected.dataset.op=$("slOp").value;applyT(selected);updateProgress();liveStars()}
function clearCanvas(){if(!countParts())return;document.querySelectorAll("#canvas .part").forEach(e=>e.remove());selected=null;sfx.del();pushUndo();updateProgress();liveStars()}
function surprise(){if(isModeGame())return;sfx.pop();const a=allParts();if(!a.length)return;for(let i=0;i<3;i++)setTimeout(()=>addPart(a[Math.floor(Math.random()*a.length)]),i*140);toast("🎲 Сюрприз: +3 детали!")}
function countParts(){return document.querySelectorAll("#canvas .part").length}
/* упаковка деталей для «Моих работ»: режем только по границе деталей, чтобы HTML не рвался */
function packParts(els,budget){const cap=budget||60000;let h="";for(let i=0;i<els.length;i++){const s=els[i].outerHTML;if(h.length+s.length>cap)break;h+=s}return h}
function partsInfo(){const els=[...document.querySelectorAll("#canvas .part")];const cols=new Set();els.forEach(e=>{const sh=e.querySelector(".shape");cols.add(sh?sh.style.background||"?":(e.style.filter||e.textContent))});return{n:els.length,colors:cols.size,html:els.map(e=>e.outerHTML).join("")}}
function needFor(g){return g===1?6:g===4?7:g===7?7:g===8?6:g===6?5:g===9?7:g===10?4:g===17?4:g===18?5:g===20?4:g===24?5:g===25?5:g===27?5:g===28?5:g===29?5:g===30?5:g===32?5:g===33?5:g===37?5:g===42?5:g===43?5:g===47?5:g===51?5:4}
function updateProgress(){const n=countParts(),need=needFor(currentGame),pct=Math.min(100,Math.round(n/need*100));$("gProg").style.width=Math.max(5,pct)+"%";$("gProgTxt").textContent=pct+"%"}
function calcStars(){const{n,colors}=partsInfo();if(currentGame===10){if(n<3)return 1;if(n<=6&&colors>=3)return 3;if(n<=8)return 2;return 1}const need=needFor(currentGame);let s=1;if(n>=need)s=2;if(n>=need+2&&colors>=3)s=3;return Math.min(3,s)}
function liveStars(){const s=calcStars(),n=countParts();$("starsPrev").innerHTML=n?`Прогноз: <span style="color:#e79b00">${"★".repeat(s)}${"☆".repeat(3-s)}</span> <small style="color:var(--muted)">(${n} деталей)</small>`:"Добавь детали — тут появится прогноз ⭐"}
function finishWork(){const{n,colors}=partsInfo(),g=GAMES.find(x=>x.id===currentGame);
 if(n<3){toast("Добавь хотя бы 3 детали 🙏");sfx.del();return}
 const stars=calcStars();let reward=40+stars*20+(colors>=4?15:0);if(timerOn&&timerSec>0){reward*=2;toast("⏱ Челлендж пройден! Награда x2!")}
 const fb2=ecoFirstBonus();if(fb2>0){reward=Math.round(reward*1.5);setTimeout(()=>toast("🌅 Первый за день +50%!"),1200)}if(g.price)reward=Math.round(reward*1.25);if(store.get("bb2_buff",0)){store.set("bb2_buff",0);reward*=2;setTimeout(()=>toast("⚡ Бафф x2 сработал!"),1400)}
 coins+=reward;ecoTrack(reward);xp+=30+stars*15;stopTimer();
 if(colors>=5)unlock("rich");if(stars===3)unlock("star3");
 const thumbs=[...document.querySelectorAll("#canvas .part")].slice(0,5).map(e=>{const sh=e.querySelector(".shape");return sh?(sh.querySelector("span")?.textContent||"✿"):e.textContent}).join("");
  const parts=[...document.querySelectorAll("#canvas .part")];
  unlock("first");updateHUD(true);renderWorks();saveAll();questCheck(stars);sfx.win();boom(140);
 if(window.AERIS_SB){AERIS_SB.sendScore(currentGame,g.title,stars*(timerOn&&timerSec>0?2:1));renderHall(g)}
 for(let i=0;i<stars;i++)setTimeout(()=>sfx.star(i),400+i*250);
 toast(`${"⭐".repeat(stars)} +${reward} 🪙 +${30+stars*15} XP • Работа сохранена!`)}
function renderWorks(){$("wCount").textContent=works.length;$("stWorks").textContent=works.length;$("worksBar").innerHTML=works.length?works.map((w,i)=>`<div class="work-thumb" onclick="onWork(${i})" title="${w.n} деталей • продать за ${20+(w.stars||1)*15} 🪙">${w.emoji}</div>`).join(""):`<span style="font-size:13px;color:var(--muted)">Пока пусто — собери первый цветок!</span>`}
let sellMode=false;
function toggleSell(){sellMode=!sellMode;sfx.click();const b=$("sellToggle");if(b)b.textContent=sellMode?"✅ Готово":"💰 Продать";toast(sellMode?"Кликай работы, чтобы продать за флорины!":"Режим продажи выключен")}
function sellWork(i){const w=works[i];if(!w)return;const wg=GAMES.find(x=>x.id===w.game);const price=20+(w.stars||1)*15+(wg&&wg.price?10:0);works.splice(i,1);coins+=price;ecoTrack(price);updateHUD(true);renderWorks();saveAll();sfx.coin();toast("Продано за +"+price+" 🪙!")}
function onWork(i){if(sellMode){sellWork(i);return}loadWork(i)}
function loadWork(i){const w=works[i];if(!w)return;if(!w.html){toast((w.stars?"⭐".repeat(w.stars)+" • ":"")+(w.n||0)+" деталей • "+(w.date||""));return}openGame(w.game);setTimeout(()=>{if(currentGame!==w.game||!document.querySelector("#canvas"))return;restore(w.html);pushUndo();toast("Работа загружена! Продолжай творить 🎨")},80)}
function showWorks(){goHome();if(!works.length){toast("Нет работ — сыграй и нажми Готово! 🎨");setTimeout(()=>openGame(1),900);return}toast(`Твоих работ: ${works.length} 🎨`)}
/* MODES объявлен в src/app/games.js вместе с играми. Раньше объявление
   жило здесь, а игры были ниже по файлу. Стоило вынести игры в свой файл —
   и они грузились раньше этого скрипта, попадая в MODES до объявления:
   «ReferenceError: MODES is not defined». Объявление поехало вместе с
   играми, где ему и место. */
let modeFinish=null,modeCleanup=null,modeReplay=null;
function stopMode(){if(modeCleanup){try{modeCleanup()}catch(e){}}modeCleanup=null;modeFinish=null;modeReplay=null;document.querySelectorAll("#canvas .mode").forEach(e=>e.remove())}
function saveClick(){const g=GAMES.find(x=>x.id===currentGame);if(g.mode&&modeFinish){modeFinish()}else{finishWork()}}
function setProg(p){$("gProg").style.width=Math.max(3,Math.min(100,p))+"%";$("gProgTxt").textContent=Math.round(p)+"%"}
function modeRoot(html){const d=document.createElement("div");d.className="mode";if(html)d.innerHTML=html;$("canvas").appendChild(d);return d}
function awardResult(stars,thumb,n,achId,note){const g=GAMES.find(x=>x.id===currentGame);AERIS_TRUTH.markDone(currentGame,stars);
 let reward=40+stars*20;const fb=ecoFirstBonus();if(fb>0){reward=Math.round(reward*1.5);setTimeout(()=>toast("🌅 Первый за день +50%!"),1200)}if(g.price)reward=Math.round(reward*1.25);if(store.get("bb2_buff",0)){store.set("bb2_buff",0);reward*=2;setTimeout(()=>toast("⚡ Бафф x2 сработал!"),1400)}coins+=reward;ecoTrack(reward);xp+=30+stars*15;stopTimer();
 if(achId)unlock(achId);if(stars===3)unlock("star3");
 works.unshift({game:currentGame,emoji:thumb||g.emoji,n:n||0,stars,date:new Date().toLocaleDateString("ru-RU")});works=works.slice(0,12);
 unlock("first");updateHUD(true);renderWorks();saveAll();questCheck(stars);sfx.win();boom(140);
 for(let i=0;i<stars;i++)setTimeout(()=>sfx.star(i),400+i*250);
  if(window.AERIS_SB){AERIS_SB.sendScore(currentGame,g.title,stars);renderHall(g)}
 toast("⭐".repeat(stars)+" +"+reward+" 🪙 +"+(30+stars*15)+" XP"+(note?" • "+note:""));
 modeFinish=()=>{if(modeReplay){const m=modeReplay;stopMode();setProg(3);MODES[m]()}else toast("Награда уже выдана! 🔄")}}
/* ===== MODES 1: мемори, раскраска, викторина, теплица, лаборатория ===== */

/* bg + timer */
function setBg(b){const c=$("canvas");c.className=b;document.querySelectorAll("[data-bg]").forEach(x=>x.classList.toggle("on",x.dataset.bg===b));sfx.click()}
function cycleBg(){const order=["day","night","sunset"],c=$("canvas").className||"day";setBg(order[(order.indexOf(c)+1)%3])}
function toggleTimer(){if(timerOn){stopTimer();return}timerOn=true;timerSec=60;$("timer").classList.add("on");$("btnTimer").classList.add("on");sfx.click();toast("⏱ Челлендж: собери за 60 сек — награда x2!");timerInt=/* Пока вкладка свёрнута, отсчёт стоит. Иначе время уходит, пока человека нет у экрана: это и лишняя работа, и нечестно по отношению к игроку. */
setInterval(()=>{if(document.hidden)return;timerSec--;$("timer").textContent="⏱ "+timerSec;if(timerSec<=10)$("timer").classList.add("low");if(timerSec<=0){stopTimer();toast("⏱ Время вышло! Но работу можно доделать 🌸")}},1000)}
function stopTimer(){timerOn=false;clearInterval(timerInt);$("timer").classList.remove("on","low");$("btnTimer")?.classList.remove("on")}
/* ach sidebar */
function renderAch(){$("sideAch").innerHTML=ACHS.map(a=>`<div style="padding:6px 4px;${ach.includes(a.id)?"color:var(--txt)":"opacity:.55"}">${ach.includes(a.id)?"✅":"🔒"} ${a.n}<br><small style="font-weight:400">${a.d}</small></div>`).join("")}
/* coach */
function closeCoach(){$("coach").classList.remove("show");store.set("bb2_seen",true);sfx.pop()}
/* drag from toolbar (desktop nicety) */
$("canvas").addEventListener("pointerdown",e=>{if(e.target.id==="canvas"||e.target.id==="canvasBase")select(null)});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();closeShop();closeSettings();select(null)}if((e.key==="Delete"||e.key==="Backspace")&&$("gameView").classList.contains("show"))transformSel("del");if((e.ctrlKey||e.metaKey)&&e.key==="z"&&!e.shiftKey)undo();if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.key==="z"&&e.shiftKey)))redo()});

/* init */
$("soundBtn").textContent=soundOn?"🔊":"🔇";
/* Настройки восстанавливаем при старте: иначе после перезагрузки страницы
   размер интерфейса и громкость молча сбрасывались бы в исходные. */
document.documentElement.style.zoom=uiScale===1?"":uiScale;
applyQuality();
if($("gcount"))$("gcount").textContent=GAMES.length;
heroRender();renderLobby();renderWorks();renderAch();renderQuests();updateHUD();
(function streak(){const t=new Date().toDateString(),last=store.get("bb2_last","","x");let s=store.get("bb2_streak",1);try{s=JSON.parse(localStorage.getItem("bb2_streak"))||1}catch(e){}const lv=localStorage.getItem("bb2_lastday");if(lv!==t){const y=new Date(Date.now()-864e5).toDateString();s=(lv===y)?s+1:1;localStorage.setItem("bb2_lastday",t);localStorage.setItem("bb2_streak",s)}$("stStreak").textContent=s+(s===1?" день":s<5?" дня":" дней")})();
if(!store.get("bb2_seen",false)){const cg=$("coachGames");if(cg&&window.GAMES)cg.textContent=GAMES.length;$("coach").classList.add("show")}

/* ============ ОФЛАЙН ============
   Сервис-воркер кладёт три страницы в кэш, и дальше приложение
   открывается без сети.

   Он работает только на http:// и https://. При запуске файла двойным
   щелчком (file://) его нет — и не нужно: файл лежит на диске. Поэтому
   сначала проверяем протокол, а не регистрируем и не ловим ошибку:
   иначе в консоли каждого запуска с диска было бы предупреждение,
   которое ничего не значит. */
(function () {
  var proto = location.protocol;
  /* Ловец ошибок в облако: непойманные сбои уходят в client_errors,
     чтобы мы видели поломку до первой жалобы игрока. Только с сайта
     (http/https): при двойном щелчке file:// сеть не трогаем — там
     файл и так локальный. Не чаще двух одинаковых текстов за сессию —
     шум не нужен, нужен каждый НОВЫЙ сбой. */
  if (proto === "http:" || proto === "https:") {
    try {
      window.addEventListener("error", function (e) {
        if (!window.AERIS_SB) return;
        AERIS_SB.report("index",
          (e.message || "?") + " @ строка " + (e.lineno || 0));
      });
      window.addEventListener("unhandledrejection", function (e) {
        if (!window.AERIS_SB) return;
        AERIS_SB.report("index", String(e.reason || "?").slice(0, 140));
      });
    } catch (err) {}
  }
  if (proto !== "http:" && proto !== "https:") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (err) {
        if (window.NebulaDiag) {
          NebulaDiag.report("info", "Офлайн не включился: " + (err && err.message));
        }
      });
    });
  } catch (e) {
    /* Регистрация не должна никогда мешать игре. */
  }
})();