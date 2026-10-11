var E3 = {
 view(p,c){const dx=p[0]-c.x,dy=p[1]-c.y,dz=p[2]-c.z;
  const cy=Math.cos(-c.yaw),sy=Math.sin(-c.yaw);
  const x1=dx*cy-dz*sy,z1=dx*sy+dz*cy;
  const cx=Math.cos(-c.pitch),sx=Math.sin(-c.pitch);
  return [x1,dy*cx-z1*sx,dy*sx+z1*cx]},
 proj(p,fl,W,H){const s=fl/Math.max(.12,p[2]);return [W/2+p[0]*s,H/2-p[1]*s,s]},
/* Цвет в оттенке. Раньше на ЛЮБУЮ строку, не начинающуюся с решётки,
     вызывался parseInt(h.slice(1),16): для "rgba(10,10,25,.25)" это
     parseInt("gba(…") = NaN, и грань молча становилась чёрной. Теперь
     неизвестный формат проходит через как есть — начертание не ровно,
     но лучше видимый объект, чем исчезнувший. */
  shade(hex,f){const h=String(hex);if(h.charAt(0)!=="#")return h;
   const n=parseInt(h.slice(1,7),16);
   const r=Math.min(255,((n>>16)&255)*f|0),g=Math.min(255,((n>>8)&255)*f|0),b=Math.min(255,(n&255)*f|0);
   return "#"+((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1)},
 /* нормаль по трём точкам (правая рука, против часовой при взгляде снаружи) */
 faceN(a,b,c){const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;
  return [nx/l,ny/l,nz/l]},
 /* треугольник; 4-я вершина дублирует 1-ю, поэтому draw работает без веток */
 tri(a,b,c,col,n){return {v:[a,b,c,a],c:col,n:n||E3.faceN(a,b,c),t:1}},
/* Произвольный выпуклый n-угольник в плоскости; нормаль — из первых трёх
     точек. Для n>4 делается веер из треугольников: draw читает не больше
     четырёх вершин, и раньше пятиугольник рисовался частично — молча,
     без всякой ошибки. */
  poly(pts,col,n){const k=pts.length;if(k<3)return [];
   const nm=n||E3.faceN(pts[0],pts[1],pts[2]);
   if(k===4)return [{v:pts.slice(),c:col,n:nm}];
   const out=[];
   for(let i=1;i<k-1;i++)
    out.push({v:[pts[0],pts[i],pts[i+1]],c:col,n:nm,t:1});
   return out},
 /* треугольная пирамида/призма — базовый объём для новых игр */
  pyramid(cx,cy,cz,w,h,d,col){
   const x=w/2,z=d/2,ap=[cx,cy+h,cz];
   const b=[[cx-x,cy,cz-z],[cx+x,cy,cz-z],[cx+x,cy,cz+z],[cx-x,cy,cz+z]];
   return E3.poly(b,col,[0,-1,0])
    .concat(E3.poly([b[0],b[1],ap],col)).concat(E3.poly([b[1],b[2],ap],col))
    .concat(E3.poly([b[2],b[3],ap],col)).concat(E3.poly([b[3],b[0],ap],col))},
 box(cx,cy,cz,w,h,d,c){const x=w/2,y=h/2,z=d/2,F=[];
  const V=(a,b,e)=>[cx+a,cy+b,cz+e];
  F.push({v:[V(-x,-y,-z),V(x,-y,-z),V(x,y,-z),V(-x,y,-z)],c:c,n:[0,0,-1],s:1});
  F.push({v:[V(-x,-y,z),V(-x,y,z),V(x,y,z),V(x,-y,z)],c:c,n:[0,0,1],s:1});
  F.push({v:[V(-x,-y,-z),V(-x,-y,z),V(x,-y,z),V(x,-y,-z)],c:c,n:[0,-1,0],s:1});
  F.push({v:[V(-x,y,-z),V(x,y,-z),V(x,y,z),V(-x,y,z)],c:c,n:[0,1,0],s:1});
  F.push({v:[V(-x,-y,-z),V(-x,y,-z),V(-x,y,z),V(-x,-y,z)],c:c,n:[-1,0,0],s:1});
  F.push({v:[V(x,-y,-z),V(x,-y,z),V(x,y,z),V(x,y,-z)],c:c,n:[1,0,0],s:1});
  return F},
 quad(a,b,c,d,col,n){return [{v:[a,b,c,d],c:col,n:n}]},
 rbox(cx,cy,cz,w,h,d,az,c){const cs=Math.cos(az),sn=Math.sin(az);
  const R=(a,b)=>[a*cs-b*sn,a*sn+b*cs];
  const V=(a,b,e)=>{const r=R(a,b);return [cx+r[0],cy+r[1],cz+e]};
  const N=(a,b)=>{const r=R(a,b);return [r[0],r[1],0]};
  const x=w/2,y=h/2,z=d/2,F=[];
  F.push({v:[V(-x,-y,-z),V(x,-y,-z),V(x,y,-z),V(-x,y,-z)],c:c,n:[0,0,-1],s:1});
  F.push({v:[V(-x,-y,z),V(-x,y,z),V(x,y,z),V(x,-y,z)],c:c,n:[0,0,1],s:1});
  F.push({v:[V(-x,-y,-z),V(-x,-y,z),V(x,-y,z),V(x,-y,-z)],c:c,n:N(0,-1),s:1});
  F.push({v:[V(-x,y,-z),V(x,y,-z),V(x,y,z),V(-x,y,z)],c:c,n:N(0,1),s:1});
  F.push({v:[V(-x,-y,-z),V(-x,y,-z),V(-x,y,z),V(-x,-y,z)],c:c,n:N(-1,0),s:1});
  F.push({v:[V(x,-y,-z),V(x,-y,z),V(x,y,z),V(x,y,-z)],c:c,n:N(1,0),s:1});
  return F},
 /* поворот вокруг вертикальной оси Y — для дорог, шпал, кия и прочих плоских объектов на земле.
    ВАЖНО: при повороте вокруг Y вектор «вверх» не меняется, поэтому верх/низ имеют
    обычную нормаль [0,±1,0], а боковые грани — повёрнутые N(±1,0) и N(0,±1). */
 gbox(cx,cy,cz,w,h,d,az,c){const cs=Math.cos(az),sn=Math.sin(az);
  const R=(a,b)=>[a*cs-b*sn,a*sn+b*cs];
  const V=(a,b,e)=>{const r=R(a,e);return [cx+r[0],cy+b,cz+r[1]]};
  const N=(a,b)=>{const r=R(a,b);return [r[0],0,r[1]]};
  const x=w/2,y=h/2,z=d/2,F=[];
  F.push({v:[V(-x,-y,-z),V(x,-y,-z),V(x,y,-z),V(-x,y,-z)],c:c,n:[0,-1,0],s:1});
  F.push({v:[V(-x,y,-z),V(x,y,-z),V(x,y,z),V(-x,y,z)],c:c,n:[0,1,0],s:1});
  F.push({v:[V(-x,-y,-z),V(-x,-y,z),V(x,-y,z),V(x,-y,-z)],c:c,n:N(-1,0),s:1});
  F.push({v:[V(x,-y,-z),V(x,-y,z),V(x,y,z),V(x,y,-z)],c:c,n:N(1,0),s:1});
  F.push({v:[V(-x,-y,z),V(-x,y,z),V(x,y,z),V(x,-y,z)],c:c,n:N(0,1),s:1});
  F.push({v:[V(-x,-y,-z),V(x,-y,-z),V(x,y,-z),V(-x,y,-z)],c:c,n:N(0,-1),s:1});
  return F},
 /* отсечение многоугольника по ближней плоскости (Sutherland–Hodgman):
    большие плоскости (пол, дороги, стены) перестают «дырявиться», когда
    хотя бы одна вершина уходит за камеру */
 clipNear(pv,near){const out=[],n=pv.length;
  for(let i=0;i<n;i++){const a=pv[i],b=pv[(i+1)%n],da=a[2]-near,db=b[2]-near;
   if(da>=0)out.push(a);
   if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,near])}}
  return out},
