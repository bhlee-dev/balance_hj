# 부부 가계부 (balance_hj) — AI 작업 컨텍스트

**구조**: GitHub Pages (프론트엔드, `index.html` 단일 파일) + Firebase Auth (인증) + Firestore (DB).  
외부 서버 없음. 운영 비용 0원. 저장소는 **public** — 시크릿·ID류 커밋 금지.  
Google Apps Script(`Code.gs`) + Google Sheets는 백업 용도로만 잔존 (신규 추가 자동 백업 + 스마트 동기화로 diff 복구).

형제 앱: snowball_hj(자산관리, snowball-hj.web.app), trip_hj(여행경비, trip-hj.web.app). 앱 스위처로 상호 이동하며, trip의 "가계부 내보내기"가 이 앱의 `expenses`에 `여행/숙박` 카테고리로 기록함.

---

## ⚠️ 절대 건드리지 말 것 (실수 시 앱 즉시 파손)

### Firebase Config 객체 — 클라이언트 노출은 정상
`index.html:875~`의 `firebaseConfig` 객체(apiKey 포함)는 클라이언트 코드에 공개되어 있으며, 이는 Firebase 표준 방식이다.  
Security Rules로 접근 제어하므로 apiKey 노출 자체는 문제없다.  
config 값 삭제·변경 시 Firebase 연결 자체가 끊김.

### Auth 방식 — PIN + "00" suffix
`submitPin()`(`index.html:2474~`)에서 사용자가 입력한 PIN 뒤에 `"00"`을 붙여 Firebase 이메일/비밀번호 인증(`hj@ledger.com`)을 수행한다.  
이 suffix 로직을 변경하면 기존 세션이 전부 무효화되어 재로그인 불가. **trip_hj의 가계부 내보내기도 같은 PIN으로 이 앱에 재인증**하므로 두 앱이 함께 깨짐.  
세션은 `browserLocalPersistence`로 유지 — 탭을 닫아도 로그인 상태 유지.

### Firestore 컬렉션명 `'expenses'`
모든 데이터 쿼리·저장·수정·삭제가 `'expenses'` 컬렉션 기준으로 작동한다.  
컬렉션명 오타·변경 시 데이터 접근 불가.  
문서 필드 구조: `{ date, item, category, user, amount, memo, createdAt }` (구버전 문서엔 숫자 `rowIndex` 필드 잔존)

**문서 읽기 스프레드 순서 — 반드시 `{ ...doc.data(), rowIndex: doc.id }`**  
구버전 문서의 레거시 `rowIndex` 필드(숫자)가 `doc.id`를 덮어쓰면 수정은 조용히 실패하고 삭제는 성공 토스트가 뜨는데 실제로는 안 지워진다(유령 기록). 순서를 절대 뒤집지 말 것.

**신규 기록은 `doc()` → `setDoc` 패턴 유지 (`addDoc` 금지)**  
`doc(collection(db,'expenses'))`로 ID를 먼저 만들어 `syncToGoogleSheet({...data, docId: ref.id})`에 전달해야 시트 H열에 docId가 들어간다. docId 없는 백업 행은 동기화 진단이 비교하지 못해 시트에 중복 행이 누적된다.

### GAS 백업 Content-Type — `text/plain`
`syncToGoogleSheet()`(`index.html:1016~`)의 fetch 헤더는 `'Content-Type': 'text/plain'` 유지.  
GAS는 `application/json` POST를 보안상 차단하므로, `application/json`으로 변경하면 백업이 막힘.  
앱 자체(Firestore)는 동작하지만 Google Sheets 백업 데이터가 소실됨.

### GAS 인증 — Firebase ID 토큰 검증 (accounts:lookup)
프론트는 요청에 Firebase ID 토큰을 담아 보내고, GAS `doPost`는 `identitytoolkit accounts:lookup`으로 검증한다 (v9에서 구버전 PIN 검증 대체).  
- **tokeninfo 엔드포인트는 Firebase 토큰 검증 불가** — accounts:lookup 방식 유지  
- 공유 시크릿 방식으로 되돌리지 말 것 (public repo라 노출됨)

