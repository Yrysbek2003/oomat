/* ============================================================
   OOMAT v5.0 — ПОЛНАЯ СИСТЕМА
   Новое: Клиенты, Касса, Пополнение склада, Продление сессии,
          Уведомления, Фильтры, CSV, Чек, Смена пароля,
          Настройки клуба, Редактирование товаров, Удаление ПК,
          Лог действий, Низкий остаток
   ============================================================ */
'use strict';

// ============================================================
//  ROLES
// ============================================================
const ROLES = {
  sysadmin: {
    label:'Сист. Администратор', icon:'fa-shield-halved', color:'#ff6a00',
    pages:['dashboard','computers','products','clients','tariffs','reports','staff','settings'],
    canAddStaff:true,canDeleteStaff:true,canManageZones:true,canManageTariffs:true,
    canViewAllReports:true,canResetData:true,canManageProducts:true,canEditSettings:true
  },
  manager: {
    label:'Менеджер', icon:'fa-user-tie', color:'#00c8ff',
    pages:['dashboard','computers','products','clients','tariffs','reports','staff'],
    canAddStaff:false,canDeleteStaff:false,canManageZones:false,canManageTariffs:true,
    canViewAllReports:true,canResetData:false,canManageProducts:true,canEditSettings:false
  },
  operator: {
    label:'Оператор', icon:'fa-headset', color:'#39ff87',
    pages:['dashboard','computers','products','clients'],
    canAddStaff:false,canDeleteStaff:false,canManageZones:false,canManageTariffs:false,
    canViewAllReports:false,canResetData:false,canManageProducts:false,canEditSettings:false
  }
};

// ============================================================
//  STATE
// ============================================================
const DB = 'oomat_v5';

let S = {
  staff:    { sysadmin:{ pass:'admin123', name:'Системный Админ', role:'sysadmin', createdAt:Date.now() } },
  settings: { clubName:'OOMAT Gaming Club', currency:'сом', lowStockThreshold:5, warningMinutes:10 },
  zones:    ['A','B','VIP'],
  computers:[],
  tariffs:  [],
  products: [],
  clients:  [],
  sessions: [],
  history:  [],
  sales:    [],
  shifts:   [],
  cash:     [],       // cash register records
  actlog:   [],       // action log
  currentUser:  null,
  activeShift:  null
};

// ============================================================
//  STORAGE
// ============================================================
function persist() {
  try {
    const {staff,settings,zones,computers,tariffs,products,clients,sessions,history,sales,shifts,cash,actlog,activeShift} = S;
    localStorage.setItem(DB, JSON.stringify({staff,settings,zones,computers,tariffs,products,clients,sessions,history,sales,shifts,cash,actlog,activeShift}));
  } catch(e){ toast('Ошибка сохранения: '+e.message,'err'); }
}
function hydrate() {
  try {
    const d = JSON.parse(localStorage.getItem(DB)||'{}');
    const keys = ['staff','settings','zones','computers','tariffs','products','clients','sessions','history','sales','shifts','cash','actlog','activeShift'];
    keys.forEach(k=>{ if(d[k]!==undefined) S[k]=d[k]; });
    // merge settings defaults
    S.settings = Object.assign({clubName:'OOMAT Gaming Club',currency:'сом',lowStockThreshold:5,warningMinutes:10}, S.settings);
  } catch(e){}
}
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function logAction(action, detail='') {
  S.actlog.unshift({ id:uid(), ts:Date.now(), userId:S.currentUser, userName:me()?.name||'—', action, detail });
  if (S.actlog.length > 200) S.actlog = S.actlog.slice(0,200);
}

// ============================================================
//  ROLE HELPERS
// ============================================================
function me()      { return S.staff[S.currentUser]; }
function myRole()  { return me()?.role||'operator'; }
function can(p)    { return !!ROLES[myRole()]?.[p]; }
function hasPage(p){ return ROLES[myRole()]?.pages.includes(p); }
function cur()     { return S.settings.currency; }

// ============================================================
//  AUTH
// ============================================================
function login() {
  const u=val('login-user').trim(), p=val('login-pass');
  const staff=S.staff[u];
  if (!staff||staff.pass!==p) { toast('Неверный логин или пароль','err'); document.getElementById('login-pass').value=''; return; }
  S.currentUser=u;
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app-wrapper').style.display='flex';
  buildSidebar(); initApp();
  toast(`Добро пожаловать, ${staff.name}`,'ok');
}
function logout() {
  if (!confirm('Завершить смену и выйти?')) return;
  endShiftIfActive(); persist(); S.currentUser=null; S.activeShift=null;
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app-wrapper').style.display='none';
  document.getElementById('login-pass').value='';
}

// ============================================================
//  REGISTER
// ============================================================
function openRegister() {
  document.getElementById('reg-error').textContent='';
  const c=countRoles(), sel=document.getElementById('reg-role');
  sel.innerHTML=`
    <option value="operator" ${c.operator>=3?'disabled':''}>Оператор (${c.operator}/3)</option>
    <option value="manager"  ${c.manager>=1?'disabled':''}>Менеджер (${c.manager}/1)</option>
    <option value="sysadmin" ${c.sysadmin>=1?'disabled':''}>Сист. Администратор (${c.sysadmin}/1)</option>`;
  openOverlay('overlay-register');
  setTimeout(()=>document.getElementById('reg-login').focus(),80);
}
function doRegister() {
  const login=val('reg-login').trim(), name=val('reg-name').trim(),
        pass=val('reg-pass'), pass2=val('reg-pass2'), role=val('reg-role'),
        errEl=document.getElementById('reg-error');
  if (!login||!name||!pass||!pass2)   { errEl.textContent='Заполните все поля'; return; }
  if (pass!==pass2)                    { errEl.textContent='Пароли не совпадают'; return; }
  if (pass.length<4)                   { errEl.textContent='Пароль минимум 4 символа'; return; }
  if (S.staff[login])                  { errEl.textContent='Логин уже занят'; return; }
  const c=countRoles();
  if (role==='sysadmin'&&c.sysadmin>=1){ errEl.textContent='Системный администратор уже существует'; return; }
  if (role==='manager'&&c.manager>=1)  { errEl.textContent='Менеджер уже существует'; return; }
  if (role==='operator'&&c.operator>=3){ errEl.textContent='Максимум 3 оператора'; return; }
  S.staff[login]={pass,name,role,createdAt:Date.now()};
  persist(); closeOverlay('overlay-register');
  logAction('Регистрация', `${name} (${role})`);
  toast(`Аккаунт "${name}" создан`,'ok');
  ['reg-login','reg-name','reg-pass','reg-pass2'].forEach(id=>document.getElementById(id).value='');
  if (currentPage==='staff') renderStaff();
}
function countRoles() {
  const c={sysadmin:0,manager:0,operator:0};
  Object.values(S.staff).forEach(u=>{ if(c[u.role]!==undefined) c[u.role]++; });
  return c;
}

// Change own password
function changeMyPassword() {
  const oldP=val('cp-old'), newP=val('cp-new'), newP2=val('cp-new2');
  const errEl=document.getElementById('cp-error');
  if (!oldP||!newP||!newP2)   { errEl.textContent='Заполните все поля'; return; }
  if (me().pass!==oldP)        { errEl.textContent='Старый пароль неверный'; return; }
  if (newP!==newP2)            { errEl.textContent='Новые пароли не совпадают'; return; }
  if (newP.length<4)           { errEl.textContent='Минимум 4 символа'; return; }
  S.staff[S.currentUser].pass=newP;
  persist(); closeOverlay('overlay-change-pass');
  ['cp-old','cp-new','cp-new2'].forEach(id=>document.getElementById(id).value='');
  logAction('Смена пароля');
  toast('Пароль изменён','ok');
}

// ============================================================
//  SHIFTS
// ============================================================
function startShift() {
  if (S.activeShift) { toast('Смена уже открыта','info'); return; }
  S.activeShift={ id:uid(), userId:S.currentUser, userName:me().name, startedAt:Date.now(), revenueAtStart:calcTotalRevenue() };
  persist(); renderShiftBadge(); logAction('Начало смены');
  toast('Смена начата','ok');
}
function endShiftIfActive() {
  if (!S.activeShift) return;
  const earned=Math.max(0, calcTotalRevenue()-S.activeShift.revenueAtStart);
  S.shifts.push({...S.activeShift, endedAt:Date.now(), revenueAtEnd:calcTotalRevenue(), earned});
  logAction('Конец смены', `Заработано: ${earned} ${cur()}`);
  S.activeShift=null; persist(); renderShiftBadge();
}
function endShift() {
  if (!S.activeShift) { toast('Нет активной смены','info'); return; }
  if (!confirm('Завершить смену?')) return;
  endShiftIfActive(); toast('Смена завершена','ok');
  if (currentPage==='reports') renderReports();
}
function calcTotalRevenue() {
  return S.history.reduce((a,h)=>a+h.price,0)+S.sales.reduce((a,s)=>a+s.total,0);
}
function renderShiftBadge() {
  const badge=document.getElementById('shift-badge');
  const startBtn=document.getElementById('btn-start-shift');
  const endBtn=document.getElementById('btn-end-shift');
  if (!badge) return;
  if (S.activeShift&&S.activeShift.userId===S.currentUser) {
    const dur=Math.floor((Date.now()-S.activeShift.startedAt)/60000);
    const h=Math.floor(dur/60), m=dur%60;
    badge.innerHTML=`<i class="fas fa-circle" style="color:var(--green);font-size:0.5rem"></i> Смена: ${h>0?h+'ч ':''} ${m}мин`;
    badge.style.display='flex';
    if(startBtn) startBtn.style.display='none';
    if(endBtn)   endBtn.style.display='inline-flex';
  } else {
    badge.style.display='none';
    if(startBtn) startBtn.style.display= myRole()==='sysadmin'?'none':'inline-flex';
    if(endBtn)   endBtn.style.display='none';
  }
}
setInterval(()=>{ if(S.activeShift) renderShiftBadge(); },30000);

