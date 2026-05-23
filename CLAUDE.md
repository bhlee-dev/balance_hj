# 부부 가계부 (balance_hj) — AI 작업 컨텍스트

**구조**: GitHub Pages (프론트엔드, `index.html` 단일 파일) + Google Apps Script (백엔드, `Code.gs`) + Google Sheets (DB).  
외부 서버 없음. 운영 비용 0원.

---

## ⚠️ 절대 건드리지 말 것 (실수 시 앱 즉시 파손)

### CORS 우회 헤더 — `Content-Type: text/plain`
GAS는 `application/json` POST를 보안상 차단한다.  
`callAPI` 함수의 fetch header는 반드시 `'Content-Type': 'text/plain;charset=utf-8'` 유지.  
"올바른" `application/json`으로 변경하면 모든 API 통신이 차단됨.

### GAS 배포 권한 — "모든 사용자(Anyone)"
웹앱 배포 시 액세스 권한을 "Google 계정이 있는 사용자"로 변경하면  
외부 브라우저에서 Google 로그인 화면으로 리다이렉트되어 무한 로딩 발생.  
반드시 **"모든 사용자(Anyone)"** 유지.

### PIN 및 SPREADSHEET_ID — JS/HTML에 절대 노출 금지
PIN과 SPREADSHEET_ID는 GAS의 `PropertiesService.getScriptProperties()`에만 저장.  
클라이언트 JS 코드(index.html)에 직접 쓰거나 GitHub에 커밋하지 말 것.  
PIN은 매 API 요청 바디에 실어 서버 사이드에서 검증함.

---

## CSS 시스템 (`index.html` `:root` 블록)

모든 타이포그래피는 CSS 변수 사용. 하드코딩 `px` 값 추가 금지.

| 변수 | 용도 |
|---|---|
| `--text-hero` ~ `--text-micro` | 6단계 폰트 크기 |
| `--fw-bold` ~ `--fw-regular` | 4단계 굵기 |
| `--ls-tight` ~ `--ls-wider` | 자간 |
| `--bg`, `--surface-1/2/3` | 배경·카드 색 |
| `--accent` | 강조색 (단색, 그라디언트 없음) |
| `--husband`, `--wife` | 사용자 pill 색상 전용 |

**예외**: `.summary-card-amount`는 3열 고밀도 레이아웃 특성상 `clamp(13px, 3.8vw, 22px)` 직접 사용.  
CSS 토큰(`--text-h1` 등)으로 되돌리면 375px 화면에서 금액 줄바꿈 재발. 건드리지 말 것.

---

## UX 원칙

- **FAB(플로팅 버튼) 없음**: 입력은 하단 탭의 `기록` 탭으로만 접근.
- **카테고리 통합**: 고정비(관리비·가스비 등)는 별도 폼 없이 카테고리 목록의 `[🏢 고정비]`로 단일 입력.
- **항상 다크모드**: 라이트 모드 분기 없음.

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 무한 로딩 / 401 | GAS 배포 권한이 "Google 계정 있는 사용자"로 설정됨 | 배포 관리 → 권한 "모든 사용자"로 수정 후 **새 버전** 재배포 |
| 데이터 불러오지 못했어요 | GAS URL 변경 미반영 또는 PIN 불일치 | GAS 편집기 실행 로그 확인. `setupSpreadsheetId()` / `setupPin()` 재실행 |
| GAS 코드 수정 후 반영 안 됨 | 배포 관리에서 "새 버전" 선택 안 함 | 배포 관리 → 편집 → **새 버전** 선택 후 재배포 (URL 변경 없음) |
