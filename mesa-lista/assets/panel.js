/* =========================================================
   Mesa Lista · panel del restaurante (/panel)
   Requiere sesión de una cuenta autorizada (tabla staff).
   ========================================================= */
const sb=makeClient();
const state={settings:settingsFromRow(null),products:[],orders:[]};
const ui={view:store.get('mesalista-view','live'),editing:null,inApp:false,live:false};
const prod=id=>state.products.find(p=>p.id===id);
const $=id=>document.getElementById(id);

/* =========================================================
   Colores del logo (extracción y combinaciones)
   ========================================================= */
const PANTONE=[["186 C","#C8102E"],["485 C","#DA291C"],["032 C","#EF3340"],["1795 C","#D22630"],["200 C","#BA0C2F"],["7621 C","#AB2328"],["Warm Red C","#F9423A"],["172 C","#FA4616"],["021 C","#FE5000"],["165 C","#FF671F"],["151 C","#FF8200"],["1375 C","#FF9E1B"],["1235 C","#FFB81C"],["123 C","#FFC72C"],["7548 C","#FFC600"],["116 C","#FFCD00"],["Yellow C","#FEDD00"],["7406 C","#F1C400"],["7407 C","#CBA052"],["4515 C","#B9975B"],["376 C","#84BD00"],["361 C","#43B02A"],["7741 C","#44883E"],["355 C","#009639"],["348 C","#00843D"],["3415 C","#007749"],["349 C","#046A38"],["3275 C","#00B2A9"],["320 C","#009CA6"],["7711 C","#0097A9"],["299 C","#00A3E0"],["2925 C","#009CDE"],["300 C","#005EB8"],["2728 C","#0047BB"],["286 C","#0033A0"],["2945 C","#004C97"],["281 C","#00205B"],["289 C","#0C2340"],["2685 C","#330072"],["267 C","#5F259F"],["2587 C","#8246AF"],["219 C","#DA1884"],["Rhodamine Red C","#E10098"],["211 C","#F57EB6"],["469 C","#693F23"],["4625 C","#4F2C1D"],["476 C","#4E3629"],["7527 C","#D6D2C4"],["Cool Gray 3 C","#C8C9C7"],["Cool Gray 7 C","#97999B"],["Cool Gray 11 C","#53565A"],["Black C","#2D2926"]];
function nearestPantone(hex){const c=hexToRgb(hex);let best=null,bd=1e9;for(const [n,h] of PANTONE){const d=cdist(c,hexToRgb(h));if(d<bd){bd=d;best=n;}}return best;}
function extractFromCanvas(cv){
  const s=80,r=Math.min(s/cv.width,s/cv.height,1);
  const c=document.createElement('canvas');c.width=Math.max(1,Math.round(cv.width*r));c.height=Math.max(1,Math.round(cv.height*r));
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(cv,0,0,c.width,c.height);
  let d;try{d=x.getImageData(0,0,c.width,c.height).data;}catch(e){return [];}
  const b=new Map();let total=0;
  for(let i=0;i<d.length;i+=4){
    if(d[i+3]<200) continue;
    const l=rgbToHsl([d[i],d[i+1],d[i+2]])[2]; if(l>.94) continue;
    total++;
    const k=(d[i]>>4)<<8|(d[i+1]>>4)<<4|(d[i+2]>>4);
    const e=b.get(k)||{r:0,g:0,b:0,n:0}; e.r+=d[i];e.g+=d[i+1];e.b+=d[i+2];e.n++; b.set(k,e);
  }
  if(!total) return [];
  const arr=[...b.values()].map(e=>({rgb:[e.r/e.n,e.g/e.n,e.b/e.n],n:e.n})).sort((a,b)=>b.n-a.n);
  const out=[];
  for(const e of arr){
    const near=out.find(o=>cdist(o.rgb,e.rgb)<85);
    if(near){near.n+=e.n;continue;}
    if(out.length<6) out.push({...e});
  }
  return out.filter(o=>o.n/total>=.015).sort((a,b)=>b.n-a.n).slice(0,5).map(o=>({hex:rgbToHex(o.rgb),share:o.n/total}));
}
function buildCombos(cols){
  const info=cols.map(c=>{const [h,s,l]=hsl(c.hex);return {...c,h,s,l};});
  const chrom=info.filter(c=>c.s>.2&&c.l>.12&&c.l<.86);
  const P=chrom[0]||info[0]||{hex:'#1F4FA3',h:.6,s:.6,l:.4};
  const p=P.hex;
  const hd=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,1-d);};
  const S=chrom.find(c=>c.hex!==p&&hd(c.h,P.h)>.05)||chrom.find(c=>c.hex!==p);
  const sec=S?S.hex:fromHsl((P.h+.09)%1,clamp(P.s,.45,.85),.55);
  const darkC=info.find(c=>c.l<.22);
  const dark=darkC?darkC.hex:fromHsl(P.h,clamp(P.s*.6,.1,.5),.13);
  const raw=[
    {name:'Fiel al logo',desc:'Encabezado con tu color principal y fondo cálido.',head:p,brand:p,accent:sec,bg:mix(p,'#FFFFFF',.95),surface:'#FFFFFF',ink:'#15171C'},
    {name:'Elegante',desc:'Encabezado oscuro y botones con tu color.',head:dark,brand:p,accent:sec,bg:'#F5F5F3',surface:'#FFFFFF',ink:'#15171C'},
    {name:'Contraste',desc:'Botones con tu segundo color, para que resalten más.',head:sec,brand:dark,accent:p,bg:'#FFFFFF',surface:mix(sec,'#FFFFFF',.94),ink:'#15171C'},
    {name:'Modo noche',desc:'Fondo oscuro, ideal para bares y cenas.',head:mix(dark,'#000000',.35),brand:p,accent:sec,bg:mix(p,'#0E1014',.93),surface:mix(p,'#1A1D24',.9),ink:'#F1F2F4'}
  ];
  return raw.map(t=>({...t,brand:ensureContrast(t.brand,t.surface,3),accent:ensureContrast(t.accent,t.surface,2)}));
}

