/* =========================================================
   Mesa Lista · página del cliente (/mesa/5)
   Solo puede leer el menú y crear pedidos.
   ========================================================= */
const params=new URLSearchParams(location.search);
const PREVIEW=params.has('preview');
const TABLE=(()=>{const m=location.pathname.match(/\/mesa\/(\d+)/);return parseInt(m?m[1]:params.get('mesa'),10)||0;})();
/* Sin número de mesa (portada): se puede ver el menú y armar el pedido; para enviarlo se escanea el QR */
const BROWSE=!PREVIEW&&!TABLE;
const HAS_DEMO=!PREVIEW&&demoBar('cliente');
const sb=makeClient({auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

/* Identificador anónimo de este celular: con él consulta el estado de SUS pedidos */
function newUUID(){
  if(crypto.randomUUID) return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
let token=store.get('mesalista-device',null);
if(!token){token=newUUID();store.set('mesalista-device',token);}

const state={settings:settingsFromRow(null),products:[],orders:[]};
const LAYOUTS=['lista','iconos','tarjetas'];
const ui={loaded:false,started:true,toGo:false,layout:LAYOUTS.includes(store.get('mesalista-layout'))?store.get('mesalista-layout'):'lista',accType:store.get('mesalista-acc','mesa'),guest:PREVIEW?'Ana':store.get('mesalista-guest',''),
  cat:"Todo",q:"",cart:[],pay:"terminal",gnote:"",sheet:null,ptab:"menu",sending:false};
/* El carrito se guarda en el celular: sobrevive al pasar de la portada a la mesa */
const CART_KEY='mesalista-cart',CART_TTL=3*3600e3;
(()=>{if(PREVIEW)return;const c=store.get(CART_KEY,null);
  if(c&&Array.isArray(c.cart)&&c.cart.length&&Date.now()-c.t<CART_TTL){
    ui.cart=c.cart;ui.toGo=!!c.toGo;ui.pay=c.pay||ui.pay;ui.gnote=c.gnote||'';
    if(!BROWSE){ui.sheet={type:'cart'};ui.fromScan=true;}}})();
function saveCart(){if(!PREVIEW)store.set(CART_KEY,{t:Date.now(),cart:ui.cart,toGo:ui.toGo,pay:ui.pay,gnote:ui.gnote});}
const prod=id=>state.products.find(p=>p.id===id);
const pBody=document.getElementById('pBody');

/* ---------- Carga y tiempo real ---------- */
async function loadMenu(){
  const [s,p]=await Promise.all([
    sb.from('settings').select('*').eq('id',1).maybeSingle(),
    sb.from('products').select('*')
  ]);
  if(s.error||p.error) throw (s.error||p.error);
  state.settings=settingsFromRow(s.data);
  state.products=p.data.map(productFromRow).sort(byMenuOrder);
  // Si algo del carrito se agotó o desapareció, lo quitamos
  const gone=ui.cart.filter(l=>{const x=prod(l.pid);return !x||!x.available;});
  if(gone.length){ui.cart=ui.cart.filter(l=>!gone.includes(l));toast(`Se agotó ${gone[0].name}, lo quitamos de tu pedido`);}
}
let menuTimer;
function onMenuChange(){clearTimeout(menuTimer);menuTimer=setTimeout(()=>loadMenu().then(render).catch(()=>{}),300);}

async function refreshOrders(){
  if(PREVIEW||!validTable()) return;
  const {data,error}=await sb.rpc('get_my_orders',{p_token:token});
  if(error||!data) return;
  const prev=new Map(state.orders.map(o=>[o.id,o.status]));
  state.orders=data.map(orderFromRow).filter(o=>o.table===TABLE&&!o.closed);
  state.orders.forEach(o=>{
    const before=prev.get(o.id);
    if(before&&before!==o.status){
      if(o.status==='listo'){toast(`¡Tu pedido #${o.id} está listo!`);try{navigator.vibrate&&navigator.vibrate([200,100,200]);}catch(e){}}
      else if(o.status==='confirmado') toast(`Pedido #${o.id} confirmado`);
      else if(o.status==='rechazado') toast(`El restaurante no pudo tomar el pedido #${o.id}`);
    }
  });
  renderClient();
}
const hasActive=()=>state.orders.some(o=>!['entregado','rechazado'].includes(o.status));
setInterval(()=>{if(!document.hidden&&hasActive()) refreshOrders();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ui.loaded){refreshOrders();onMenuChange();}});

/* Vista previa dentro del panel: recibe colores al instante */
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data||e.data.type!=='mesalista-theme') return;
  Object.assign(state.settings,e.data.settings);render();
});