/* тень на плоскости: эллипс, сплюснутый по глубине и сдвинутый против света.
     h — высота объекта над плоскостью: чем выше, тем больше и светлее тень.

     Флага t:1 здесь больше нет. Он означал «треугольник», и четыре
     РАЗНЫЕ вершины эллипса попадали в ветку на 3 вершины: тень
     теряла четвёртый угол и рисовалась треугольником. Это задевало все
     26 мест в играх, где тень звали E3.shadow. */
 shadow(x,z,r,h,o){
  const gy=(o&&o.y!==undefined)?o.y:0;
  const k=1/(1+(h||0)*.16);                       // с высотой тень растёт и бледнеет
  const a=o&&o.a!==undefined?o.a:.3;              // непрозрачность
  const sq=o&&o.sq!==undefined?o.sq:.55;          // сплющивание по глубине (ракурс камеры)
return [{v:[[x-r*k,gy,z-r*k*sq],[x+r*k,gy,z-r*k*sq],[x+r*k,gy,z+r*k*sq],[x-r*k,gy,z+r*k*sq]],
           c:o&&o.c?o.c:"#000000",n:[0,1,0],e:2,a:a}]},
 /* спрайт-эмодзи, участвующий в сортировке по глубине вместе с гранями.
    В отличие от ctx.fillText после draw() он корректно перекрывается геометрией. */
 sprite(x,y,z,size,text,col,glow){return {v:[x,y,z,x],c:col||"#fff",n:[0,0,1],k:1,p:[x,y,z],z:size,t2:text,g:glow||0}},
 /* текстуры-паттерны через createPattern: заменяют однотонные плоскости.
    Возвращают CanvasPattern; применяются как ctx.fillStyle. */
 pattern(ctx,kind,c1,c2){
  c1=c1||"#2e7d4f";c2=c2||"#3a8f5f";
  const k=document.createElement("canvas");k.width=k.height=16;
  const g=k.getContext("2d");
  g.fillStyle=c1;g.fillRect(0,0,16,16);
  if(kind==="checker"){g.fillStyle=c2;g.fillRect(0,0,8,8);g.fillRect(8,8,8,8)}
  else if(kind==="stripes"){g.fillStyle=c2;g.fillRect(0,0,8,16)}
  else if(kind==="grid"){g.fillStyle=c2;g.fillRect(0,0,16,1);g.fillRect(0,0,1,16)}
  else if(kind==="noise"){g.fillStyle=c2;for(let i=0;i<10;i++)g.fillRect((i*7)%16,(i*11)%16,2,2)}
  else if(kind==="water"){g.fillStyle=c2;g.fillRect(0,0,16,2);g.fillRect(0,8,16,2)}
  else if(kind==="bricks"){g.fillStyle=c2;g.fillRect(0,7,16,2);g.fillRect(7,0,2,7);g.fillRect(3,9,2,7)}
  return ctx.createPattern(k,"repeat")},
 /* частицы в 3D-пространстве (дождь/снег/пыль/искры). Хранятся в плоском массиве
    и рисуются как depth-sorted спрайты — дешевле геометрии. */
 particles(n,opt){
  const o=opt||{},p=[];
  for(let i=0;i<n;i++)p.push({x:(Math.random()-.5)*(o.w||14),y:Math.random()*(o.h||10),
   z:-2+Math.random()*(o.d||26),vy:-(o.spd||3)*(0.5+Math.random()),vx:(Math.random()-.5)*.4,
   s:(o.s||.5)*(0.5+Math.random()),t:o.txt||"❄",c:o.c||"#ffffff",life:1});
  p.step=function(dt){
   for(let i=p.length-1;i>=0;i--){const q=p[i];
    q.y+=q.vy*dt;q.x+=q.vx*dt;q.z+=(o.zs||4)*dt;
    if(q.y<0){q.y=o.h||10;q.x=(Math.random()-.5)*(o.w||14)}
    if(q.z>(o.d||26)+4){q.z=-2;q.y=Math.random()*(o.h||10)}}
   return p},
  p.faces=function(){return p.map(q=>E3.sprite(q.x,q.y,q.z,q.s,q.t,q.c,o.glow||0))};
  return p},
 /* физика для новых игр: сферы, плоскости, рэшн, кувырок. Намеренно простая —
    устойчивость важнее точности. */
 phys:{o(){return {x:0,y:0,z:0,vx:0,vy:0,vz:0,r:.3,spin:0,ang:0,ground:0,alive:true,bounce:.5,fric:.995,drag:1}},
  step(o,dt,c){
   c=c||{};
   const g=c.g!==undefined?c.g:9.8;
   o.vy-=g*dt;o.vx*=o.drag;o.vz*=o.drag;
   o.x+=o.vx*dt;o.y+=o.vy*dt;o.z+=o.vz*dt;
   o.spin+=(o.vx+o.vz)*dt*1.5;o.ang+=o.spin*dt;
   const gr=o.ground;
   if(o.y-o.r<gr){o.y=gr+o.r;
    if(o.vy<-0.5){o.vy=-o.vy*o.bounce;o.spin*=.7}
    else o.vy=0;
    o.vx*=o.fric;o.vz*=o.fric}
   if(c.walls){for(let i=0;i<c.walls.length;i++){const w=c.walls[i];
    if(Math.abs(o.x-w[0])<w[2]/2+o.r&&Math.abs(o.z-w[1])<w[3]/2+o.r&&o.y-o.r<w[4]){
     const px=w[2]/2+o.r-Math.abs(o.x-w[0]),pz=w[3]/2+o.r-Math.abs(o.z-w[1]);
     if(px<pz)o.vx=-o.vx*(o.bounce*2>1?1:o.bounce*2);else o.vz=-o.vz*(o.bounce*2>1?1:o.bounce*2)}}}
   if(c.bounds){const b=c.bounds;
    if(o.x<-b[0]){o.x=-b[0];o.vx=Math.abs(o.vx)}if(o.x>b[0]){o.x=b[0];o.vx=-Math.abs(o.vx)}
    if(o.z<-b[1]){o.z=-b[1];o.vz=Math.abs(o.vz)}if(o.z>b[1]){o.z=b[1];o.vz=-Math.abs(o.vz)}}
   return o},
  /* сфера против сферы: упругий удар по нормали */
  hit(a,b,rest){
   const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dx,dy,dz)||1e-6;
   if(d>a.r+b.r)return 0;
   const nx=dx/d,ny=dy/d,nz=dz/d,rvx=b.vx-a.vx,rvy=b.vy-a.vy,rvz=b.vz-a.vz;
   const s=rvx*nx+rvy*ny+rvz*nz;
   if(s>0)return 0;
   const j=-(1+(rest===undefined?.9:rest))*s/2;
   a.vx-=j*nx;a.vy-=j*ny;a.vz-=j*nz;
   b.vx+=j*nx;b.vy+=j*ny;b.vz+=j*nz;
   const ov=a.r+b.r-d;
   a.x-=nx*ov/2;a.y-=ny*ov/2;a.z-=nz*ov/2;
   b.x+=nx*ov/2;b.y+=ny*ov/2;b.z+=nz*ov/2;
   return -s}},
 rotN(n,c){
  const cy=Math.cos(-c.yaw),sy=Math.sin(-c.yaw);
  const x1=n[0]*cy-n[2]*sy,z1=n[0]*sy+n[2]*cy;
  const cx=Math.cos(-c.pitch),sx=Math.sin(-c.pitch);
  return [x1,n[1]*cx-z1*sx,n[1]*sx+z1*cx]},
 /* инстансинг: пол одним объектом — 1 грань вместо 6N у боксов-плиток.
    ВАЖНО: t:1 не ставим — это флаг треугольника, и draw отбросил бы
    четвёртую вершину, нарисовав половину плоскости. */
 tiles(w,d,o){
  const s=o||{};
  return [{v:[[-w/2,s.y||0,-d/2],[w/2,s.y||0,-d/2],[w/2,s.y||0,d/2],[-w/2,s.y||0,d/2]],
          c:s.c||"#2e7d4f",n:[0,1,0],pl:1}]},
 /* сетка gw×gh плиток по колбэку cb(gx,gz) -> цвет | null */
 tileMap(gw,gh,tw,th,cb,o){
  const s=o||{},x0=s.x||0,y=s.y||0,z0=s.z||0,W=gw*tw,D=gh*th;
  return [{v:[[x0,y,z0],[x0+W,y,z0],[x0+W,y,z0+D],[x0,y,z0+D]],
           c:s.c||"#ffffff",n:[0,1,0],pl:1,pc:cb,gw:gw,gh:gh}]},
 /* узел с иерархией трансформа: манипуляторы, ноги/руки, стрела крана */
 node(t,f){
  const p={x:0,y:0,z:0,ry:0,rx:0,rz:0,s:1,...(t||{})};
  const rot=(a,b,c)=>{let t1,t2;
   t1=a*Math.cos(p.rz)-b*Math.sin(p.rz);t2=a*Math.sin(p.rz)+b*Math.cos(p.rz);a=t1;b=t2;
   t1=b*Math.cos(p.rx)-c*Math.sin(p.rx);t2=b*Math.sin(p.rx)+c*Math.cos(p.rx);b=t1;c=t2;
   t1=a*Math.cos(p.ry)+c*Math.sin(p.ry);t2=-a*Math.sin(p.ry)+c*Math.cos(p.ry);a=t1;c=t2;
   return [a,b,c]},
   add=v=>{const r=rot(v[0]*p.s,v[1]*p.s,v[2]*p.s);return [p.x+r[0],p.y+r[1],p.z+r[2]]},
   addN=n=>rot(n[0],n[1],n[2]);
  const api={
   x:p.x,y:p.y,z:p.z,P:add,n:addN,
   box:(w,h,d,col)=>{const X=w/2,Y=h/2,Z=d/2,V=(a,b,e)=>add([a,b,e]),F=[];
    F.push({v:[V(-X,-Y,-Z),V(X,-Y,-Z),V(X,Y,-Z),V(-X,Y,-Z)],c:col,n:addN([0,0,-1]),s:1});
    F.push({v:[V(-X,-Y,Z),V(-X,Y,Z),V(X,Y,Z),V(X,-Y,Z)],c:col,n:addN([0,0,1]),s:1});
    F.push({v:[V(-X,-Y,-Z),V(-X,-Y,Z),V(X,-Y,Z),V(X,-Y,-Z)],c:col,n:addN([0,-1,0]),s:1});
    F.push({v:[V(-X,Y,-Z),V(X,Y,-Z),V(X,Y,Z),V(-X,Y,Z)],c:col,n:addN([0,1,0]),s:1});
    F.push({v:[V(-X,-Y,-Z),V(-X,Y,-Z),V(-X,Y,Z),V(-X,-Y,Z)],c:col,n:addN([-1,0,0]),s:1});
    F.push({v:[V(X,-Y,-Z),V(X,-Y,Z),V(X,Y,Z),V(X,Y,-Z)],c:col,n:addN([1,0,0]),s:1});
    return F},
   sprite:(zz,size,text,col,glow)=>{const q=add([0,0,zz]);return E3.sprite(q[0],q[1],q[2],size,text,col,glow)}};
  return f?f(api):api},
 /* бюджет граней (E12): 0 = без ограничения */
 budget(n){E3.maxFaces=n||0;return E3.maxFaces},
 /* освещение грани. opts===undefined → берётся E3.defLit.
    opts: {ao — затемнение нижних граней, sky — подсветка верхних небом,
           l2 — второй направленный источник, l2w — его вес, spec — блик, shin — жёсткость} */
 lit(n,L,o){
  if(o===undefined)o=E3.defLit;
  const dl=n[0]*L[0]+n[1]*L[1]+n[2]*L[2];
  let b=.42+.58*(dl>0?dl:0);
  if(o){
   if(o.ao)b*=1-o.ao*(.5-.5*n[1]);
   if(o.sky)b*=1+o.sky*(n[1]>0?n[1]:0);
   if(o.l2){const l=o.l2,ln=Math.hypot(l[0],l[1],l[2])||1;
    const d=(n[0]*l[0]+n[1]*l[1]+n[2]*l[2])/ln;if(d>0)b+=(o.l2w||.3)*d}
  }
  return b},
 /* блик: степенная зависимость от отражения, нужен вектор взгляда на грань */
 spec(n,L,V,k,sh){if(!k)return 0;
  const hx=L[0]+V[0],hy=L[1]+V[1],hz=L[2]+V[2],hl=Math.hypot(hx,hy,hz)||1;
  const d=(n[0]*hx+n[1]*hy+n[2]*hz)/hl;
  return d<=0?0:Math.pow(d,sh||24)*k},
 /* заливка плоскости-инстанса. items = {cam, fl, f, c, pp, pv}
    f.v — 4 вершины прямоугольника в мире: [угол, +X, +X+Z, +Z]
    Поддерживается подделение на сетку gw×gh с колбэком f.pc(gx,gz)->цвет| */
 paintPlane(ctx,it,LW,LH){
  const f=it.f,V=f.v;
  ctx.beginPath();ctx.moveTo(it.pp[0][0],it.pp[0][1]);
  for(let i=1;i<it.pp.length;i++)ctx.lineTo(it.pp[i][0],it.pp[i][1]);
  ctx.closePath();ctx.fillStyle=it.c;ctx.fill();
  if(!f.pc)return;
  const gw=f.gw||1,gh=f.gh||1,cb=f.pc;
  const cam=it.cam,fl=it.fl;
  /* точка плоскости по параметрам сетки → экран */
  const at=(gx,gz)=>{
   const u=gx/gw,v=gz/gh,a=V[0],b=V[1],c=V[3];
   return E3.proj(E3.view([a[0]+(b[0]-a[0])*u+(c[0]-a[0])*v,
                          a[1]+(b[1]-a[1])*u+(c[1]-a[1])*v,
                          a[2]+(b[2]-a[2])*u+(c[2]-a[2])*v],cam),fl,LW,LH)};
   ctx.save();ctx.clip();
  for(let gz=0;gz<gh;gz++)for(let gx=0;gx<gw;gx++){
   const col=cb(gx,gz);
   if(!col)continue;
   if(--E3.stats.tiles<=0){gz=gh;break}
   const p00=at(gx,gz),p10=at(gx+1,gz),p11=at(gx+1,gz+1),p01=at(gx,gz+1);
   ctx.fillStyle=col;ctx.beginPath();
   ctx.moveTo(p00[0],p00[1]);ctx.lineTo(p10[0],p10[1]);
   ctx.lineTo(p11[0],p11[1]);ctx.lineTo(p01[0],p01[1]);
   ctx.closePath();ctx.fill();
  }
  ctx.restore();
 },
 draw(ctx,faces,cam,fl,L,opts){
  /* Переключение на WebGL2. Одно место, через которое проходят все 100
     игр: ни одной из них править не пришлось. Проверка идёт на каждом
     кадре, потому что E3GL грузится ПОСЛЕ E3 и на этапе разбора ещё не
     существует. Если WebGL2 недоступен или не запрошен — просто идём
     ниже обычным путём. */
  if(typeof E3GL!=="undefined"&&E3GL.want){
   if(!E3GL.ok)E3GL.attach(ctx);
   if(E3GL.ok&&E3GL.want)return E3GL.draw(ctx,faces,cam,fl,L,opts);
  }
  const _pf=E3.profile.on,_p0=_pf?performance.now():0;
  const LW=ctx.canvas._lw||ctx.canvas.width,LH=ctx.canvas._lh||ctx.canvas.height;
  const items=[],near=E3.near||.15;
  let culled=0,dropped=0;
  E3.stats.tiles=E3.maxTiles||9000;
  /* Сетка отсечения: сначала камера обходит занятые ячейки, потом
     грани берутся только из них. При E3.grid.use=false остаётся
     прежний линейный путь — так поведение игр не меняется молча. */
  /* list — либо сами грани (линейный путь), либо индексы в faces
     (сетка). idx=true означает, что элемент list[i] это номер грани. */
  let list=faces,listLen=faces.length,idx=false;
  if(E3.grid.use&&faces.length>E3.grid.minFaces){
   const pls=E3.grid.planes(cam,LW,LH,fl,near,E3.grid.sceneFar(cam));
   const cand=E3.grid.candidates(cam,pls);
   if(cand&&cand.length){list=cand;listLen=cand.length;idx=true}
  }
  for(let li=0;li<listLen;li++){const f=idx?faces[list[li]]:list[li];
   if(f.k){const vw=E3.view(f.p,cam);
    if(vw[2]<near)continue;
    const q=E3.proj(vw,fl,LW,LH);
    items.push({d:vw[2],spr:1,x:q[0],y:q[1],s:(f.z||1)*q[2],t:f.t2,c:f.c,g:f.g});
    continue}
   const nv=(f.t||f.v[3]===f.v[0])?3:4;
   let pv=[E3.view(f.v[0],cam)];
   for(let k=1;k<nv;k++)pv.push(E3.view(f.v[k],cam));
   let inside=0,dmax=0;
   for(let k=0;k<pv.length;k++){if(pv[k][2]>=near)inside++;if(pv[k][2]>dmax)dmax=pv[k][2]}
   if(!inside)continue;
   if(inside<pv.length)pv=E3.clipNear(pv,near);
   /* плоскость-инстанс: одна грань вместо N боксов, при желании делится на сетку */
   if(f.pl){
    items.push({d:dmax,pl:1,pp:pv.map(q=>E3.proj(q,fl,LW,LH)),c:f.c,f:f,cam:cam,fl:fl});
    continue}
   /* отсечение обратных граней: только для замкнутых объёмов (f.s) и только
      если грань целиком перед камерой — иначе оставляем на всякий случай */
   if(f.s&&E3.cull!==false&&dmax>near+.05){
    const rn=E3.rotN(f.n,cam);
    let cx=0,cy2=0,cz=0;
    for(let k=0;k<pv.length;k++){cx+=pv[k][0];cy2+=pv[k][1];cz+=pv[k][2]}
    const q=pv.length;
    if(rn[0]*cx+rn[1]*cy2+rn[2]*cz>0){culled++;continue}
   }
   const nl=Math.hypot(f.n[0],f.n[1],f.n[2])||1;
   const nrm=[f.n[0]/nl,f.n[1]/nl,f.n[2]/nl];
   /* цвет-текстура (CanvasPattern из E3.pattern) не тонируется, а идёт в fillStyle как есть */
   const flat=f.e===1||typeof f.c!=="string";
   let fcol=flat?f.c:E3.shade(f.c,E3.lit(nrm,L,opts));
   if(!flat&&opts&&opts.spec){
    /* направление взгляда: от грани к камере (грани уже в view space) */
    let vx=0,vy=0,vz=0;
    for(let k=0;k<pv.length;k++){vx-=pv[k][0];vy-=pv[k][1];vz-=pv[k][2]}
    const vl=Math.hypot(vx,vy,vz)||1;
    const sp=E3.spec(nrm,E3.rotN(L,cam),[vx/vl,vy/vl,vz/vl],opts.spec,opts.shin);
    if(sp>0)fcol=E3.mix(fcol,255,255,255,Math.min(.9,sp));
   }
   const fdep=dmax;
   if(E3.fog&&!flat){const fk=Math.max(0,Math.min(1,(fdep-E3.fog[3])/(E3.fog[4]-E3.fog[3])));if(fk>0)fcol=E3.mix(fcol,E3.fog[0],E3.fog[1],E3.fog[2],fk)}
   const pp=[];for(let k=0;k<pv.length;k++)pp.push(E3.proj(pv[k],fl,LW,LH));
   if(E3.maxFaces&&items.length>=E3.maxFaces){dropped++;continue}
   items.push({d:fdep,e:f.e?1:0,ea:f.e===2?2:0,a:f.a,p:pp,c:fcol})}
  E3.stats.faces=items.length;E3.stats.culled=culled;E3.stats.dropped=dropped;E3.stats.total=faces.length;E3.stats.tested=listLen;
 E3.stats.ms=E3.auto?E3.auto.ms:0;
  const _p1=_pf?performance.now():0;
  items.sort((a,b)=>b.d-a.d);
  const _p2=_pf?performance.now():0;
  for(let i=0;i<items.length;i++){const it=items[i];
   if(it.spr){const sz=Math.max(2,it.s);
    if(it.g){ctx.globalAlpha=.25+.2*Math.sin(performance.now()/250);
     ctx.fillStyle=it.c;ctx.beginPath();ctx.arc(it.x,it.y,sz*.5,0,7);ctx.fill();ctx.globalAlpha=1}
    ctx.font=Math.round(sz)+"px serif";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillStyle=it.c;ctx.fillText(it.t,it.x,it.y);continue}
   if(it.pl){E3.paintPlane(ctx,it,LW,LH,L,opts);continue}
   const P=it.p;
   let y0=1e9,y1=-1e9;for(let k=0;k<P.length;k++){if(P[k][1]<y0)y0=P[k][1];if(P[k][1]>y1)y1=P[k][1]}
    if(it.ea===2){ctx.fillStyle="rgba(0,0,0,"+(it.a||.3)+")"}
    else if(it.e||typeof it.c!=="string"){ctx.fillStyle=it.c}
    else if(y1-y0<E3.minGrad){
     /* Мелкая грань: градиент не читается глазом, а стоит дорого.
        Замер (tools/fill-bench.py, 1700 граней): плоская заливка 0.75 мс,
        с градиентом 6.29 мс — создание CanvasGradient это 88% стоимости. */
     ctx.fillStyle=it.flat||(it.flat=E3.shade(it.c,1))
    }
    else{const gr=ctx.createLinearGradient(0,y0,0,Math.max(y0+1,y1));gr.addColorStop(0,E3.shade(it.c,1.18));gr.addColorStop(1,E3.shade(it.c,.8));ctx.fillStyle=gr}
   ctx.beginPath();ctx.moveTo(P[0][0],P[0][1]);
   for(let k=1;k<P.length;k++)ctx.lineTo(P[k][0],P[k][1]);
   ctx.closePath();ctx.fill();
   /* Обводка толщиной 1px на грани в несколько пикселей не видна, но
      стоит столько же, сколько сама заливка (замер: +5.17 мс). */
   if(!it.ea&&(y1-y0)>=E3.minStroke){ctx.strokeStyle="rgba(10,10,25,.25)";ctx.lineWidth=1;ctx.stroke()}}
  if(_pf){const _p3=performance.now();
   E3.profile.push({ms:_p3-_p0,setup:_p1-_p0,sort:_p2-_p1,fill:_p3-_p2,
    faces:items.length,culled:culled,dropped:dropped,total:faces.length})}}
};