/* =========================================================
   Acceso
   ========================================================= */
function showLogin(msg){
  $('app').classList.add('hidden');$('login').classList.remove('hidden');
  $('loginErr').textContent=msg||'';
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();
  const btn=$('loginBtn');btn.disabled=true;btn.textContent='Entrando…';$('loginErr').textContent='';
  const {data,error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
  btn.disabled=false;btn.textContent='Entrar';
  if(error){$('loginErr').textContent=/invalid/i.test(error.message)?'Correo o contraseña incorrectos.':errText(error);return;}
  $('password').value='';
  enter(data.session);
};
$('logoutBtn').onclick=async()=>{await sb.auth.signOut();location.reload();};

async function enter(session){
  const {data:ok,error}=await sb.rpc('is_staff');
  if(error){
    if(/permission denied/i.test(error.message)){await sb.auth.signOut();showLogin();return;} // sesión vencida
    showLogin(/Could not find|does not exist|schema cache/i.test(error.message)?'Falta preparar la base de datos (guía, paso 2).':errText(error));
    return;
  }
  if(!ok){
    await sb.auth.signOut();
    showLogin('Esta cuenta no tiene permiso para el panel. Agrega su correo a la lista de personal (guía, paso 2).');
    return;
  }
  ui.inApp=true;
  $('whoAmI').textContent=session.user.email;
  $('login').classList.add('hidden');$('app').classList.remove('hidden');
  applyView();
  await loadAll();
  subscribe();
  keepAwake();
}

/* Modo libre (demos): sin inicio de sesión */
async function enterOpen(){
  ui.inApp=true;
  $('whoAmI').textContent='Acceso libre (sin contraseña)';
  if(!document.querySelector('.demo-bar')) demoBar(KITCHEN?'cocina':'admin');
  $('logoutBtn').classList.add('hidden');
  $('login').classList.add('hidden');$('app').classList.remove('hidden');
  applyView();
  if(!await loadAll()) toast('Falta activar el modo libre en Supabase (código 3-modo-libre.sql).');
  subscribe();
  keepAwake();
}

/* =========================================================
   Datos y tiempo real
   ========================================================= */
const startOfToday=()=>{const d=new Date();d.setHours(0,0,0,0);return d;};
async function loadAll(){
  const since=startOfToday().toISOString();
  const [s,p,o]=await Promise.all([
    sb.from('settings').select('*').eq('id',1).maybeSingle(),
    sb.from('products').select('*'),
    sb.from('orders').select('*').or(`closed.eq.false,created_at.gte."${since}"`).order('id')
  ]);
  const err=s.error||p.error||o.error;
  if(err){toast(errText(err));return false;}
  state.settings=settingsFromRow(s.data);
  state.products=p.data.map(productFromRow).sort(byMenuOrder);
  const fresh=new Set(state.orders.filter(x=>x.fresh).map(x=>x.id));
  state.orders=o.data.map(orderFromRow).map(x=>fresh.has(x.id)?{...x,fresh:true}:x);
  qrKey='';render();
  return true;
}

let channel=null,everLive=false;
function subscribe(){
  if(channel) sb.removeChannel(channel);
  const ch=channel=sb.channel('panel')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},onOrder)
    .on('postgres_changes',{event:'*',schema:'public',table:'products'},onProduct)
    .on('postgres_changes',{event:'*',schema:'public',table:'settings'},onSettings)
    .subscribe(status=>{
      if(ch!==channel) return;
      const live=status==='SUBSCRIBED';
      // Al reconectar, recargamos por si se perdió algo mientras no había señal
      if(live&&everLive&&!ui.live) loadAll();
      if(live) everLive=true;
      ui.live=live;setSync();
    });
}
function setSync(){
  $('syncState').textContent=ui.live?'En vivo':'Reconectando…';
  $('syncState').parentElement.classList.toggle('off',!ui.live);
}
// Red de seguridad: si se cae el tiempo real, recargamos cada 15 s
setInterval(()=>{if(ui.inApp&&!ui.live&&!document.hidden) loadAll();},15000);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!ui.inApp) return;
  loadAll();keepAwake();
  if(!ui.live) subscribe();
});

function onOrder(ev){
  if(ev.eventType==='DELETE'){state.orders=state.orders.filter(o=>o.id!==Number(ev.old.id));render();return;}
  const o=orderFromRow(ev.new),i=state.orders.findIndex(x=>x.id===o.id),prev=state.orders[i];
  if(i<0){
    o.fresh=true;state.orders.push(o);state.orders.sort((a,b)=>a.id-b.id);
    if(o.status==='pendiente'){toast(`Nuevo pedido de la mesa ${o.table}`);if(['live','caja'].includes(ui.view)) beep();}
  }else{
    state.orders[i]=o;
    if(prev.status!=='confirmado'&&o.status==='confirmado'&&ui.view==='cocina') beep();
  }
  render();
}
function onProduct(ev){
  if(ev.eventType==='DELETE') state.products=state.products.filter(p=>p.id!==ev.old.id);
  else{const p=productFromRow(ev.new),i=state.products.findIndex(x=>x.id===p.id);if(i<0)state.products.push(p);else state.products[i]=p;state.products.sort(byMenuOrder);}
  render();
}
function onSettings(ev){if(ev.new&&ev.new.id===1){state.settings=settingsFromRow(ev.new);qrKey='';render();}}

/* Guardado */
async function updateOrders(match,patch,okMsg){
  const touched=state.orders.filter(match),before=touched.map(o=>({...o}));
  touched.forEach(o=>Object.assign(o,patch.local));render();
  let q=sb.from('orders').update(patch.db);
  for(const [k,v] of Object.entries(patch.where)) q=q.eq(k,v);
  const {error}=await q;
  if(error){touched.forEach((o,i)=>Object.assign(o,before[i]));render();toast(errText(error));}
  else if(okMsg) toast(okMsg);
}
async function saveProduct(p){
  const {error}=await sb.from('products').upsert(productToRow(p));
  if(error){toast(errText(error));loadAll();}
}
async function saveSettings(patch){
  const {error}=await sb.from('settings').update({...patch,updated_at:new Date().toISOString()}).eq('id',1);
  if(error){toast(errText(error));loadAll();}
}

