// ====================================================
// 부부 가계부 — Google Apps Script 백엔드
// ====================================================

// 시트 이름 상수 (SPREADSHEET_ID는 PropertiesService에 저장)
const RAW_SHEET = 'RAW_DATA';
const CACHE_DURATION_SEC = 30;
const ALLOWED_USERS = ['남편', '아내'];
const ALLOWED_CATEGORIES = ['식비', '교통', '생활', '의료', '여가', '고정비', '기타'];

// ====================================================
// 최초 1회 설정 함수 — GAS 편집기에서 직접 실행
// ====================================================
function setupSpreadsheetId() {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', '1WeARJqfLry-2NmT4wgDnI_ZdsCXLULUNm-sPu14_gAE');
  Logger.log('SPREADSHEET_ID 저장 완료');
}

// ====================================================
// 유틸리티
// ====================================================
function getSpreadsheetId() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
          || '1WeARJqfLry-2NmT4wgDnI_ZdsCXLULUNm-sPu14_gAE';
  return id;
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

// ====================================================
// PIN 설정 (최초 1회, GAS 편집기에서 직접 실행)
// ====================================================
function setupPin() {
  // 아래 '0000' 을 원하는 PIN으로 교체 후 실행
  PropertiesService.getScriptProperties().setProperty('APP_PIN', '0000');
  Logger.log('APP_PIN 저장 완료');
}

function verifyPin(pin) {
  var stored = PropertiesService.getScriptProperties().getProperty('APP_PIN');
  return stored != null && pin === stored;
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
  if (!verifyPin(p.pin || '')) return jsonResponse({ success: false, error: '인증 실패' });

  var action = p.action || '';
  try {
    if (action === 'getMonthlySummary')       return jsonResponse(getMonthlySummary(+p.year, +p.month));
    if (action === 'getRecentExpenses')        return jsonResponse(getRecentExpenses(+(p.limit || 10)));
    if (action === 'getExpenses')              return jsonResponse(getExpenses(+p.year, +p.month));
    if (action === 'getYearlySummary')              return jsonResponse(getYearlySummary(+p.year));
    if (action === 'getAvailableYears')             return jsonResponse(getAvailableYears());
    if (action === 'getYearlyFixedBreakdown')       return jsonResponse(getYearlyFixedBreakdown(+p.year));
    return jsonResponse({ success: false, error: '알 수 없는 액션: ' + action });
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ====================================================
// 웹앱 진입점 — POST (쓰기/수정/삭제)
// ====================================================
function doPost(e) {
  var payload;
  try { payload = JSON.parse(e.postData.contents); }
  catch(err) { return jsonResponse({ success: false, error: '요청 파싱 실패' }); }

  if (!verifyPin(payload.pin || '')) return jsonResponse({ success: false, error: '인증 실패' });

  var action = payload.action || '';
  try {
    if (action === 'addExpense')    return jsonResponse(addExpense(payload.data));
    if (action === 'updateExpense') return jsonResponse(updateExpense(payload.rowIndex, payload.data));
    if (action === 'deleteExpense') return jsonResponse(deleteExpense(payload.rowIndex));
    return jsonResponse({ success: false, error: '알 수 없는 액션: ' + action });
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ====================================================
// 일상 지출 함수
// ====================================================

/**
 * 일상 지출 추가
 * @param {Object} data - { date, item, category, user, amount, memo }
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

    const sheet = getSheet(RAW_SHEET);
    sheet.appendRow([date, item, category, user, amount, memo, createdAt]);

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
 * 일상 지출 수정
 * @param {number} rowIndex - RAW_DATA 실제 행 번호 (2부터 시작)
 * @param {Object} data - { date, item, category, user, amount, memo }
 */
function updateExpense(rowIndex, data) {
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
    // 업데이트 전 기존 날짜 읽기 (날짜 변경 시 이전 월 캐시도 무효화)
    const oldDateVal = sheet.getRange(rowIndex, 1).getValue();
    const oldDateStr = typeof oldDateVal === 'string' ? oldDateVal
      : Utilities.formatDate(new Date(oldDateVal), 'Asia/Seoul', 'yyyy-MM-dd');

    // A~F열만 수정, G열(created_at) 유지
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
 * 일상 지출 삭제
 * @param {number} rowIndex - RAW_DATA 실제 행 번호
 */
function deleteExpense(rowIndex) {
  try {
    const sheet = getSheet(RAW_SHEET);
    const lastRow = sheet.getLastRow();
    if (rowIndex < 2 || rowIndex > lastRow) return { success: false, error: '유효하지 않은 행 번호입니다.' };

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
    const byCategory = { '식비': 0, '교통': 0, '생활': 0, '의료': 0, '여가': 0, '고정비': 0, '기타': 0 };
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
