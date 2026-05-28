// =====================================================
// <script type="module"> 내부에 이 코드를 붙여넣으세요
// (기존 <script> 태그를 <script type="module">로 교체)
// =====================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache,
  collection, getDocs, query, where, limit
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/* ── Firebase 초기화 ──────────────────────────────── */
const firebaseConfig = {
  // TODO: Firebase 콘솔 → 프로젝트 설정 → 웹 앱 구성 값 복사
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};
const _fbApp = initializeApp(firebaseConfig);
const db = initializeFirestore(_fbApp, { localCache: persistentLocalCache() });

/* ── 상수 ────────────────────────────────────────── */
const CATEGORY_EMOJI = { '식비':'🍚','교통':'🚇','생활':'🏠','의료':'💊','여가':'🎬','고정비':'🏢','기타':'📦' };
const CATEGORIES = ['식비','교통','생활','의료','여가','고정비','기타'];
const FIXED_BREAKDOWN_ITEMS = ['관리비','도시가스','수도요금','세금'];
const DAY_KO = ['일','월','화','수','목','금','토'];
const CLIENT_CACHE_MS = 30000;
const GAS_BACKEND_URL = 'https://script.google.com/macros/s/AKfycby8rKMnV6cwkA5ScyjXkzVLzKCWECyirdg03_79USjKd0jzoEW7AF8qz77KpsPuB6H0/exec';

/* ── 상태 ────────────────────────────────────────── */
const state = {
  currentTab: 'home',
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  monthlyYear: new Date().getFullYear(),
  monthlyMonth: new Date().getMonth() + 1,
  annualYear: new Date().getFullYear(),
  selectedUser: (function(){ var u=localStorage.getItem('lastUser')||'희'; return u==='남편'?'희':u==='아내'?'정':u; })(),
  selectedCategory: null,
  selectedMajorCat: null,
  editingRowIndex: null,
  returnTab: null,
  categoryManuallySet: false,
  cache: {},
  isLoading: false,
  availableYears: [],
  pendingAction: null,
  annualView: 'summary',
  fsYearCache: {}   // ← Firestore 연도별 세션 캐시
};

/* ── 유틸 ────────────────────────────────────────── */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatMoney(n) { return Number(n||0).toLocaleString('ko-KR')+'원'; }
function formatNum(n)   { return Number(n||0).toLocaleString('ko-KR'); }
function formatMoneyShort(n) {
  n=Number(n||0);
  if(n>=100000000) return Math.floor(n/100000000)+'억';
  if(n>=10000) return Math.floor(n/10000)+'만';
  return n.toLocaleString('ko-KR');
}
function parseMoney(str) { return parseInt(String(str).replace(/[^0-9]/g,''),10)||0; }
function clampAmount(n)  { return Math.min(Math.max(0,n),9999999); }
function formatDate(dateStr) {
  const d=new Date(dateStr+'T00:00:00');
  return (d.getMonth()+1)+'월 '+d.getDate()+'일 ('+DAY_KO[d.getDay()]+')';
}
function todayStr() {
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function yesterdayStr() {
  const d=new Date(); d.setDate(d.getDate()-1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

/* ── 클라이언트 캐시 ─────────────────────────────── */
function getCached(key) {
  const c=state.cache[key];
  if(c&&Date.now()-c.ts<CLIENT_CACHE_MS) return c.data;
  return null;
}
function setCached(key,data) { state.cache[key]={data,ts:Date.now()}; }
function invalidateCached(year,month) {
  delete state.cache['summary_'+year+'_'+month];
  delete state.cache['expenses_'+year+'_'+month];
  delete state.cache['yearly_'+year];
  delete state.cache['recent'];
  // Firestore 연도 캐시도 함께 무효화
  delete state.fsYearCache[year];
  const prevYear=month===1?year-1:year;
  if(prevYear!==year) delete state.fsYearCache[prevYear];
}

/* ── GAS callAPI (쓰기 전용 — STEP 2에서 Firestore로 교체 예정) */
function getStoredPin() { return localStorage.getItem('app_pin')||''; }
var _retryFns = {};
function renderLoadError(areaId,msgId,retryKey,errorMsg) {
  var msgEl=document.getElementById(msgId);
  var areaEl=document.getElementById(areaId);
  if(msgEl) msgEl.textContent='-';
  var detail=errorMsg
    ?'<div style="font-size:11px;margin-top:4px;opacity:.7;word-break:break-all">'+escHtml(String(errorMsg).slice(0,120))+'</div>'
    :'';
  if(areaEl) areaEl.innerHTML=
    '<div style="padding:20px 0;text-align:center;color:var(--text-muted);font-size:13px">'
    +'데이터를 불러오지 못했어요.'+detail+'<br>'
    +'<button onclick="_retryFns[\''+retryKey+'\']()\" style="margin-top:10px;padding:7px 18px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer;font-family:inherit;font-size:13px">다시 시도</button>'
    +'</div>';
}
function callAPI(action,params,method) {
  var pin=getStoredPin();
  function parseResponse(r) {
    return r.text().then(function(text){
      try{return JSON.parse(text);}
      catch(e){console.error('[GAS] 비-JSON 응답 ('+action+'):', text.slice(0,300)); throw new Error('서버 응답 오류: '+text.slice(0,80));}
    });
  }
  if(method==='POST') {
    return fetch(GAS_BACKEND_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(Object.assign({action,pin},params)),redirect:'follow'}).then(parseResponse);
  }
  var qs=new URLSearchParams(Object.assign({action,pin},params||{})).toString();
  return fetch(GAS_BACKEND_URL+'?'+qs,{redirect:'follow'}).then(parseResponse);
}

/* ── localStorage 헬퍼 ──────────────────────────── */
function updateRecentItems(user,item) {
  var key='recentItems_'+user;
  var list=JSON.parse(localStorage.getItem(key)||'[]');
  list=list.filter(i=>i!==item); list.unshift(item);
  localStorage.setItem(key,JSON.stringify(list.slice(0,20)));
}
function getRecentItems(user) { return JSON.parse(localStorage.getItem('recentItems_'+user)||'[]'); }
function updateItemCategoryMap(item,category) {
  var map=JSON.parse(localStorage.getItem('itemCategoryMap')||'{}');
  map[item]=category; localStorage.setItem('itemCategoryMap',JSON.stringify(map));
}
function getCategoryByItem(item) {
  return (JSON.parse(localStorage.getItem('itemCategoryMap')||'{}'))[item]||null;
}

/* ── 오프라인 pending ───────────────────────────── */
function getPending() { return JSON.parse(localStorage.getItem('pending_expenses')||'[]'); }
function setPending(list) { localStorage.setItem('pending_expenses',JSON.stringify(list)); }
function checkOfflineBar() {
  var pending=getPending();
  var bar=document.getElementById('offline-bar');
  if(pending.length>0){
    bar.textContent='저장되지 않은 지출 '+pending.length+'건이 있습니다. 지금 저장하기 →';
    bar.classList.add('show');
  } else {
    bar.classList.remove('show');
  }
}
async function retrySendPending() {
  var pending=getPending(); if(!pending.length) return;
  var remaining=[];
  for(var i=0;i<pending.length;i++){
    try{var res=await callAPI('addExpense',{data:pending[i]},'POST');if(!res.success)remaining.push(pending[i]);}
    catch(e){remaining.push(pending[i]);}
  }
  setPending(remaining); checkOfflineBar();
  if(remaining.length<pending.length){
    invalidateCached(state.currentYear,state.currentMonth);
    if(state.currentTab==='home') loadHomeData();
  }
}

/* ════════════════════════════════════════════════════
   Firestore 데이터 레이어
   ════════════════════════════════════════════════════ */
function _normalizeUser(u) {
  if(u==='남편') return '희';
  if(u==='아내') return '정';
  return u||'';
}

/**
 * 해당 연도의 모든 지출을 Firestore에서 가져와 세션 캐싱.
 * expenses 컬렉션 스키마: { date, item, category, user, amount, memo, createdAt }
 */
async function fetchExpensesByYear(year) {
  if(state.fsYearCache[year]) return state.fsYearCache[year];
  const startDate=year+'-01-01', endDate=year+'-12-31';
  const q=query(
    collection(db,'expenses'),
    where('date','>=',startDate),
    where('date','<=',endDate)
  );
  const snap=await getDocs(q);
  const expenses=[];
  snap.forEach(docSnap=>{
    const d=docSnap.data();
    if(!d.date) return;
    expenses.push({
      id: docSnap.id,
      rowIndex: docSnap.id,   // 기존 render 함수 호환 (STEP 2에서 삭제/수정에 사용)
      date: d.date,
      item: d.item||'',
      category: d.category||'',
      user: _normalizeUser(d.user),
      amount: parseInt(d.amount,10)||0,
      memo: d.memo||''
    });
  });
  expenses.sort((a,b)=>b.date.localeCompare(a.date));
  state.fsYearCache[year]=expenses;
  return expenses;
}

/** expenses 컬렉션 전체를 한 번 스캔해 연도 목록 추출 */
async function fetchAvailableYears() {
  const snap=await getDocs(collection(db,'expenses'));
  const yearSet=new Set();
  snap.forEach(d=>{
    const dt=d.data().date;
    if(dt&&typeof dt==='string') yearSet.add(parseInt(dt.slice(0,4),10));
  });
  const cur=new Date().getFullYear();
  if(!yearSet.size) yearSet.add(cur);
  return Array.from(yearSet).filter(y=>y>2000&&y<=cur+1).sort((a,b)=>b-a);
}

function filterByMonth(expenses,year,month) {
  const prefix=year+'-'+String(month).padStart(2,'0');
  return expenses.filter(e=>e.date.startsWith(prefix));
}

/** getMonthlySummary 대체 — GAS와 동일한 shape 반환 */
function computeMonthlySummary(expenses,year,month) {
  const rows=filterByMonth(expenses,year,month);
  let living=0,fixed=0,husband=0,wife=0;
  const byCategory={'식비':0,'교통':0,'생활':0,'의료':0,'여가':0,'고정비':0,'기타':0};
  const dailyTotals={};
  rows.forEach(e=>{
    if(e.category==='고정비') fixed+=e.amount; else living+=e.amount;
    if(e.user==='희'||e.user==='남편') husband+=e.amount;
    else if(e.user==='정'||e.user==='아내') wife+=e.amount;
    const cat=byCategory.hasOwnProperty(e.category)?e.category:'기타';
    byCategory[cat]+=e.amount;
    dailyTotals[e.date]=(dailyTotals[e.date]||0)+e.amount;
  });
  return {
    success:true, year, month,
    total:living+fixed, livingTotal:living, fixedTotal:fixed,
    husbandTotal:husband, wifeTotal:wife, byCategory, dailyTotals
  };
}

/** getYearlySummary 대체 */
function computeYearlySummary(expenses,year) {
  const md={};
  for(let m=1;m<=12;m++) md[m]={living:0,fixed:0,husband:0,wife:0};
  expenses.forEach(e=>{
    const m=parseInt(e.date.slice(5,7),10);
    if(m<1||m>12) return;
    if(e.category==='고정비') md[m].fixed+=e.amount; else md[m].living+=e.amount;
    if(e.user==='희'||e.user==='남편') md[m].husband+=e.amount;
    else if(e.user==='정'||e.user==='아내') md[m].wife+=e.amount;
  });
  let yearTotal=0,yearLiving=0,yearFixed=0,yearHusband=0,yearWife=0;
  const months=[];
  for(let m=1;m<=12;m++){
    const {living,fixed,husband,wife}=md[m];
    const total=living+fixed;
    months.push({month:m,total,living,fixed,husband,wife});
    yearTotal+=total; yearLiving+=living; yearFixed+=fixed; yearHusband+=husband; yearWife+=wife;
  }
  return {success:true,year,months,yearTotal,yearLiving,yearFixed,yearHusband,yearWife};
}

/** getYearlyFixedBreakdown 대체 */
function computeYearlyFixedBreakdown(expenses,year) {
  const ITEMS=['관리비','도시가스','수도요금','세금'];
  const result={};
  for(let m=1;m<=12;m++) result[m]={month:m,관리비:0,도시가스:0,수도요금:0,세금:0};
  expenses.filter(e=>e.category==='고정비').forEach(e=>{
    const m=parseInt(e.date.slice(5,7),10);
    if(m<1||m>12) return;
    ITEMS.forEach(name=>{ if(e.item&&e.item.includes(name)) result[m][name]+=e.amount; });
  });
  return {success:true, months:Object.values(result)};
}

/* ── 탭 라우팅 ──────────────────────────────────── */
function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tabName));
  var el=document.getElementById('tab-'+tabName);
  if(el) el.classList.add('active');
  state.currentTab=tabName;
  var titles={home:'가계부',record:'기록',monthly:'월간',annual:'연간'};
  document.getElementById('header-title').textContent=titles[tabName]||'가계부';
  if(tabName==='home') loadHomeData();
  else if(tabName==='record') initRecordTab();
  else if(tabName==='monthly') loadMonthlyData();
  else if(tabName==='annual') loadAnnualData();
}