/* Sonido y pantalla encendida */
let actx;
function beep(){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended') actx.resume();
    const t=actx.currentTime;
    [[880,0],[1175,.18]].forEach(([f,d])=>{
      const o=actx.createOscillator(),g=actx.createGain();
      o.frequency.value=f;g.gain.setValueAtTime(.0001,t+d);g.gain.exponentialRampToValueAtTime(.35,t+d+.02);g.gain.exponentialRampToValueAtTime(.0001,t+d+.35);
      o.connect(g).connect(actx.destination);o.start(t+d);o.stop(t+d+.4);
    });
  }catch(e){}
}
document.addEventListener('pointerdown',()=>{try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();actx.resume();}catch(e){}},{once:true});
async function keepAwake(){try{if('wakeLock' in navigator&&!document.hidden) await navigator.wakeLock.request('screen');}catch(e){}}

/* =========================================================
   Tema
   ========================================================= */
function applyTheme(){
  const s=state.settings,t=s.theme,root=document.documentElement.style;
  const brandL=ensureContrast(t.brand,'#FFFFFF',3);
  root.setProperty('--brand',brandL);
  root.setProperty('--brand-ink',bestInk(brandL));
  root.setProperty('--brand-text',ensureContrast(t.brand,'#FFFFFF',4.5));
  root.setProperty('--brand-text-d',ensureContrast(t.brand,'#151820',4.5));
  root.setProperty('--brand-soft',rgba(brandL,.12));
  root.setProperty('--accent',t.accent);
  const logoHTML=s.logo?`<img src="${esc(s.logo)}" alt="">`:`<span style="font-size:20px">🍽️</span>`;
  $('sideLogo').innerHTML=logoHTML;$('loginLogo').innerHTML=logoHTML;
  $('sideName').textContent=s.name;$('loginName').textContent=s.name;
  postPreview();
}
function postPreview(){
  const f=$('previewFrame');
  try{f.contentWindow.postMessage({type:'mesalista-theme',settings:{theme:state.settings.theme,name:state.settings.name,logo:state.settings.logo}},location.origin);}catch(e){}
}
$('previewFrame').addEventListener('load',postPreview);

/* =========================================================
   Navegación
   ========================================================= */