(async()=>{
  if(!sb){pBody.innerHTML=setupMessage();return;}
  try{await loadMenu();}
  catch(e){
    pBody.innerHTML=`<div class="p-msg"><b>No pudimos cargar el menú</b><span>${esc(errText(e))}</span><button class="c-cta" id="retry"><span>Reintentar</span></button></div>`;
    document.getElementById('retry').onclick=()=>location.reload();
    return;
  }
  ui.loaded=true;render();
  sb.channel('menu')
    .on('postgres_changes',{event:'*',schema:'public',table:'products'},onMenuChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'settings'},onMenuChange)
    .subscribe();
  refreshOrders();
})();

/* ---------- Pantalla ---------- */
const validTable=()=>TABLE>=1&&TABLE<=state.settings.tables;
const canUse=()=>BROWSE||validTable();
function applyTheme(){
  const s=state.settings,t=s.theme;
  document.getElementById('phone').setAttribute('style',themeVars(t));
  document.body.style.background=mix(t.bg,'#000000',.08);
  document.querySelector('meta[name="theme-color"]').setAttribute('content',t.head);
  document.getElementById('pLogo').innerHTML=s.logo?`<img src="${esc(s.logo)}" alt="">`:`<span style="font-size:20px">🍽️</span>`;
  document.getElementById('pName').textContent=s.name;
  document.getElementById('pTable').classList.toggle('hidden',!validTable());
  document.getElementById('pStaff').classList.toggle('hidden',!BROWSE||HAS_DEMO);
  document.getElementById('pTableN').textContent=TABLE;
  document.title=validTable()?`${s.name} · Mesa ${TABLE}`:s.name;
}
function render(){applyTheme();renderClient();}

document.querySelectorAll('[data-ptab]').forEach(b=>b.onclick=()=>{ui.ptab=b.dataset.ptab;renderClient();if(ui.ptab==='orders')refreshOrders();});

function renderClient(){
  if(!ui.loaded) return;
  if(!canUse()){
    document.getElementById('pNav').classList.add('hidden');
    pBody.innerHTML=`<div class="p-msg"><b>Este código no corresponde a una mesa</b><span>Pide ayuda al personal del restaurante.</span></div>`;
    return;
  }
  document.querySelectorAll('[data-ptab]').forEach(b=>b.setAttribute('aria-current',b.dataset.ptab===ui.ptab));
  document.getElementById('pNav').classList.toggle('hidden',!ui.started||BROWSE);
  const mine=state.orders;
  const activeN=mine.filter(o=>!['entregado','rechazado'].includes(o.status)).length;
  const on=document.getElementById('ordN'); on.textContent=activeN; on.classList.toggle('hidden',!activeN);
  if(ui.ptab==='menu') renderMenu();
  else renderOrders(mine);
  renderCartBar();
  renderSheet();
  saveCart();
  if(ui.fromScan&&ui.sheet&&ui.sheet.type==='cart'){ui.fromScan=false;toast(`Ya estás en la mesa ${TABLE}. Revisa tu pedido y envíalo.`);}
}