/* ================= настройки движка (общие для приложения и языка) ======== */
const LIGHT3=[.42,.75,.5];
/* пресеты освещения: ao — ambient occlusion (затемняет нижние грани),
   sky — подсветка верхних граней небом, l2 — второй направленный источник,
   spec — сила блика (вода/лёд/металл). E3.defLit применяется ко всем сценам,
   если draw() вызван без opts. */
E3.defLit={ao:.16,sky:.12};
E3.LIT={
 water:{ao:.14,sky:.1,l2:[-.5,.2,-.8],l2w:.22,spec:.5,shin:30},
 ice:{ao:.12,sky:.18,l2:[.6,.3,-.5],l2w:.28,spec:.7,shin:40},
 metal:{ao:.2,sky:.1,l2:[-.6,.5,.3],l2w:.3,spec:.85,shin:60},
 grass:{ao:.16,sky:.14},
 night:{ao:.3,sky:.04,l2:[-.3,.1,-.9],l2w:.12}
};
E3.fog=null;
/* статистика последнего draw(): total — подано граней, faces — нарисовано,
   culled — отсечено, dropped — выброшено по бюджету */
E3.stats={faces:0,culled:0,dropped:0,total:0,tiles:0,ms:0};
E3.maxFaces=0;E3.maxTiles=9000;
 /* Пороги качества заливки.
   Замер (tools/fill-bench.py, 1700 граней): плоская заливка 0.75 мс, с
   градиентом 6.29 мс — создание CanvasGradient это 88% стоимости кадра.
   Поэтому градиент отключаем только на мелких гранях, где он не виден.

   Обводку НЕ отключаем: замер показал, что она стоит дорого (+5.17 мс), но
   убрав её, картинка менялась на 7.6% пикселей — тёмный контур это часть
   стиля, а не украшение. Красивую картинку за наши деньги не продаём,
   порог оставлен нулевым, выигрыш берём только без потери качества. */