// ============================================================
//  INIT
// ============================================================
function initApp() {
  hydrate();
  if (S.tariffs.length===0) loadDefaultTariffs();
  if (S.computers.length===0) loadDemo();
  updateClubBranding();
  startClock(); startTimerLoop();
  setInterval(persist,30000);
  const u=me(), role=ROLES[u.role];
  document.getElementById('sidebar-username').textContent=u.name;
  document.getElementById('sidebar-avatar').textContent=u.name[0].toUpperCase();
  document.getElementById('sidebar-avatar').style.borderColor=role.color;
  document.getElementById('sidebar-role-label').textContent=role.label;
  document.getElementById('sidebar-role-label').style.color=role.color;
  renderShiftBadge();
  navigate('dashboard'); updateTopbarStats();
}
function loadDefaultTariffs() {
  S.tariffs=[
    {id:uid(),name:'30 мин',  duration:30, price:30, vipMult:1.5,type:'fixed'},
    {id:uid(),name:'1 час',   duration:60, price:50, vipMult:1.5,type:'hourly'},
    {id:uid(),name:'2 часа',  duration:120,price:90, vipMult:1.5,type:'hourly'},
    {id:uid(),name:'3 часа',  duration:180,price:130,vipMult:1.5,type:'hourly'},
    {id:uid(),name:'5 часов', duration:300,price:200,vipMult:1.5,type:'hourly'},
    {id:uid(),name:'Ночной',  duration:480,price:300,vipMult:1.3,type:'night'},
  ];
}
function updateClubBranding() {
  document.title = S.settings.clubName + ' — OOMAT';
  const el = document.getElementById('club-name-display');
  if (el) el.textContent = S.settings.clubName;
}

// ============================================================
//  SIDEBAR
// ============================================================
function buildSidebar() {
  const nav=document.getElementById('sidebar-nav');
  const items=[
    {id:'dashboard',icon:'fa-chart-bar',    label:'Дашборд'},
    {id:'computers',icon:'fa-desktop',      label:'Компьютеры'},
    {id:'products', icon:'fa-box',          label:'Товары'},
    {id:'clients',  icon:'fa-users',        label:'Клиенты'},
    {id:'tariffs',  icon:'fa-tags',         label:'Тарифы'},
    {id:'reports',  icon:'fa-chart-line',   label:'Отчёты'},
    {id:'staff',    icon:'fa-id-badge',     label:'Сотрудники'},
    {id:'settings', icon:'fa-cog',          label:'Настройки'},
  ];
  nav.innerHTML=items.filter(p=>hasPage(p.id))
    .map(p=>`<div class="nav-item" data-page="${p.id}" onclick="navigate('${p.id}')">
      <i class="fas ${p.icon}"></i> ${p.label}
    </div>`).join('');
}

// ============================================================
//  CLOCK + SESSION TIMER LOOP
// ============================================================
function startClock() {
  const el=document.getElementById('sidebar-clock');
  setInterval(()=>{ if(el) el.textContent=new Date().toLocaleTimeString('ru-RU'); },1000);
}
function startTimerLoop() { setInterval(tickSessions,1000); }

function tickSessions() {
  const now=Date.now(); let changed=false;
  S.sessions.forEach(s=>{
    const elapsed=Math.floor((now-s.startedAt)/1000);
    const total=s.duration*60;
    s.remaining=Math.max(0,total-elapsed);
    const was=s.overdue; s.overdue=elapsed>=total;
    if(s.overdue!==was) changed=true;

    // Warning notification at warningMinutes before end
    const warnSecs=(S.settings.warningMinutes||10)*60;
    if (!s.warned && !s.overdue && s.remaining<=warnSecs && s.remaining>0) {
      s.warned=true;
      const pc=S.computers.find(c=>c.id===s.computerId);
      showNotification(`⏰ ${pc?.number||'ПК'}: ${s.client} — осталось ${S.settings.warningMinutes} мин`);
    }
  });
  updateSessionTimers();
  if(changed){ renderComputerCards(); updateTopbarStats(); }
}

function showNotification(msg) {
  toast(msg,'info');
  // pulse topbar
  const tb=document.getElementById('topbar-overdue');
  if(tb){ tb.style.animation='none'; setTimeout(()=>tb.style.animation='',10); }
}

function updateSessionTimers() {
  S.sessions.forEach(s=>{
    const t=s.overdue?'!ВРЕМЯ!':fmtTime(s.remaining);
    const tEl=document.querySelector(`[data-stid="${s.id}"]`);
    const pEl=document.querySelector(`[data-spid="${s.id}"]`);
    if(tEl) tEl.textContent=t;
    if(pEl){ const pct=Math.min(100,((s.duration*60-s.remaining)/(s.duration*60))*100); pEl.style.width=pct+'%'; }
    const pcEl=document.querySelector(`[data-pcid="${s.computerId}"]`);
    if(pcEl){
      const pc=S.computers.find(c=>c.id===s.computerId);
      pcEl.className=`pc ${s.overdue?'overdue':'occupied'}${pc?.isVip?' vip':''}`;
      const te=pcEl.querySelector('.pc-time'); if(te) te.textContent=t;
    }
  });
  document.querySelectorAll('.srow').forEach(r=>{
    const s=S.sessions.find(x=>x.id===r.dataset.sid); if(!s) return;
    r.classList.toggle('overdue',s.overdue);
    const te=r.querySelector('.srow-time'); if(te) te.textContent=s.overdue?'!ВРЕМЯ!':fmtTime(s.remaining);
  });
}

// ============================================================
//  NAVIGATION
// ============================================================
let currentPage='';
function navigate(page) {
  if (!hasPage(page)){ toast('Нет доступа к этому разделу','err'); return; }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const el=document.getElementById('page-'+page); if(el) el.classList.add('active');
  document.querySelectorAll(`.nav-item[data-page="${page}"]`).forEach(n=>n.classList.add('active'));
  const titles={dashboard:'Дашборд',computers:'Компьютеры',products:'Товары',clients:'Клиенты',tariffs:'Тарифы',reports:'Отчёты',staff:'Сотрудники',settings:'Настройки'};
  document.getElementById('page-title').textContent=titles[page]||page;
  currentPage=page;
  const fn={dashboard:renderDashboard,computers:renderComputers,products:renderProducts,clients:renderClients,tariffs:renderTariffs,reports:renderReports,staff:renderStaff,settings:renderSettings};
  if(fn[page]) fn[page]();
}
function updateTopbarStats() {
  const active=S.sessions.length, ov=S.sessions.filter(s=>s.overdue).length;
  const el1=document.getElementById('topbar-active'); if(el1) el1.querySelector('strong').textContent=active;
  const el2=document.getElementById('topbar-overdue');
  if(el2){ el2.querySelector('strong').textContent=ov; el2.style.display=ov>0?'flex':'none'; }
  // Cash today
  const ts=new Date(); ts.setHours(0,0,0,0);
  const todayCash=S.history.filter(h=>h.endedAt>=ts.getTime()).reduce((a,h)=>a+h.price,0)
                 +S.sales.filter(s=>s.date>=ts.getTime()).reduce((a,s)=>a+s.total,0);
  const cashEl=document.getElementById('topbar-cash'); if(cashEl) cashEl.querySelector('strong').textContent=todayCash+' '+cur();
}