function renderMenu(){
  const q=ui.q.trim().toLowerCase();
  const all=groupByCategory(state.settings.categories,state.products);
  const cats=["Todo",...all.map(([c])=>c)];
  if(!cats.includes(ui.cat)) ui.cat="Todo";
  const groups=all.filter(([c])=>ui.cat==="Todo"||c===ui.cat)
    .map(([c,ps])=>[c,ps.filter(p=>!q||(p.name+" "+p.desc).toLowerCase().includes(q))]).filter(([,ps])=>ps.length);
  pBody.innerHTML=`
    <div class="hi-bar"><span>${BROWSE?'Elige lo que se te antoje. Para enviar tu pedido escaneas el QR de tu mesa.'
      :ui.guest?`Hola, <b>${esc(ui.guest)}</b>. Estás en la mesa ${TABLE}.`:`Estás en la mesa ${TABLE}. Elige lo que se te antoje.`}</span></div>
    <div class="search"><svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search" placeholder="Buscar platillo" value="${esc(ui.q)}" aria-label="Buscar platillo"></div>
    <div class="c-views" role="group" aria-label="Forma de ver el menú">${[
      ['lista','Lista','<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'],
      ['iconos','Íconos','<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'],
      ['tarjetas','Tarjetas','<rect x="3.5" y="3.5" width="17" height="11" rx="2"/><path d="M4 18.5h16"/>']
    ].map(([k,l,ic])=>`<button data-layout="${k}" aria-pressed="${ui.layout===k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${l}</button>`).join('')}</div>
    <div class="c-cats" role="group" aria-label="Categorías">${cats.map(c=>`<button data-cat="${esc(c)}" aria-pressed="${c===ui.cat}">${esc(c)}</button>`).join('')}</div>
    <div class="c-list v-${ui.layout}">${!state.products.length?`<p style="color:var(--c-muted);text-align:center;padding:20px 0">El menú todavía no está disponible.</p>`
      :groups.length?groups.map(([c,ps])=>`${ui.cat==='Todo'?`<div class="c-sec">${esc(c)}</div>`:''}${ps.map(ITEM[ui.layout]).join('')}`).join('')
      :`<p style="color:var(--c-muted);text-align:center;padding:20px 0">No encontramos platillos con “${esc(ui.q)}”.</p>`}</div>`;
  document.getElementById('search').oninput=e=>{ui.q=e.target.value;const pos=e.target.selectionStart;renderMenu();const s=document.getElementById('search');s.focus();try{s.setSelectionRange(pos,pos);}catch(_){}};
  pBody.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{ui.cat=b.dataset.cat;renderMenu();});
  pBody.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>{ui.layout=b.dataset.layout;store.set('mesalista-layout',ui.layout);renderMenu();});
  pBody.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openProduct(b.dataset.open));
}
function itemHTML(p){
  const n=inCart(p);
  return `<button class="c-item" data-open="${esc(p.id)}" ${p.available?'':'disabled'} aria-label="${esc(p.name)}">
    ${photoTag(p)}
    <div><h4>${esc(p.name)}</h4><p>${esc(p.desc)}</p><div class="c-price">${money(p.price)}${p.options.length?'<span class="c-tag">Personalizable</span>':''}</div></div>
    ${p.available?`<span class="c-add" aria-hidden="true">+${n?`<span class="n">${n}</span>`:''}</span>`:'<span class="c-out">Agotado</span>'}
  </button>`;
}
const inCart=p=>ui.cart.filter(l=>l.pid===p.id).reduce((s,l)=>s+l.q,0);
/* Vista 2: íconos tipo app, con el nombre abajo */
function iconHTML(p){
  const n=inCart(p);
  return `<button class="c-ico" data-open="${esc(p.id)}" ${p.available?'':'disabled'} aria-label="${esc(p.name)}, ${money(p.price)}">
    ${photoTag(p,'ico-tile')}${n?`<span class="n">${n}</span>`:''}
    <span class="nm">${esc(p.name)}</span><span class="pr">${p.available?money(p.price):'Agotado'}</span>
  </button>`;
}
/* Vista 3: tarjetas con la imagen grande */
function cardHTML(p){
  const n=inCart(p);
  return `<button class="c-card" data-open="${esc(p.id)}" ${p.available?'':'disabled'} aria-label="${esc(p.name)}">
    <div class="card-media">${p.photo?`<img src="${esc(p.photo)}" alt="" loading="lazy">`:`<span aria-hidden="true">${esc(p.emoji)}</span>`}<span class="card-tag">${esc(p.cat)}</span></div>
    <div class="card-body"><h4>${esc(p.name)}</h4><p>${esc(p.desc)}</p>
      <div class="card-foot"><b>${money(p.price)}</b>${p.available?`<span class="c-add" aria-hidden="true">+${n?`<span class="n">${n}</span>`:''}</span>`:'<span class="c-out">Agotado</span>'}</div></div>
  </button>`;
}
const ITEM={lista:itemHTML,iconos:iconHTML,tarjetas:cardHTML};
function renderCartBar(){
  const bar=document.getElementById('cartBar');
  const show=ui.started&&ui.ptab==='menu'&&ui.cart.length&&!ui.sheet;
  bar.classList.toggle('hidden',!show);
  if(!show){bar.innerHTML='';return;}
  const total=ui.cart.reduce((s,l)=>s+l.unit*l.q,0),count=ui.cart.reduce((s,l)=>s+l.q,0);
  bar.innerHTML=`<button class="c-cta" id="openCart"><span><span class="count">${count}</span> Ver mi pedido</span><span>${money(total)}</span></button>`;
  document.getElementById('openCart').onclick=()=>{ui.sheet={type:'cart'};renderClient();};
}

function renderOrders(mine){
  const steps=['Enviado','Confirmado','Preparando','Listo'];
  const idxOf={pendiente:0,confirmado:1,preparando:2,listo:3,entregado:4};
  if(!mine.length){pBody.innerHTML=`<div class="orders"><h4>Mis pedidos</h4><p style="color:var(--c-muted)">Aún no has pedido nada en la mesa ${TABLE}. Elige algo del menú.</p></div>`;return;}
  const valid=mine.filter(o=>!['rechazado','pendiente'].includes(o.status));
  const byAcc={};valid.forEach(o=>byAcc[o.account]=(byAcc[o.account]||0)+orderTotal(o));
  const totalAll=Object.values(byAcc).reduce((a,b)=>a+b,0);
  pBody.innerHTML=`<div class="orders"><h4>Mis pedidos en la mesa ${TABLE}</h4>
    ${mine.slice().reverse().map(o=>{
      const idx=idxOf[o.status]??-1;
      return `<div class="o-card"><div class="o-top"><span>${esc(o.by||o.account)}</span><span class="num">#${o.id}</span></div>
        <div class="o-lines">${o.items.map(i=>`${i.q}× ${esc(i.name)}${i.opts.length?` <span>(${esc(i.opts.join(', '))})</span>`:''}${i.note?`, ${esc(i.note)}`:''}`).join('<br>')}</div>
        ${o.status==='rechazado'?'':`<div class="o-steps">${steps.map((s,i)=>`<div class="${i<idx||o.status==='entregado'?'done':i===idx?'now':''}">${s}</div>`).join('')}</div>`}
        <div class="o-status ${o.status==='rechazado'?'rej':''}">${STATUS_CLIENT[o.status]||''}</div></div>`;
    }).join('')}
    ${valid.length?`<div class="o-bill">${Object.entries(byAcc).map(([a,t])=>`<div><span>Cuenta ${a==='Mesa'?'compartida':'de '+esc(a)}</span><span>${money(t)}</span></div>`).join('')}${Object.keys(byAcc).length>1?`<div><b>Total</b><b>${money(totalAll)}</b></div>`:''}</div>`:''}
  </div>`;
}

/* ---------- Hojas: personalizar producto y carrito ---------- */
function openProduct(pid){ui.sheet={type:'product',pid,sel:{},note:'',q:1};renderClient();setTimeout(()=>{const x=document.querySelector('#sheet .x');if(x)x.focus();},30);}
function unitOf(p,s){return p.price+p.options.reduce((sum,g)=>sum+(s.sel[g.id]||[]).reduce((a,ci)=>a+(+g.choices[ci]?.price||0),0),0);}
function validOf(p,s){return p.options.every(g=>!g.required||(s.sel[g.id]||[]).length);}
function renderSheet(){
  const el=document.getElementById('sheet'),s=ui.sheet;
  if(!s||!ui.started){el.classList.add('hidden');el.innerHTML='';return;}
  if(s.type==='product') return productSheet(el,s);
  if(s.type==='cart') return cartSheet(el);
  if(s.type==='scan') return scanSheet(el);
}
function closeSheet(){if(ui.sending)return;stopScan();document.getElementById('sheet').dataset.kind='';ui.sheet=null;renderClient();}
function productSheet(el,s){
  const p=prod(s.pid);
  if(!p||!p.available){ui.sheet=null;el.classList.add('hidden');return;}
  el.classList.remove('hidden');
  const unit=unitOf(p,s),ok=validOf(p,s);
  const post=ui.layout!=='lista',biz=state.settings;
  el.innerHTML=`<div class="sheet-back" data-close></div>
  <div class="sheet-panel${post?' post':''}" role="dialog" aria-modal="true" aria-label="Personalizar ${esc(p.name)}">${post
    ?`<div class="post-head"><div class="p-logo">${biz.logo?`<img src="${esc(biz.logo)}" alt="">`:'<span aria-hidden="true">🍽️</span>'}</div>
       <div><b>${esc(biz.name)}</b><small>${esc(p.cat)}</small></div><button class="x" data-close aria-label="Cerrar">✕</button></div>`
    :'<div class="grab"></div>'}
    <div class="sheet-body">
      ${post?`<div class="post-media">${p.photo?`<img src="${esc(p.photo)}" alt="${esc(p.name)}">`:`<span aria-hidden="true">${esc(p.emoji)}</span>`}</div>
      <div class="post-title"><h3>${esc(p.name)}</h3><b>${money(p.price)}</b></div>
      ${p.desc?`<p class="post-desc">${esc(p.desc)}</p>`:''}`
      :`${p.photo?`<div class="s-photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}"></div>`:''}
      <div class="s-head">${photoTag(p)}<div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p><b>${money(p.price)}</b></div><button class="x" data-close aria-label="Cerrar">✕</button></div>`}
      ${p.options.map(g=>{const has=(s.sel[g.id]||[]).length>0;
        return `<fieldset class="og"><legend>${esc(g.name)} ${g.required?`<span class="req ${has?'ok':''}">${has?'Listo':'Obligatorio'}</span>`:`<span class="optl">Opcional${g.multi?', elige varias':''}</span>`}</legend>
          <div class="chips">${g.choices.map((c,ci)=>`<button data-g="${esc(g.id)}" data-c="${ci}" aria-pressed="${(s.sel[g.id]||[]).includes(ci)}">${esc(c.name)}${+c.price?`<small>+${money(c.price)}</small>`:''}</button>`).join('')}</div></fieldset>`;}).join('')}
      <label class="field"><span>Especificaciones</span><input class="c-input" style="font-size:14px" id="sheetNote" maxlength="80" value="${esc(s.note)}" placeholder="Sin…, con…, extra de…"></label>
    </div>
    <div class="s-foot">
      <div class="stepper"><button data-sq="-1" aria-label="Menos">−</button><span>${s.q}</span><button data-sq="1" aria-label="Más">+</button></div>
      <button class="c-cta" id="addLine" ${ok?'':'disabled'}><span>${ok?'Agregar':'Elige lo obligatorio'}</span><span>${money(unit*s.q)}</span></button>
    </div></div>`;
  el.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeSheet);
  el.querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>{
    const g=p.options.find(x=>x.id===b.dataset.g),ci=+b.dataset.c,cur=s.sel[g.id]||[];
    if(g.multi) s.sel[g.id]=cur.includes(ci)?cur.filter(x=>x!==ci):[...cur,ci];
    else s.sel[g.id]=(cur[0]===ci&&!g.required)?[]:[ci];
    productSheet(el,s);
  });
  el.querySelectorAll('[data-sq]').forEach(b=>b.onclick=()=>{s.q=Math.min(50,Math.max(1,s.q+ +b.dataset.sq));productSheet(el,s);});
  document.getElementById('sheetNote').oninput=e=>s.note=e.target.value;
  document.getElementById('addLine').onclick=()=>{
    const opts=[];
    p.options.forEach(g=>(s.sel[g.id]||[]).forEach(ci=>{const c=g.choices[ci];opts.push(`${g.multi?'':g.name+': '}${c.name}${+c.price?` (+${money(c.price)})`:''}`);}));
    const sel={};p.options.forEach(g=>{if((s.sel[g.id]||[]).length) sel[g.id]=[...s.sel[g.id]].sort((a,b)=>a-b);});
    const note=s.note.trim(),key=p.id+'|'+JSON.stringify(sel)+'|'+note;
    const ex=ui.cart.find(l=>l.key===key);
    if(ex) ex.q=Math.min(50,ex.q+s.q); else ui.cart.push({key,pid:p.id,name:p.name,emoji:p.emoji,unit:unitOf(p,s),opts,sel,note,q:s.q});
    ui.sheet=null;toast(`${p.name} agregado`);renderClient();
  };
  el.onkeydown=e=>{if(e.key==='Escape')closeSheet();};
}
function cartSheet(el){
  if(!ui.cart.length){ui.sheet=null;el.classList.add('hidden');return;}
  el.classList.remove('hidden');
  const total=ui.cart.reduce((s,l)=>s+l.unit*l.q,0);
  el.innerHTML=`<div class="sheet-back" data-close></div>
  <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Tu pedido"><div class="grab"></div>
    <div class="sheet-body">
      <div class="s-head" style="grid-template-columns:1fr auto"><div><h3>Tu pedido</h3><p>${BROWSE?'Todavía sin mesa':`Mesa ${TABLE}`}</p></div><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <div>${ui.cart.map((l,i)=>`<div class="cl"><div><b>${esc(l.name)}</b><div style="font-size:12.5px;color:var(--c-muted)">${money(l.unit)} c/u</div></div>
        <div class="stepper"><button data-cdec="${i}" aria-label="Quitar uno">−</button><span>${l.q}</span><button data-cinc="${i}" aria-label="Agregar uno">+</button></div>
        ${(l.opts.length||l.note)?`<div class="opts">${esc(l.opts.join(' · '))}${l.note?`${l.opts.length?' · ':''}<em>${esc(l.note)}</em>`:''}</div>`:''}</div>`).join('')}</div>
      <label class="field"><span>¿Cómo te llamas?</span><input class="c-input" id="cName" placeholder="Tu nombre" maxlength="24" autocomplete="given-name" value="${esc(ui.guest)}"></label>
      <div class="field"><span>¿Cómo quieres tu cuenta?</span><div class="c-seg" role="group" aria-label="Tipo de cuenta">
        <button data-acc="mesa" aria-pressed="${ui.accType==='mesa'}"><b>Compartida</b><span>Una cuenta para toda la mesa</span></button>
        <button data-acc="individual" aria-pressed="${ui.accType==='individual'}"><b>Solo la mía</b><span>Pagas solo lo que pides</span></button>
      </div></div>
      <div class="field"><span>¿Comes aquí o es para llevar?</span><div class="c-seg" role="group" aria-label="Comer aquí o para llevar">
        <button data-togo="0" aria-pressed="${!ui.toGo}"><b>Comer aquí</b><span>Te lo llevamos a la mesa</span></button>
        <button data-togo="1" aria-pressed="${ui.toGo}"><b>🥡 Para llevar</b><span>Te lo entregamos empacado</span></button>
      </div></div>
      <label class="field"><span>Comentario para el restaurante (opcional)</span><textarea class="c-text" rows="2" id="gnote" maxlength="200" placeholder="Ej. traer todo junto, es cumpleaños">${esc(ui.gnote)}</textarea></label>
      <div class="field"><span>¿Cómo vas a pagar?</span><div class="pay2" role="group" aria-label="Forma de pago">
        ${[['terminal','📟','Tarjeta (terminal)'],['efectivo','💵','Efectivo']].map(([k,e,t])=>`<button data-pay="${k}" aria-pressed="${ui.pay===k}"><span>${e}</span>${t}</button>`).join('')}
      </div></div>
    </div>
    <div class="s-foot"><button class="c-cta" id="sendBtn" ${ui.sending||(!ui.guest&&!PREVIEW)?'disabled':''}><span>${PREVIEW?'Vista previa':BROWSE?'Escanear el QR de mi mesa':ui.sending?'Enviando…':'Enviar pedido'}</span><span>${money(total)}</span></button>
      <p class="s-hint" id="sendHint">${!ui.guest&&!PREVIEW?'Escribe tu nombre para continuar.':BROWSE?'Tu pedido queda guardado. Al escanear el QR de tu mesa lo envías.':''}</p></div>
  </div>`;
  el.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeSheet);
  el.querySelectorAll('[data-cinc]').forEach(b=>b.onclick=()=>{const l=ui.cart[+b.dataset.cinc];l.q=Math.min(50,l.q+1);cartSheet(el);renderCartBar();});
  el.querySelectorAll('[data-cdec]').forEach(b=>b.onclick=()=>{const i=+b.dataset.cdec;if(--ui.cart[i].q<=0)ui.cart.splice(i,1);if(!ui.cart.length){closeSheet();return;}cartSheet(el);});
  const nameIn=document.getElementById('cName');
  nameIn.oninput=()=>{ui.guest=nameIn.value.trim();store.set('mesalista-guest',ui.guest);
    document.getElementById('sendBtn').disabled=!ui.guest&&!PREVIEW;
    document.getElementById('sendHint').textContent=!ui.guest&&!PREVIEW?'Escribe tu nombre para continuar.':BROWSE?'Tu pedido queda guardado. Al escanear el QR de tu mesa lo envías.':'';};
  el.querySelectorAll('[data-acc]').forEach(b=>b.onclick=()=>{ui.accType=b.dataset.acc;store.set('mesalista-acc',ui.accType);el.querySelectorAll('[data-acc]').forEach(x=>x.setAttribute('aria-pressed',x===b));});
  el.querySelectorAll('[data-togo]').forEach(b=>b.onclick=()=>{ui.toGo=b.dataset.togo==='1';saveCart();el.querySelectorAll('[data-togo]').forEach(x=>x.setAttribute('aria-pressed',x===b));});
  el.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>{ui.pay=b.dataset.pay;el.querySelectorAll('[data-pay]').forEach(x=>x.setAttribute('aria-pressed',x===b));});
  document.getElementById('gnote').oninput=e=>ui.gnote=e.target.value;
  document.getElementById('sendBtn').onclick=BROWSE?()=>{ui.sheet={type:'scan'};renderClient();}:sendOrder;
  el.onkeydown=e=>{if(e.key==='Escape')closeSheet();};
}
async function sendOrder(){
  if(!ui.cart.length||ui.sending) return;
  if(!ui.guest&&!PREVIEW){toast('Escribe tu nombre para enviar el pedido');document.getElementById('cName')?.focus();return;}
  if(PREVIEW){toast('Es una vista previa: aquí no se envían pedidos.');return;}
  ui.sending=true;renderSheet();
  const {data,error}=await sb.rpc('place_order',{
    p_table:TABLE,p_guest:ui.guest,p_individual:ui.accType==='individual',
    p_items:ui.cart.map(l=>({pid:l.pid,q:l.q,sel:l.sel,note:l.note})),
    p_note:(ui.toGo?TOGO_MARK+(ui.gnote.trim()?' · ':''):'')+ui.gnote.trim(),p_pay:ui.pay,p_token:token
  });
  ui.sending=false;
  if(error){toast(errText(error));try{await loadMenu();}catch(e){}render();return;}
  ui.cart=[];ui.gnote='';ui.toGo=false;ui.sheet=null;ui.ptab='orders';
  toast(`Pedido #${data} enviado. Te avisamos cuando el restaurante lo confirme.`);
  await refreshOrders();renderClient();
}