/* ── 홈 탭 ──────────────────────────────────────── */
function handleAuthFailure() {
  localStorage.removeItem('app_pin');
  document.getElementById('pin-input').value='';
  document.getElementById('pin-overlay').classList.add('show');
  setTimeout(()=>document.getElementById('pin-input').focus(),100);
}

async function loadHomeData() {
  const now=new Date();
  const year=now.getFullYear(), month=now.getMonth()+1;
  state.currentYear=year; state.currentMonth=month;
  document.getElementById('header-month').textContent=year+'년 '+month+'월';

  const prevMonth=month===1?12:month-1;
  const prevYear =month===1?year-1:year;
  const lastYear =year-1;

  renderHomeSkeleton();
  try {
    const uniqueYears=[...new Set([year,prevYear,lastYear])];
    const yearData={};
    await Promise.all(uniqueYears.map(async y=>{ yearData[y]=await fetchExpensesByYear(y); }));

    const summary =computeMonthlySummary(yearData[year],year,month);
    const currData=filterByMonth(yearData[year],year,month);
    const prevData=filterByMonth(yearData[prevYear],prevYear,prevMonth);
    const lyData  =filterByMonth(yearData[lastYear],lastYear,month);

    renderHomeSummary(summary);
    renderHomeDashboard(currData,prevData,lyData,month);
  } catch(e) {
    console.error('홈 데이터 로드 실패',e);
    _retryFns['home']=loadHomeData;
    renderLoadError('dash-living','home-total','home',e.message);
  }
}

function renderHomeSkeleton() {
  document.getElementById('home-total').innerHTML='<div class="skeleton" style="width:140px;height:32px;border-radius:6px"></div>';
  document.getElementById('dash-living').innerHTML=[0,1,2].map(()=>'<div class="skeleton" style="height:44px;margin:6px 0;border-radius:6px"></div>').join('');
  document.getElementById('dash-fixed').innerHTML =[0,1].map(()=>'<div class="skeleton" style="height:44px;margin:6px 0;border-radius:6px"></div>').join('');
}

function renderHomeSummary(s) {
  const now=new Date();
  document.getElementById('home-month-label').textContent=now.getFullYear()+'년 '+(now.getMonth()+1)+'월';
  document.getElementById('home-total').textContent=formatMoney(s.total);
  document.getElementById('home-living-label').textContent='생활비 '+formatMoney(s.livingTotal);
  document.getElementById('home-fixed-label').textContent='고정비 '+formatMoney(s.fixedTotal);
}