// ============================================================
//  DASHBOARD
// ============================================================
let chartRev,chartPie;
function renderDashboard() {
  const ts=new Date(); ts.setHours(0,0,0,0); const tsN=ts.getTime();
  const trs=S.history.filter(h=>h.endedAt>=tsN).reduce((a,h)=>a+h.price,0);
  const trp=S.sales.filter(s=>s.date>=tsN).reduce((a,s)=>a+s.total,0);
  set('dash-rev-today',(trs+trp)+' '+cur());
  set('dash-rev-total','Всего: '+calcTotalRevenue()+' '+cur());
  set('dash-sessions',S.sessions.length); set('dash-pcs','ПК: '+S.computers.length);
  set('dash-sold',S.sales.reduce((a,s)=>a+s.qty,0));
  // Low stock warning
  const lowStock=S.products.filter(p=>p.qty<=S.settings.lowStockThreshold);
  set('dash-stock',lowStock.length>0?`⚠ ${lowStock.length} товаров мало`:'Склад: '+S.products.reduce((a,p)=>a+p.qty,0)+' ед.');
  const dashStockEl=document.getElementById('dash-stock'); if(dashStockEl) dashStockEl.style.color=lowStock.length>0?'var(--red)':'';
  const ov=S.sessions.filter(s=>s.overdue).length; set('dash-overdue',ov);
  const ovEl=document.getElementById('dash-overdue'); if(ovEl) ovEl.style.color=ov>0?'var(--red)':'var(--green)';
  // Clients today
  const clientsToday=new Set(S.history.filter(h=>h.endedAt>=tsN).map(h=>h.client)).size;
  set('dash-clients-today',clientsToday); set('dash-clients-total','Всего: '+S.clients.length);
  renderDashSessions(); renderCharts(); updateTopbarStats();
}
function renderDashSessions() {
  const el=document.getElementById('dash-sessions-list'); if(!el) return;
  if(!S.sessions.length){ el.innerHTML='<div class="empty-state"><i class="fas fa-moon"></i>Нет активных сессий</div>'; return; }
  el.innerHTML=S.sessions.map(s=>{
    const pc=S.computers.find(c=>c.id===s.computerId);
    const op=S.staff[s.operatorId];
    const t=s.overdue?'!ВРЕМЯ!':fmtTime(s.remaining||0);
    return `<div class="srow ${s.overdue?'overdue':''}" data-sid="${s.id}" onclick="openEndSession('${s.id}')">
      <span class="srow-pc">${pc?.number||'?'}</span>
      <span class="srow-client">${s.client}</span>
      <span class="srow-tariff">${s.tariffName}</span>
      ${op?`<span class="srow-op"><i class="fas fa-headset"></i>${op.name.split(' ')[0]}</span>`:''}
      <span class="srow-time" data-stid="${s.id}">${t}</span>
      <button class="btn btn-orange btn-xs" onclick="event.stopPropagation();openExtendSession('${s.id}')" title="Продлить"><i class="fas fa-plus"></i></button>
      <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();openEndSession('${s.id}')"><i class="fas fa-stop"></i></button>
    </div>`;
  }).join('');
}
function renderCharts() {
  const days=[],revs=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    const de=new Date(d); de.setHours(23,59,59,999);
    revs.push(S.history.filter(h=>h.endedAt>=d.getTime()&&h.endedAt<=de.getTime()).reduce((a,h)=>a+h.price,0)
             +S.sales.filter(s=>s.date>=d.getTime()&&s.date<=de.getTime()).reduce((a,s)=>a+s.total,0));
    days.push(['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d.getDay()]);
  }
  const rc=document.getElementById('chart-rev');
  if(rc){ if(chartRev) chartRev.destroy();
    chartRev=new Chart(rc.getContext('2d'),{type:'bar',data:{labels:days,datasets:[{data:revs,backgroundColor:'rgba(255,106,0,0.25)',borderColor:'rgba(255,106,0,0.8)',borderWidth:1,borderRadius:4}]},
    options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{grid:{color:'rgba(255,106,0,0.06)'},ticks:{color:'#7a7068',font:{family:'Exo 2'}}},x:{grid:{display:false},ticks:{color:'#7a7068',font:{family:'Exo 2'}}}}}});}
  const freeN=S.computers.filter(c=>!S.sessions.find(s=>s.computerId===c.id)).length;
  const occN=S.sessions.filter(s=>!s.overdue).length, ovN=S.sessions.filter(s=>s.overdue).length;
  const pc=document.getElementById('chart-pc');
  if(pc){ if(chartPie) chartPie.destroy();
    chartPie=new Chart(pc.getContext('2d'),{type:'doughnut',data:{labels:['Свободно','Занято','Просрочено'],datasets:[{data:[freeN,occN,ovN],backgroundColor:['rgba(57,255,135,0.3)','rgba(255,157,0,0.5)','rgba(255,51,85,0.5)'],borderColor:['rgba(57,255,135,0.8)','rgba(255,157,0,0.8)','rgba(255,51,85,0.8)'],borderWidth:1}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#7a7068',font:{family:'Exo 2',size:11},boxWidth:10,padding:12}}},cutout:'58%'}});}
}

// ============================================================
//  COMPUTERS
// ============================================================
function renderComputers() {
  const cont=document.getElementById('zones-container'); if(!cont) return;
  set('pc-free',S.computers.filter(c=>!S.sessions.find(s=>s.computerId===c.id)).length);
  set('pc-occ', S.sessions.filter(s=>!s.overdue).length);
  set('pc-ov',  S.sessions.filter(s=>s.overdue).length);
  const addBtn=document.getElementById('btn-add-pc'), zonesBtn=document.getElementById('btn-zones');
  if(addBtn)  addBtn.style.display =can('canManageZones')?'inline-flex':'none';
  if(zonesBtn)zonesBtn.style.display=can('canManageZones')?'inline-flex':'none';
  if(!S.computers.length){ cont.innerHTML='<div class="empty-state"><i class="fas fa-desktop"></i>Добавьте зоны и компьютеры</div>'; return; }
  const zones=[...new Set(S.computers.map(c=>c.zone))].sort();
  cont.innerHTML=zones.map(zone=>{
    const pcs=S.computers.filter(c=>c.zone===zone).sort((a,b)=>a.number.localeCompare(b.number));
    const zF=pcs.filter(c=>!S.sessions.find(s=>s.computerId===c.id)).length;
    const zO=pcs.filter(c=>{const s=S.sessions.find(s=>s.computerId===c.id);return s&&!s.overdue;}).length;
    const zV=pcs.filter(c=>{const s=S.sessions.find(s=>s.computerId===c.id);return s&&s.overdue;}).length;
    return `<div class="zone-block">
      <div class="zone-hdr">
        <div class="zone-hdr-left">
          <span class="zone-label">ЗОНА ${zone}</span>
          <div class="zone-meta">
            <span><span class="zone-dot zd-free"></span>${zF} своб.</span>
            <span><span class="zone-dot zd-occ"></span>${zO} занято</span>
            ${zV>0?`<span><span class="zone-dot zd-ov"></span>${zV} просроч.</span>`:''}
          </div>
        </div>
        ${can('canManageZones')?`<button class="btn btn-ghost btn-sm" onclick="addPcToZone('${zone}')"><i class="fas fa-plus"></i> ПК</button>`:''}
      </div>
      <div class="pcs-grid">${pcs.map(pc=>renderPcCard(pc)).join('')}</div>
    </div>`;
  }).join('');
}
function renderPcCard(pc) {
  const ses=S.sessions.find(s=>s.computerId===pc.id);
  const st=ses?(ses.overdue?'overdue':'occupied'):'free';
  const vip=pc.isVip?' vip':'';
  const clk=ses?`openEndSession('${ses.id}')`:`openStartSession('${pc.id}')`;
  let inner='';
  if(!ses){
    inner=`<div class="pc-dot"></div>
      ${pc.isVip?'<div class="pc-vip-badge">VIP</div>':''}
      ${can('canManageZones')?`<button class="pc-del-btn" onclick="event.stopPropagation();deleteComputer('${pc.id}')" title="Удалить ПК"><i class="fas fa-times"></i></button>`:''}
      <i class="fas fa-desktop pc-icon"></i>
      <div class="pc-num">${pc.number}</div>
      <div class="pc-client" style="color:var(--text3);font-size:0.62rem">СВОБОДЕН</div>`;
  } else {
    const total=ses.duration*60, elapsed=total-(ses.remaining||0);
    const pct=Math.min(100,(elapsed/total)*100);
    const t=ses.overdue?'!ВРЕМЯ!':fmtTime(ses.remaining||0);
    const op=S.staff[ses.operatorId];
    inner=`<div class="pc-dot"></div>
      ${pc.isVip?'<div class="pc-vip-badge">VIP</div>':''}
      <i class="fas fa-desktop pc-icon"></i>
      <div class="pc-num">${pc.number}</div>
      <div class="pc-client">${ses.client}</div>
      ${op?`<div class="pc-op"><i class="fas fa-headset"></i>${op.name.split(' ')[0]}</div>`:''}
      <div class="pc-time" data-stid="${ses.id}">${t}</div>
      <div class="pc-bar"><div class="pc-bar-fill" data-spid="${ses.id}" style="width:${pct}%"></div></div>`;
  }
  return `<div class="pc ${st}${vip}" data-pcid="${pc.id}" onclick="${clk}" title="${pc.number}">${inner}</div>`;
}
function renderComputerCards(){ if(currentPage==='computers') renderComputers(); }

function deleteComputer(pcId) {
  if(!can('canManageZones')) return;
  const pc=S.computers.find(c=>c.id===pcId);
  if(S.sessions.find(s=>s.computerId===pcId)){ toast('Нельзя удалить — ПК занят','err'); return; }
  if(!confirm(`Удалить ПК ${pc.number}?`)) return;
  S.computers=S.computers.filter(c=>c.id!==pcId);
  persist(); renderComputers(); logAction('Удалён ПК', pc.number); toast(`ПК ${pc.number} удалён`,'info');
}

// ============================================================
//  SESSION START
// ============================================================
let _pendingPcId=null, _selTariffId=null;
function openStartSession(pcId) {
  const pc=S.computers.find(c=>c.id===pcId); if(!pc) return;
  _pendingPcId=pcId; _selTariffId=null;
  set('sess-modal-title',`СЕССИЯ — ${pc.number}`);
  document.getElementById('sess-pc-info').innerHTML=`
    <div class="irow"><span>Компьютер</span><span>${pc.number}</span></div>
    <div class="irow"><span>Зона</span><span>Зона ${pc.zone}</span></div>
    <div class="irow"><span>Оператор</span><span style="color:var(--green)">${me().name}</span></div>
    ${pc.isVip?'<div class="irow"><span>Тип</span><span style="color:var(--gold)">★ VIP</span></div>':''}`;
  document.getElementById('sess-client').value='';
  document.getElementById('sess-calc').style.display='none';
  document.getElementById('sess-note').value='';
  // Populate client autocomplete
  buildClientSuggestions('sess-client','sess-client-list');
  document.getElementById('sess-tariff-picker').innerHTML=S.tariffs.map(t=>{
    const price=pc.isVip?Math.ceil(t.price*t.vipMult):t.price;
    return `<div class="tp-btn" onclick="pickTariff('${t.id}',${pc.isVip})" data-tid="${t.id}">
      <span class="tp-dur">${fmtDur(t.duration)}</span><span style="font-size:0.82rem">${t.name}</span>
      <div class="tp-price">${price} ${cur()}</div></div>`;
  }).join('');
  openOverlay('overlay-session');
  setTimeout(()=>document.getElementById('sess-client').focus(),80);
}
function buildClientSuggestions(inputId, listId) {
  const list=document.getElementById(listId); if(!list) return;
  list.innerHTML=S.clients.map(c=>`<option value="${c.name}">`).join('');
}
function pickTariff(tid,isVip) {
  _selTariffId=tid;
  document.querySelectorAll('.tp-btn').forEach(b=>b.classList.toggle('sel',b.dataset.tid===tid));
  const t=S.tariffs.find(t=>t.id===tid);
  const price=isVip?Math.ceil(t.price*t.vipMult):t.price;
  const calc=document.getElementById('sess-calc'); calc.style.display='block';
  calc.innerHTML=`<div class="irow"><span>Тариф</span><span>${t.name}</span></div>
    <div class="irow"><span>Время</span><span>${fmtDur(t.duration)}</span></div>
    <div class="irow"><span>Сумма</span><span class="gold">${price} ${cur()}</span></div>`;
}
function startSession() {
  const client=val('sess-client').trim(), note=val('sess-note').trim();
  if(!client)     { toast('Введите имя клиента','err'); return; }
  if(!_selTariffId){ toast('Выберите тариф','err'); return; }
  const pc=S.computers.find(c=>c.id===_pendingPcId);
  const tariff=S.tariffs.find(t=>t.id===_selTariffId);
  if(!pc||!tariff) return;
  const price=pc.isVip?Math.ceil(tariff.price*tariff.vipMult):tariff.price;
  // Auto-add client if new
  autoAddClient(client);
  S.sessions.push({id:uid(),computerId:pc.id,client,note,tariffId:tariff.id,tariffName:tariff.name,duration:tariff.duration,price,startedAt:Date.now(),remaining:tariff.duration*60,overdue:false,warned:false,operatorId:S.currentUser});
  persist(); closeOverlay('overlay-session'); renderComputers(); renderDashSessions(); updateTopbarStats();
  logAction('Сессия начата', `${pc.number} → ${client} (${tariff.name})`);
  toast(`Сессия: ${pc.number} → ${client}`,'ok');
}
function autoAddClient(name) {
  if(!name||S.clients.find(c=>c.name===name)) return;
  S.clients.push({id:uid(),name,visits:1,totalSpent:0,createdAt:Date.now(),note:''});
}
function updateClientStats(clientName, amount) {
  const c=S.clients.find(c=>c.name===clientName);
  if(!c) return;
  c.visits=(c.visits||0)+1; c.totalSpent=(c.totalSpent||0)+amount; c.lastVisit=Date.now();
}

// ============================================================
//  SESSION END
// ============================================================
let _endSessId=null;
function openEndSession(sid) {
  const s=S.sessions.find(x=>x.id===sid); if(!s) return;
  _endSessId=sid;
  const pc=S.computers.find(c=>c.id===s.computerId);
  const op=S.staff[s.operatorId];
  const elapsed=Math.floor((Date.now()-s.startedAt)/60000);
  document.getElementById('end-sess-info').innerHTML=`
    <div class="irow"><span>Компьютер</span><span>${pc?.number||'?'}</span></div>
    <div class="irow"><span>Клиент</span><span>${s.client}</span></div>
    <div class="irow"><span>Тариф</span><span>${s.tariffName}</span></div>
    <div class="irow"><span>Прошло</span><span>${elapsed} мин / ${fmtDur(s.duration)}</span></div>
    <div class="irow"><span>Оператор</span><span style="color:var(--green)">${op?.name||'—'}</span></div>
    ${s.note?`<div class="irow"><span>Заметка</span><span style="color:var(--text2)">${s.note}</span></div>`:''}
    <div class="irow"><span>Сумма</span><span class="gold">${s.price} ${cur()}</span></div>
    ${s.overdue?'<div class="irow"><span>Статус</span><span class="red">⚠ ПРОСРОЧЕНО!</span></div>':''}`;
  openOverlay('overlay-end-session');
}
function confirmEndSession() {
  const s=S.sessions.find(x=>x.id===_endSessId); if(!s) return;
  S.history.push({...s,endedAt:Date.now()});
  S.sessions=S.sessions.filter(x=>x.id!==_endSessId);
  updateClientStats(s.client, s.price);
  // cash record
  S.cash.push({id:uid(),type:'session',amount:s.price,desc:`Сессия ${S.computers.find(c=>c.id===s.computerId)?.number||'?'} — ${s.client}`,ts:Date.now(),operatorId:S.currentUser});
  persist(); closeOverlay('overlay-end-session');
  renderComputers(); renderDashSessions(); updateTopbarStats();
  if(currentPage==='dashboard') renderDashboard();
  logAction('Сессия завершена', `${s.client} — ${s.price} ${cur()}`);
  toast(`Завершено: ${s.price} ${cur()}`,'ok');
  showReceiptModal(s);
}

// Receipt popup
function showReceiptModal(s) {
  const pc=S.computers.find(c=>c.id===s.computerId);
  const now=new Date();
  document.getElementById('receipt-content').innerHTML=`
    <div style="text-align:center;border-bottom:1px solid var(--border);padding-bottom:1rem;margin-bottom:1rem">
      <div style="font-family:var(--font-d);font-size:1.4rem;color:var(--orange);letter-spacing:4px">${S.settings.clubName}</div>
      <div style="font-size:0.75rem;color:var(--text2);letter-spacing:2px">ЧЕК / RECEIPT</div>
    </div>
    <div class="irow"><span>ПК</span><span>${pc?.number||'?'}</span></div>
    <div class="irow"><span>Клиент</span><span>${s.client}</span></div>
    <div class="irow"><span>Тариф</span><span>${s.tariffName}</span></div>
    <div class="irow"><span>Начало</span><span>${new Date(s.startedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="irow"><span>Конец</span><span>${now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
      <div class="irow"><span style="font-weight:700">ИТОГО</span><span style="font-family:var(--font-d);font-size:1.2rem;color:var(--gold)">${s.price} ${cur()}</span></div>
    </div>
    <div style="text-align:center;margin-top:1rem;font-size:0.75rem;color:var(--text3)">
      ${now.toLocaleDateString('ru-RU')} ${now.toLocaleTimeString('ru-RU')}<br>Спасибо за посещение!
    </div>`;
  openOverlay('overlay-receipt');
}

// ============================================================
//  EXTEND SESSION
// ============================================================
let _extendSessId=null;
function openExtendSession(sid) {
  _extendSessId=sid;
  const s=S.sessions.find(x=>x.id===sid); if(!s) return;
  const pc=S.computers.find(c=>c.id===s.computerId);
  document.getElementById('extend-info').innerHTML=`
    <div class="irow"><span>Компьютер</span><span>${pc?.number||'?'}</span></div>
    <div class="irow"><span>Клиент</span><span>${s.client}</span></div>
    <div class="irow"><span>Осталось</span><span>${s.overdue?'<span class="red">ПРОСРОЧЕНО</span>':fmtTime(s.remaining||0)}</span></div>`;
  // Build extend tariff picker
  const picker=document.getElementById('extend-tariff-picker');
  picker.innerHTML=S.tariffs.map(t=>{
    const price=pc?.isVip?Math.ceil(t.price*t.vipMult):t.price;
    return `<div class="tp-btn" onclick="pickExtendTariff('${t.id}',${!!pc?.isVip})" data-tid="${t.id}">
      <span class="tp-dur">${fmtDur(t.duration)}</span><span style="font-size:0.82rem">${t.name}</span>
      <div class="tp-price">+${price} ${cur()}</div></div>`;
  }).join('');
  document.getElementById('extend-calc').style.display='none';
  openOverlay('overlay-extend');
}
let _extendTariffId=null;
function pickExtendTariff(tid,isVip){
  _extendTariffId=tid;
  document.querySelectorAll('#extend-tariff-picker .tp-btn').forEach(b=>b.classList.toggle('sel',b.dataset.tid===tid));
  const t=S.tariffs.find(t=>t.id===tid), price=isVip?Math.ceil(t.price*t.vipMult):t.price;
  const calc=document.getElementById('extend-calc'); calc.style.display='block';
  calc.innerHTML=`<div class="irow"><span>Добавить</span><span>${fmtDur(t.duration)}</span></div>
    <div class="irow"><span>Доплата</span><span class="gold">+${price} ${cur()}</span></div>`;
}
function confirmExtend() {
  if(!_extendTariffId){ toast('Выберите тариф','err'); return; }
  const s=S.sessions.find(x=>x.id===_extendSessId); if(!s) return;
  const pc=S.computers.find(c=>c.id===s.computerId);
  const tariff=S.tariffs.find(t=>t.id===_extendTariffId);
  const extraPrice=pc?.isVip?Math.ceil(tariff.price*tariff.vipMult):tariff.price;
  s.duration+=tariff.duration;
  s.remaining=(s.remaining||0)+tariff.duration*60;
  s.price+=extraPrice;
  s.overdue=false; s.warned=false;
  persist(); closeOverlay('overlay-extend'); renderComputers(); renderDashSessions();
  logAction('Сессия продлена', `${pc?.number} — +${fmtDur(tariff.duration)}`);
  toast(`Продлено на ${fmtDur(tariff.duration)} (+${extraPrice} ${cur()})`,'ok');
}

// ============================================================
//  COMPUTERS / ZONES MANAGEMENT
// ============================================================
function addPcToZone(zone) {
  if(!can('canManageZones')) return;
  const sel=document.getElementById('add-pc-zone');
  sel.innerHTML=S.zones.sort().map(z=>`<option value="${z}"${z===zone?' selected':''}>${z}</option>`).join('');
  openOverlay('overlay-add-pc'); setTimeout(()=>document.getElementById('add-pc-num').focus(),80);
}
function openAddPc() {
  if(!can('canManageZones')){ toast('Нет доступа','err'); return; }
  const sel=document.getElementById('add-pc-zone');
  sel.innerHTML=S.zones.sort().map(z=>`<option value="${z}">${z}</option>`).join('');
  openOverlay('overlay-add-pc'); setTimeout(()=>document.getElementById('add-pc-num').focus(),80);
}
function saveAddPc() {
  const num=val('add-pc-num').trim(), zone=val('add-pc-zone'), vip=document.getElementById('add-pc-vip').checked;
  if(!num){ toast('Введите номер','err'); return; }
  const fullNum=`${zone}-${num}`;
  if(S.computers.find(c=>c.number===fullNum)){ toast(`ПК ${fullNum} уже есть`,'err'); return; }
  S.computers.push({id:uid(),number:fullNum,zone,isVip:vip});
  document.getElementById('add-pc-num').value=''; document.getElementById('add-pc-vip').checked=false;
  persist(); closeOverlay('overlay-add-pc'); renderComputers(); logAction('Добавлен ПК',fullNum); toast(`Добавлен ${fullNum}`,'ok');
}
function openZonesModal() {
  if(!can('canManageZones')){ toast('Нет доступа','err'); return; }
  renderZonesList(); openOverlay('overlay-zones');
}
function addZone() {
  const name=val('new-zone-name').trim().toUpperCase();
  if(!name){ toast('Введите название','err'); return; }
  if(S.zones.includes(name)){ toast('Уже есть','err'); return; }
  S.zones.push(name); S.zones.sort(); document.getElementById('new-zone-name').value='';
  persist(); renderZonesList(); toast(`Зона ${name} добавлена`,'ok');
}
function deleteZone(zone) {
  const cnt=S.computers.filter(c=>c.zone===zone).length;
  if(cnt&&!confirm(`Зона ${zone}: ${cnt} ПК. Удалить всё?`)) return;
  S.computers=S.computers.filter(c=>c.zone!==zone);
  S.sessions=S.sessions.filter(s=>S.computers.find(c=>c.id===s.computerId));
  S.zones=S.zones.filter(z=>z!==zone);
  persist(); renderZonesList(); renderComputers(); toast(`Зона ${zone} удалена`,'info');
}
function renderZonesList() {
  const el=document.getElementById('zones-list'); if(!el) return;
  el.innerHTML=!S.zones.length?'<div class="empty-state" style="padding:1rem">Нет зон</div>':
    '<div class="zones-manage">'+S.zones.map(z=>{
      const cnt=S.computers.filter(c=>c.zone===z).length;
      return `<div class="zone-manage-row">
        <div><div class="zone-manage-name">ЗОНА ${z}</div><div class="zone-manage-info">${cnt} ПК</div></div>
        <button class="btn btn-danger btn-xs btn-icon" onclick="deleteZone('${z}')"><i class="fas fa-trash"></i></button>
      </div>`;
    }).join('')+'</div>';
}

// ============================================================
//  PRODUCTS
// ============================================================
let _prodSearch='', _prodFilter='';
function renderProducts(search, catFilter) {
  if(search!==undefined)    _prodSearch=search;
  if(catFilter!==undefined) _prodFilter=catFilter;
  const el=document.getElementById('products-grid'); if(!el) return;
  const addBtn=document.getElementById('btn-add-product');
  if(addBtn) addBtn.style.display=can('canManageProducts')?'inline-flex':'none';

  // Build category filter
  const cats=[...new Set(S.products.map(p=>p.category))].sort();
  const catEl=document.getElementById('prod-cat-filter');
  if(catEl&&catEl.children.length<=1){
    cats.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; catEl.appendChild(o); });
  }

  let prods=S.products;
  if(_prodSearch){ const q=_prodSearch.toLowerCase(); prods=prods.filter(p=>p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)); }
  if(_prodFilter) prods=prods.filter(p=>p.category===_prodFilter);

  if(!prods.length){ el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-box-open"></i>${_prodSearch?'Ничего не найдено':'Нет товаров'}</div>`; return; }
  el.innerHTML=prods.map(p=>{
    const maxQty=Math.max(1,p.qty+(p.soldQty||0)), pct=Math.round((p.qty/maxQty)*100);
    const isLow=p.qty<=S.settings.lowStockThreshold;
    return `<div class="product-card ${isLow?'low-stock':''}">
      <div class="prod-name">${p.name} ${isLow?'<span style="color:var(--red);font-size:0.7rem">⚠ МАЛО</span>':''}</div>
      <div class="prod-cat">${p.category}</div>
      <div class="prod-price">${p.price} ${cur()}</div>
      <div class="prod-row"><i class="fas fa-cubes" style="color:var(--orange)"></i> Склад: <strong style="${isLow?'color:var(--red)':''}">${p.qty}</strong> шт</div>
      <div class="prod-row"><i class="fas fa-shopping-cart" style="color:var(--gold)"></i> Продано: <strong>${p.soldQty||0}</strong> шт</div>
      <div class="prod-qty-bar"><div class="prod-qty-fill" style="width:${pct}%;${isLow?'background:var(--red)':''}"></div></div>
      <div class="prod-actions">
        <button class="btn btn-gold btn-sm" style="flex:1" onclick="openSell('${p.id}')"><i class="fas fa-cash-register"></i> Продать</button>
        ${can('canManageProducts')?`
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openRestockProduct('${p.id}')" title="Пополнить склад"><i class="fas fa-plus-circle"></i></button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditProduct('${p.id}')" title="Редактировать"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteProduct('${p.id}')"><i class="fas fa-trash"></i></button>`:''}
      </div>
    </div>`;
  }).join('');
}
function openAddProduct(){ if(!can('canManageProducts')){ toast('Нет доступа','err'); return; } openOverlay('overlay-add-product'); setTimeout(()=>document.getElementById('prod-name').focus(),80); }
function saveProduct(){
  const name=val('prod-name').trim(), cat=val('prod-cat').trim()||'Общее', price=parseFloat(val('prod-price')), qty=parseInt(val('prod-qty'));
  if(!name||isNaN(price)||isNaN(qty)||price<=0||qty<0){ toast('Заполните поля корректно','err'); return; }
  S.products.push({id:uid(),name,category:cat,price,qty,soldQty:0});
  ['prod-name','prod-cat','prod-price','prod-qty'].forEach(id=>document.getElementById(id).value='');
  persist(); closeOverlay('overlay-add-product'); renderProducts(); logAction('Товар добавлен',name); toast('Товар добавлен','ok');
}
function deleteProduct(id){
  if(!can('canManageProducts')) return;
  const p=S.products.find(p=>p.id===id);
  if(!confirm(`Удалить "${p.name}"?`)) return;
  S.products=S.products.filter(p=>p.id!==id);
  persist(); renderProducts(); logAction('Товар удалён',p.name); toast('Товар удалён','info');
}

// Restock
let _restockId=null;
function openRestockProduct(pid){
  _restockId=pid; const p=S.products.find(p=>p.id===pid);
  document.getElementById('restock-info').innerHTML=`<div class="irow"><span>${p.name}</span><span>Сейчас: <strong>${p.qty}</strong> шт</span></div>`;
  document.getElementById('restock-qty').value='';
  openOverlay('overlay-restock');
  setTimeout(()=>document.getElementById('restock-qty').focus(),80);
}
function confirmRestock(){
  const p=S.products.find(p=>p.id===_restockId), qty=parseInt(val('restock-qty'));
  if(!qty||qty<=0){ toast('Введите количество','err'); return; }
  p.qty+=qty; persist(); closeOverlay('overlay-restock'); renderProducts();
  logAction('Пополнение склада', `${p.name} +${qty} шт`); toast(`+${qty} шт к "${p.name}"`,'ok');
}

// Edit product
let _editProdId=null;
function openEditProduct(pid){
  _editProdId=pid; const p=S.products.find(p=>p.id===pid);
  document.getElementById('edit-prod-name').value=p.name;
  document.getElementById('edit-prod-cat').value=p.category;
  document.getElementById('edit-prod-price').value=p.price;
  openOverlay('overlay-edit-product');
  setTimeout(()=>document.getElementById('edit-prod-name').focus(),80);
}
function saveEditProduct(){
  const p=S.products.find(p=>p.id===_editProdId);
  const name=val('edit-prod-name').trim(), cat=val('edit-prod-cat').trim(), price=parseFloat(val('edit-prod-price'));
  if(!name||isNaN(price)||price<=0){ toast('Заполните поля корректно','err'); return; }
  p.name=name; p.category=cat||p.category; p.price=price;
  persist(); closeOverlay('overlay-edit-product'); renderProducts(); toast('Товар обновлён','ok');
}

// Sell
let _sellId=null;
function openSell(pid){
  _sellId=pid; const p=S.products.find(p=>p.id===pid);
  if(p.qty<=0){ toast('Товар закончился на складе','err'); return; }
  document.getElementById('sell-info').innerHTML=`<div class="irow"><span>Товар</span><span>${p.name}</span></div><div class="irow"><span>Цена/шт</span><span class="gold">${p.price} ${cur()}</span></div><div class="irow"><span>На складе</span><span>${p.qty} шт</span></div>`;
  document.getElementById('sell-qty').value=1; document.getElementById('sell-qty').max=p.qty;
  updateSellCalc(); openOverlay('overlay-sell'); setTimeout(()=>document.getElementById('sell-qty').select(),80);
}
function updateSellCalc(){
  if(!_sellId) return; const p=S.products.find(p=>p.id===_sellId), qty=parseInt(document.getElementById('sell-qty').value)||0;
  document.getElementById('sell-calc').innerHTML=`<div class="irow"><span>Количество</span><span>${qty} шт</span></div><div class="irow"><span>Итого</span><span class="gold">${p.price*qty} ${cur()}</span></div>`;
}
function confirmSell(){
  const p=S.products.find(p=>p.id===_sellId), qty=parseInt(val('sell-qty'));
  if(!qty||qty<=0){ toast('Введите количество','err'); return; }
  if(qty>p.qty)   { toast('Недостаточно на складе','err'); return; }
  p.qty-=qty; p.soldQty=(p.soldQty||0)+qty;
  const total=p.price*qty;
  S.sales.push({id:uid(),productId:p.id,productName:p.name,qty,total,date:Date.now(),operatorId:S.currentUser});
  S.cash.push({id:uid(),type:'sale',amount:total,desc:`Продажа: ${qty}× ${p.name}`,ts:Date.now(),operatorId:S.currentUser});
  persist(); closeOverlay('overlay-sell'); renderProducts();
  if(currentPage==='dashboard') renderDashboard();
  logAction('Продажа', `${qty}× ${p.name} = ${total} ${cur()}`);
  toast(`${qty}× ${p.name} = ${total} ${cur()}`,'ok');
}

// ============================================================
//  CLIENTS
// ============================================================
let _clientSearch='';
function renderClients(search){
  if(search!==undefined) _clientSearch=search;
  const el=document.getElementById('clients-grid'); if(!el) return;
  let clients=S.clients;
  if(_clientSearch){ const q=_clientSearch.toLowerCase(); clients=clients.filter(c=>c.name.toLowerCase().includes(q)||(c.phone||'').includes(q)); }
  clients=clients.sort((a,b)=>(b.totalSpent||0)-(a.totalSpent||0));
  if(!clients.length){
    el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-users"></i>${_clientSearch?'Ничего не найдено':'Нет клиентов'}</div>`; return;
  }
  el.innerHTML=clients.map(c=>{
    const lastDate=c.lastVisit?new Date(c.lastVisit).toLocaleDateString('ru-RU'):'—';
    return `<div class="product-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:0.8rem">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,106,0,0.15);border:1px solid rgba(255,106,0,0.3);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);color:var(--orange);font-size:1rem;flex-shrink:0">${c.name[0].toUpperCase()}</div>
        <div><div class="prod-name" style="margin:0">${c.name}</div>${c.phone?`<div style="font-size:0.75rem;color:var(--text2)">${c.phone}</div>`:''}</div>
      </div>
      <div class="prod-row"><i class="fas fa-calendar" style="color:var(--orange)"></i> Визитов: <strong>${c.visits||0}</strong></div>
      <div class="prod-row"><i class="fas fa-coins" style="color:var(--gold)"></i> Потрачено: <strong style="color:var(--gold)">${c.totalSpent||0} ${cur()}</strong></div>
      <div class="prod-row"><i class="fas fa-clock" style="color:var(--text3)"></i> Последний: ${lastDate}</div>
      ${c.note?`<div style="font-size:0.75rem;color:var(--text2);margin-top:0.5rem;padding:0.4rem;background:var(--bg4);border-radius:3px">${c.note}</div>`:''}
      <div class="prod-actions" style="margin-top:0.8rem">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="openClientHistory('${c.id}')"><i class="fas fa-history"></i> История</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditClient('${c.id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteClient('${c.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}
function openAddClient(){ openOverlay('overlay-add-client'); setTimeout(()=>document.getElementById('client-name').focus(),80); }
function saveClient(){
  const name=val('client-name').trim(), phone=val('client-phone').trim(), note=val('client-note').trim();
  if(!name){ toast('Введите имя','err'); return; }
  if(S.clients.find(c=>c.name===name)){ toast('Клиент уже есть','err'); return; }
  S.clients.push({id:uid(),name,phone,note,visits:0,totalSpent:0,createdAt:Date.now()});
  ['client-name','client-phone','client-note'].forEach(id=>document.getElementById(id).value='');
  persist(); closeOverlay('overlay-add-client'); renderClients(); toast('Клиент добавлен','ok');
}
let _editClientId=null;
function openEditClient(cid){
  _editClientId=cid; const c=S.clients.find(c=>c.id===cid);
  document.getElementById('edit-client-name').value=c.name;
  document.getElementById('edit-client-phone').value=c.phone||'';
  document.getElementById('edit-client-note').value=c.note||'';
  openOverlay('overlay-edit-client');
}
function saveEditClient(){
  const c=S.clients.find(c=>c.id===_editClientId);
  c.name=val('edit-client-name').trim()||c.name;
  c.phone=val('edit-client-phone').trim();
  c.note=val('edit-client-note').trim();
  persist(); closeOverlay('overlay-edit-client'); renderClients(); toast('Клиент обновлён','ok');
}
function deleteClient(cid){
  const c=S.clients.find(c=>c.id===cid);
  if(!confirm(`Удалить клиента ${c.name}?`)) return;
  S.clients=S.clients.filter(c=>c.id!==cid);
  persist(); renderClients(); toast('Клиент удалён','info');
}
function openClientHistory(cid){
  const c=S.clients.find(c=>c.id===cid);
  const sessions=S.history.filter(h=>h.client===c.name).slice(-20).reverse();
  const sales=S.sales.filter(s=>false); // TODO: track by client
  document.getElementById('client-hist-title').textContent=`История: ${c.name}`;
  document.getElementById('client-hist-content').innerHTML=`
    <div class="info-box" style="margin-bottom:1rem">
      <div class="irow"><span>Визиты</span><span>${c.visits||0}</span></div>
      <div class="irow"><span>Потрачено</span><span class="gold">${c.totalSpent||0} ${cur()}</span></div>
      <div class="irow"><span>Телефон</span><span>${c.phone||'—'}</span></div>
    </div>
    ${!sessions.length?'<div class="empty-state"><i class="fas fa-history"></i>Нет истории</div>':
      '<table><thead><tr><th>ПК</th><th>Тариф</th><th>Дата</th><th>Сумма</th></tr></thead><tbody>'+
      sessions.map(h=>{
        const pc=S.computers.find(c=>c.id===h.computerId);
        return `<tr><td>${pc?.number||'?'}</td><td>${h.tariffName}</td><td>${new Date(h.startedAt).toLocaleDateString('ru-RU')}</td><td style="color:var(--gold)">${h.price} ${cur()}</td></tr>`;
      }).join('')+'</tbody></table>'}`;
  openOverlay('overlay-client-history');
}

// ============================================================
//  TARIFFS
// ============================================================
function renderTariffs(){
  const grid=document.getElementById('tariff-grid'), tbody=document.getElementById('tariff-tbody'); if(!grid||!tbody) return;
  const addBtn=document.getElementById('btn-add-tariff'); if(addBtn) addBtn.style.display=can('canManageTariffs')?'inline-flex':'none';
  const tl={hourly:'Почасовой',fixed:'Фиксированный',night:'Ночной'}, tc={hourly:'tb-hourly',fixed:'tb-fixed',night:'tb-night'};
  grid.innerHTML=!S.tariffs.length?'<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-tags"></i>Нет тарифов</div>':
    S.tariffs.map(t=>`<div class="tariff-card ${t.type}">
      <div class="tariff-type-badge ${tc[t.type]||'tb-hourly'}">${tl[t.type]||t.type}</div>
      <div class="tariff-name">${t.name}</div><div class="tariff-price">${t.price} ${cur()}</div>
      <div class="tariff-dur"><i class="fas fa-clock" style="color:var(--orange);margin-right:4px"></i>${fmtDur(t.duration)}</div>
      <div class="tariff-vip">★ VIP ×${t.vipMult}</div>
      ${can('canManageTariffs')?`<div style="margin-top:0.8rem"><button class="btn btn-danger btn-xs" onclick="deleteTariff('${t.id}')"><i class="fas fa-trash"></i> Удалить</button></div>`:''}
    </div>`).join('');
  tbody.innerHTML=!S.tariffs.length?'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem">Нет тарифов</td></tr>':
    S.tariffs.map(t=>`<tr><td><strong>${t.name}</strong></td><td>${fmtDur(t.duration)}</td>
      <td><span style="font-family:var(--font-d);color:var(--gold)">${t.price} ${cur()}</span></td>
      <td>×${t.vipMult}</td>
      <td><span class="badge ${t.type==='night'?'badge-blue':t.type==='fixed'?'badge-green':'badge-orange'}">${tl[t.type]}</span></td>
    </tr>`).join('');
}
function saveTariff(){
  if(!can('canManageTariffs')){ toast('Нет доступа','err'); return; }
  const name=val('tar-name').trim(), type=val('tar-type'), dur=parseInt(val('tar-dur')), price=parseFloat(val('tar-price')), vip=parseFloat(val('tar-vip'))||1.5;
  if(!name||isNaN(dur)||isNaN(price)||dur<=0||price<=0){ toast('Заполните поля корректно','err'); return; }
  S.tariffs.push({id:uid(),name,type,duration:dur,price,vipMult:vip});
  ['tar-name','tar-dur','tar-price'].forEach(id=>document.getElementById(id).value='');
  persist(); closeOverlay('overlay-add-tariff'); renderTariffs(); toast('Тариф добавлен','ok');
}
function deleteTariff(id){
  if(!can('canManageTariffs')) return;
  if(!confirm('Удалить тариф?')) return;
  S.tariffs=S.tariffs.filter(t=>t.id!==id); persist(); renderTariffs(); toast('Тариф удалён','info');
}

// ============================================================
//  REPORTS
// ============================================================
let _repDateFrom='', _repDateTo='', _repOperator='all', chartStaffBar, chartDailyLine;

function renderReports(){
  const trs=S.history.reduce((a,h)=>a+h.price,0), trp=S.sales.reduce((a,s)=>a+s.total,0);
  // Today
  const ts=new Date(); ts.setHours(0,0,0,0); const tsN=ts.getTime();
  const todayRev=S.history.filter(h=>h.endedAt>=tsN).reduce((a,h)=>a+h.price,0)+S.sales.filter(s=>s.date>=tsN).reduce((a,s)=>a+s.total,0);

  document.getElementById('rep-stats').innerHTML=`
    <div class="stat-card"><div class="stat-label">Общая выручка</div><div class="stat-value">${trs+trp} с</div><div class="stat-sub">Сессии + Товары</div><div class="stat-bg-icon"><i class="fas fa-coins"></i></div></div>
    <div class="stat-card blue"><div class="stat-label">Сегодня</div><div class="stat-value">${todayRev} с</div><div class="stat-sub">${S.sessions.length} акт. сессий</div><div class="stat-bg-icon"><i class="fas fa-calendar-day"></i></div></div>
    <div class="stat-card green"><div class="stat-label">Выручка товаров</div><div class="stat-value">${trp} с</div><div class="stat-sub">${S.sales.length} продаж</div><div class="stat-bg-icon"><i class="fas fa-box"></i></div></div>`;

  // Build operator filter
  const opSel=document.getElementById('rep-op-filter');
  if(opSel&&opSel.options.length<=1){
    Object.entries(S.staff).forEach(([key,u])=>{
      const o=document.createElement('option'); o.value=key; o.textContent=u.name; opSel.appendChild(o);
    });
  }

  filterAndRenderHistory();
  filterAndRenderSales();

  // Shifts table
  document.getElementById('shifts-tbody').innerHTML=!S.shifts.length
    ?'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:1.5rem">Смен нет</td></tr>'
    :[...S.shifts].reverse().slice(0,40).map(sh=>{
      const op=S.staff[sh.userId];
      const dur=Math.floor((sh.endedAt-sh.startedAt)/60000), h=Math.floor(dur/60), m=dur%60;
      return `<tr>
        <td>${op?`<span style="color:var(--green)">${op.name}</span>`:'—'}</td>
        <td>${op?`<span class="badge ${op.role==='operator'?'badge-green':op.role==='manager'?'badge-blue':'badge-orange'}">${ROLES[op.role]?.label||op.role}</span>`:'—'}</td>
        <td>${new Date(sh.startedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
        <td>${new Date(sh.endedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
        <td>${h>0?h+'ч ':''} ${m}м</td>
        <td><span style="color:var(--gold);font-family:var(--font-d)">${sh.earned} ${cur()}</span></td>
      </tr>`;
    }).join('');

  renderAnalytics();
}

function filterAndRenderHistory(){
  const htbody=document.getElementById('history-tbody');
  let hist=[...S.history].reverse();
  if(_repDateFrom) hist=hist.filter(h=>new Date(h.startedAt)>=new Date(_repDateFrom));
  if(_repDateTo)   hist=hist.filter(h=>new Date(h.startedAt)<=new Date(_repDateTo+'T23:59:59'));
  if(_repOperator!=='all') hist=hist.filter(h=>h.operatorId===_repOperator);
  htbody.innerHTML=!hist.length
    ?'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:1.5rem">История пуста</td></tr>'
    :hist.slice(0,80).map(h=>{
      const pc=S.computers.find(c=>c.id===h.computerId), op=S.staff[h.operatorId];
      const dt=new Date(h.startedAt);
      return `<tr>
        <td><span style="font-family:var(--font-d);color:var(--orange)">${pc?.number||'?'}</span></td>
        <td>${h.client}</td><td>${h.tariffName}</td>
        <td>${dt.toLocaleDateString('ru-RU')} ${dt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</td>
        <td>${h.endedAt?new Date(h.endedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'—'}</td>
        <td>${op?`<span style="color:var(--green)">${op.name}</span>`:'—'}</td>
        <td><span style="color:var(--gold);font-family:var(--font-d)">${h.price} ${cur()}</span></td>
      </tr>`;
    }).join('');
}
function filterAndRenderSales(){
  const stbody=document.getElementById('sales-tbody');
  let sales=[...S.sales].reverse();
  if(_repDateFrom) sales=sales.filter(s=>new Date(s.date)>=new Date(_repDateFrom));
  if(_repDateTo)   sales=sales.filter(s=>new Date(s.date)<=new Date(_repDateTo+'T23:59:59'));
  if(_repOperator!=='all') sales=sales.filter(s=>s.operatorId===_repOperator);
  stbody.innerHTML=!sales.length
    ?'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem">Продаж нет</td></tr>'
    :sales.slice(0,80).map(s=>{
      const op=S.staff[s.operatorId];
      return `<tr><td>${s.productName}</td><td>${s.qty} шт</td>
        <td><span style="color:var(--gold)">${s.total} ${cur()}</span></td>
        <td>${op?`<span style="color:var(--green)">${op.name}</span>`:'—'}</td>
        <td>${new Date(s.date).toLocaleDateString('ru-RU')}</td></tr>`;
    }).join('');
}
function applyReportFilters(){
  _repDateFrom=val('rep-date-from'); _repDateTo=val('rep-date-to'); _repOperator=val('rep-op-filter');
  filterAndRenderHistory(); filterAndRenderSales(); toast('Фильтр применён','info');
}
function clearReportFilters(){
  _repDateFrom=''; _repDateTo=''; _repOperator='all';
  ['rep-date-from','rep-date-to'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('rep-op-filter').value='all';
  filterAndRenderHistory(); filterAndRenderSales();
}
function exportCSV(){
  const headers=['ПК','Клиент','Тариф','Начало','Конец','Оператор','Сумма'];
  const rows=S.history.map(h=>{
    const pc=S.computers.find(c=>c.id===h.computerId), op=S.staff[h.operatorId];
    return [pc?.number||'?',h.client,h.tariffName,new Date(h.startedAt).toLocaleString('ru-RU'),h.endedAt?new Date(h.endedAt).toLocaleString('ru-RU'):'',op?.name||'',h.price].join(',');
  });
  const csv='\uFEFF'+[headers.join(','),...rows].join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='oomat_sessions_'+new Date().toISOString().slice(0,10)+'.csv'; a.click(); toast('CSV экспортирован','ok');
}
function clearHistory(){ if(!confirm('Очистить историю сессий?')) return; S.history=[]; persist(); renderReports(); toast('История очищена','info'); }
function clearSales(){   if(!confirm('Очистить историю продаж?')) return; S.sales=[];   persist(); renderReports(); toast('История продаж очищена','info'); }

// ============================================================
//  ANALYTICS
// ============================================================
function renderAnalytics(){
  const opStats={};
  Object.entries(S.staff).forEach(([key,u])=>{
    const sr=S.history.filter(h=>h.operatorId===key).reduce((a,h)=>a+h.price,0);
    const pr=S.sales.filter(s=>s.operatorId===key).reduce((a,s)=>a+s.total,0);
    opStats[key]={name:u.name,role:u.role,sr,pr,total:sr+pr,sc:S.history.filter(h=>h.operatorId===key).length,pc:S.sales.filter(s=>s.operatorId===key).length};
  });
  const opList=Object.values(opStats).sort((a,b)=>b.total-a.total);

  document.getElementById('op-stats-body').innerHTML=!opList.length
    ?'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:1rem">Нет данных</td></tr>'
    :opList.map(o=>`<tr>
      <td><strong>${o.name}</strong></td>
      <td><span class="badge ${o.role==='operator'?'badge-green':o.role==='manager'?'badge-blue':'badge-orange'}">${ROLES[o.role]?.label||o.role}</span></td>
      <td>${o.sc}</td><td>${o.pc}</td>
      <td><span style="color:var(--amber)">${o.sr} ${cur()}</span></td>
      <td><span style="color:var(--gold);font-family:var(--font-d)">${o.total} ${cur()}</span></td>
    </tr>`).join('');

  const scCtx=document.getElementById('chart-staff-earn');
  if(scCtx){ if(chartStaffBar) chartStaffBar.destroy();
    chartStaffBar=new Chart(scCtx.getContext('2d'),{type:'bar',
      data:{labels:opList.map(o=>o.name.split(' ')[0]),datasets:[
        {label:'Сессии',data:opList.map(o=>o.sr),backgroundColor:'rgba(255,106,0,0.4)',borderColor:'rgba(255,106,0,0.8)',borderWidth:1,borderRadius:3},
        {label:'Товары',data:opList.map(o=>o.pr),backgroundColor:'rgba(57,255,135,0.3)',borderColor:'rgba(57,255,135,0.7)',borderWidth:1,borderRadius:3},
      ]},
      options:{responsive:true,plugins:{legend:{labels:{color:'#7a7068',font:{family:'Exo 2',size:11}}}},
        scales:{y:{grid:{color:'rgba(255,106,0,0.06)'},ticks:{color:'#7a7068',font:{family:'Exo 2'}}},x:{grid:{display:false},ticks:{color:'#7a7068',font:{family:'Exo 2'}}}}}
    });
  }

  const dlCtx=document.getElementById('chart-daily-line');
  if(dlCtx){ const labels30=[],sr30=[],pr30=[];
    for(let i=29;i>=0;i--){
      const d=new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
      const de=new Date(d); de.setHours(23,59,59,999);
      sr30.push(S.history.filter(h=>h.endedAt>=d.getTime()&&h.endedAt<=de.getTime()).reduce((a,h)=>a+h.price,0));
      pr30.push(S.sales.filter(s=>s.date>=d.getTime()&&s.date<=de.getTime()).reduce((a,s)=>a+s.total,0));
      labels30.push(i%5===0?`${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}`:'');
    }
    if(chartDailyLine) chartDailyLine.destroy();
    chartDailyLine=new Chart(dlCtx.getContext('2d'),{type:'line',
      data:{labels:labels30,datasets:[
        {label:'Сессии',data:sr30,borderColor:'rgba(255,106,0,0.8)',backgroundColor:'rgba(255,106,0,0.08)',fill:true,tension:0.4,borderWidth:2,pointRadius:2},
        {label:'Товары',data:pr30,borderColor:'rgba(57,255,135,0.7)',backgroundColor:'rgba(57,255,135,0.06)',fill:true,tension:0.4,borderWidth:2,pointRadius:2},
      ]},
      options:{responsive:true,plugins:{legend:{labels:{color:'#7a7068',font:{family:'Exo 2',size:11}}}},
        scales:{y:{grid:{color:'rgba(255,106,0,0.06)'},ticks:{color:'#7a7068',font:{family:'Exo 2'}}},x:{grid:{display:false},ticks:{color:'#7a7068',font:{family:'Exo 2'},maxRotation:0}}}}
    });
  }

  // Top PCs
  const pcRevs={};
  S.history.forEach(h=>{const pc=S.computers.find(c=>c.id===h.computerId);const k=pc?.number||'?';pcRevs[k]=(pcRevs[k]||0)+h.price;});
  document.getElementById('top-pcs-body').innerHTML=Object.entries(pcRevs).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([num,rev],i)=>`<tr><td><span style="color:var(--text3);margin-right:6px">#${i+1}</span><strong style="font-family:var(--font-d);color:var(--orange)">${num}</strong></td><td><span style="color:var(--gold)">${rev} ${cur()}</span></td></tr>`).join('')
    ||'<tr><td colspan="2" style="text-align:center;color:var(--text3);padding:1rem">Нет данных</td></tr>';

  // Top products
  const prodRevs={};
  S.sales.forEach(s=>{prodRevs[s.productName]=(prodRevs[s.productName]||0)+s.total;});
  document.getElementById('top-prods-body').innerHTML=Object.entries(prodRevs).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([name,rev],i)=>`<tr><td><span style="color:var(--text3);margin-right:6px">#${i+1}</span>${name}</td><td><span style="color:var(--gold)">${rev} ${cur()}</span></td></tr>`).join('')
    ||'<tr><td colspan="2" style="text-align:center;color:var(--text3);padding:1rem">Нет данных</td></tr>';

  // Top clients
  const topClients=[...S.clients].sort((a,b)=>(b.totalSpent||0)-(a.totalSpent||0)).slice(0,5);
  document.getElementById('top-clients-body').innerHTML=!topClients.length
    ?'<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:1rem">Нет данных</td></tr>'
    :topClients.map((c,i)=>`<tr><td><span style="color:var(--text3);margin-right:6px">#${i+1}</span>${c.name}</td><td>${c.visits||0}</td><td><span style="color:var(--gold)">${c.totalSpent||0} ${cur()}</span></td></tr>`).join('');

  // My shift summary
  const myShifts=S.shifts.filter(sh=>sh.userId===S.currentUser);
  set('my-shift-total',myShifts.reduce((a,sh)=>a+sh.earned,0)+' '+cur());
  set('my-shift-count',myShifts.length+' смен');
  document.getElementById('my-shifts-body').innerHTML=!myShifts.length
    ?'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1rem">Нет завершённых смен</td></tr>'
    :[...myShifts].reverse().slice(0,10).map(sh=>{
      const dur=Math.floor((sh.endedAt-sh.startedAt)/60000), h=Math.floor(dur/60), m=dur%60;
      return `<tr><td>${new Date(sh.startedAt).toLocaleDateString('ru-RU')}</td>
        <td>${new Date(sh.startedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</td>
        <td>${new Date(sh.endedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</td>
        <td>${h>0?h+'ч ':''} ${m}м</td>
        <td><span style="color:var(--gold);font-family:var(--font-d)">${sh.earned} ${cur()}</span></td>
      </tr>`;
    }).join('');
}

// ============================================================
//  STAFF
// ============================================================
function renderStaff(){
  const tbody=document.getElementById('staff-tbody'); if(!tbody) return;
  const addBtn=document.getElementById('btn-add-staff'); if(addBtn) addBtn.style.display=can('canAddStaff')?'inline-flex':'none';
  tbody.innerHTML=Object.entries(S.staff).map(([key,u])=>{
    const role=ROLES[u.role], isMe=key===S.currentUser;
    const shifts=S.shifts.filter(sh=>sh.userId===key), earned=shifts.reduce((a,sh)=>a+sh.earned,0);
    const canDel=can('canDeleteStaff')&&!isMe;
    return `<tr ${isMe?'style="background:rgba(255,106,0,0.04)"':''}>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="width:30px;height:30px;border-radius:50%;background:rgba(255,106,0,0.1);border:1px solid ${role.color};display:flex;align-items:center;justify-content:center;font-family:var(--font-d);color:${role.color}">${u.name[0].toUpperCase()}</div>
        <div><div style="font-weight:700">${u.name} ${isMe?'<span style="color:var(--orange);font-size:0.7rem">(вы)</span>':''}</div><div style="font-size:0.75rem;color:var(--text3)">${key}</div></div>
      </div></td>
      <td><span class="badge ${u.role==='sysadmin'?'badge-orange':u.role==='manager'?'badge-blue':'badge-green'}"><i class="fas ${role.icon}" style="margin-right:3px"></i>${role.label}</span></td>
      <td>${shifts.length}</td>
      <td><span style="color:var(--gold);font-family:var(--font-d)">${earned} ${cur()}</span></td>
      <td>${new Date(u.createdAt).toLocaleDateString('ru-RU')}</td>
      <td style="display:flex;gap:4px;align-items:center">
        ${isMe?`<button class="btn btn-ghost btn-xs" onclick="openOverlay('overlay-change-pass')" title="Сменить пароль"><i class="fas fa-key"></i></button>`:''}
        ${can('canAddStaff')&&!isMe?`<button class="btn btn-ghost btn-xs" onclick="resetPass('${key}')" title="Сбросить пароль"><i class="fas fa-unlock"></i></button>`:''}
        ${canDel?`<button class="btn btn-danger btn-xs" onclick="deleteStaff('${key}')"><i class="fas fa-user-minus"></i></button>`:''}
      </td>
    </tr>`;
  }).join('');
  const c=countRoles();
  set('role-count-sysadmin',`${c.sysadmin}/1`); set('role-count-manager',`${c.manager}/1`); set('role-count-operator',`${c.operator}/3`);
}
function deleteStaff(key){
  if(!can('canDeleteStaff')) return; if(key===S.currentUser){ toast('Нельзя удалить себя','err'); return; }
  if(!confirm(`Удалить ${S.staff[key].name}?`)) return;
  delete S.staff[key]; persist(); renderStaff(); toast('Сотрудник удалён','info');
}
function resetPass(key){
  if(!can('canAddStaff')) return;
  const p=prompt(`Новый пароль для ${S.staff[key].name}:`);
  if(!p||p.length<4){ toast('Пароль минимум 4 символа','err'); return; }
  S.staff[key].pass=p; persist(); toast('Пароль изменён','ok');
}

// ============================================================
//  SETTINGS PAGE
// ============================================================
function renderSettings(){
  document.getElementById('set-club-name').value=S.settings.clubName||'';
  document.getElementById('set-currency').value=S.settings.currency||'сом';
  document.getElementById('set-low-stock').value=S.settings.lowStockThreshold||5;
  document.getElementById('set-warn-min').value=S.settings.warningMinutes||10;
  // Log
  const logEl=document.getElementById('actlog-body');
  if(logEl) logEl.innerHTML=!S.actlog.length
    ?'<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:1rem">Лог пуст</td></tr>'
    :S.actlog.slice(0,50).map(l=>`<tr>
      <td>${new Date(l.ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</td>
      <td>${new Date(l.ts).toLocaleDateString('ru-RU')}</td>
      <td><span style="color:var(--green)">${l.userName}</span></td>
      <td>${l.action}${l.detail?` <span style="color:var(--text2);font-size:0.8rem">— ${l.detail}</span>`:''}</td>
    </tr>`).join('');
}
function saveSettings(){
  const name=val('set-club-name').trim()||'OOMAT Gaming Club';
  const cur2=val('set-currency').trim()||'сом';
  const lowS=parseInt(val('set-low-stock'))||5;
  const warnM=parseInt(val('set-warn-min'))||10;
  S.settings={clubName:name,currency:cur2,lowStockThreshold:lowS,warningMinutes:warnM};
  persist(); updateClubBranding(); toast('Настройки сохранены','ok'); logAction('Настройки изменены');
}

// ============================================================
//  EXPORT / IMPORT / RESET / DEMO
// ============================================================
function exportData(){
  const d=JSON.stringify({staff:S.staff,settings:S.settings,zones:S.zones,computers:S.computers,tariffs:S.tariffs,products:S.products,clients:S.clients,sessions:S.sessions,history:S.history,sales:S.sales,shifts:S.shifts,cash:S.cash,actlog:S.actlog},null,2);
  const a=document.createElement('a'); a.href='data:application/json,'+encodeURIComponent(d);
  a.download='oomat_v5_'+new Date().toISOString().slice(0,10)+'.json'; a.click(); toast('Экспорт JSON выполнен','ok');
}
function importData(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{ try{
    const d=JSON.parse(e.target.result);
    ['staff','settings','zones','computers','tariffs','products','clients','sessions','history','sales','shifts','cash','actlog'].forEach(k=>{ if(d[k]) S[k]=d[k]; });
    persist(); navigate(currentPage); updateClubBranding(); toast('Данные импортированы','ok');
  }catch{ toast('Ошибка импорта','err'); } };
  reader.readAsText(file); input.value='';
}
function resetAll(){
  if(!can('canResetData')){ toast('Нет доступа','err'); return; }
  if(!confirm('СБРОСИТЬ ВСЕ ДАННЫЕ?')) return;
  localStorage.removeItem(DB);
  S.zones=['A','B','VIP']; S.computers=[]; S.tariffs=[]; S.products=[]; S.clients=[];
  S.sessions=[]; S.history=[]; S.sales=[]; S.shifts=[]; S.cash=[]; S.actlog=[]; S.activeShift=null;
  loadDefaultTariffs(); navigate(currentPage); toast('Данные сброшены','info');
}
function loadDemoAndRefresh(){ loadDemo(); navigate(currentPage); toast('Демо загружено','ok'); }
function loadDemo(){
  S.zones=['A','B','VIP']; if(S.tariffs.length===0) loadDefaultTariffs();
  S.computers=[
    {id:'pc-a1',number:'A-1',zone:'A',isVip:false},{id:'pc-a2',number:'A-2',zone:'A',isVip:false},
    {id:'pc-a3',number:'A-3',zone:'A',isVip:false},{id:'pc-a4',number:'A-4',zone:'A',isVip:false},
    {id:'pc-a5',number:'A-5',zone:'A',isVip:false},{id:'pc-b1',number:'B-1',zone:'B',isVip:false},
    {id:'pc-b2',number:'B-2',zone:'B',isVip:false},{id:'pc-b3',number:'B-3',zone:'B',isVip:false},
    {id:'pc-b4',number:'B-4',zone:'B',isVip:false},{id:'pc-v1',number:'VIP-1',zone:'VIP',isVip:true},
    {id:'pc-v2',number:'VIP-2',zone:'VIP',isVip:true},
  ];
  S.products=[
    {id:'p1',name:'Red Bull 250ml',category:'Напитки',price:200,qty:18,soldQty:89},
    {id:'p2',name:'Чипсы Lays',category:'Снеки',price:150,qty:3,soldQty:156},
    {id:'p3',name:'Вода 0.5л',category:'Напитки',price:40,qty:68,soldQty:312},
    {id:'p4',name:'Кофе',category:'Горячие',price:80,qty:2,soldQty:74},
    {id:'p5',name:'Kit-Kat',category:'Сладкое',price:100,qty:25,soldQty:67},
  ];
  S.clients=[
    {id:'cl1',name:'Жоомарт',phone:'+996 555 001',visits:15,totalSpent:1850,createdAt:Date.now()-30*86400000,lastVisit:Date.now()-86400000,note:'Постоянный клиент'},
    {id:'cl2',name:'Айгуль',  phone:'+996 555 002',visits:8, totalSpent:920, createdAt:Date.now()-20*86400000,lastVisit:Date.now()-3*86400000,note:''},
    {id:'cl3',name:'Марат',   phone:'+996 555 003',visits:22,totalSpent:3100,createdAt:Date.now()-60*86400000,lastVisit:Date.now()-43200000,note:'VIP клиент'},
    {id:'cl4',name:'Нурлан',  phone:'',           visits:3, totalSpent:250, createdAt:Date.now()-5*86400000, lastVisit:Date.now()-2*86400000,note:''},
  ];
  if(!S.staff['op1']) S.staff['op1']={pass:'op123',name:'Дастан Оп.',role:'operator',createdAt:Date.now()-86400000};
  if(!S.staff['op2']) S.staff['op2']={pass:'op456',name:'Бакыт Оп.',role:'operator',createdAt:Date.now()-172800000};
  if(!S.staff['mgr1'])S.staff['mgr1']={pass:'mgr123',name:'Айгуль Мгр.',role:'manager',createdAt:Date.now()-259200000};
  const now=Date.now(), t1=S.tariffs[1], t2=S.tariffs[2], t3=S.tariffs[3];
  S.sessions=[
    {id:'s1',computerId:'pc-a2',client:'Жоомарт',tariffId:t1.id,tariffName:t1.name,duration:t1.duration,price:50,startedAt:now-20*60000,remaining:40*60,overdue:false,warned:false,operatorId:'sysadmin'},
    {id:'s2',computerId:'pc-b2',client:'Марат',  tariffId:t2.id,tariffName:t2.name,duration:t2.duration,price:90,startedAt:now-45*60000,remaining:75*60,overdue:false,warned:false,operatorId:'op1'},
    {id:'s3',computerId:'pc-v1',client:'Айгуль', tariffId:t3.id,tariffName:t3.name,duration:t3.duration,price:195,startedAt:now-80*60000,remaining:100*60,overdue:false,warned:false,operatorId:'mgr1'},
  ];
  S.history=[
    {id:'h1',computerId:'pc-a1',client:'Жоомарт',tariffName:'1 час', duration:60,price:50,startedAt:now-4*3600000,endedAt:now-3*3600000,operatorId:'sysadmin'},
    {id:'h2',computerId:'pc-b1',client:'Марат',  tariffName:'2 часа',duration:120,price:90,startedAt:now-6*3600000,endedAt:now-4*3600000,operatorId:'op1'},
    {id:'h3',computerId:'pc-v2',client:'Нурлан', tariffName:'Ночной',duration:480,price:390,startedAt:now-14*3600000,endedAt:now-6*3600000,operatorId:'mgr1'},
    {id:'h4',computerId:'pc-a3',client:'Айгуль', tariffName:'2 часа',duration:120,price:90,startedAt:now-8*3600000,endedAt:now-6*3600000,operatorId:'op2'},
  ];
  S.sales=[
    {id:'sl1',productId:'p1',productName:'Red Bull 250ml',qty:3,total:600,date:now-3600000,operatorId:'op1'},
    {id:'sl2',productId:'p2',productName:'Чипсы Lays',qty:2,total:300,date:now-5400000,operatorId:'sysadmin'},
    {id:'sl3',productId:'p3',productName:'Вода 0.5л',qty:5,total:200,date:now-7200000,operatorId:'op2'},
  ];
  S.shifts=[
    {id:'sh1',userId:'op1', userName:'Дастан Оп.', startedAt:now-9*3600000,endedAt:now-4*3600000,revenueAtStart:0,revenueAtEnd:690,earned:690},
    {id:'sh2',userId:'mgr1',userName:'Айгуль Мгр.',startedAt:now-11*3600000,endedAt:now-2*3600000,revenueAtStart:0,revenueAtEnd:890,earned:890},
    {id:'sh3',userId:'op2', userName:'Бакыт Оп.',  startedAt:now-7*3600000,endedAt:now-1*3600000,revenueAtStart:0,revenueAtEnd:390,earned:390},
  ];
  persist();
}

// ============================================================
//  OVERLAYS
// ============================================================
function openOverlay(id){ document.getElementById(id).classList.add('open'); }
function closeOverlay(id){ document.getElementById(id).classList.remove('open'); }
document.addEventListener('click',e=>{ if(e.target.classList.contains('overlay')) e.target.classList.remove('open'); });

// ============================================================
//  HOTKEYS
// ============================================================
document.addEventListener('keydown',e=>{
  if(!S.currentUser){ if(e.key==='Enter') login(); return; }
  if(document.querySelector('.overlay.open')){ if(e.key==='Escape') document.querySelectorAll('.overlay.open').forEach(o=>o.classList.remove('open')); return; }
  if(e.ctrlKey){
    const map={'1':'dashboard','2':'computers','3':'products','4':'clients','5':'tariffs','6':'reports','7':'staff','0':'settings'};
    if(map[e.key]){ e.preventDefault(); navigate(map[e.key]); }
    if(e.key==='s'){ e.preventDefault(); persist(); toast('Сохранено','ok'); }
    if(e.key==='q'){ e.preventDefault(); logout(); }
  }
});

// ============================================================
//  UTILS
// ============================================================
function val(id){ return document.getElementById(id)?.value||''; }
function set(id,txt){ const el=document.getElementById(id); if(el) el.textContent=txt; }
function fmtTime(s){ return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function fmtDur(m){ if(m<60) return m+' мин'; const h=Math.floor(m/60),r=m%60; return r?`${h}ч ${r}м`:`${h} ч`; }
function toast(msg,type='info'){
  const el=document.createElement('div'), icons={ok:'check-circle',err:'times-circle',info:'exclamation-circle'};
  el.className=`toast ${type}`; el.innerHTML=`<i class="fas fa-${icons[type]||'info-circle'}"></i> ${msg}`;
  document.getElementById('toast-root').appendChild(el); setTimeout(()=>el.remove(),3200);
}
document.getElementById('login-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
document.getElementById('login-user').addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