const PAGES={
  live:["En vivo","Las tres pantallas sincronizadas: cliente, caja y cocina."],
  cliente:["Vista cliente","Lo que ve el comensal al escanear el QR de su mesa. Los pedidos que hagas aquí son reales."],
  caja:["Caja","Confirma pedidos, revisa mesas y cobra."],
  cocina:["Cocina","Pantalla para la cocina con los pedidos confirmados."],
  menu:["Menú y opciones","Edita productos y agrega opciones solo a los que las necesitan."],
  marca:["Marca y colores","Sube tu logo y la plataforma toma tus colores."],
  qr:["Códigos QR","Los códigos de tus mesas, listos para imprimir."]
};
/* Modo cocina: solo la pantalla de cocina, a pantalla completa (panel?modo=cocina) */
const KITCHEN=new URLSearchParams(location.search).get('modo')==='cocina';
if(KITCHEN){ui.view='cocina';document.body.classList.add('modo-cocina');}
if(!PAGES[ui.view]) ui.view='live';
document.querySelectorAll('.nav [data-view]').forEach(b=>b.onclick=()=>{ui.view=b.dataset.view;if(!KITCHEN)store.set('mesalista-view',ui.view);applyView();});
function applyView(){
  const v=ui.view;
  document.querySelectorAll('.nav [data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===v));
  $('pageTitle').textContent=PAGES[v][0];
  $('pageDesc').textContent=PAGES[v][1];
  $('views').classList.toggle('live',v==='live');
  const show={live:['cliente','caja','cocina'],cliente:['cliente'],caja:['caja'],cocina:['cocina'],menu:['menu'],marca:['marca'],qr:['qr']}[v];
  ['cliente','caja','cocina','menu','marca','qr'].forEach(s=>$('v-'+s).classList.toggle('hidden',!show.includes(s)));
  document.querySelectorAll('.live-only').forEach(e=>e.classList.toggle('hidden',v!=='live'));
  if(show.includes('cliente')) loadClientFrame();
}

/* Celular del cliente: carga el menú real de la mesa elegida */
function renderTableSelect(){
  const sel=$('liveTable'),n=state.settings.tables;
  if(sel.options.length===n) return;
  const cur=Math.min(+sel.value||+store.get('mesalista-livetable',1)||1,n);
  sel.innerHTML=Array.from({length:n},(_,k)=>`<option value="${k+1}">Mesa ${k+1}</option>`).join('');
  sel.value=cur;
}
function loadClientFrame(){
  if(!ui.inApp) return;
  renderTableSelect();
  const src=mesaPath($('liveTable').value),f=$('clientFrame');
  if(f.getAttribute('src')!==src) f.setAttribute('src',src);
}
$('liveTable').onchange=e=>{store.set('mesalista-livetable',+e.target.value);loadClientFrame();
  window.scrollTo({top:0});
}

/* =========================================================
   Caja
   ========================================================= */
function linesHTML(o){
  return `<ul class="lines">${o.items.map(i=>`<li><span class="q">${i.q}×</span><span>${esc(i.name)}</span><span class="num small">${money(i.unit*i.q)}</span>
    ${i.opts.length?`<span class="o">${esc(i.opts.join(' · '))}</span>`:''}${i.note?`<span class="nt">↳ ${esc(i.note)}</span>`:''}</li>`).join('')}</ul>`;
}
function renderCaja(){
  const pend=state.orders.filter(o=>o.status==='pendiente'&&!o.closed);
  const list=$('pendingList');
  list.innerHTML=pend.length?pend.map(o=>`<div class="ord ${o.fresh?'fresh':''}">
      <div class="ord-top"><span class="mesa">Mesa ${o.table}</span>${o.toGo?'<span class="pill togo">🥡 Para llevar</span>':''}<span class="pill pendiente">Por confirmar</span><span class="t"><span class="num">#${o.id}</span>, hace ${ago(o.createdAt)}</span></div>
      <div class="ord-who">Pidió <b>${esc(o.by||o.account)}</b>, ${o.account==='Mesa'?'cuenta compartida':'cuenta propia'}, ${PAY_LABEL[o.pay]||esc(o.pay)}</div>
      ${linesHTML(o)}${o.note?`<div class="gnote">📝 ${esc(o.note)}</div>`:''}
      <div class="ord-foot"><b>${money(orderTotal(o))}</b><button class="btn btn-danger btn-sm" data-reject="${o.id}">Rechazar</button><button class="btn btn-ok btn-sm" data-confirm="${o.id}">Confirmar y enviar a cocina</button></div>
    </div>`).join(''):`<div class="empty">No hay pedidos por confirmar. Los nuevos aparecen aquí al instante.</div>`;
  state.orders.forEach(o=>delete o.fresh);
  list.querySelectorAll('[data-confirm]').forEach(b=>b.onclick=()=>{const id=+b.dataset.confirm;
    updateOrders(o=>o.id===id,{local:{status:'confirmado',confirmedAt:Date.now()},db:{status:'confirmado'},where:{id,status:'pendiente'}},`Pedido #${id} confirmado y enviado a cocina`);});
  list.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>{const id=+b.dataset.reject;
    updateOrders(o=>o.id===id,{local:{status:'rechazado'},db:{status:'rechazado'},where:{id}},`Pedido #${id} rechazado`);});

  const grid=$('tablesGrid');let open=0;
  grid.innerHTML=Array.from({length:state.settings.tables},(_,k)=>k+1).map(t=>{
    const os=state.orders.filter(o=>o.table===t&&!o.closed&&o.status!=='rechazado');
    if(!os.length) return `<div class="tbl"><strong>Mesa ${t}</strong><span class="muted">Libre</span></div>`;
    open++;
    const accs=[...new Set(os.map(o=>o.account))];
    const total=os.filter(o=>o.status!=='pendiente').reduce((s,o)=>s+orderTotal(o),0);
    const unpaid=os.filter(o=>!o.paid&&o.status!=='pendiente').reduce((s,o)=>s+orderTotal(o),0);
    const done=os.every(o=>o.status==='entregado');
    return `<div class="tbl busy"><strong>Mesa ${t}</strong><span class="amt">${money(total)}</span>
      <span class="muted">${accs.length>1?accs.length+' cuentas: '+esc(accs.map(a=>a==='Mesa'?'compartida':a).join(', ')):accs[0]==='Mesa'?'Cuenta compartida':'Cuenta de '+esc(accs[0])}</span>
      <span class="muted">${unpaid?'Por cobrar '+money(unpaid):'Todo pagado'}</span>
      ${done?`<button class="btn btn-brand btn-sm" data-close="${t}">Cobrar y liberar</button>`:''}</div>`;
  }).join('');
  grid.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{const t=+b.dataset.close;
    updateOrders(o=>o.table===t&&!o.closed,{local:{closed:true,paid:true},db:{closed:true,paid:true},where:{table_no:t,closed:false}},`Mesa ${t} cobrada y liberada`);});

  const cook=state.orders.filter(o=>!o.closed&&['confirmado','preparando'].includes(o.status)).length;
  const today=+startOfToday();
  const venta=state.orders.filter(o=>o.createdAt>=today&&!['pendiente','rechazado'].includes(o.status)).reduce((s,o)=>s+orderTotal(o),0);
  $('kPend').textContent=pend.length;
  $('kCook').textContent=cook;
  $('kMesas').textContent=open;
  $('kVenta').textContent=money(venta);
  $('bCaja').textContent=pend.length||'';
  document.title=(pend.length?`(${pend.length}) `:'')+`Panel · ${state.settings.name}`;
}

/* =========================================================
   Cocina
   ========================================================= */
function renderCocina(){
  const col=(status,el,cnt,cls,btn,next)=>{
    const os=state.orders.filter(o=>o.status===status&&!o.closed).sort((a,b)=>(a.confirmedAt||a.createdAt)-(b.confirmedAt||b.createdAt));
    $(cnt).textContent=os.length||'';
    $(el).innerHTML=os.length?os.map(o=>{
      const since=o.confirmedAt||o.createdAt;
      const late=(Date.now()-since)>=15*60000&&status!=='listo';
      return `<div class="ticket ${cls}">
        <div class="top"><span class="mesa">Mesa ${o.table}${o.toGo?' <span class="pill togo">🥡 Para llevar</span>':''}</span><span class="timer ${late?'late':''}" data-since="${since}">${clock(since)}</span></div>
        <div class="who"><span class="num">#${o.id}</span>, ${esc(o.by||o.account)}</div>
        <ul>${o.items.map(i=>`<li><b>${i.q}×</b>${esc(i.name)}${i.opts.length?`<span class="o">${esc(i.opts.join(' · '))}</span>`:''}${i.note?`<span class="nt">↳ ${esc(i.note)}</span>`:''}</li>`).join('')}</ul>
        ${o.note?`<div class="gnote">📝 ${esc(o.note)}</div>`:''}
        <button class="btn" data-move="${o.id}" data-next="${next}">${btn}</button></div>`;
    }).join(''):`<div class="kempty">${status==='confirmado'?'Sin pedidos nuevos':status==='preparando'?'Nada en preparación':'Nada esperando entrega'}</div>`;
  };
  col('confirmado','kNew','cNew','','Empezar a preparar','preparando');
  col('preparando','kPrep','cPrep','prep','Marcar como listo','listo');
  col('listo','kReady','cReady','ready','Entregado en mesa','entregado');
  document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{
    const id=+b.dataset.move,next=b.dataset.next,o=state.orders.find(x=>x.id===id);
    const msg=next==='listo'?`Mesa ${o.table}: pedido #${id} listo`:next==='entregado'?`Pedido #${id} entregado`:`Preparando pedido #${id}`;
    updateOrders(x=>x.id===id,{local:{status:next},db:{status:next},where:{id}},msg);
  });
  $('bCocina').textContent=state.orders.filter(o=>o.status==='confirmado'&&!o.closed).length||'';
}
setInterval(()=>document.querySelectorAll('[data-since]').forEach(el=>{el.textContent=clock(+el.dataset.since);if(!el.closest('.ready'))el.classList.toggle('late',Date.now()-el.dataset.since>=15*60000);}),1000);