function renderHomeDashboard(curr,prev,ly,month) {
  const now=new Date();
  const todayDay=now.getDate();
  const livCats=['식비','교통','생활','의료','여가'];

  var currLiv={}, prevLivMTD={};
  livCats.forEach(c=>{ currLiv[c]=0; prevLivMTD[c]=0; });
  (curr||[]).forEach(e=>{ if(livCats.includes(e.category)) currLiv[e.category]+=e.amount; });
  (prev||[]).forEach(e=>{
    if(!livCats.includes(e.category)) return;
    if(parseInt(e.date.slice(8,10),10)<=todayDay) prevLivMTD[e.category]+=e.amount;
  });

  var prevDataExists=(prev||[]).length>0;
  var topLiv=livCats
    .filter(c=>currLiv[c]>0)
    .sort((a,b)=>currLiv[b]-currLiv[a])
    .slice(0,3);

  var livHtml=topLiv.length===0
    ?'<div class="dash-compare flat" style="padding:4px 0 12px">이번 달 생활비 내역이 없어요.</div>'
    :topLiv.map(cat=>{
      var diff=currLiv[cat]-prevLivMTD[cat];
      var cmp=!prevDataExists
        ?'<div class="dash-compare flat">지난달 데이터 없음</div>'
        :diff<0
          ?'<div class="dash-compare save">↘ 지난달 '+todayDay+'일까지보다 '+formatNum(Math.abs(diff))+'원 덜 썼어요</div>'
          :diff>0
            ?'<div class="dash-compare over">↗ 지난달 '+todayDay+'일까지보다 '+formatNum(diff)+'원 더 썼어요</div>'
            :'<div class="dash-compare flat">지난달 같은 날과 동일해요</div>';
      return '<div class="dash-row">'
        +'<div class="dash-row-left">'
          +'<span class="dash-row-icon">'+(CATEGORY_EMOJI[cat]||'📦')+'</span>'
          +'<div><div class="dash-row-name">'+cat+'</div>'+cmp+'</div>'
        +'</div>'
        +'<div class="dash-row-right"><div class="dash-amount">'+formatMoney(currLiv[cat])+'</div></div>'
      +'</div>';
    }).join('');

  document.getElementById('dash-living').innerHTML='<div class="dash-title">생활비 하이라이트</div>'+livHtml;

  var currFixed={}, prevFixed={}, lyFixed={};
  (curr||[]).filter(e=>e.category==='고정비').forEach(e=>{ currFixed[e.item]=(currFixed[e.item]||0)+e.amount; });
  (prev||[]).filter(e=>e.category==='고정비').forEach(e=>{ prevFixed[e.item]=(prevFixed[e.item]||0)+e.amount; });
  (ly||[]).filter(e=>e.category==='고정비').forEach(e=>{ lyFixed[e.item]=(lyFixed[e.item]||0)+e.amount; });

  var paidItems  =FIXED_BREAKDOWN_ITEMS.filter(i=>currFixed[i]>0);
  var unpaidItems=FIXED_BREAKDOWN_ITEMS.filter(i=>!(currFixed[i]>0));
  var orderedItems=paidItems.concat(unpaidItems);

  var fixHtml=orderedItems.map(item=>{
    var paid=currFixed[item]>0;
    var isTax=item==='세금';
    var refFixed=isTax?lyFixed:prevFixed;
    var refLabel=isTax?'작년 '+month+'월':'지난달';
    var refAmount=refFixed[item]||0;
    var hasRef=refAmount>0;
    var amtHtml,cmpHtml;
    if(paid){
      var diff=currFixed[item]-refAmount;
      amtHtml='<div class="dash-amount">'+formatMoney(currFixed[item])+'</div>';
      cmpHtml=!hasRef
        ?'<div class="dash-compare flat">'+refLabel+' 데이터 없음</div>'
        :diff<0
          ?'<div class="dash-compare save">↘ '+refLabel+'보다 '+formatNum(Math.abs(diff))+'원 줄었어요</div>'
          :diff>0
            ?'<div class="dash-compare over">↗ '+refLabel+'보다 '+formatNum(diff)+'원 올랐어요</div>'
            :'<div class="dash-compare flat">'+refLabel+'과 같아요</div>';
    } else {
      amtHtml='<div class="dash-amount" style="color:var(--text-muted);font-size:var(--text-caption)">결제 전</div>';
      cmpHtml=hasRef
        ?'<div class="dash-compare flat">예상: '+formatMoney(refAmount)+' ('+refLabel+' 기준)</div>'
        :'<div class="dash-compare flat">기준 데이터 없음</div>';
    }
    return '<div class="dash-row">'
      +'<div class="dash-row-left">'
        +'<span class="dash-row-icon">🏢</span>'
        +'<div><div class="dash-row-name">'+escHtml(item)+'</div>'+cmpHtml+'</div>'
      +'</div>'
      +'<div class="dash-row-right">'+amtHtml+'</div>'
    +'</div>';
  }).join('');

  if(!orderedItems.length) fixHtml='<div class="dash-compare flat" style="padding:4px 0 12px">고정비 항목이 없어요.</div>';
  document.getElementById('dash-fixed').innerHTML='<div class="dash-title">이번 달 주요 고정비</div>'+fixHtml;
}

/* ── 기록 탭 ────────────────────────────────────── */
function catToMajor(cat) {
  if(['식비','교통','생활','의료','여가'].includes(cat)) return '생활비';
  if(cat==='고정비') return '고정비';
  return '기타';
}
function effectiveCategory() {
  if(!state.selectedMajorCat) return null;
  if(state.selectedMajorCat==='고정비') return '고정비';
  if(state.selectedMajorCat==='기타') return '기타';
  var sub=document.getElementById('expense-subcat');
  return sub?sub.value:'식비';
}
function updateUserSeg() {
  if(state.selectedUser==='희정') return;
  document.querySelectorAll('#seg-user .seg-btn:not(#seg-user-common)').forEach(btn=>{
    btn.className='seg-btn'+(btn.dataset.user===state.selectedUser?' active':'');
  });
}
function updateMajorCatSeg() {
  document.querySelectorAll('#seg-major .seg-btn').forEach(btn=>{
    btn.className='seg-btn'+(btn.dataset.major===state.selectedMajorCat?' active':'');
  });
}
function updateUserSegForMajor(major) {
  var commonBtn=document.getElementById('seg-user-common');
  var indivBtns=Array.from(document.querySelectorAll('#seg-user .seg-btn:not(#seg-user-common)'));
  if(major==='고정비'){
    indivBtns.forEach(b=>b.style.display='none');
    if(commonBtn){ commonBtn.style.display=''; commonBtn.className='seg-btn active'; }
    state.selectedUser='희정';
    var errEl=document.getElementById('user-error');
    if(errEl) errEl.style.display='none';
  } else {
    indivBtns.forEach(b=>b.style.display='');
    if(commonBtn){ commonBtn.style.display='none'; commonBtn.className='seg-btn active'; }
    if(state.selectedUser==='희정'){
      var last=localStorage.getItem('lastUser');
      state.selectedUser=(last==='희'||last==='정')?last:'희';
    }
    updateUserSeg();
  }
}
function updateCategoryForm() {
  var major=state.selectedMajorCat;
  var subRow=document.getElementById('subcat-row');
  var subDiv=document.getElementById('subcat-divider');
  var input =document.getElementById('expense-item');
  var sel   =document.getElementById('expense-item-select');
  if(!subRow||!input||!sel) return;
  if(major==='생활비'){ subRow.style.display=''; subDiv.style.display=''; input.style.display=''; sel.style.display='none'; }
  else if(major==='고정비'){ subRow.style.display='none'; subDiv.style.display='none'; input.style.display='none'; sel.style.display=''; }
  else { subRow.style.display='none'; subDiv.style.display='none'; input.style.display=''; sel.style.display='none'; }
  updateMajorCatSeg();
  updateTaxChips();
  updateUserSegForMajor(major);
}
function updateTaxChips() {
  var sel=document.getElementById('expense-item-select');
  var row=document.getElementById('tax-chips-row');
  if(!row) return;
  row.style.display=(sel&&sel.style.display!=='none'&&sel.value==='세금')?'':'none';
}
function updateUserButtons() { updateUserSeg(); }
function updateCategoryButtons() { updateCategoryForm(); }
function buildCategoryGrid() {}
function updateItemField() { updateCategoryForm(); }

