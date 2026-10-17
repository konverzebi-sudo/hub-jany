/* =========================================================
   Mesa Lista · código compartido (cliente y panel)
   ========================================================= */

/* Carpeta donde vive la app (ej. "/mesa-lista" en jefeshub.com/mesa-lista, o "" en la raíz) */
const BASE=location.pathname.replace(/\/(panel|mesa)(\.html|\/.*)?$/,'').replace(/\/index\.html$/,'').replace(/\/$/,'');
const mesaPath=n=>`${BASE}/mesa/${n}/`;
const MAX_TABLES=100; // hay una carpeta mesa/1 … mesa/100
const TOGO_MARK='🥡 PARA LLEVAR'; // va al inicio del comentario del pedido
let HAS_PHOTO=false; // la base de datos ya tiene la columna de fotos (5-fotos.sql)
let HAS_VIDEO=false; // y la de videos (6-videos.sql)

/* ---------- Conexión con Supabase ---------- */
const CFG=window.MESA_CONFIG||{};
const CONFIGURED=/^https:\/\//.test(CFG.supabaseUrl||'')&&!!CFG.supabaseKey&&!/PEGA/.test(CFG.supabaseKey+CFG.supabaseUrl);
function makeClient(opts){return CONFIGURED&&window.supabase?window.supabase.createClient(CFG.supabaseUrl.replace(/\/+$/,''),CFG.supabaseKey,opts):null;}
function setupMessage(){
  return `<div class="setup card card-pad"><h3>Falta conectar la base de datos</h3>
    <p class="sub">Abre el archivo <b>config.js</b> y pega la URL de tu proyecto de Supabase y tu clave pública. Está explicado en la guía, paso 3.</p></div>`;
}
function errText(e){
  const m=(e&&(e.message||e.error_description))||'';
  if(/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión a internet. Intenta de nuevo.';
  return m||'Algo salió mal. Intenta de nuevo.';
}

/* ---------- Utilidades de color ---------- */
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
function hexToRgb(h){h=String(h).replace('#','');if(h.length===3)h=h.split('').map(x=>x+x).join('');const n=parseInt(h,16)||0;return [n>>16&255,n>>8&255,n&255];}
function rgbToHex(c){return '#'+c.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('').toUpperCase();}
function rgbToHsl([r,g,b]){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0;const l=(mx+mn)/2;if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6;}return [h,s,l];}
function hslToRgb([h,s,l]){if(!s){const v=l*255;return [v,v,v];}const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const f=t=>{t=((t%1)+1)%1;return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};return [f(h+1/3)*255,f(h)*255,f(h-1/3)*255];}
function lum(hex){const c=hexToRgb(hex).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function contrast(a,b){const A=lum(a),B=lum(b);return (Math.max(A,B)+.05)/(Math.min(A,B)+.05);}
function mix(a,b,t){const A=hexToRgb(a),B=hexToRgb(b);return rgbToHex(A.map((v,i)=>v+(B[i]-v)*t));}
function hsl(hex){return rgbToHsl(hexToRgb(hex));}
function fromHsl(h,s,l){return rgbToHex(hslToRgb([h,s,l]));}
function ensureContrast(fg,bg,min){
  if(contrast(fg,bg)>=min) return fg;
  const lighten=lum(bg)<.35; let [h,s,l]=hsl(fg);
  for(let i=0;i<50;i++){ l=clamp(l+(lighten?.02:-.02)); const c=fromHsl(h,s,l); if(contrast(c,bg)>=min) return c; }
  return lighten?'#FFFFFF':'#000000';
}
const bestInk=bg=>contrast('#FFFFFF',bg)>=contrast('#15171C',bg)?'#FFFFFF':'#15171C';
const rgba=(hex,a)=>{const [r,g,b]=hexToRgb(hex);return `rgba(${r},${g},${b},${a})`;};
function cdist(a,b){const rm=(a[0]+b[0])/2,dr=a[0]-b[0],dg=a[1]-b[1],db=a[2]-b[2];return Math.sqrt((2+rm/256)*dr*dr+4*dg*dg+(2+(255-rm)/256)*db*db);}

function deriveTheme(t){
  return {...t,
    headInk:bestInk(t.head), brandInk:bestInk(t.brand), accentInk:bestInk(t.accent),
    muted:mix(t.ink,t.bg,.45), line:mix(t.ink,t.surface,.87), soft:mix(t.brand,t.surface,.86), tile:mix(t.accent,t.surface,.82)};
}
function themeVars(t){
  const d=deriveTheme(t);
  return `--c-bg:${d.bg};--c-surface:${d.surface};--c-ink:${d.ink};--c-muted:${d.muted};--c-line:${d.line};--c-head:${d.head};--c-head-ink:${d.headInk};--c-brand:${d.brand};--c-brand-ink:${d.brandInk};--c-soft:${d.soft};--c-accent:${d.accent};--c-accent-ink:${d.accentInk};--c-tile:${d.tile}`;
}

/* ---------- Datos ---------- */
const DEFAULT_THEME={name:'Predeterminado',head:'#111111',brand:'#FF4A1A',accent:'#FF8C2E',bg:'#F5F5F5',surface:'#FFFFFF',ink:'#111111'};
const PAY_LABEL={terminal:"📟 Terminal con mesero",efectivo:"💵 Efectivo"};
const STATUS_CLIENT={pendiente:"Esperando que el restaurante confirme tu pedido",confirmado:"Confirmado, en la fila de cocina",preparando:"Tu pedido se está preparando",listo:"¡Listo! Ya va a tu mesa",entregado:"Entregado, buen provecho",rechazado:"El restaurante no pudo tomar este pedido"};
const money=n=>"$"+Number(n||0).toLocaleString("es-MX");
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let _n=0;const uid=p=>p+Date.now().toString(36)+(_n++).toString(36)+Math.random().toString(36).slice(2,6);
const orderTotal=o=>o.items.reduce((s,i)=>s+Number(i.unit)*i.q,0);

/* Filas de la base de datos ⇄ objetos de la app */
function settingsFromRow(r){
  r=r||{};
  return {name:r.name||'Mi restaurante',logo:r.logo||null,colors:r.colors||[],combos:r.combos||[],
    applied:r.applied??-1,theme:{...DEFAULT_THEME,...(r.theme||{})},
    categories:Array.isArray(r.categories)?r.categories:[],tables:r.tables_count||8};
}
function productFromRow(r){
  return {id:r.id,cat:r.cat,name:r.name,desc:r.description||'',price:Number(r.price)||0,emoji:r.emoji||'🍽️',photo:r.photo||'',video:r.video||'',
    available:!!r.available,options:Array.isArray(r.options)?r.options:[],sort:r.sort||0,created:r.created_at||''};
}
function productToRow(p){
  return {id:p.id,cat:p.cat,name:p.name,description:p.desc,price:Math.max(0,Number(p.price)||0),emoji:p.emoji,
    available:p.available,options:p.options,sort:p.sort||0,...(HAS_PHOTO?{photo:p.photo||''}:{}),...(HAS_VIDEO?{video:(p.video||'').trim()}:{})};
}
const byMenuOrder=(a,b)=>(a.sort-b.sort)||String(a.created).localeCompare(String(b.created));
function orderFromRow(r){
  const note=r.note||'',toGo=note.startsWith(TOGO_MARK);
  return {id:Number(r.id),table:r.table_no,by:r.guest,account:r.account,items:r.items||[],toGo,note:toGo?note.slice(TOGO_MARK.length).replace(/^\s*·\s*/,''):note,pay:r.pay,
    status:r.status,paid:!!r.paid,closed:!!r.closed,
    createdAt:Date.parse(r.created_at)||Date.now(),confirmedAt:r.confirmed_at?Date.parse(r.confirmed_at):null};
}
/* Categorías en el orden del restaurante, más "Otros" para lo que no tenga categoría válida */
function groupByCategory(categories,products){
  const groups=categories.map(c=>[c,products.filter(p=>p.cat===c)]);
  const rest=products.filter(p=>!categories.includes(p.cat));
  if(rest.length) groups.push(['Otros',rest]);
  return groups.filter(([,ps])=>ps.length);
}

/* ---------- Pequeñas utilidades de pantalla ---------- */
function ago(t){const m=Math.floor((Date.now()-t)/60000);return m<1?'un momento':m+' min';}
function clock(t){const s=Math.max(0,Math.floor((Date.now()-t)/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
let _tt;function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),3200);}
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
};