/* ---------- Escanear el QR de la mesa (desde la portada) ---------- */
let scan=null;
function stopScan(){
  if(!scan) return;
  scan.stop=true;cancelAnimationFrame(scan.raf);
  if(scan.stream) scan.stream.getTracks().forEach(t=>t.stop());
  scan=null;
}
function tableUrl(text){
  try{
    const u=new URL(text,location.href),m=u.pathname.match(/\/mesa\/(\d+)/);
    if(u.host!==location.host||!m) return null;
    return u.href;
  }catch(e){return null;}
}
function loadJsQR(){
  if(window.jsQR) return Promise.resolve();
  return new Promise((ok,ko)=>{const sc=document.createElement('script');
    sc.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';sc.onload=ok;sc.onerror=ko;document.head.appendChild(sc);});
}
function scanSheet(el){
  if(el.dataset.kind==='scan') return; // la cámara ya está abierta
  el.dataset.kind='scan';el.classList.remove('hidden');
  el.innerHTML=`<div class="sheet-back" data-close></div>
  <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Escanear el QR de tu mesa"><div class="grab"></div>
    <div class="sheet-body">
      <div class="s-head" style="grid-template-columns:1fr auto"><div><h3>Escanea el QR de tu mesa</h3><p>Apunta la cámara al código pegado en tu mesa.</p></div><button class="x" data-close aria-label="Cerrar">✕</button></div>
      <div class="scan-box"><video id="scanVideo" playsinline muted></video><div class="scan-frame" aria-hidden="true"></div></div>
      <p class="s-hint" id="scanMsg">Abriendo la cámara…</p>
    </div></div>`;
  el.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeSheet);
  el.onkeydown=e=>{if(e.key==='Escape')closeSheet();};
  startScan();
}
async function startScan(){
  stopScan();
  const me=scan={stop:false};
  const msg=t=>{const m=document.getElementById('scanMsg');if(m)m.textContent=t;};
  const video=document.getElementById('scanVideo');
  const fallback='No pudimos abrir la cámara. Usa la cámara de tu celular para escanear el QR de tu mesa: tu pedido sigue guardado.';
  try{
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) throw new Error('sin cámara');
    me.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    if(me.stop){me.stream.getTracks().forEach(t=>t.stop());return;}
    video.srcObject=me.stream;await video.play();
  }catch(e){msg(fallback);return;}
  let detect;
  if('BarcodeDetector' in window){
    try{const bd=new BarcodeDetector({formats:['qr_code']});detect=async()=>{const r=await bd.detect(video);return r[0]&&r[0].rawValue;};}catch(e){}
  }
  if(!detect){
    try{await loadJsQR();}catch(e){msg(fallback);return;}
    const cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true});
    detect=async()=>{const w=video.videoWidth,h=video.videoHeight;if(!w)return null;
      const k=Math.min(1,640/Math.max(w,h));cv.width=w*k|0;cv.height=h*k|0;cx.drawImage(video,0,0,cv.width,cv.height);
      const r=jsQR(cx.getImageData(0,0,cv.width,cv.height).data,cv.width,cv.height);return r&&r.data;};
  }
  if(me.stop) return;
  msg('Buscando el código…');
  let busy=false,warned=false;
  const tick=async()=>{
    if(me.stop) return;
    if(!busy&&video.readyState>=2){
      busy=true;
      try{
        const text=await detect();
        if(text&&!me.stop){
          const url=tableUrl(text);
          if(url){saveCart();msg('¡Listo! Abriendo tu mesa…');stopScan();location.href=url;return;}
          if(!warned){warned=true;msg('Ese código no es de una mesa de este restaurante. Busca el QR pegado en tu mesa.');}
        }
      }catch(e){}
      busy=false;
    }
    me.raf=requestAnimationFrame(tick);
  };
  tick();
}