E3.minGrad=7;E3.minStroke=0;
E3.near=.15;
/* ===== Адаптивное качество =====
   E3.maxFaces умеет резать число граней, но его никто не включал: на слабом
   железе игра начинала подтормаживать. Этот сторож живёт сам, поверх любой игры:
   меряет реальное время кадра, опускает бюджет при просадке FPS и возвращает
   его обратно, когда снова хорошо. Пороги широкие: 26 мс — терпимо,
   13 мс — можно расслабить бюджет. */
E3.auto={min:240,ms:16.7,frames:[],last:0,on:true,
 tick:function(t){
  if(!E3.auto.on)return;
  requestAnimationFrame(function(s){E3.auto.tick(s)});
  if(!t)return;
  if(!E3.auto.last){E3.auto.last=t;return}
  E3.auto.measure(t-E3.auto.last,t)},
 /* dt — длительность кадра в мс; чистая логика, rAF не трогает */
 measure:function(dt,t){
  if(t)E3.auto.last=t;
  if(dt<=0||dt>500)return;
  var A=E3.auto;
  A.frames.push(dt);
  if(A.frames.length>50)A.frames.shift();
  if(A.frames.length<50)return;
  var sum=0;
  for(var i=0;i<A.frames.length;i++)sum+=A.frames[i];
  A.ms=sum/A.frames.length;
  if(A.ms>26){
   if(!E3.maxFaces)E3.maxFaces=1000;
   else if(E3.maxFaces>A.min)E3.maxFaces=Math.max(A.min,Math.floor(E3.maxFaces*.72));
   A.frames.length=0;if(E3.profile)E3.profile.onBudgetChange();
  }else if(A.ms<13&&E3.maxFaces>0){
   E3.maxFaces=E3.maxFaces<760?Math.floor(E3.maxFaces*1.35)+60:0;
   A.frames.length=0;if(E3.profile)E3.profile.onBudgetChange();
  }},
 /* прогон на синтетике: n кадров по frameMs мс, без побочных rAF */
 stress:function(n,frameMs){
  var wasOn=E3.auto.on,wasFaces=E3.maxFaces;
  E3.auto.on=false;E3.auto.frames=[];E3.auto.last=0;
  for(var i=0;i<n;i++)E3.auto.measure(frameMs,i*frameMs);
  var out=E3.maxFaces;
  E3.auto.on=wasOn;E3.maxFaces=wasFaces;E3.auto.frames=[];E3.auto.last=0;
  return out},
 q:function(){return E3.maxFaces?Math.round(E3.maxFaces)+" граней":"полное качество"}};