/* ---------- Demo: cambiar entre las 3 vistas (cliente, cocina, admin) ---------- */
function demoBar(active){
  if(!CFG.openPanel||window.top!==window) return false;
  const items=[['cliente','Cliente',`${BASE}/`],['cocina','Cocina',`${BASE}/panel?modo=cocina`],['admin','Admin',`${BASE}/panel`]];
  const el=document.createElement('nav');
  el.className='demo-bar';el.setAttribute('aria-label','Cambiar de vista (demo)');
  el.innerHTML=`<span>Demo · ver como</span><div class="demo-seg">${items.map(([k,l,h])=>
    `<a href="${h}"${k===active?' aria-current="page"':''}>${l}</a>`).join('')}</div>`;
  document.body.prepend(el);document.body.classList.add('has-demo');
  return true;
}
function photoTag(p,cls='tile'){
  return p.photo?`<div class="${cls} ph" aria-hidden="true"><img src="${esc(p.photo)}" alt="" loading="lazy"></div>`
    :`<div class="${cls}" aria-hidden="true">${esc(p.emoji)}</div>`;
}

/* Imagen grande de un platillo: video en loop (si tiene), si no la foto, si no el ícono */
function mediaInner(p){
  if(p.video) return `<video src="${esc(p.video)}" ${p.photo?`poster="${esc(p.photo)}"`:''} autoplay muted loop playsinline preload="metadata" aria-label="${esc(p.name)}"></video>`;
  if(p.photo) return `<img src="${esc(p.photo)}" alt="${esc(p.name)}">`;
  return `<span aria-hidden="true">${esc(p.emoji)}</span>`;
}
const videoBadge=p=>p.video?'<span class="vid-badge" aria-label="Tiene video">▶</span>':'';