/* =========================================================
   Menú (editor)
   ========================================================= */
const G=(name,required,multi,choices)=>({id:uid('g'),name,required,multi,choices:choices.map(c=>Array.isArray(c)?{name:c[0],price:c[1]}:{name:c,price:0})});
const PRESETS={
  "Término de carne":()=>G("Término",true,false,["Término medio","Tres cuartos","Bien cocido"]),
  "Tipo de leche":()=>G("Leche",false,false,["Entera","Deslactosada",["Almendra",10],["Avena",10]]),
  "Salsa":()=>G("Salsa",true,false,["Verde","Roja"]),
  "Extras":()=>G("Extras",false,true,[["Extra queso",20],["Aguacate",25]]),
  "Tortilla":()=>G("Tortilla",true,false,["Maíz","Harina"])
};
const menuAdmin=$('menuAdmin');
function renderMenuAdmin(){
  const ci=$('catsInput');if(document.activeElement!==ci) ci.value=state.settings.categories.join(', ');
  const groups=groupByCategory(state.settings.categories,state.products);
  menuAdmin.innerHTML=(groups.length?'':`<div class="empty">Tu menú está vacío. Agrega tu primer producto.</div>`)+groups.map(([cat,ps])=>
    `<h4 style="margin:16px 0 8px;font-size:13px;color:var(--muted);font-weight:600">${esc(cat)}</h4>`+ps.map(p=>{
      const open=ui.editing===p.id;
      return `<div class="prod ${open?'open':''}"><div class="prod-main">
          ${photoTag(p,'tile2')}
          <div class="info"><b>${esc(p.name)}</b><span>${money(p.price)}${p.options.length?`, opciones: ${esc(p.options.map(g=>g.name).join(', '))}`:', sin opciones'}</span></div>
          <input type="checkbox" class="toggle" data-act="avail" data-p="${esc(p.id)}" ${p.available?'checked':''} aria-label="Disponible: ${esc(p.name)}" title="${p.available?'Disponible':'Agotado'}">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-p="${esc(p.id)}">${open?'Cerrar':'Editar'}</button>
        </div>${open?editorHTML(p):''}</div>`;
    }).join('')).join('')+`<button class="btn btn-dashed" data-act="newprod" style="margin-top:12px">+ Agregar producto</button>`;
}
function editorHTML(p){
  const cats=state.settings.categories.includes(p.cat)?state.settings.categories:[p.cat,...state.settings.categories];
  const id=esc(p.id);
  return `<div class="editor">
    <div class="fields">
      <label class="f"><span>Nombre</span><input class="inp" data-fk="pn-${id}" data-field="name" data-p="${id}" value="${esc(p.name)}" maxlength="60"></label>
      <label class="f"><span>Precio</span><div class="pin"><span>$</span><input class="inp" type="number" min="0" step="0.5" data-fk="pp-${id}" data-field="price" data-p="${id}" value="${p.price}"></div></label>
      <label class="f"><span>Categoría</span><select class="inp" data-field="cat" data-p="${id}">${cats.map(c=>`<option value="${esc(c)}" ${c===p.cat?'selected':''}>${esc(c||'Sin categoría')}</option>`).join('')}</select></label>
      <label class="f"><span>Ícono</span><input class="inp" data-fk="pe-${id}" data-field="emoji" data-p="${id}" value="${esc(p.emoji)}" maxlength="4"></label>
      <label class="f wide"><span>Descripción</span><input class="inp" data-fk="pd-${id}" data-field="desc" data-p="${id}" value="${esc(p.desc)}" maxlength="120"></label>
      <div class="f wide"><span>Foto</span><div class="photo-row">${photoTag(p,'photo-prev')}
        ${HAS_PHOTO?`<div class="photo-btns"><button class="btn btn-ghost btn-sm" data-act="photo" data-p="${id}">${p.photo?'Cambiar foto':'Subir foto'}</button>
          ${p.photo?`<button class="btn btn-ghost btn-sm" data-act="nophoto" data-p="${id}">Quitar foto</button>`:''}
          <span class="muted small">Si no subes foto se usa el ícono. Al subirla eliges qué parte se ve.</span></div>`
        :`<span class="muted small">Para usar fotos, primero corre el archivo <b>5-fotos.sql</b> en Supabase (una sola vez). Mientras, se usa el ícono.</span>`}</div></div>
      <label class="f wide"><span>Video (opcional)</span>${HAS_VIDEO
        ?`<input class="inp" data-fk="pv-${id}" data-field="video" data-p="${id}" value="${esc(p.video)}" placeholder="Link del video .mp4, ej. https://jefeshub.com/mesa-lista/videos/latte.mp4">
          <span class="muted small">Se reproduce solo, sin sonido y en loop, al abrir el platillo. Usa clips cortos (5 a 8 segundos, menos de 2 MB).</span>`
        :`<span class="muted small">Para usar videos, primero corre el archivo <b>6-videos.sql</b> en Supabase (una sola vez).</span>`}</label>
    </div>
    <div><h4>Opciones de este producto</h4>${p.options.length?'':`<p class="muted small" style="margin:4px 0 0">Sin opciones. Agrega solo si el cliente debe elegir algo.</p>`}</div>
    ${p.options.map(g=>{const gid=esc(g.id);return `<div class="og-edit">
      <div class="og-top">
        <input class="inp" type="text" data-fk="gn-${gid}" data-gfield="name" data-p="${id}" data-g="${gid}" value="${esc(g.name)}" aria-label="Nombre del grupo" placeholder="Ej. Término">
        <label class="chk"><input type="checkbox" data-gfield="required" data-p="${id}" data-g="${gid}" ${g.required?'checked':''}> Obligatorio</label>
        <label class="chk"><input type="checkbox" data-gfield="multi" data-p="${id}" data-g="${gid}" ${g.multi?'checked':''}> Puede elegir varias</label>
        <button class="del" data-act="delgroup" data-p="${id}" data-g="${gid}" aria-label="Eliminar grupo"><svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
      </div>
      ${g.choices.map((c,ci)=>`<div class="choice">
        <input class="inp" type="text" data-fk="cn-${gid}-${ci}" data-cfield="name" data-p="${id}" data-g="${gid}" data-c="${ci}" value="${esc(c.name)}" placeholder="Nombre de la opción" aria-label="Opción">
        <div class="pin"><span>+$</span><input class="inp" type="number" min="0" data-fk="cp-${gid}-${ci}" data-cfield="price" data-p="${id}" data-g="${gid}" data-c="${ci}" value="${+c.price||0}" aria-label="Costo extra"></div>
        <button class="del" data-act="delchoice" data-p="${id}" data-g="${gid}" data-c="${ci}" aria-label="Quitar opción">✕</button></div>`).join('')}
      <button class="btn btn-dashed btn-sm" data-act="addchoice" data-p="${id}" data-g="${gid}" style="justify-self:start">+ Agregar opción</button>
    </div>`;}).join('')}
    <div class="presets"><button class="btn btn-dashed btn-sm" data-act="addgroup" data-p="${id}">+ Grupo en blanco</button><span class="muted small">o usa una plantilla:</span>
      ${Object.keys(PRESETS).map(k=>`<button class="btn btn-ghost btn-sm" data-act="preset" data-k="${k}" data-p="${id}">${k}</button>`).join('')}</div>
    <button class="danger-link" data-act="delprod" data-p="${id}">Eliminar producto</button>
  </div>`;
}
menuAdmin.onclick=async e=>{
  const b=e.target.closest('[data-act]'); if(!b||b.dataset.act==='avail') return;
  const p=prod(b.dataset.p),g=p&&p.options.find(x=>x.id===b.dataset.g);
  switch(b.dataset.act){
    case 'edit': ui.editing=ui.editing===p.id?null:p.id; renderMenuAdmin(); return;
    case 'photo': {
      const photo=await pickPhoto(); if(!photo) return;
      p.photo=photo; toast('Foto guardada'); break;
    }
    case 'nophoto': p.photo=''; toast('Foto quitada, se usa el ícono'); break;
    case 'addgroup': p.options.push(G('Nuevo grupo',false,false,['Opción 1'])); break;
    case 'preset': p.options.push(PRESETS[b.dataset.k]()); toast(`Plantilla "${b.dataset.k}" agregada`); break;
    case 'delgroup': p.options=p.options.filter(x=>x!==g); break;
    case 'addchoice': g.choices.push({name:'',price:0}); break;
    case 'delchoice': g.choices.splice(+b.dataset.c,1); break;
    case 'delprod': {
      if(!confirm(`¿Eliminar "${p.name}" del menú?`)) return;
      state.products=state.products.filter(x=>x!==p); ui.editing=null; render();
      const {error}=await sb.from('products').delete().eq('id',p.id);
      if(error){toast(errText(error));loadAll();} else toast('Producto eliminado');
      return;
    }
    case 'newprod': {
      const np={id:uid('p'),cat:state.settings.categories[0]||'',name:'Nuevo producto',desc:'',price:0,emoji:'🍽️',available:true,options:[],
        sort:Math.max(0,...state.products.map(x=>x.sort||0))+1,created:new Date().toISOString()};
      state.products.push(np);ui.editing=np.id;render();saveProduct(np);return;
    }
  }
  render();saveProduct(p);
};
menuAdmin.onchange=e=>{
  const el=e.target,p=prod(el.dataset.p); if(!p) return;
  if(el.dataset.act==='avail'){p.available=el.checked;toast(el.checked?`${p.name} disponible`:`${p.name} marcado como agotado`);}
  else if(el.dataset.field){p[el.dataset.field]=el.dataset.field==='price'?Math.max(0,+el.value||0):el.value;}
  else if(el.dataset.gfield){const g=p.options.find(x=>x.id===el.dataset.g);g[el.dataset.gfield]=el.type==='checkbox'?el.checked:el.value;}
  else if(el.dataset.cfield){const g=p.options.find(x=>x.id===el.dataset.g),c=g.choices[+el.dataset.c];c[el.dataset.cfield]=el.dataset.cfield==='price'?Math.max(0,+el.value||0):el.value;}
  else return;
  render();saveProduct(p);
};
$('catsInput').onchange=e=>{
  const cats=[...new Set(e.target.value.split(',').map(s=>s.trim()).filter(Boolean))];
  state.settings.categories=cats;render();saveSettings({categories:cats});toast('Categorías guardadas');
};