/* Смешивание с цветом. Если первый аргумент — не #rrggbb (например,
     CanvasPattern), возвращаем его же: раньше здесь был parseInt от
     объекта, и паттерн вместе с туманом ронял кадр. */
E3.mix=function(hex,r,g,b,k){const h=String(hex);if(h.charAt(0)!=="#")return hex;
 const n=parseInt(h.slice(1,7),16);
 const R=Math.round(((n>>16)&255)*(1-k)+r*k),G=Math.round(((n>>8)&255)*(1-k)+g*k),B=Math.round((n&255)*(1-k)+b*k);
 return "#"+((1<<24)|(R<<16)|(G<<8)|B).toString(16).slice(1)};

/* ============ ПРОФИЛИРОВЩИК КАДРА (Фаза 1.1) ============
 * Отвечает на вопрос, на который E3.stats не отвечает: не «сколько граней»,
 * а «где ушло время». Разница принципиальна — если время съедает сортировка,
 * резать бюджет граней бесполезно, и сторож качества раньше резал его вслепую.
 *
 * Запись кадра: {ms, setup, sort, fill, faces, culled, dropped, total}
 *   setup — построение списка и отсечение,
 *   sort  — сортировка по глубине,
 *   fill  — заливка граней и плоскостей.
 *
 * Выключен по умолчанию: два лишних now() на кадр не бесплатны.
 * Кольцевой буфер держит последние keep кадров, иначе в долгой игре
 * память росла бы без ограничений. */