function initRecordTab() {
  if(!state.editingRowIndex) resetForm();
  updateUserSeg(); updateCategoryForm(); updateDatePills(); updateItemSuggestions();
}
function updateDatePills() {
  var val=document.getElementById('expense-date').value;
  document.getElementById('pill-today').classList.toggle('active',val===todayStr());
  document.getElementById('pill-yesterday').classList.toggle('active',val===yesterdayStr());
}
function updateItemSuggestions() {
  var datalist=document.getElementById('item-suggestions');
  var items=getRecentItems(state.selectedUser);
  datalist.innerHTML=items.map(i=>'<option value="'+escHtml(i)+'">').join('');
}
function getItemValue() {
  var sel=document.getElementById('expense-item-select');
  if(sel.style.display!=='none') return sel.value;
  return document.getElementById('expense-item').value.trim();
}
function showError(inputEl,errorId,msg) {
  inputEl.classList.add('error');
  var err=document.getElementById(errorId);
  if(err){ err.textContent=msg; err.style.display='block'; }
}
function clearError(errorId,inputs) {
  var err=document.getElementById(errorId);
  if(err){ err.textContent=''; err.style.display='none'; }
  if(inputs) inputs.forEach(el=>el.classList.remove('error'));
}

async function onSaveExpense() {
  if(state.isLoading) return;
  var dateVal=document.getElementById('expense-date').value;
  var userVal=state.selectedUser;
  var catVal=effectiveCategory();
  var itemVal=getItemValue();
  var amountRaw=parseMoney(document.getElementById('expense-amount').value);

  clearError('date-error',[document.getElementById('expense-date')]);
  clearError('user-error',Array.from(document.querySelectorAll('#seg-user .seg-btn')));
  clearError('category-error',Array.from(document.querySelectorAll('#seg-major .seg-btn')));
  clearError('item-error',[document.getElementById('expense-item'),document.getElementById('expense-item-select')]);
  clearError('amount-error',[document.getElementById('expense-amount')]);

  var valid=true;
  if(!dateVal){ showError(document.getElementById('expense-date'),'date-error','날짜를 선택해주세요.'); valid=false; }
  if(!userVal){
    document.querySelectorAll('#seg-user .seg-btn').forEach(b=>b.classList.add('error'));
    var ue=document.getElementById('user-error');
    if(ue){ ue.textContent='사용자를 선택해주세요.'; ue.style.display='block'; }
    valid=false;
  }
  if(!catVal){
    document.querySelectorAll('#seg-major .seg-btn').forEach(b=>b.classList.add('error'));
    document.getElementById('category-error').textContent='분류를 선택해주세요.';
    document.getElementById('category-error').style.display='block';
    valid=false;
  }
  if(!itemVal){
    var itemErrEl=document.getElementById('expense-item-select').style.display!=='none'
      ?document.getElementById('expense-item-select')
      :document.getElementById('expense-item');
    showError(itemErrEl,'item-error','항목명을 입력해주세요.'); valid=false;
  }
  if(amountRaw<=0){ showError(document.getElementById('expense-amount'),'amount-error','금액을 입력해주세요.'); valid=false; }
  else if(amountRaw>9999999){ showError(document.getElementById('expense-amount'),'amount-error','최대 금액을 초과했습니다.'); valid=false; }
  if(!valid) return;

  var data={date:dateVal,item:itemVal,category:catVal,user:userVal,amount:amountRaw,memo:document.getElementById('expense-memo').value.trim()};
  setBtnLoading(true);
  try {
    var res;
    if(state.editingRowIndex){
      res=await callAPI('updateExpense',{rowIndex:state.editingRowIndex,data},'POST');
    } else {
      res=await callAPI('addExpense',{data},'POST');
    }
    if(res&&res.success){
      var yr=parseInt(dateVal.slice(0,4),10), mo=parseInt(dateVal.slice(5,7),10);
      invalidateCached(yr,mo);
      invalidateCached(state.monthlyYear,state.monthlyMonth);
      invalidateCached(state.currentYear,state.currentMonth);
      updateRecentItems(userVal,itemVal);
      updateItemCategoryMap(itemVal,catVal);
      localStorage.setItem('lastCategory_'+userVal,catVal);
      showSaveSuccess(()=>{
        if(state.editingRowIndex){
          var rt=state.returnTab||'home';
          state.editingRowIndex=null; state.returnTab=null; state.categoryManuallySet=false;
          resetForm(); showTab(rt);
        } else { resetForm(); }
      });
    } else {
      setBtnError((res&&res.error)||'네트워크 오류가 발생했습니다.');
      if(!res){ var p=getPending(); p.push(data); setPending(p); checkOfflineBar(); }
    }
  } catch(e) {
    setBtnError('네트워크 오류가 발생했습니다.');
    var p=getPending(); p.push(data); setPending(p); checkOfflineBar();
  }
}

function setBtnLoading(on) {
  state.isLoading=on;
  var btn=document.getElementById('save-btn');
  btn.textContent=on?'저장 중...':(state.editingRowIndex?'수정하기':'저장하기');
  btn.style.opacity=on?'0.7':'';
  btn.style.pointerEvents=on?'none':'';
}

var _dp={mode:null,year:null,month:null};
function openDatePicker(mode) {
  _dp.mode=mode;
  _dp.year=mode==='monthly'?state.monthlyYear:state.annualYear;
  _dp.month=mode==='monthly'?state.monthlyMonth:null;
  renderDatePicker();
  document.getElementById('datepicker-overlay').classList.add('show');
}
function closeDatePicker() { document.getElementById('datepicker-overlay').classList.remove('show'); }
function renderDatePicker() {
  var now=new Date(), curYear=now.getFullYear(), curMonth=now.getMonth()+1;
  var years=state.availableYears.length>0
    ?state.availableYears.slice().sort((a,b)=>a-b)
    :(()=>{ var a=[]; for(var y=curYear-3;y<=curYear;y++) a.push(y); return a; })();

  var yearScroll=document.getElementById('dp-year-scroll');
  yearScroll.innerHTML='';
  years.forEach(y=>{
    var chip=document.createElement('button'); chip.type='button';
    chip.className='dp-chip dp-year-chip'+(y===_dp.year?' active':'');
    chip.textContent=y+'년'; chip.dataset.year=y;
    yearScroll.appendChild(chip);
  });
  requestAnimationFrame(()=>{ var a=yearScroll.querySelector('.active'); if(a) a.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'}); });

  var monthSection=document.getElementById('dp-month-section');
  if(_dp.mode==='annual'){ monthSection.style.display='none'; return; }
  monthSection.style.display='';
  var monthGrid=document.getElementById('dp-month-grid');
  monthGrid.innerHTML='';
  ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'].forEach((name,i)=>{
    var m=i+1, isFuture=_dp.year>curYear||(_dp.year===curYear&&m>curMonth);
    var chip=document.createElement('button'); chip.type='button';
    chip.className='dp-chip dp-month-chip'+(m===_dp.month?' active':'');
    chip.textContent=name; chip.dataset.month=m; chip.disabled=isFuture;
    monthGrid.appendChild(chip);
  });
}