/* =========================================================
   Marca y colores
   ========================================================= */
const logoInput=$('logoInput'),dropZone=$('dropZone');
$('uploadBtn').onclick=()=>logoInput.click();
dropZone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();logoInput.click();}};
logoInput.onchange=()=>{if(logoInput.files[0]) loadLogoFile(logoInput.files[0]);logoInput.value='';};
['dragenter','dragover'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('over');}));
['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove('over');}));
dropZone.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f) loadLogoFile(f);});
$('nameInput').onchange=e=>{state.settings.name=e.target.value.trim()||'Mi restaurante';render();saveSettings({name:state.settings.name});};
$('resetThemeBtn').onclick=()=>{
  state.settings.theme={...DEFAULT_THEME};state.settings.applied=-1;render();
  saveSettings({theme:state.settings.theme,applied:-1});toast('Colores originales restaurados');
};
function loadLogoFile(file){
  if(!file.type.startsWith('image/')){toast('Ese archivo no es una imagen. Sube PNG, JPG o SVG.');return;}
  const fr=new FileReader();
  fr.onload=()=>{const img=new Image();img.onload=()=>{
    const w=img.naturalWidth||256,h=img.naturalHeight||256,r=Math.min(256/w,256/h,1);
    const cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(w*r));cv.height=Math.max(1,Math.round(h*r));
    cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
    let data;try{data=cv.toDataURL('image/png');}catch(e){toast('No pudimos leer esa imagen. Prueba con otro archivo.');return;}
    useLogo(cv,data);
  };img.onerror=()=>toast('No pudimos leer esa imagen. Prueba con otro archivo.');img.src=fr.result;};
  fr.readAsDataURL(file);
}
function useLogo(cv,dataUrl){
  const cols=extractFromCanvas(cv);
  if(!cols.length){toast('No encontramos colores en el logo. Prueba con una versión a color.');return;}
  const combos=buildCombos(cols),s=state.settings;
  Object.assign(s,{logo:dataUrl,colors:cols,combos,applied:0,theme:{...combos[0]}});
  toast(`Detectamos ${cols.length} colores y aplicamos “${combos[0].name}”`);
  render();saveSettings({logo:s.logo,colors:s.colors,combos:s.combos,applied:0,theme:s.theme});
}
function renderMarca(){
  const b=state.settings;
  dropZone.querySelector('img')?.remove();
  dropZone.querySelector('span').classList.toggle('hidden',!!b.logo);
  if(b.logo){const im=document.createElement('img');im.src=b.logo;im.alt='Logo del restaurante';dropZone.prepend(im);}
  const ni=$('nameInput'); if(document.activeElement!==ni) ni.value=b.name;

  $('swatches').innerHTML=b.colors.length?b.colors.map(c=>`<button class="sw" data-copy="${c.hex}" title="Copiar ${c.hex}">
      <div class="chip" style="background:${c.hex}"></div><div class="t"><b>${c.hex}</b><span>Pantone ${nearestPantone(c.hex)} aprox.</span><span>${Math.round(c.share*100)}% del logo</span></div></button>`).join('')
    :`<div class="empty" style="grid-column:1/-1">Sube tu logo para ver tus colores aquí.</div>`;
  document.querySelectorAll('[data-copy]').forEach(x=>x.onclick=()=>{try{navigator.clipboard.writeText(x.dataset.copy);toast(`${x.dataset.copy} copiado`);}catch(e){toast(x.dataset.copy);}});

  $('combos').innerHTML=b.combos.length?b.combos.map((t,i)=>{const d=deriveTheme(t);
    return `<button class="combo" data-combo="${i}" aria-pressed="${b.applied===i}">
      <div class="mini" style="background:${d.bg}">
        <div class="mh" style="background:${d.head};color:${d.headInk}"><i></i>${esc(b.name)}</div>
        <div class="mb">${[0,1].map(()=>`<div class="mr" style="background:${d.surface}"><i style="background:${d.tile}"></i><em style="background:${d.ink}"></em></div>`).join('')}
          <div class="mbtn" style="background:${d.brand};color:${d.brandInk}">Ver mi pedido</div></div>
      </div><div><b>${esc(t.name)}</b><br><span>${esc(t.desc)}</span></div></button>`;}).join('')
    :`<div class="empty" style="grid-column:1/-1">Aparecerán aquí cuando subas tu logo.</div>`;
  document.querySelectorAll('[data-combo]').forEach(x=>x.onclick=()=>{const i=+x.dataset.combo;
    state.settings.applied=i;state.settings.theme={...state.settings.combos[i]};
    toast(`Combinación “${state.settings.combos[i].name}” aplicada`);render();
    saveSettings({applied:i,theme:state.settings.theme});});

  const t=b.theme;
  const fields=[['head','Encabezado'],['brand','Botones'],['accent','Acento'],['bg','Fondo'],['surface','Tarjetas'],['ink','Texto']];
  $('tune').innerHTML=fields.map(([k,l])=>`<label><input type="color" data-tune="${k}" value="${t[k]}"><span>${l}<small>${t[k].toUpperCase()}</small></span></label>`).join('');
  document.querySelectorAll('[data-tune]').forEach(inp=>{
    inp.oninput=()=>{state.settings.theme[inp.dataset.tune]=inp.value.toUpperCase();state.settings.applied=-1;applyTheme();inp.nextElementSibling.querySelector('small').textContent=inp.value.toUpperCase();updateCheck();};
    inp.onchange=()=>saveSettings({theme:state.settings.theme,applied:-1});
  });
  updateCheck();
}
function updateCheck(){
  const d=deriveTheme(state.settings.theme);
  const r1=contrast(d.brand,d.brandInk),r2=contrast(d.ink,d.bg),r3=contrast(d.head,d.headInk);
  const tag=r=>r>=4.5?`<b>Muy legible</b>`:r>=3?`<b>Legible</b>`:`<b class="bad">Difícil de leer</b>`;
  $('contrastCheck').innerHTML=`Botones: ${tag(r1)}&nbsp;&nbsp; Texto: ${tag(r2)}&nbsp;&nbsp; Encabezado: ${tag(r3)}`;
}