E3.profile = {
 frames: [], keep: 240, on: false,
 start(){ E3.profile.on = true; E3.profile.frames.length = 0; },
 stop(){ E3.profile.on = false; },
 reset(){ E3.profile.frames.length = 0; },
 /* Вызывается в конце draw(), только если профилировщик включён. */
 push(rec){
  const f = E3.profile.frames;
  f.push(rec);
  if(f.length > E3.profile.keep) f.shift();
 },
 /* Средние по записанным кадрам. */
 avg(){
  const f = E3.profile.frames;
  if(!f.length) return null;
  const s = { ms:0, setup:0, sort:0, fill:0, faces:0, culled:0, dropped:0, total:0, n:f.length };
  for(const r of f){
   s.ms += r.ms; s.setup += r.setup || 0; s.sort += r.sort || 0; s.fill += r.fill || 0;
   s.faces += r.faces; s.culled += r.culled; s.dropped += r.dropped; s.total += r.total;
  }
  for(const k in s) if(k !== "n") s[k] = Math.round(s[k] * 1000 / s.n * 1000) / 1000;
  return s;
 },
 /* Доли этапов в процентах от кадра: что именно дорого. */
 breakdown(){
  const a = E3.profile.avg();
  if(!a || !a.ms) return null;
  return {
   setup: Math.round(a.setup / a.ms * 100),
   sort: Math.round(a.sort / a.ms * 100),
   fill: Math.round(a.fill / a.ms * 100),
   other: Math.round(Math.max(0, 100 - (a.setup + a.sort + a.fill) / a.ms * 100))
  };
 },
 /* Сводка для консоли и для тестов. */
 report(){
  const a = E3.profile.avg();
  if(!a) return "профилировщик выключен или кадров ещё нет";
  const b = E3.profile.breakdown();
  return "кадров " + a.n + ", кадр " + a.ms + " мс | подготовка " + b.setup +
   "% (" + a.setup + " мс), сортировка " + b.sort + "% (" + a.sort +
   " мс), заливка " + b.fill + "% (" + a.fill + " мс) | граней " +
   a.faces + " из " + a.total + ", отсечено " + a.culled + ", выброшено " + a.dropped;
 },
 /* После смены бюджета старые кадры описывают уже другое состояние. */
 onBudgetChange(){ E3.profile.frames.length = 0; }
};