### Spreadsheet ID — Config.gs 분리 (public repo)
ID는 `Config.gs`(**gitignored**, GAS에만 push)의 `SPREADSHEET_ID_FALLBACK` + Script Properties에만 존재.  
`getSpreadsheetId()`는 PropertiesService → Config.gs 폴백 순. ID를 Code.gs나 커밋 파일에 쓰지 말 것.

### .claspignore — clasp push 전 반드시 확인
sw.js/manifest.json/icons/html이 GAS에 push되면 top-level `self` 참조로 **백엔드 전체가 깨짐** (실제 사고 이력).  
GAS 수정 전에는 `clasp pull`로 배포본과 로컬 일치를 먼저 확인할 것 (과거 불일치 사고).  
재배포는 `clasp deploy -i <기존배포ID>` — URL 유지 필수.

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
| `--husband`, `--wife` | 지출 목록 pill(`.pill-husband`/`.pill-wife`) 전용 — seg-ctrl active에 쓰지 말 것 |

**예외1**: `.summary-card-amount`는 3열 고밀도 레이아웃 특성상 `clamp(13px, 3.8vw, 22px)` 직접 사용.  
CSS 토큰(`--text-h1` 등)으로 되돌리면 375px 화면에서 금액 줄바꿈 재발. 건드리지 말 것.

**예외2 — Active State 하드코딩**:  
- Segmented Control(`.seg-btn.active`): `background:#FFFFFF; color:#121212` (CSS 변수 아님)  
- Chip 버튼(`.quick-pill.active`): `border:1px solid rgba(255,255,255,0.8); color:#FFFFFF`

---

## UX 원칙

- **FAB(플로팅 버튼) 없음**: 입력은 하단 탭의 `기록` 탭으로만 접근.
- **헤더 제목은 `가계부` 고정**: 탭(월간/연간/기록)이나 수정 모드에 따라 제목을 바꾸지 않는다. 현재 위치는 하단 탭, 수정 중 여부는 `edit-banner`로 표시. trip_hj(`여행`)·snowball_hj(`우상향`)와 동작 통일 — `showTab`/`fillFormWithExpense` 등에서 `#header-title`을 다시 쓰지 말 것.
- **카테고리 통합**: 고정비(관리비·가스비 등)는 별도 폼 없이 기록 탭 분류 세그먼트 `고정비` 선택 후 항목 드롭다운으로 입력.
- **항상 다크모드**: 라이트 모드 분기 없음.
- **사용자 식별자**: `'희'`(남편), `'정'`(아내), `'희정'`(공동비 전용, 고정비에만 사용). 구버전 DB 레코드에 `'남편'`/`'아내'` 잔존 — 프론트에서 자동 호환 처리. 신규 코드에 `'남편'`/`'아내'` 하드코딩 금지.

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| PIN 입력해도 로그인 안 됨 | Firebase Auth 비밀번호 불일치 또는 네트워크 오류 | 브라우저 콘솔에서 Firebase Auth 오류 코드 확인 |
| 데이터 불러오지 못했어요 | Firestore 연결 실패 또는 오프라인 캐시 만료 | Firebase Console → Firestore 접속 가능 여부 확인 |
| 수정 후 구글 시트에 반영 안 됨 | 자동 백업은 신규 추가만 대상 | 데이터 관리 → **동기화 진단하기** → 동기화 실행 (smartSync가 수정·삭제·옛 백업 행 정리까지 복구) |
| 시트 백업이 계속 실패 | GAS 배포본이 구버전이거나 authorizeOnce 미승인 | `clasp pull`로 배포본 확인, GAS 편집기 실행 로그 확인 |
| GitHub Pages 반영 안 됨 | `main` 브랜치에 푸시 안 됨 | `git push origin main` 후 1~2분 대기 |
