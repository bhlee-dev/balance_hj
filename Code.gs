// ====================================================
// 부부 가계부 — Google Apps Script 백엔드
// ====================================================

// 시트 이름 상수 (SPREADSHEET_ID는 PropertiesService에 저장)
const RAW_SHEET = 'RAW_DATA';
const CACHE_DURATION_SEC = 30;
const ALLOWED_USERS = ['희', '정', '희정', '남편', '아내']; // 구 데이터 호환 유지, '희정'=공동 고정비
const ALLOWED_CATEGORIES = ['식비/주류','교통/차량','주거/생활','쇼핑/의료','취미/여가','여행/숙박','고정비','기타'];

// ====================================================
// 최초 1회 설정 함수 — GAS 편집기에서 직접 실행
// ====================================================
function setupSpreadsheetId() {
  // 실제 Spreadsheet ID로 교체 후 실행
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'YOUR_SPREADSHEET_ID');
  Logger.log('SPREADSHEET_ID 저장 완료');
}

// ====================================================
// 유틸리티
// ====================================================
// Config.gs(gitignore, GAS에만 존재)의 SPREADSHEET_ID_FALLBACK을 폴백으로 사용
function getSpreadsheetId() {
  var stored = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (stored) return stored;
  return typeof SPREADSHEET_ID_FALLBACK !== 'undefined' ? SPREADSHEET_ID_FALLBACK : '';
}

function getSheet(name) {
  return SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName(name);
}

function cacheKey(type, year, month) {
  return month != null ? type + '_' + year + '_' + month : type + '_' + year + '_all';
}

function invalidateCache(year, month) {
  const cache = CacheService.getScriptCache();
  const keys = [
    'summary_' + year + '_' + month,
    'expenses_' + year + '_' + month,
    'yearly_' + year,
    'recent'
  ];
  cache.removeAll(keys);
}

function sanitizeString(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function validateDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr);
  return d instanceof Date && !isNaN(d);
}

function parseAmount(val) {
  const n = parseInt(String(val).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function clampAmount(n) {
  return Math.min(Math.max(0, n), 9999999);
}

// 편집기에서 1회 실행 — UrlFetchApp(외부 요청) 권한 승인용
function authorizeOnce() {
  var res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json', payload: '{}', muteHttpExceptions: true }
  );
  Logger.log('HTTP ' + res.getResponseCode() + ' — 외부 요청 권한 승인 완료');
}

// ====================================================
// Firebase ID Token 검증
// ====================================================
const ALLOWED_EMAILS = ['hj@ledger.com', 'jeong@ledger.com'];
const FIREBASE_API_KEY = 'AIzaSyAL7kaWcmpD4Q6dnzhAzeQYbc-leIxohlc';

// tokeninfo 엔드포인트는 Firebase(securetoken) 발급 토큰을 검증하지 못함 — accounts:lookup 사용
function verifyFirebaseToken(token) {
  if (!token) return false;
  try {
    var res = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ idToken: token }),
        muteHttpExceptions: true
      }
    );
    if (res.getResponseCode() !== 200) return false;
    var data = JSON.parse(res.getContentText());
    if (!data.users || !data.users.length) return false;
    return ALLOWED_EMAILS.indexOf(data.users[0].email) !== -1;
  } catch(e) {
    Logger.log('Token 검증 오류: ' + e.message);
    return false;
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====================================================
// 웹앱 진입점 — GET (조회)
// ====================================================
function doGet(e) {
  var p = e.parameter || {};
  if (!verifyFirebaseToken(p.token || '')) return jsonResponse({ success: false, error: '인증 실패' });

  var action = p.action || '';
  try {
    if (action === 'getMonthlySummary')       return jsonResponse(getMonthlySummary(+p.year, +p.month));
    if (action === 'getRecentExpenses')        return jsonResponse(getRecentExpenses(+(p.limit || 10)));
    if (action === 'getExpenses')              return jsonResponse(getExpenses(+p.year, +p.month));
    if (action === 'getYearlySummary')              return jsonResponse(getYearlySummary(+p.year));
    if (action === 'getAvailableYears')             return jsonResponse(getAvailableYears());
    if (action === 'getYearlyFixedBreakdown')       return jsonResponse(getYearlyFixedBreakdown(+p.year));
    if (action === 'getAllExpenses')                return jsonResponse(getAllExpenses());
    return jsonResponse({ success: false, error: '알 수 없는 액션' });
  } catch(err) {
    Logger.log('오류: ' + err.message);
    return jsonResponse({ success: false, error: '서버 오류가 발생했습니다.' });
  }
}

// ====================================================
// 웹앱 진입점 — POST (쓰기/수정/삭제)
// ====================================================
function doPost(e) {
  var payload;
  try { payload = JSON.parse(e.postData.contents); }
  catch(err) { return jsonResponse({ success: false, error: '요청 파싱 실패' }); }

  if (!verifyFirebaseToken(payload.token || '')) return jsonResponse({ success: false, error: '인증 실패' });

  var action = payload.action || '';
  try {
    if (action === 'addExpense')    return jsonResponse(addExpense(payload.data));
    if (action === 'updateExpense') return jsonResponse(updateExpense(payload.docId, payload.data));
    if (action === 'deleteExpense') return jsonResponse(deleteExpense(payload.docId));
    if (action === 'smartSync')     return jsonResponse(smartSync(payload));
    return jsonResponse({ success: false, error: '알 수 없는 액션' });
  } catch(err) {
    Logger.log('오류: ' + err.message);
    return jsonResponse({ success: false, error: '서버 오류가 발생했습니다.' });
  }
}

// ====================================================
// 일상 지출 함수
// ====================================================

/**
 * H열(docId)로 시트 행 번호를 찾는다. 없으면 -1 반환.
 */
function findRowByDocId(sheet, docId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === docId) return i + 2;
  }
  return -1;
}