/* =========================================================
   QR (apuntan a este mismo dominio: https://tudominio.com/mesa-lista/mesa/N/)
   ========================================================= */
let qrKey='';
function renderQRs(){
  const s=state.settings,t=s.theme;
  const ti=$('tablesInput');if(document.activeElement!==ti) ti.value=s.tables;
  const dark=ensureContrast(t.head===t.brand?t.brand:t.head,'#FFFFFF',5);
  const key=[dark,s.tables,s.name,location.origin].join('|');
  if(qrKey===key) return; qrKey=key;
  $('qrGrid').innerHTML=Array.from({length:s.tables},(_,k)=>k+1).map(n=>{
    const url=`${location.origin}${mesaPath(n)}`;
    let svg='';
    try{const q=qrcode(0,'M');q.addData(url);q.make();svg=q.createSvgTag(4,2).replace(/fill="black"/g,`fill="${dark}"`).replace(/fill="#000000"/g,`fill="${dark}"`);}catch(e){svg='<span>QR</span>';}
    return `<a class="qr" href="${url}" target="_blank" rel="noopener" aria-label="Abrir el menú de la mesa ${n}">${svg}<strong>Mesa ${n}</strong><span class="qr-name">${esc(s.name)} · Escanea para pedir</span><small>${esc(url.replace(/^https?:\/\//,''))}</small></a>`;
  }).join('');
}
$('tablesInput').onchange=e=>{
  const n=Math.min(MAX_TABLES,Math.max(1,parseInt(e.target.value,10)||1));
  state.settings.tables=n;render();saveSettings({tables_count:n});toast(`Ahora tienes ${n} mesas`);
};
$('printBtn').onclick=()=>window.print();

