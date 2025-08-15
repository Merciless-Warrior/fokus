const LS_TASKS = 'fb_tasks_v1';
const LS_SESS  = 'fb_sessions_v1';

const COOKIE_DAYS  = 3650;
const COOKIE_CHUNK = 3500;

function setCookie(name, value, days) {
  const d = new Date(); d.setTime(d.getTime() + days*864e5);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}
function getCookie(name) {
  const re = new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)');
  const m = document.cookie.match(re); return m ? decodeURIComponent(m[1]) : null;
}
function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}
function setCookieChunked(prefix, str, days) {
  const old = Number(getCookie(prefix + '_n') || 0);
  for (let i=0;i<old;i++) deleteCookie(`${prefix}_${i}`);
  const parts = Math.ceil(str.length / COOKIE_CHUNK);
  for (let i=0;i<parts;i++) setCookie(`${prefix}_${i}`, str.slice(i*COOKIE_CHUNK,(i+1)*COOKIE_CHUNK), days);
  setCookie(prefix + '_n', String(parts), days);
}
function getCookieChunked(prefix) {
  const n = Number(getCookie(prefix + '_n') || 0);
  if (!n) return null;
  let out = '';
  for (let i=0;i<n;i++) {
    const p = getCookie(`${prefix}_${i}`); if (p == null) return null; out += p;
  }
  return out;
}

const state = { tasks: [], sessions: [] };
let mode = 'focus';
let endAt = null;
let tickId = null;
let activeTaskId = null;
let chart;

function newId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8); return v.toString(16);
  });
}
function el(id){ return document.getElementById(id); }
function isRunning(){ return endAt !== null; }
function setTimeBox(sec){
  const m = String(Math.floor(sec/60)).padStart(2,'0');
  const s = String(Math.floor(sec%60)).padStart(2,'0');
  el('timeLeft').textContent = `${m}:${s}`;
}
function getFocusMinutes(){
  let m = Number(el('lenFocus').value) || 25;
  if (activeTaskId){
    const t = state.tasks.find(x=>x.id===activeTaskId);
    if (t && t.est) m = Number(t.est);
  }
  return Math.max(1, m);
}
function getBreakMinutes(){ return Math.max(1, Number(el('lenBreak').value) || 5); }
function selectTask(id){
  const sel = el('taskSelect');
  sel.value = id || '';
  activeTaskId = id || null;
  if (!isRunning() && mode==='focus') setTimeBox(getFocusMinutes()*60);
}

function save(){
  const tasksJson = JSON.stringify(state.tasks);
  const sessJson  = JSON.stringify(state.sessions);
  localStorage.setItem(LS_TASKS, tasksJson);
  localStorage.setItem(LS_SESS,  sessJson);
  setCookieChunked(LS_TASKS, tasksJson, COOKIE_DAYS);
  setCookieChunked(LS_SESS,   sessJson,  COOKIE_DAYS);
}
function load(){
  let tRaw = localStorage.getItem(LS_TASKS) || getCookieChunked(LS_TASKS);
  let sRaw = localStorage.getItem(LS_SESS)  || getCookieChunked(LS_SESS);
  try{ state.tasks = JSON.parse(tRaw || '[]'); }catch{ state.tasks = []; }
  try{ state.sessions = JSON.parse(sRaw || '[]'); }catch{ state.sessions = []; }
}
function hardReset(){
  if (!confirm('Удалить все данные?')) return;
  localStorage.removeItem(LS_TASKS); localStorage.removeItem(LS_SESS);
  setCookieChunked(LS_TASKS,'[]',0); setCookieChunked(LS_SESS,'[]',0);
  deleteCookie(LS_TASKS+'_n'); deleteCookie(LS_SESS+'_n');
  state.tasks=[]; state.sessions=[]; save(); render();
}

function addTask(title, est){
  const t = (title||'').trim(); if (!t) return;
  const minutes = Math.max(5, Number(est) || 25);
  state.tasks.push({ id:newId(), title:t, status:'todo', est:minutes, createdAt:new Date().toISOString(), completedAt:null });
  save(); render();
}
function moveTask(id, status){
  const t = state.tasks.find(x=>x.id===id); if(!t) return;

  if (status==='doing'){
    state.tasks.forEach(x=>{ if(x.id!==id && x.status==='doing') x.status='todo'; });
  }
  t.status = status;

  if (status==='done' && !t.completedAt){
    t.completedAt = new Date().toISOString();
    if (activeTaskId===t.id) selectTask('');
  }
  if (status==='doing'){
    selectTask(t.id);
    if (!isRunning()){
      mode='focus';
      resetTimer();
      startTimer();
    }
  }
  save(); render();
}
function deleteTask(id){
  if (activeTaskId===id) selectTask('');
  state.tasks = state.tasks.filter(t=>t.id!==id);
  save(); render();
}