/* ============ СЕТКА ОТСЕЧЕНИЯ (Фаза 1.2) ============
 * Разложение граней по ячейкам мирового пространства. Кадр обходит только
 * те ячейки, которые попали в поле зрения, и рисует грани оттуда.
 *
 * Что это даёт. На равномерной сцене (а это большинство игр: кубики на
 * земле, плитки, деревья) камера видит малую долю ячеек, поэтому число
 * преобразований view() падает на порядок. На разреженной сцене выигрыша
 * почти нет — честно: это не универсальное ускорение.
 *
 * Сетка, а не BVH: дерево на кадр обходится дороже, чем его построение
 * для наших объёмов, и хуже чинится при динамических объектах.
 *
 * Включается явно: E3.grid.use = true. По умолчанию выключено, потому что
 * построение сетки само по себе стоит денег на маленьких сценах.
 *
 * УСТАРЕЛО, НОВОГО КОДА НЕ ПИШЕМ. Замер показал: в браузере сетка
 * медленнее линейного прохода в 2,6 раза (15,1 мс против 39,4 мс на 1000
 * граней), потому что кадр упирается в заливку, а не в отбор граней.
 * В пути WebGL2 отсечение делает GPU бесплатно, и сетка там просто не
 * читается. Код оставлен, потому что на нём стоит tools/grid-gate.py;
 * удалять его имеет смысл вместе с отказом от пути 2D. */