/* =========================================================
   Pintar todo y arrancar
   ========================================================= */
function render(){
  // Conservamos lo que la persona está escribiendo aunque llegue un cambio en vivo
  const a=document.activeElement,fk=a&&a.dataset?a.dataset.fk:null;
  let pos=null,val=null;try{pos=fk?a.selectionStart:null;val=fk?a.value:null;}catch(e){}
  applyTheme();renderTableSelect();renderCaja();renderCocina();renderMenuAdmin();renderMarca();renderQRs();
  if(fk){const el=document.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if(el&&el!==document.activeElement){if(val!=null)el.value=val;el.focus();try{if(pos!=null)el.setSelectionRange(pos,pos);}catch(e){}}}
}

(async()=>{
  if(!sb){document.body.innerHTML=setupMessage();return;}
  // Nombre y logo en la pantalla de acceso (son públicos)
  sb.from('settings').select('name,logo,theme').eq('id',1).maybeSingle().then(({data})=>{
    if(data&&!ui.inApp){state.settings=settingsFromRow(data);applyTheme();}
  });
  if(CFG.openPanel){enterOpen();return;}
  sb.auth.onAuthStateChange(ev=>{if(ev==='SIGNED_OUT'&&ui.inApp) location.reload();});
  const {data:{session}}=await sb.auth.getSession();
  if(session) enter(session); else showLogin();
})();

/* =========================================================
   Fotos de platillos: subir y recortar (todas quedan 4:3)
   ========================================================= */
if(sb){
  sb.from('products').select('photo').limit(1).then(({error})=>{HAS_PHOTO=!error;if(ui.editing)renderMenuAdmin();});
  sb.from('products').select('video').limit(1).then(({error})=>{HAS_VIDEO=!error;if(ui.editing)renderMenuAdmin();});
}
function pickPhoto(){
  return new Promise(resolve=>{
    const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
    inp.onchange=()=>{const f=inp.files&&inp.files[0];if(!f)return resolve(null);
      if(!f.type.startsWith('image/')){toast('Ese archivo no es una imagen. Sube JPG o PNG.');return resolve(null);}
      cropPhoto(f).then(resolve);};
    inp.click();
  });
}
function cropPhoto(file){
  return new Promise(resolve=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onerror=()=>{URL.revokeObjectURL(url);toast('No pudimos abrir esa imagen. Prueba con JPG o PNG.');resolve(null);};
    img.onload=()=>{
      const W=640,H=480; // tamaño final de todas las fotos
      const ov=document.createElement('div');ov.className='crop-ov';
      ov.innerHTML=`<div class="crop-box" role="dialog" aria-modal="true" aria-label="Recortar foto">
        <h3>Elige qué parte de la foto se verá</h3>
        <p class="muted small">Arrastra la foto para moverla y usa la barra para acercar. Todas las fotos del menú quedan del mismo tamaño.</p>
        <canvas class="crop-cv" width="${W}" height="${H}"></canvas>
        <label class="crop-zoom"><span class="small">Acercar</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Acercar"></label>
        <div class="crop-foot"><button class="btn btn-ghost" data-x>Cancelar</button><button class="btn btn-brand" data-ok>Usar esta foto</button></div></div>`;
      document.body.appendChild(ov);
      const cv=ov.querySelector('canvas'),cx=cv.getContext('2d'),zr=ov.querySelector('input');
      const base=Math.max(W/img.width,H/img.height);let z=1,x=0,y=0;
      const draw=()=>{
        const s=base*z,w=img.width*s,h=img.height*s,mx=(w-W)/2,my=(h-H)/2;
        x=Math.max(-mx,Math.min(mx,x));y=Math.max(-my,Math.min(my,y));
        cx.fillStyle='#fff';cx.fillRect(0,0,W,H);cx.drawImage(img,(W-w)/2+x,(H-h)/2+y,w,h);
      };
      draw();
      let drag=null;
      cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,ox:x,oy:y};};
      cv.onpointermove=e=>{if(!drag)return;const k=W/cv.getBoundingClientRect().width;x=drag.ox+(e.clientX-drag.x)*k;y=drag.oy+(e.clientY-drag.y)*k;draw();};
      cv.onpointerup=cv.onpointercancel=()=>{drag=null;};
      zr.oninput=()=>{z=+zr.value;draw();};
      cv.onwheel=e=>{e.preventDefault();z=Math.min(4,Math.max(1,z*(e.deltaY<0?1.08:1/1.08)));zr.value=z;draw();};
      const done=v=>{URL.revokeObjectURL(url);ov.remove();resolve(v);};
      ov.querySelector('[data-x]').onclick=()=>done(null);
      ov.onkeydown=e=>{if(e.key==='Escape')done(null);};
      ov.querySelector('[data-ok]').onclick=()=>done(cv.toDataURL('image/jpeg',.78));
      ov.querySelector('[data-ok]').focus();
    };
    img.src=url;
  });
}