var _toastTimer=null;
function showToast(msg) {
  var t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),2500);
}
function showSaveSuccess(cb) {
  state.isLoading=false;
  var btn=document.getElementById('save-btn');
  btn.textContent='✓ 완료'; btn.style.opacity=''; btn.style.pointerEvents='none';
  showToast(state.editingRowIndex?'수정되었습니다.':'기록이 추가되었습니다.');
  setTimeout(()=>{ btn.textContent=state.editingRowIndex?'수정하기':'저장하기'; btn.style.pointerEvents=''; if(cb) cb(); },1500);
}
function setBtnError(msg) {
  state.isLoading=false;
  var btn=document.getElementById('save-btn');
  btn.style.opacity=''; btn.style.pointerEvents=''; btn.textContent='✕ 실패';
  btn.classList.add('btn-shake');
  btn.addEventListener('animationend',()=>btn.classList.remove('btn-shake'),{once:true});
  showToast(msg||'네트워크 오류가 발생했습니다.');
  setTimeout(()=>{ btn.textContent=state.editingRowIndex?'수정하기':'저장하기'; },2000);
}
function resetForm() {
  document.getElementById('expense-date').value=todayStr();
  document.getElementById('expense-item').value='';
  document.getElementById('expense-item-select').value='관리비';
  var subEl=document.getElementById('expense-subcat'); if(subEl) subEl.value='식비';
  document.getElementById('expense-amount').value='';
  document.getElementById('expense-memo').value='';
  document.getElementById('memo-count').textContent='0';
  state.categoryManuallySet=false;
  var lastCat=localStorage.getItem('lastCategory_'+state.selectedUser);
  if(lastCat){ state.selectedMajorCat=catToMajor(lastCat); if(state.selectedMajorCat==='생활비'&&subEl) subEl.value=lastCat; }
  else state.selectedMajorCat=null;
  updateCategoryForm(); updateUserSeg(); updateDatePills(); updateItemSuggestions();
  document.getElementById('edit-banner').classList.remove('show');
  document.getElementById('save-btn').textContent='저장하기';
  document.getElementById('header-title').textContent='기록';
}
function fillFormWithExpense(data) {
  document.getElementById('expense-date').value=data.date||todayStr();
  var rawUser=data.user||'희';
  if(rawUser==='남편') rawUser='희';
  if(rawUser==='아내') rawUser='정';
  state.selectedUser=rawUser;
  var cat=data.category||null;
  state.selectedMajorCat=cat?catToMajor(cat):null;
  state.categoryManuallySet=true;
  var FIXED_PRESET=['관리비','도시가스','수도요금','세금'];
  var editItem=data.item||'';
  var sel=document.getElementById('expense-item-select');
  var sub=document.getElementById('expense-subcat');
  if(state.selectedMajorCat==='생활비'&&sub) sub.value=cat;
  if(state.selectedMajorCat==='고정비'&&FIXED_PRESET.includes(editItem)){ sel.value=editItem; document.getElementById('expense-item').value=''; }
  else { sel.value='관리비'; document.getElementById('expense-item').value=editItem; }
  document.getElementById('expense-amount').value=data.amount>0?data.amount.toLocaleString('ko-KR'):'';
  document.getElementById('expense-memo').value=data.memo||'';
  document.getElementById('memo-count').textContent=(data.memo||'').length;
  updateUserSeg(); updateCategoryForm(); updateDatePills(); updateItemSuggestions();
  document.getElementById('edit-banner').classList.add('show');
  document.getElementById('save-btn').textContent='수정하기';
  document.getElementById('header-title').textContent='내역 수정';
}
function openEditMode(expenseData,returnTab) {
  state.editingRowIndex=expenseData.rowIndex;
  state.returnTab=returnTab;
  showTab('record'); fillFormWithExpense(expenseData);
  setTimeout(()=>{ var input=document.getElementById('expense-item'); if(input.style.display!=='none') input.focus(); },150);
}
function cancelEditMode() {
  state.editingRowIndex=null; state.categoryManuallySet=false;
  var tab=state.returnTab||'home'; state.returnTab=null;
  resetForm(); showTab(tab);
}

/* ── 월간 탭 ────────────────────────────────────── */
async function loadMonthlyData() {
  var year=state.monthlyYear, month=state.monthlyMonth;
  var now=new Date();
  document.getElementById('monthly-title').textContent=year+'년 '+month+'월';
  document.getElementById('monthly-next').disabled=(year>now.getFullYear()||(year===now.getFullYear()&&month>=now.getMonth()+1));

  renderMonthlySkeleton();
  try {
    var allYear=await fetchExpensesByYear(year);
    var expenses=filterByMonth(allYear,year,month);
    var summary=computeMonthlySummary(allYear,year,month);
    renderMonthlySummary(summary);
    renderMonthlyExpenses(expenses);
    renderMonthlyFixedBreakdown(expenses);
    renderMonthlyUserSplit(expenses);
  } catch(e) {
    console.error('월간 로드 실패',e);
    _retryFns['monthly']=loadMonthlyData;
    renderLoadError('monthly-expense-list','m-total','monthly',e.message);
  }
}

function renderMonthlySkeleton() {
  document.getElementById('m-total').innerHTML='<div class="skeleton" style="width:70px;height:18px;border-radius:4px"></div>';
  document.getElementById('monthly-expense-list').innerHTML='<div class="skeleton" style="height:80px;margin:8px 16px;border-radius:8px"></div>';
  var splitEl=document.getElementById('monthly-user-split');
  if(splitEl) splitEl.style.display='none';
}
function renderMonthlySummary(s) {
  document.getElementById('m-total').textContent=formatMoney(s.total);
  document.getElementById('m-living').textContent=formatMoney(s.livingTotal);
  document.getElementById('m-fixed').textContent=formatMoney(s.fixedTotal);
}
function renderMonthlyUserSplit(expenses) {
  var el=document.getElementById('monthly-user-split'); if(!el) return;
  var hee=0,jung=0;
  (expenses||[]).forEach(e=>{
    if(e.user==='희'||e.user==='남편') hee+=e.amount;
    else if(e.user==='정'||e.user==='아내') jung+=e.amount;
  });
  var total=hee+jung; if(!total){ el.style.display='none'; return; }
  var heePct=Math.round(hee/total*100);
  document.getElementById('split-hee-label').textContent='희  '+formatNum(hee)+' ('+heePct+'%)';
  document.getElementById('split-jung-label').textContent='정  '+formatNum(jung)+' ('+(100-heePct)+'%)';
  document.getElementById('split-hee-bar').style.width=heePct+'%';
  el.style.display='';
}
function renderMonthlyFixedBreakdown(expenses) {
  var el=document.getElementById('monthly-fixed-breakdown'); if(!el) return;
  var html=FIXED_BREAKDOWN_ITEMS.map(name=>{
    var matching=(expenses||[]).filter(e=>e.item&&e.item.includes(name));
    var total=matching.reduce((s,e)=>s+e.amount,0);
    var paid=total>0;
    var rowClass=paid?'fixed-breakdown-item':'fixed-breakdown-item clickable';
    var rowClick=paid?'':' onclick="quickRecordFixed(\''+name+'\')"';
    var memos=(name==='세금'&&paid)?matching.filter(e=>e.memo).map(e=>e.memo):[];
    var alignAttr=memos.length>0?' style="align-items:flex-start"':'';
    var nameHtml=memos.length>0
      ?'<div><span class="fixed-breakdown-name">'+escHtml(name)+'</span>'
        +memos.map(m=>'<div class="fixed-breakdown-subtag">↳ '+escHtml(m)+'</div>').join('')+'</div>'
      :'<span class="fixed-breakdown-name">'+escHtml(name)+'</span>';
    return '<div class="'+rowClass+'"'+rowClick+alignAttr+'>'
      +nameHtml
      +'<span class="fixed-breakdown-amount'+(paid?'':' unpaid')+'">'
        +(paid?formatMoney(total):'미결제 ›')
      +'</span></div>';
  }).join('');
  el.innerHTML=html;
}
function quickRecordFixed(itemName) {
  var ctxYear=state.monthlyYear, ctxMonth=state.monthlyMonth;
  state.editingRowIndex=null;
  showTab('record');
  state.selectedMajorCat='고정비'; state.categoryManuallySet=true;
  updateCategoryForm();
  var sel=document.getElementById('expense-item-select'); if(sel) sel.value=itemName;
  updateTaxChips();
  var now=new Date();
  if(ctxYear!==now.getFullYear()||ctxMonth!==now.getMonth()+1){
    var lastDay=new Date(ctxYear,ctxMonth,0);
    var dateStr=ctxYear+'-'+String(ctxMonth).padStart(2,'0')+'-'+String(lastDay.getDate()).padStart(2,'0');
    document.getElementById('expense-date').value=dateStr; updateDatePills();
  }
  setTimeout(()=>{ var amt=document.getElementById('expense-amount'); if(amt){ amt.focus(); amt.select(); } },150);
}
function renderMonthlyExpenses(data) {
  var list=document.getElementById('monthly-expense-list');
  if(!data||!data.length){
    list.innerHTML='<div class="empty-state"><div class="empty-icon">🗒️</div><div class="empty-text">이번 달 지출 내역이 없어요</div><button class="empty-btn" onclick="showTab(\'record\')">첫 지출 기록하기</button></div>';
    return;
  }
  var groups={};
  data.forEach(item=>{ if(!groups[item.date]) groups[item.date]=[]; groups[item.date].push(item); });
  var dates=Object.keys(groups).sort((a,b)=>b.localeCompare(a));
  var html=dates.map((date,di)=>{
    var dayTotal=groups[date].reduce((s,i)=>s+i.amount,0);
    var items=groups[date].map((item,ii)=>{
      var pillCls=(item.user==='남편'||item.user==='희')?'pill-husband':(item.user==='희정')?'pill-common':'pill-wife';
      return '<div class="expense-list-item slide-in" style="animation-delay:'+((di*2+ii)*20)+'ms">'
        +'<div class="ei-left">'
          +'<div class="ei-top">'
            +'<div class="expense-icon" style="width:36px;height:36px;font-size:16px">'+(CATEGORY_EMOJI[item.category]||'📦')+'</div>'
            +'<div class="expense-name">'+escHtml(item.item)+'</div>'
          +'</div>'
          +(item.memo?'<div class="expense-date"><span class="expense-memo">'+escHtml(item.memo)+'</span></div>':'')
        +'</div>'
        +'<div class="ei-right">'
          +'<div class="ei-amount-row">'
            +'<div class="expense-amount">'+formatMoney(item.amount)+'</div>'
            +'<button class="more-btn" data-row="'+escHtml(String(item.rowIndex))+'" data-name="'+escHtml(item.item)+'" onclick="openActionSheet(this)" type="button">···</button>'
          +'</div>'
          +'<span class="user-pill '+pillCls+'">'+escHtml(item.user)+'</span>'
        +'</div>'
      +'</div>';
    }).join('');
    return '<div class="date-group">'
      +'<div class="date-group-header"><span>'+formatDate(date)+'</span><span class="date-group-total">'+formatMoney(dayTotal)+'</span></div>'
      +items+'</div>';
  }).join('');
  list.innerHTML=html;
}