/**
 * 일상 지출 추가
 * @param {Object} data - { date, item, category, user, amount, memo, docId }
 */
function addExpense(data) {
  try {
    const date = sanitizeString(data.date, 10);
    if (!validateDate(date)) return { success: false, error: '날짜 형식이 올바르지 않습니다.' };

    const user = sanitizeString(data.user, 10);
    if (!ALLOWED_USERS.includes(user)) return { success: false, error: '사용자 값이 올바르지 않습니다.' };

    const category = sanitizeString(data.category, 10);
    if (!ALLOWED_CATEGORIES.includes(category)) return { success: false, error: '카테고리 값이 올바르지 않습니다.' };

    const item = sanitizeString(data.item, 50);
    if (!item) return { success: false, error: '항목명을 입력해주세요.' };

    const amount = parseAmount(data.amount);
    if (amount < 1 || amount > 9999999) return { success: false, error: '금액을 확인해주세요.' };

    const memo = sanitizeString(data.memo || '', 200);
    const createdAt = new Date().toISOString();
    const docId = sanitizeString(data.docId || '', 100);

    const sheet = getSheet(RAW_SHEET);
    sheet.appendRow([date, item, category, user, amount, memo, createdAt, docId]);

    // 해당 날짜의 년/월 캐시 무효화
    const year = parseInt(date.slice(0, 4), 10);
    const month = parseInt(date.slice(5, 7), 10);
    invalidateCache(year, month);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 일상 지출 수정 (H열 docId로 행을 찾아서 수정)
 * @param {string} docId - Firestore 문서 ID
 * @param {Object} data - { date, item, category, user, amount, memo }
 */
function updateExpense(docId, data) {
  try {
    const date = sanitizeString(data.date, 10);
    if (!validateDate(date)) return { success: false, error: '날짜 형식이 올바르지 않습니다.' };

    const user = sanitizeString(data.user, 10);
    if (!ALLOWED_USERS.includes(user)) return { success: false, error: '사용자 값이 올바르지 않습니다.' };

    const category = sanitizeString(data.category, 10);
    if (!ALLOWED_CATEGORIES.includes(category)) return { success: false, error: '카테고리 값이 올바르지 않습니다.' };

    const item = sanitizeString(data.item, 50);
    if (!item) return { success: false, error: '항목명을 입력해주세요.' };

    const amount = parseAmount(data.amount);
    if (amount < 1 || amount > 9999999) return { success: false, error: '금액을 확인해주세요.' };

    const memo = sanitizeString(data.memo || '', 200);

    const sheet = getSheet(RAW_SHEET);
    const rowIndex = findRowByDocId(sheet, docId);
    if (rowIndex === -1) return { success: false, error: '시트에서 해당 항목을 찾을 수 없습니다.' };

    // 업데이트 전 기존 날짜 읽기 (날짜 변경 시 이전 월 캐시도 무효화)
    const oldDateVal = sheet.getRange(rowIndex, 1).getValue();
    const oldDateStr = typeof oldDateVal === 'string' ? oldDateVal
      : Utilities.formatDate(new Date(oldDateVal), 'Asia/Seoul', 'yyyy-MM-dd');

    // A~F열만 수정, G열(created_at), H열(docId) 유지
    sheet.getRange(rowIndex, 1, 1, 6).setValues([[date, item, category, user, amount, memo]]);

    const year = parseInt(date.slice(0, 4), 10);
    const month = parseInt(date.slice(5, 7), 10);
    invalidateCache(year, month);

    // 날짜가 변경된 경우 이전 월도 무효화
    const oldYear = parseInt(oldDateStr.slice(0, 4), 10);
    const oldMonth = parseInt(oldDateStr.slice(5, 7), 10);
    if (oldYear !== year || oldMonth !== month) {
      invalidateCache(oldYear, oldMonth);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 일상 지출 삭제 (H열 docId로 행을 찾아서 삭제)
 * @param {string} docId - Firestore 문서 ID
 */
function deleteExpense(docId) {
  try {
    const sheet = getSheet(RAW_SHEET);
    const rowIndex = findRowByDocId(sheet, docId);
    if (rowIndex === -1) return { success: false, error: '시트에서 해당 항목을 찾을 수 없습니다.' };

    // 삭제 전 날짜 읽어서 캐시 무효화
    const dateVal = sheet.getRange(rowIndex, 1).getValue();
    sheet.deleteRow(rowIndex);

    if (dateVal) {
      const dateStr = Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
      const year = parseInt(dateStr.slice(0, 4), 10);
      const month = parseInt(dateStr.slice(5, 7), 10);
      invalidateCache(year, month);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 시트 전체 데이터 조회 (스마트 동기화 진단용, 캐시 없음)
 */
function getAllExpenses() {
  try {
    const sheet = getSheet(RAW_SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };

    const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    const data = [];
    values.forEach(function(row) {
      const dateVal = row[0];
      if (!dateVal) return;
      const dateStr = typeof dateVal === 'string' ? dateVal
        : Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
      data.push({
        date: dateStr,
        item: String(row[1] || ''),
        category: String(row[2] || ''),
        user: String(row[3] || ''),
        amount: Number(row[4]) || 0,
        memo: String(row[5] || ''),
        docId: String(row[7] || '')
      });
    });
    return { success: true, data: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 스마트 동기화 — Firestore 기준으로 시트를 일괄 추가/수정/삭제
 * @param {Object} payload - { toAdd: [{rowIndex(docId), date, item, ...}], toUpdate: [{docId, data}], toDelete: [{docId}] }
 */
function smartSync(payload) {
  try {
    const sheet = getSheet(RAW_SHEET);
    const toAdd = payload.toAdd || [];
    const toUpdate = payload.toUpdate || [];
    const toDelete = payload.toDelete || [];
    let added = 0, updated = 0, deleted = 0;

    // docId → 행 번호 맵 (1회 조회)
    const idMap = {};
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0]) idMap[String(ids[i][0])] = i + 2;
      }
    }

    // 수정 (행 번호 유지되는 단계에서 먼저 처리)
    toUpdate.forEach(function(u) {
      const row = idMap[String(u.docId)];
      if (!row || !u.data) return;
      const d = u.data;
      sheet.getRange(row, 1, 1, 6).setValues([[
        sanitizeString(String(d.date || ''), 10),
        sanitizeString(String(d.item || ''), 50),
        sanitizeString(String(d.category || ''), 10),
        sanitizeString(String(d.user || ''), 10),
        clampAmount(parseAmount(d.amount)),
        sanitizeString(String(d.memo || ''), 200)
      ]]);
      updated++;
    });

    // 삭제 (아래쪽 행부터 — 행 번호 밀림 방지), 삭제 전 날짜 수집
    const deletedDates = [];
    const delRows = toDelete
      .map(function(t) { return idMap[String(t.docId)]; })
      .filter(function(r) { return r; })
      .sort(function(a, b) { return b - a; });
    delRows.forEach(function(r) {
      const dv = sheet.getRange(r, 1).getValue();
      if (dv) deletedDates.push(typeof dv === 'string' ? dv : Utilities.formatDate(new Date(dv), 'Asia/Seoul', 'yyyy-MM-dd'));
      sheet.deleteRow(r);
      deleted++;
    });

    // 추가 (rowIndex 필드 = Firestore docId)
    toAdd.forEach(function(item) {
      sheet.appendRow([
        sanitizeString(String(item.date || ''), 10),
        sanitizeString(String(item.item || ''), 50),
        sanitizeString(String(item.category || ''), 10),
        sanitizeString(String(item.user || ''), 10),
        clampAmount(parseAmount(item.amount)),
        sanitizeString(String(item.memo || ''), 200),
        String(item.createdAt || new Date().toISOString()),
        sanitizeString(String(item.rowIndex || ''), 100)
      ]);
      added++;
    });

    // 영향 받은 년/월 캐시 전체 무효화
    const months = {};
    function markMonth(dateStr) {
      if (!dateStr || !/^\d{4}-\d{2}/.test(dateStr)) return;
      months[dateStr.slice(0, 7)] = true;
    }
    toAdd.forEach(function(i) { markMonth(String(i.date || '')); });
    toUpdate.forEach(function(u) { markMonth(String((u.data && u.data.date) || '')); markMonth(String((u.old && u.old.date) || '')); });
    deletedDates.forEach(markMonth);
    Object.keys(months).forEach(function(ym) {
      invalidateCache(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10));
    });

    return { success: true, added: added, updated: updated, deleted: deleted };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 일상 지출 조회
 * @param {number} year
 * @param {number|null} month - null이면 연간 전체
 */
function getExpenses(year, month) {
  try {
    const key = cacheKey('expenses', year, month);
    const cache = CacheService.getScriptCache();
    const cached = cache.get(key);
    if (cached) return { success: true, data: JSON.parse(cached) };

    const sheet = getSheet(RAW_SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };

    const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const result = [];

    values.forEach((row, idx) => {
      const dateVal = row[0];
      if (!dateVal) return;
      const dateStr = typeof dateVal === 'string' ? dateVal
        : Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
      const rowYear = parseInt(dateStr.slice(0, 4), 10);
      const rowMonth = parseInt(dateStr.slice(5, 7), 10);

      if (rowYear !== year) return;
      if (month != null && rowMonth !== month) return;

      result.push({
        rowIndex: idx + 2,
        date: dateStr,
        item: row[1] || '',
        category: row[2] || '',
        user: row[3] || '',
        amount: parseInt(row[4], 10) || 0,
        memo: row[5] || ''
      });
    });

    // 날짜 내림차순 정렬
    result.sort((a, b) => b.date.localeCompare(a.date));

    const json = JSON.stringify(result);
    if (json.length < 100000) cache.put(key, json, CACHE_DURATION_SEC);

    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 최근 지출 조회
 * @param {number} limit - 기본 10
 */
function getRecentExpenses(limit) {
  try {
    const n = parseInt(limit, 10) || 10;
    const key = 'recent';
    const cache = CacheService.getScriptCache();
    const cached = cache.get(key);
    if (cached) {
      const data = JSON.parse(cached);
      return { success: true, data: data.slice(0, n) };
    }

    const sheet = getSheet(RAW_SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };

    const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const result = [];

    values.forEach((row, idx) => {
      const dateVal = row[0];
      if (!dateVal) return;
      const dateStr = typeof dateVal === 'string' ? dateVal
        : Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
      result.push({
        rowIndex: idx + 2,
        date: dateStr,
        item: row[1] || '',
        category: row[2] || '',
        user: row[3] || '',
        amount: parseInt(row[4], 10) || 0,
        memo: row[5] || ''
      });
    });

    result.sort((a, b) => b.date.localeCompare(a.date));

    const json = JSON.stringify(result);
    if (json.length < 100000) cache.put(key, json, CACHE_DURATION_SEC);

    return { success: true, data: result.slice(0, n) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ====================================================
// 통계 함수
// ====================================================

/**
 * 월간 요약
 */
function getMonthlySummary(year, month) {
  try {
    const key = 'summary_' + year + '_' + month;
    const scriptCache = CacheService.getScriptCache();
    const cached = scriptCache.get(key);
    if (cached) return JSON.parse(cached);

    // RAW_DATA 집계
    const rawSheet = getSheet(RAW_SHEET);
    const rawLastRow = rawSheet.getLastRow();
    let livingTotal = 0;
    let husbandTotal = 0;
    let wifeTotal = 0;
    const byCategory = {'식비/주류':0,'교통/차량':0,'주거/생활':0,'쇼핑/의료':0,'취미/여가':0,'여행/숙박':0,'고정비':0,'기타':0};
    const dailyTotals = {};
    let rawFixedTotal = 0;

    if (rawLastRow >= 2) {
      const values = rawSheet.getRange(2, 1, rawLastRow - 1, 5).getValues();
      values.forEach(function(row) {
        const dateVal = row[0];
        if (!dateVal) return;
        const dateStr = typeof dateVal === 'string' ? dateVal
          : Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
        const rowYear = parseInt(dateStr.slice(0, 4), 10);
        const rowMonth = parseInt(dateStr.slice(5, 7), 10);
        if (rowYear !== year || rowMonth !== month) return;

        const amount = parseInt(row[4], 10) || 0;
        const user = row[3];
        const category = row[2];

        // 고정비 카테고리는 생활비가 아닌 고정비 합계에 집계
        if (category === '고정비') {
          rawFixedTotal += amount;
        } else {
          livingTotal += amount;
        }
        if (user === '남편') husbandTotal += amount;
        else if (user === '아내') wifeTotal += amount;
        if (byCategory.hasOwnProperty(category)) byCategory[category] += amount;
        else byCategory['기타'] += amount;
        dailyTotals[dateStr] = (dailyTotals[dateStr] || 0) + amount;
      });
    }

    // RAW_DATA 고정비 항목만 집계 (FIXED_EXPENSES 시트 미사용)
    const fixedTotal = rawFixedTotal;
    const total = livingTotal + fixedTotal;

    const summary = {
      success: true,
      year: year,
      month: month,
      total: total,
      livingTotal: livingTotal,
      fixedTotal: fixedTotal,
      husbandTotal: husbandTotal,
      wifeTotal: wifeTotal,
      byCategory: byCategory,
      dailyTotals: dailyTotals
    };

    const json = JSON.stringify(summary);
    if (json.length < 100000) scriptCache.put(key, json, CACHE_DURATION_SEC);

    return summary;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 연간 요약
 */
function getYearlySummary(year) {
  try {
    const key = 'yearly_' + year;
    const scriptCache = CacheService.getScriptCache();
    const cached = scriptCache.get(key);
    if (cached) return JSON.parse(cached);

    // RAW_DATA 한 번에 읽기
    const rawSheet = getSheet(RAW_SHEET);
    const rawLastRow = rawSheet.getLastRow();

    // 월별 집계 초기화
    const monthData = {};
    for (let m = 1; m <= 12; m++) {
      monthData[m] = { living: 0, rawFixed: 0, husband: 0, wife: 0 };
    }

    if (rawLastRow >= 2) {
      const values = rawSheet.getRange(2, 1, rawLastRow - 1, 5).getValues();
      values.forEach(function(row) {
        const dateVal = row[0];
        if (!dateVal) return;
        const dateStr = typeof dateVal === 'string' ? dateVal
          : Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
        if (parseInt(dateStr.slice(0, 4), 10) !== year) return;
        const m = parseInt(dateStr.slice(5, 7), 10);
        if (m < 1 || m > 12) return;
        const amount = parseInt(row[4], 10) || 0;
        const user = row[3];
        const category = row[2];
        // 고정비 카테고리는 생활비가 아닌 고정비 합계에 집계
        if (category === '고정비') {
          monthData[m].rawFixed += amount;
        } else {
          monthData[m].living += amount;
        }
        if (user === '남편') monthData[m].husband += amount;
        else if (user === '아내') monthData[m].wife += amount;
      });
    }

    // 결과 조합 (FIXED_EXPENSES 시트 미사용, RAW_DATA 고정비 항목만)
    const months = [];
    let yearTotal = 0, yearLiving = 0, yearFixed = 0, yearHusband = 0, yearWife = 0;

    for (let m = 1; m <= 12; m++) {
      const living = monthData[m].living;
      const fixed = monthData[m].rawFixed;
      const total = living + fixed;
      months.push({
        month: m,
        total: total,
        living: living,
        fixed: fixed,
        husband: monthData[m].husband,
        wife: monthData[m].wife
      });
      yearTotal += total;
      yearLiving += living;
      yearFixed += fixed;
      yearHusband += monthData[m].husband;
      yearWife += monthData[m].wife;
    }

    const summary = {
      success: true,
      year: year,
      months: months,
      yearTotal: yearTotal,
      yearLiving: yearLiving,
      yearFixed: yearFixed,
      yearHusband: yearHusband,
      yearWife: yearWife
    };

    const json = JSON.stringify(summary);
    if (json.length < 100000) scriptCache.put(key, json, CACHE_DURATION_SEC);

    return summary;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 데이터가 존재하는 연도 목록
 */
function getAvailableYears() {
  try {
    const yearSet = {};
    const currentYear = new Date().getFullYear();

    const rawSheet = getSheet(RAW_SHEET);
    const rawLastRow = rawSheet.getLastRow();
    if (rawLastRow >= 2) {
      const dates = rawSheet.getRange(2, 1, rawLastRow - 1, 1).getValues();
      dates.forEach(function(row) {
        const v = row[0];
        if (!v) return;
        const dateStr = typeof v === 'string' ? v
          : Utilities.formatDate(new Date(v), 'Asia/Seoul', 'yyyy-MM-dd');
        const y = parseInt(dateStr.slice(0, 4), 10);
        if (y > 2000 && y <= currentYear + 1) yearSet[y] = true;
      });
    }

    let years = Object.keys(yearSet).map(Number);
    if (years.length === 0) years = [currentYear];
    years.sort((a, b) => b - a);

    return { success: true, years: years };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ====================================================
// 연간 고정비 항목별 매트릭스
// ====================================================

function getYearlyFixedBreakdown(year) {
  try {
    const ITEMS = ['관리비', '도시가스', '수도요금', '세금'];
    const sheet = getSheet(RAW_SHEET);
    const lastRow = sheet.getLastRow();
    const result = {};
    for (let m = 1; m <= 12; m++) {
      result[m] = { month: m, 관리비: 0, 도시가스: 0, 수도요금: 0, 세금: 0 };
    }
    if (lastRow < 2) return { success: true, months: Object.values(result) };

    const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const dateVal = row[0];
      if (!dateVal) continue;
      const dateStr = typeof dateVal === 'string' ? dateVal
        : Utilities.formatDate(new Date(dateVal), 'Asia/Seoul', 'yyyy-MM-dd');
      if (parseInt(dateStr.slice(0, 4), 10) !== year) continue;
      const month = parseInt(dateStr.slice(5, 7), 10);
      if (month < 1 || month > 12) continue;
      const category = String(row[2]).trim();
      if (category !== '고정비') continue;
      const item = String(row[1]).trim();
      const amount = parseInt(row[4], 10) || 0;
      ITEMS.forEach(function(name) {
        if (item.includes(name)) result[month][name] += amount;
      });
    }
    return { success: true, months: Object.values(result) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