E3.grid = {
 /* minFaces — ниже этого сетка не строим: на маленьких сценах
    построение дороже самой отрисовки. far — половина стороны,
    до которой камера «смотрит» в сетку: должна покрывать
    максимальный обзор, иначе дальние объекты исчезнут. */
 minFaces: 400, maxFar: 0,
 /* ВЫКЛЮЧЕНА ПО УМОВАНИЮ, А НЕ ПО ЗАБЫВЧИВОСТИ.
    Замер (tools/bench-gate.py, 1000 граней, камера внутри сцены):
      линейный путь — 15.1 мс/кадр, сетка — 39.4 мс/кадр.
    Сетка проигрывает в 2.6 раза: обход всех ячеек с проверкой плоскостей
    стоит дороже, чем сэкономленные преобразования. Профилировщик показывает,
    что кадр на 74% уходит в ЗАЛИВКУ, а не в отбор граней — отсекать
    нечего, узкое место — заливка холста.
    Включать имеет смысл только там, где сцена огромна, а в кадре
    попадает малая доля (проверять на своей сцене, а не на глаз). */
 use: false, cell: 8, minX: 0, minY: 0, minZ: 0, nx: 1, ny: 1, nz: 1,
 cells: null, buckets: null, faceIndex: null, built: 0,

 /* Разложить грани по ячейкам. cell — сторона ячейки в мировых единицах.
    Пустые ячейки не хранятся: память пропорциональна занятым ячейкам. */
 build(faces, cell){
  const P = E3.grid;
  P.cell = cell || P.cell;
  const c = P.cell;
  let minX = Infinity, minY = Infinity, minZ = Infinity,
      maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  /* Первым проходом считаем общий объём сцены и AABB каждой грани.
     Без этого сетку не на что натянуть. */
  const aabb = [], sprites = [];
  for(let i = 0; i < faces.length; i++){
   const f = faces[i];
   /* Спрайт — точка, а не объём: в ячейку его класть нельзя.
      Держим отдельно и добавляем к кандидатам всегда. */
   if(!f) continue;
   if(f.k){ sprites.push(i); continue; }
   const v = f.v;
   if(!v || v.length < 3) continue;
   let ax = v[0][0], ay = v[0][1], az = v[0][2],
       bx = ax, by = ay, bz = az;
   for(let k = 1; k < v.length; k++){
    const p = v[k];
    if(p[0] < ax) ax = p[0]; if(p[0] > bx) bx = p[0];
    if(p[1] < ay) ay = p[1]; if(p[1] > by) by = p[1];
    if(p[2] < az) az = p[2]; if(p[2] > bz) bz = p[2];
   }
   aabb[i] = [ax, ay, az, bx, by, bz];
   if(ax < minX) minX = ax; if(ax > maxX) maxX = ax;
   if(ay < minY) minY = ay; if(ay > maxY) maxY = ay;
   if(az < minZ) minZ = az; if(az > maxZ) maxZ = az;
  }
  if(!isFinite(minX)){ P.cells = null; P._aabb = null; return 0; }

  P.minX = minX; P.minY = minY; P.minZ = minZ;
  P.maxX = maxX; P.maxY = maxY; P.maxZ = maxZ;
  P.nx = Math.max(1, Math.ceil((maxX - minX) / c));
  P.ny = Math.max(1, Math.ceil((maxY - minY) / c));
  P.nz = Math.max(1, Math.ceil((maxZ - minZ) / c));

  /* Защита от взрыва памяти: если сетка выходит разумного размера,
     не строим её вовсе и остаёмся на линейном пути. 1e6 ячеек — это
     уже сцена, где сетка вряд ли окупит себя. */
  const total = P.nx * P.ny * P.nz;
  if(total > 1e6){ P.use = false; P.cells = null; return 0; }

  const map = new Map();
  for(let i = 0; i < faces.length; i++){
   const b = aabb[i];
   if(!b){ continue; }
   const i0 = Math.max(0, Math.min(P.nx - 1, ((b[0] - P.minX) / c) | 0)),
         j0 = Math.max(0, Math.min(P.ny - 1, ((b[1] - P.minY) / c) | 0)),
         k0 = Math.max(0, Math.min(P.nz - 1, ((b[2] - P.minZ) / c) | 0)),
         i1 = Math.max(0, Math.min(P.nx - 1, ((b[3] - P.minX) / c) | 0)),
         j1 = Math.max(0, Math.min(P.ny - 1, ((b[4] - P.minY) / c) | 0)),
         k1 = Math.max(0, Math.min(P.nz - 1, ((b[5] - P.minZ) / c) | 0));
   /* Большая грань (земля, стена) попадает во много ячеек — это верно,
      иначе при движении камеры она «пропадала» бы на границах. */
   for(let kk = k0; kk <= k1; kk++)
    for(let jj = j0; jj <= j1; jj++)
     for(let ii = i0; ii <= i1; ii++){
      const key = (kk * P.ny + jj) * P.nx + ii;
      let arr = map.get(key);
      if(!arr){ arr = []; map.set(key, arr); }
      arr.push(i);
     }
  }
  P.cells = map;
  P._aabb = aabb;
  P.sprites = sprites;
  P.buckets = map.size;
  P.built++;
  return map.size;
 },

 /* Грани, потенциально видимые из камеры.
    Радиус берём по дальней плоскости и по «толстой» грани: если камера
    внутри ячейки, берём ячейку целиком — иначе объект мог бы исчезнуть. */
 /* Дальность взгляда: до самой дальней вершины AABB сцены.
    Фиксированное число здесь не годится — сцена то на 30, то на 600 единиц,
    и лишний отсечённый объём просто исчезает с экрана. */
 sceneFar(cam){
  const P = E3.grid;
  if(!P.cells || P.maxX === undefined) return P.maxFar || 260;
  const x0=P.minX, x1=P.maxX, y0=P.minY, y1=P.maxY, z0=P.minZ, z1=P.maxZ;
  let d = 0;
  for(let i = 0; i < 8; i++){
   const dx = ((i&1)?x1:x0) - cam.x,
         dy = ((i&2)?y1:y0) - cam.y,
         dz = ((i&4)?z1:z0) - cam.z;
   const q = dx*dx + dy*dy + dz*dz;
   if(q > d) d = q;
  }
  const far = Math.sqrt(d);
  return P.maxFar > 0 ? Math.min(far, P.maxFar) : far;
 },

 /* Плоскости пирамиды видимости в мировых координатах.
    Каждая задана как nx*x + ny*y + nz*z + d >= 0 — «внутри».
    Нормали берутся из проекции: s = fl/z, значит на глубине z полуэкран
    по X = LW*z/(2*fl), по Y = LH*z/(2*fl). Отсюда плоскости
      x + hW*z >= 0,  -x + hW*z >= 0,  y + hH*z >= 0,  -y + hH*z >= 0,
      z >= near,  farD - z >= 0.
    Перенос в мир: n_world = R^T·n (R — поворот из view()). */
 planes(cam, LW, LH, fl, near, farD){
  const cy=Math.cos(-cam.yaw),sy=Math.sin(-cam.yaw);
  const cx=Math.cos(-cam.pitch),sx=Math.sin(-cam.pitch);
  /* строки R^-1 = R^T — мировые координаты осей камеры */
  const axX=cy,     axY=-sx*sy,  axZ=cx*sy;     /* вправо */
  const ayX=0,      ayY=cx,      ayZ=sx;        /* вверх */
  const azX=-sy,    azY=-sx*cy,  azZ=cx*cy;     /* вперёд */
  const hW=LW/(2*fl), hH=LH/(2*fl);
  const P=E3.grid._planes || (E3.grid._planes = []);
  let n = 0;
  /* n_cam -> n_world = n_cam.x*right + n_cam.y*up + n_cam.z*fwd */
  function push(nx, ny, nz, d){
   const wx = nx*axX + ny*ayX + nz*azX,
         wy = nx*axY + ny*ayY + nz*azY,
         wz = nx*axZ + ny*ayZ + nz*azZ;
   P[n] = { x:wx, y:wy, z:wz, d:d - (wx*cam.x + wy*cam.y + wz*cam.z) };
   n++;
  }
  push( 1, 0, hW, 0);          /* левая  */
  push(-1, 0, hW, 0);          /* правая */
  push( 0, 1, hH, 0);          /* нижняя */
  push( 0,-1, hH, 0);          /* верхняя */
  push( 0, 0, 1, -near);       /* ближняя */
  push( 0, 0,-1, farD);         /* дальняя */
  P.length = n;
  return P;
 },
 /* Ячейка целиком вне пирамиды? Берём вершину AABB со знаком нормали:
    если даже она снаружи — ячейка не пересекает кадр ни в одной точке. */
 cellOutside(pl, x0, y0, z0, x1, y1, z1){
  for(let i = 0; i < pl.length; i++){
   const p = pl[i];
   const vx = p.x >= 0 ? x1 : x0,
         vy = p.y >= 0 ? y1 : y0,
         vz = p.z >= 0 ? z1 : z0;
   if(p.x*vx + p.y*vy + p.z*vz + p.d < 0) return true;
  }
  return false;
 },
 /* Индексы граней из ячеек, пересекающих пирамиду видимости. */
 candidates(cam, planes){
  const P = E3.grid;
  const out = P._out || (P._out = []);
  out.length = 0;
  if(!P.cells || !planes) return null;
  const c = P.cell;
  /* Обходим все занятые ячейки, а не прямоугольник по сцене: при сильно
     вытянутой сцене прямоугольник был бы заметно больше нужного. */
  let seen = null;
  P.cells.forEach((arr, key) => {
   const ix = key % P.nx,
         iy = ((key - ix) / P.nx) % P.ny,
         iz = (key - ix - iy*P.nx) / (P.ny*P.nx);
   const x0 = P.minX + ix*c, y0 = P.minY + iy*c, z0 = P.minZ + iz*c;
   if(P.cellOutside(planes, x0, y0, z0, x0+c, y0+c, z0+c)) return;
   if(!seen) seen = new Set();
   for(let n = 0; n < arr.length; n++){
    const i = arr[n];
    if(seen.has(i)) continue;
    seen.add(i);
    out.push(i);
   }
  });
  /* Спрайты: у них нет объёма, они не в ячейках и проверяются всегда. */
  const sp = P.sprites;
  if(sp) for(let i = 0; i < sp.length; i++) out.push(sp[i]);
  return out;
 },

 /* Сброс: сетка описывает прошлую сцену, для новой она бессмысленна. */
 clear(){
  E3.grid.cells = null; E3.grid._aabb = null;
  E3.grid.buckets = 0; E3.grid.maxX = undefined; E3.grid.sprites = null;
 }
};