var _actionData=null;
function openActionSheet(btn) {
  _actionData={rowIndex:btn.dataset.row, name:btn.dataset.name};
  document.getElementById('action-sheet-title').textContent='"'+_actionData.name+'"';
  document.getElementById('action-sheet-overlay').classList.add('show');
}
function closeActionSheet() {
  document.getElementById('action-sheet-overlay').classList.remove('show');
  _actionData=null;
}
async function doDeleteExpense(rowIndex,name) {
  // STEP 2에서 Firestore deleteDoc 으로 교체 예정. 현재는 GAS fallback.
  var res=await callAPI('deleteExpense',{rowIndex},'POST');
  if(res&&res.success){
    invalidateCached(state.monthlyYear,state.monthlyMonth);
    invalidateCached(state.currentYear,state.currentMonth);
    loadMonthlyData();
  }
}

/* ── 연간 탭 ────────────────────────────────────── */
async function loadAnnualData() {
  var year=state.annualYear;
  document.getElementById('annual-title').textContent=year+'년';
  if(!state.availableYears.length){
    try{ state.availableYears=await fetchAvailableYears(); }
    catch(e){ state.availableYears=[year]; }
  }
  updateAnnualNavBtns();
  renderAnnualSkeleton();
  try {
    var expenses=await fetchExpensesByYear(year);
    var summary=computeYearlySummary(expenses,year);
    var fixedBreakdown=computeYearlyFixedBreakdown(expenses,year);
    renderAnnualSummary(summary,fixedBreakdown);
  } catch(e) {
    console.error('연간 로드 실패',e);
    _retryFns['annual']=loadAnnualData;
    renderLoadError('annual-chart-wrap','y-total','annual',e.message);
  }
}
function updateAnnualNavBtns() {
  var years=state.availableYears, idx=years.indexOf(state.annualYear);
  document.getElementById('annual-prev').disabled=idx>=years.length-1;
  document.getElementById('annual-next').disabled=idx<=0;
}
function renderAnnualSkeleton() {
  document.getElementById('y-total').innerHTML='<div class="skeleton" style="width:70px;height:18px;border-radius:4px;display:inline-block"></div>';
}
function renderAnnualSummary(s,fixedBreakdown) {
  document.getElementById('y-total').textContent=formatMoney(s.yearTotal);
  document.getElementById('y-living').textContent=formatMoney(s.yearLiving);
  document.getElementById('y-fixed').textContent=formatMoney(s.yearFixed);
  renderAnnualChart(s.months);
  renderAnnualMatrix(s.months,fixedBreakdown?fixedBreakdown.months:null);
}

function roundedTop(x,y,w,h,r) {
  if(h<=0) return '';
  r=Math.min(r,w/2,h);
  var x2=x+w,yr=y+r,yh=y+h;
  return 'M'+x.toFixed(1)+','+yh.toFixed(1)+' L'+x.toFixed(1)+','+yr.toFixed(1)
    +' Q'+x.toFixed(1)+','+y.toFixed(1)+' '+(x+r).toFixed(1)+','+y.toFixed(1)
    +' L'+(x2-r).toFixed(1)+','+y.toFixed(1)+' Q'+x2.toFixed(1)+','+y.toFixed(1)+' '+x2.toFixed(1)+','+yr.toFixed(1)
    +' L'+x2.toFixed(1)+','+yh.toFixed(1)+' Z';
}

function renderAnnualChart(months) {
  var svg=document.getElementById('annual-svg');
  var W=360,H=140,PL=10,PR=10,PT=18,PB=22;
  var chartW=W-PL-PR,chartH=H-PT-PB;
  var maxVal=Math.max.apply(null,months.map(m=>m.total))||1;
  var gap=chartW/12, barW=Math.floor(gap*0.46);
  var MIN_H=3,SEP=1,rx=3;
  svg.setAttribute('viewBox','0 0 '+W+' '+H);
  var legend=
    '<rect x="222" y="4" width="7" height="7" fill="#F5F5F7" rx="1"/>'
    +'<text x="231" y="12" font-size="9" fill="var(--text-muted)">생활비</text>'
    +'<rect x="278" y="4" width="7" height="7" fill="#8E8E93" rx="1"/>'
    +'<text x="287" y="12" font-size="9" fill="var(--text-muted)">고정비</text>';
  var bars='';
  months.forEach((m,i)=>{
    var x=PL+i*gap+(gap-barW)/2, baseY=PT+chartH;
    var total=m.total||0, fixed=m.fixed||0;
    var living=(m.living!==undefined)?m.living:(total-fixed); if(living<0) living=0;
    if(total<=0){
      bars+='<rect x="'+x.toFixed(1)+'" y="'+(baseY-MIN_H).toFixed(1)+'" width="'+barW+'" height="'+MIN_H+'" fill="var(--border)" rx="'+rx+'"/>';
    } else {
      var fixedH=fixed>0?Math.max(fixed/maxVal*chartH,MIN_H):0;
      var livingH=living>0?Math.max(living/maxVal*chartH,MIN_H):0;
      var hasBoth=fixedH>0&&livingH>0;
      var fixedY=baseY-fixedH, livingY=fixedY-(hasBoth?SEP:0)-livingH;
      if(fixedH>0){
        if(hasBoth) bars+='<rect x="'+x.toFixed(1)+'" y="'+fixedY.toFixed(1)+'" width="'+barW+'" height="'+fixedH.toFixed(1)+'" fill="#8E8E93"/>';
        else bars+='<path d="'+roundedTop(x,fixedY,barW,fixedH,rx)+'" fill="#8E8E93"/>';
      }
      if(livingH>0) bars+='<path d="'+roundedTop(x,livingY,barW,livingH,rx)+'" fill="#F5F5F7"/>';
      var topY=livingH>0?livingY:fixedY;
      bars+='<rect x="'+x.toFixed(1)+'" y="'+topY.toFixed(1)+'" width="'+barW+'" height="'+(baseY-topY).toFixed(1)+'" fill="transparent" data-month="'+m.month+'" data-total="'+total+'" data-living="'+living+'" data-fixed="'+fixed+'" class="annual-bar" style="cursor:pointer"/>';
    }
    bars+='<text x="'+(x+barW/2).toFixed(1)+'" y="'+(PT+chartH+14)+'" text-anchor="middle" font-size="9" fill="var(--text-muted)">'+m.month+'월</text>';
  });
  svg.innerHTML=legend+bars;
  svg.querySelectorAll('.annual-bar').forEach(bar=>{
    bar.addEventListener('click',e=>{ e.stopPropagation(); showAnnualTooltip(e,bar); });
  });
}