function node(tag, attrs={}, ...children){
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k==='class') e.className=v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k==='dataset') Object.entries(v).forEach(([dk,dv])=> e.dataset[dk]=dv);
    else e.setAttribute(k,v);
  });
  children.forEach(c=>{
    if (c==null) return;
    if (typeof c==='string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}
function renderKanban(){
  const cols = {
    todo:  document.querySelector('.drop[data-col="todo"]'),
    doing: document.querySelector('.drop[data-col="doing"]'),
    done:  document.querySelector('.drop[data-col="done"]')
  };
  Object.values(cols).forEach(c=>c.innerHTML='');

  const counts = { todo:0, doing:0, done:0 };

  state.tasks.forEach(t=>{
    counts[t.status]++;
    const card = node('div',{class:'task',draggable:true});
    card.addEventListener('dragstart',ev=>ev.dataTransfer.setData('text/plain',t.id));
    card.append(
      node('div',{class:'title'}, t.title),
      node('div',{class:'meta'}, `оценка: ${t.est} мин`),
      node('div',{class:'row'},
        node('button',{class:'btn',onclick:()=>moveTask(t.id,'doing')},'В работу'),
        node('button',{class:'btn',onclick:()=>moveTask(t.id,'done')},'Готово'),
        node('button',{class:'btn danger',onclick:()=>deleteTask(t.id)},'Удалить')
      )
    );
    cols[t.status].append(card);
  });

  el('todoCount').textContent  = counts.todo;
  el('doingCount').textContent = counts.doing;
  el('doneCount').textContent  = counts.done;

  const sel = el('taskSelect');
  sel.innerHTML = '';
  sel.append(node('option',{value:''},'— Без задачи —'));
  state.tasks.filter(t=>t.status!=='done').forEach(t=>{
    sel.append(node('option',{value:t.id}, t.title));
  });

  selectTask(activeTaskId);
}
function enableDnD(){
  document.querySelectorAll('.drop').forEach(zone=>{
    zone.addEventListener('dragover',e=>{ e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave',()=> zone.classList.remove('drag-over'));
    zone.addEventListener('drop',e=>{
      e.preventDefault(); zone.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      moveTask(id, zone.dataset.col);
    });
  });
}

function startTimer(){
  const sel = el('taskSelect'); activeTaskId = sel.value || activeTaskId || null;
  const minutes = (mode==='focus'?getFocusMinutes():getBreakMinutes());
  endAt = Date.now() + minutes*60*1000;

  state.sessions.push({
    id:newId(), taskId:activeTaskId, type:mode, startedAt:new Date().toISOString()
  });
  save();
  tick();
}
function closeLastSession(){
  for(let i=state.sessions.length-1;i>=0;i--){
    const s = state.sessions[i];
    if (!s.endedAt){
      s.endedAt = new Date().toISOString();
      s.durationSec = Math.max(1, ((new Date(s.endedAt)-new Date(s.startedAt))/1000)|0);
      break;
    }
  }
  save();
}
function pauseTimer(){
  if (!endAt) return;
  clearTimeout(tickId);
  closeLastSession();
  const left = Math.max(0, endAt - Date.now());
  setTimeBox(Math.floor(left/1000));
  endAt = null;
}
function resetTimer(){
  clearTimeout(tickId);
  endAt = null;
  const minutes = (mode==='focus'?getFocusMinutes():getBreakMinutes());
  setTimeBox(minutes*60);
}
function tick(){
  const left = Math.max(0, endAt - Date.now());
  setTimeBox(Math.floor(left/1000));
  if (left<=0){
    closeLastSession();
    mode = (mode==='focus')?'break':'focus';
    endAt = null;
    setTimeBox((mode==='focus'?getFocusMinutes():getBreakMinutes())*60);
    updateStats();
    return;
  }
  tickId = setTimeout(tick, 250);
}
function updateStats(){
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfWeek.getDate()-6);

  const doneToday = state.tasks.filter(t=>t.completedAt && new Date(t.completedAt)>=startOfDay).length;
  const doneWeek  = state.tasks.filter(t=>t.completedAt && new Date(t.completedAt)>=startOfWeek).length;
  el('doneToday').textContent = doneToday;
  el('doneWeek').textContent  = doneWeek;

  const days=[], mins=[];
  for(let i=6;i>=0;i--){
    const d = new Date(startOfDay); d.setDate(d.getDate()-i);
    const label = d.toISOString().slice(5,10);
    const sum = state.sessions
      .filter(s =>
        s.type==='focus' && s.endedAt &&
        new Date(s.startedAt) >= new Date(d.getFullYear(),d.getMonth(),d.getDate()) &&
        new Date(s.startedAt) <  new Date(d.getFullYear(),d.getMonth(),d.getDate()+1)
      )
      .reduce((a,b)=> a + Math.round((b.durationSec||0)/60), 0);
    days.push(label); mins.push(sum);
  }

  const ctx = el('chartFocus');
  if (chart) chart.destroy();
  if (typeof Chart !== 'undefined' && ctx){
    chart = new Chart(ctx, {
      type:'bar',
      data:{ labels:days, datasets:[{ label:'мин', data:mins }] },
      options:{ plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true } } }
    });
  }
}

function exportJson(){
  const blob = new Blob([JSON.stringify({tasks:state.tasks, sessions:state.sessions},null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='focusboard.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function importJson(file){
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const data = JSON.parse(r.result);
      if (Array.isArray(data.tasks)) state.tasks = data.tasks;
      if (Array.isArray(data.sessions)) state.sessions = data.sessions;
      save(); render();
    }catch{ alert('Некорректный JSON'); }
  };
  r.readAsText(file);
}
function applyTheme(t){ document.documentElement.className=t; localStorage.setItem('fb_theme',t); }

async function exportPDF({ fit = 'a4', margin = 10 } = {}) {
  const { jsPDF } = window.jspdf || {};
  if (!window.html2canvas || !jsPDF) {
    alert('PDF не доступен: нет html2canvas/jsPDF');
    return;
  }

  const target = document.querySelector('.app');
  const bg = getComputedStyle(document.body).backgroundColor;


  const canvas = await html2canvas(target, {
    scale: 2,
    backgroundColor: bg,
    useCORS: true,
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth:  target.scrollWidth,
    windowHeight: target.scrollHeight
  });

  const imgData = canvas.toDataURL('image/png');
  const imgPxW = canvas.width;
  const imgPxH = canvas.height;
  const aspect = imgPxW / imgPxH;

  if (fit === 'auto') {

    const px2mm = 0.264583;
    const pageW = imgPxW * px2mm + margin * 2;
    const pageH = imgPxH * px2mm + margin * 2;

    const pdf = new jsPDF({ orientation: pageW > pageH ? 'l' : 'p', unit: 'mm', format: [pageW, pageH] });
    pdf.addImage(imgData, 'PNG', margin, margin, pageW - margin * 2, pageH - margin * 2);
    pdf.save('focusboard_onepage.pdf');
    return;
  }


  const a4w = 210, a4h = 297;

  function fitInto(pageW, pageH) {
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;

    const w = Math.min(maxW, maxH * aspect);
    const h = w / aspect;
    return { pageW, pageH, w, h, x: (pageW - w) / 2, y: (pageH - h) / 2 };
  }

  const p = fitInto(a4w, a4h);    
  const l = fitInto(a4h, a4w);     
  const best = (p.w * p.h >= l.w * l.h) ? { ...p, orient: 'p' } : { ...l, orient: 'l' };

  const pdf = new jsPDF({ orientation: best.orient, unit: 'mm', format: 'a4' });
  pdf.addImage(imgData, 'PNG', best.x, best.y, best.w, best.h);
  pdf.save('focusboard_a4_onepage.pdf');
}

function render(){
  renderKanban();
  updateStats();
}

(function init(){
  el('pdfBtn').onclick = () => exportPDF({ fit: 'a4' });

  load();
  enableDnD();
  render();

  applyTheme(localStorage.getItem('fb_theme') || '');
  setTimeBox(getFocusMinutes()*60);
  el('year').textContent = new Date().getFullYear();

  el('addTaskBtn').onclick = ()=>{ addTask(el('taskTitle').value, el('taskEst').value); el('taskTitle').value=''; };
  el('startBtn').onclick = startTimer;
  el('pauseBtn').onclick = pauseTimer;
  el('resetTimerBtn').onclick = resetTimer;

  el('exportBtn').onclick = exportJson;
  el('importInput').addEventListener('change', e=>{ if (e.target.files[0]) importJson(e.target.files[0]); });
  el('resetBtn').onclick = hardReset;
  el('themeBtn').onclick = ()=> applyTheme(document.documentElement.className==='light'?'':'light');

  document.addEventListener('keydown', e=>{
    if (e.altKey && (e.key==='s' || e.key==='ы')){ e.preventDefault(); if (isRunning()) pauseTimer(); else startTimer(); }
  });

  try{
    if (location.hash.startsWith('#snapshot=')){
      const b64 = location.hash.replace('#snapshot=','');
      const bin = atob(b64);
      const buf = new Uint8Array([...bin].map(c=>c.charCodeAt(0)));
      const data = JSON.parse(new TextDecoder().decode(buf));
      if (Array.isArray(data.tasks)){ state.tasks = data.tasks; render(); document.querySelectorAll('.btn').forEach(b=>b.disabled=true); }
    }
  }catch{}
})();