var _tooltipTimeout;
function showAnnualTooltip(e,bar) {
  var tooltip=document.getElementById('svg-tooltip');
  var month=bar.dataset.month;
  tooltip.innerHTML='<strong>'+month+'월</strong><br>총 '+formatMoney(bar.dataset.total)+'<br>생활비 '+formatMoney(bar.dataset.living)+'<br>고정비 '+formatMoney(bar.dataset.fixed);
  tooltip.style.display='block';
  var barRect=bar.getBoundingClientRect();
  var cx=barRect.left+barRect.width/2;
  var above=barRect.top-tooltip.offsetHeight-8;
  var top=above>=8?above:barRect.bottom+8;
  var halfW=tooltip.offsetWidth/2;
  tooltip.style.left=Math.min(Math.max(cx,halfW+8),window.innerWidth-halfW-8)+'px';
  tooltip.style.top=top+'px';
  clearTimeout(_tooltipTimeout);
  _tooltipTimeout=setTimeout(()=>tooltip.style.display='none',5000);
}
function positionTooltip(tooltip,rect) {
  var cx=rect.left+rect.width/2, above=rect.top-tooltip.offsetHeight-8;
  var top=above>=8?above:rect.bottom+8, halfW=tooltip.offsetWidth/2;
  tooltip.style.left=Math.min(Math.max(cx,halfW+8),window.innerWidth-halfW-8)+'px';
  tooltip.style.top=top+'px';
}

/** 세금 툴팁 — Firestore 버전 (callAPI 제거) */
function showTaxMemoTooltip(cell,year,month) {
  var tooltip=document.getElementById('svg-tooltip');
  tooltip.innerHTML='<strong>'+month+'월 세금</strong><br>불러오는 중…';
  tooltip.style.display='block';
  positionTooltip(tooltip,cell.getBoundingClientRect());
  clearTimeout(_tooltipTimeout);
  _tooltipTimeout=setTimeout(()=>tooltip.style.display='none',6000);
  fetchExpensesByYear(year).then(allYear=>{
    _applyTaxTooltip(tooltip,cell,month,filterByMonth(allYear,year,month));
  }).catch(()=>{ tooltip.style.display='none'; });
}
function _applyTaxTooltip(tooltip,cell,month,expenses) {
  var taxes=(expenses||[]).filter(e=>e.item&&e.item.includes('세금'));
  if(!taxes.length){ tooltip.style.display='none'; return; }
  var total=taxes.reduce((s,e)=>s+(e.amount||0),0);
  var lines=taxes.map(e=>'↳ '+escHtml(e.memo||'세금')+'&nbsp;&nbsp;'+formatMoney(e.amount));
  tooltip.innerHTML='<strong>'+month+'월 세금</strong>&nbsp;&nbsp;'+formatMoney(total)+'<br>'+lines.join('<br>');
  positionTooltip(tooltip,cell.getBoundingClientRect());
  clearTimeout(_tooltipTimeout);
  _tooltipTimeout=setTimeout(()=>tooltip.style.display='none',5000);
}

function renderAnnualMatrix(months,fixedMonths) {
  var head=document.getElementById('annual-matrix-head');
  var tbody=document.getElementById('annual-matrix-body');
  if(!head||!tbody||!months) return;
  state._annualMonths=months; state._annualFixedMonths=fixedMonths;
  document.querySelectorAll('#annual-view-seg .seg-btn').forEach(b=>{
    b.className='seg-btn'+(b.dataset.view===state.annualView?' active':'');
  });
  var fixedMap={};
  (fixedMonths||[]).forEach(m=>fixedMap[m.month]=m);
  var zeroTd=(v,extraCls)=>{
    var cls=[extraCls,v>0?'':'amount-zero'].filter(Boolean).join(' ');
    return '<td'+(cls?' class="'+cls+'"':'')+'>'+( v>0?formatNum(v):'–')+'</td>';
  };
  var html,footHtml;
  if(state.annualView==='detail'){
    head.innerHTML='<th>월</th>'+FIXED_BREAKDOWN_ITEMS.map(n=>'<th>'+n+'</th>').join('');
    var totFixed={}; FIXED_BREAKDOWN_ITEMS.forEach(n=>totFixed[n]=0);
    html=months.map(m=>{
      var fd=fixedMap[m.month]||{};
      FIXED_BREAKDOWN_ITEMS.forEach(n=>totFixed[n]+=(fd[n]||0));
      return '<tr><td>'+m.month+'월</td>'
        +FIXED_BREAKDOWN_ITEMS.map(n=>{
          var v=fd[n]||0;
          if(n==='세금'&&v>0) return '<td class="tax-cell" data-month="'+m.month+'">'+formatNum(v)+'</td>';
          return zeroTd(v);
        }).join('')+'</tr>';
    }).join('');
    footHtml='<tr class="matrix-footer"><td>합계</td>'
      +FIXED_BREAKDOWN_ITEMS.map(n=>'<td>'+(totFixed[n]>0?formatNum(totFixed[n]):'–')+'</td>').join('')+'</tr>';
  } else {
    head.innerHTML='<th>월</th><th>생활비</th><th>고정비</th><th class="col-total">합계</th>';
    var totL=0,totF=0,totA=0;
    html=months.map(m=>{
      var living=m.total-m.fixed;
      totL+=living; totF+=m.fixed; totA+=m.total;
      return '<tr><td>'+m.month+'월</td>'+zeroTd(living)+zeroTd(m.fixed)+zeroTd(m.total,'col-total')+'</tr>';
    }).join('');
    footHtml='<tr class="matrix-footer"><td>합계</td>'
      +'<td>'+(totL>0?formatNum(totL):'–')+'</td>'
      +'<td>'+(totF>0?formatNum(totF):'–')+'</td>'
      +'<td class="col-total">'+formatNum(totA)+'</td></tr>';
  }
  tbody.innerHTML=html+footHtml;
}

/* ── 이벤트 바인딩 ───────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('expense-date').value=todayStr();

  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>showTab(btn.dataset.tab));
  });
  document.getElementById('offline-bar').addEventListener('click',retrySendPending);

  document.querySelectorAll('#seg-user .seg-btn').forEach(btn=>{
    btn.addEventListener('click',function(){
      state.selectedUser=this.dataset.user;
      localStorage.setItem('lastUser',state.selectedUser);
      updateUserSeg();
      if(!state.categoryManuallySet){
        var lastCat=localStorage.getItem('lastCategory_'+state.selectedUser);
        if(lastCat){ state.selectedMajorCat=catToMajor(lastCat); var sub=document.getElementById('expense-subcat'); if(state.selectedMajorCat==='생활비'&&sub) sub.value=lastCat; }
        else state.selectedMajorCat=null;
        updateCategoryForm();
      }
      updateItemSuggestions();
      clearError('user-error',Array.from(document.querySelectorAll('#seg-user .seg-btn')));
    });
  });

  document.querySelectorAll('#seg-major .seg-btn').forEach(btn=>{
    btn.addEventListener('click',function(){
      state.selectedMajorCat=this.dataset.major; state.categoryManuallySet=true;
      clearError('category-error',Array.from(document.querySelectorAll('#seg-major .seg-btn')));
      updateCategoryForm();
    });
  });

  document.getElementById('pill-yesterday').addEventListener('click',()=>{ document.getElementById('expense-date').value=yesterdayStr(); updateDatePills(); });
  document.getElementById('pill-today').addEventListener('click',()=>{ document.getElementById('expense-date').value=todayStr(); updateDatePills(); });
  document.getElementById('expense-date').addEventListener('change',updateDatePills);

  document.getElementById('expense-amount').addEventListener('input',function(){
    var raw=parseMoney(this.value), clamped=clampAmount(raw);
    this.value=clamped>0?clamped.toLocaleString('ko-KR'):'';
    if(raw>9999999) showError(this,'amount-error','최대 금액을 초과했습니다.');
    else clearError('amount-error',[this]);
  });
  document.getElementById('expense-amount').addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();document.getElementById('expense-memo').focus();} });

  document.querySelectorAll('.amount-pill').forEach(pill=>{
    pill.addEventListener('click',function(){
      var added=clampAmount(parseMoney(document.getElementById('expense-amount').value)+parseInt(this.dataset.add,10));
      document.getElementById('expense-amount').value=added>0?added.toLocaleString('ko-KR'):'';
      clearError('amount-error',[document.getElementById('expense-amount')]);
    });
  });

  document.getElementById('expense-memo').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onSaveExpense();} });
  document.getElementById('expense-memo').addEventListener('input',function(){ document.getElementById('memo-count').textContent=this.value.length; });

  document.getElementById('expense-item-select').addEventListener('change',function(){ clearError('item-error',[this,document.getElementById('expense-item')]); updateTaxChips(); });
  document.getElementById('tax-chips-row').addEventListener('click',e=>{
    var btn=e.target.closest('[data-tax]'); if(!btn) return;
    var memo=document.getElementById('expense-memo');
    memo.value=btn.dataset.tax; document.getElementById('memo-count').textContent=btn.dataset.tax.length; memo.focus();
  });
  document.getElementById('expense-item').addEventListener('input',()=>clearError('item-error',[document.getElementById('expense-item')]));
  document.getElementById('expense-item').addEventListener('change',()=>clearError('item-error',[document.getElementById('expense-item')]));

  document.getElementById('save-btn').addEventListener('click',onSaveExpense);
  document.getElementById('edit-cancel').addEventListener('click',cancelEditMode);

  document.getElementById('monthly-prev').addEventListener('click',()=>{
    if(state.monthlyMonth===1){state.monthlyYear--;state.monthlyMonth=12;}else state.monthlyMonth--;
    loadMonthlyData();
  });
  document.getElementById('monthly-next').addEventListener('click',()=>{
    var now=new Date();
    if(state.monthlyYear>now.getFullYear()||(state.monthlyYear===now.getFullYear()&&state.monthlyMonth>=now.getMonth()+1)) return;
    if(state.monthlyMonth===12){state.monthlyYear++;state.monthlyMonth=1;}else state.monthlyMonth++;
    loadMonthlyData();
  });

  document.getElementById('annual-matrix-body').addEventListener('click',e=>{
    var cell=e.target.closest('.tax-cell'); if(!cell) return;
    e.stopPropagation();
    showTaxMemoTooltip(cell,state.annualYear,parseInt(cell.dataset.month));
  });
  document.getElementById('annual-view-seg').addEventListener('click',e=>{
    var btn=e.target.closest('.seg-btn');
    if(!btn||btn.dataset.view===state.annualView) return;
    state.annualView=btn.dataset.view;
    renderAnnualMatrix(state._annualMonths,state._annualFixedMonths);
  });
  document.getElementById('annual-prev').addEventListener('click',()=>{
    var years=state.availableYears, idx=years.indexOf(state.annualYear);
    if(idx<years.length-1){state.annualYear=years[idx+1];loadAnnualData();}
  });
  document.getElementById('annual-next').addEventListener('click',()=>{
    var years=state.availableYears, idx=years.indexOf(state.annualYear);
    if(idx>0){state.annualYear=years[idx-1];loadAnnualData();}
  });

  document.getElementById('monthly-title').addEventListener('click',()=>openDatePicker('monthly'));
  document.getElementById('annual-title').addEventListener('click',()=>openDatePicker('annual'));
  document.getElementById('dp-year-scroll').addEventListener('click',e=>{
    var chip=e.target.closest('.dp-year-chip'); if(!chip) return;
    _dp.year=parseInt(chip.dataset.year,10);
    if(_dp.mode==='annual'){state.annualYear=_dp.year;closeDatePicker();loadAnnualData();return;}
    var now=new Date();
    if(_dp.year===now.getFullYear()&&_dp.month>now.getMonth()+1) _dp.month=now.getMonth()+1;
    renderDatePicker();
  });
  document.getElementById('dp-month-grid').addEventListener('click',e=>{
    var chip=e.target.closest('.dp-month-chip'); if(!chip||chip.disabled) return;
    state.monthlyYear=_dp.year; state.monthlyMonth=parseInt(chip.dataset.month,10);
    closeDatePicker(); loadMonthlyData();
  });
  document.getElementById('datepicker-overlay').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeDatePicker(); });

  document.getElementById('action-cancel-btn').addEventListener('click',closeActionSheet);
  document.getElementById('action-sheet-overlay').addEventListener('click',e=>{ if(e.target===e.currentTarget) closeActionSheet(); });

  document.getElementById('action-edit-btn').addEventListener('click',async function(){
    if(!_actionData) return;
    var data=_actionData; closeActionSheet();
    try {
      var allYear=await fetchExpensesByYear(state.monthlyYear);
      var expenses=filterByMonth(allYear,state.monthlyYear,state.monthlyMonth);
      var found=expenses.find(e=>e.rowIndex===data.rowIndex||e.id===data.rowIndex);
      if(found) openEditMode(found,'monthly');
    } catch(e) { showToast('내역을 불러오지 못했습니다.'); }
  });

  document.getElementById('action-delete-btn').addEventListener('click',function(){
    if(!_actionData) return;
    var data=_actionData; closeActionSheet();
    document.getElementById('confirm-msg').textContent="'"+data.name+"'을 삭제할까요? 되돌릴 수 없습니다.";
    document.getElementById('confirm-overlay').classList.add('show');
    document.getElementById('confirm-ok-btn').onclick=function(){
      document.getElementById('confirm-overlay').classList.remove('show');
      doDeleteExpense(data.rowIndex,data.name);
    };
  });
  document.getElementById('confirm-cancel-btn').addEventListener('click',()=>document.getElementById('confirm-overlay').classList.remove('show'));
  document.getElementById('confirm-overlay').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.currentTarget.classList.remove('show'); });

  document.addEventListener('click',()=>{
    var tooltip=document.getElementById('svg-tooltip');
    if(tooltip&&tooltip.style.display!=='none'){tooltip.style.display='none';clearTimeout(_tooltipTimeout);}
  });

  /* ── PIN 인증 ─── */
  function startApp() {
    document.getElementById('pin-overlay').classList.remove('show');
    checkOfflineBar();
    showTab('home');
    updateUserSeg();
    document.getElementById('expense-date').value=todayStr();
    updateDatePills();
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden){
        if(state.currentTab==='home') loadHomeData();
        else if(state.currentTab==='monthly') loadMonthlyData();
        else if(state.currentTab==='annual') loadAnnualData();
      }
    });
  }

  async function submitPin() {
    var pin=document.getElementById('pin-input').value.trim(); if(!pin) return;
    var btn=document.getElementById('pin-submit'), errEl=document.getElementById('pin-error');
    btn.disabled=true; btn.textContent='확인 중...'; errEl.style.display='none';
    localStorage.setItem('app_pin',pin);
    try {
      // GAS로 PIN 검증 (쓰기 작업용 PIN 확인 겸)
      var res=await callAPI('getAvailableYears',{});
      if(res&&res.error==='인증 실패'){
        localStorage.removeItem('app_pin');
        document.getElementById('pin-input').value='';
        errEl.style.display='block';
        btn.disabled=false; btn.textContent='확인'; return;
      }
      if(res&&res.success&&res.years) state.availableYears=res.years;
    } catch(e) { /* 네트워크 오류 시 진행 */ }
    startApp();
  }

  document.getElementById('pin-submit').addEventListener('click',submitPin);
  document.getElementById('pin-input').addEventListener('keydown',e=>{ if(e.key==='Enter') submitPin(); });

  if(getStoredPin()) startApp();
  else { document.getElementById('pin-overlay').classList.add('show'); setTimeout(()=>document.getElementById('pin-input').focus(),100); }
});

/* ── 인라인 onclick 핸들러용 전역 노출 ─────────── */
window.openActionSheet  = openActionSheet;
window.quickRecordFixed = quickRecordFixed;
window.showTab          = showTab;
window._retryFns        = _retryFns;
