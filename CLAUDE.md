# 부부 가계부 (balance_hj) — AI 작업 컨텍스트

**구조**: GitHub Pages (프론트엔드, `index.html` 단일 파일) + Firebase Auth (인증) + Firestore (DB).  
외부 서버 없음. 운영 비용 0원.  
Google Apps Script(`Code.gs`) + Google Sheets는 신규 데이터 추가 시 백그라운드 백업 용도로만 잔존.

---

## ⚠️ 절대 건드리지 말 것 (실수 시 앱 즉시 파손)

### Firebase Config 객체 — 클라이언트 노출은 정상
`index.html:664~672`의 `firebaseConfig` 객체(apiKey 포함)는 클라이언트 코드에 공개되어 있으며, 이는 Firebase 표준 방식이다.  
Security Rules로 접근 제어하므로 apiKey 노출 자체는 문제없다.  
config 값 삭제·변경 시 Firebase 연결 자체가 끊김.

### Auth 방식 — PIN + "00" suffix
`submitPin()`(`index.html:1823~`)에서 사용자가 입력한 PIN 뒤에 `"00"`을 붙여 Firebase 이메일/비밀번호 인증(`hj@ledger.com`)을 수행한다.  
이 suffix 로직을 변경하면 기존 세션이 전부 무효화되어 재로그인 불가.  
세션은 `browserLocalPersistence`로 유지 — 탭을 닫아도 로그인 상태 유지.

### Firestore 컬렉션명 `'expenses'`
모든 데이터 쿼리·저장·수정·삭제가 `'expenses'` 컬렉션 기준으로 작동한다.  
컬렉션명 오타·변경 시 데이터 접근 불가.  
문서 필드 구조: `{ date, item, category, user, amount, memo, createdAt, rowIndex }`

### GAS 백업 Content-Type — `text/plain`
`syncToGoogleSheet()`(`index.html:774~`)의 fetch 헤더는 `'Content-Type': 'text/plain'` 유지.  
GAS는 `application/json` POST를 보안상 차단하므로, `application/json`으로 변경하면 백업이 막힘.  
앱 자체(Firestore)는 동작하지만 Google Sheets 백업 데이터가 소실됨.

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
- **카테고리 통합**: 고정비(관리비·가스비 등)는 별도 폼 없이 기록 탭 분류 세그먼트 `고정비` 선택 후 항목 드롭다운으로 입력.
- **항상 다크모드**: 라이트 모드 분기 없음.
- **사용자 식별자**: `'희'`(남편), `'정'`(아내), `'희정'`(공동비 전용, 고정비에만 사용). 구버전 DB 레코드에 `'남편'`/`'아내'` 잔존 — 프론트에서 자동 호환 처리. 신규 코드에 `'남편'`/`'아내'` 하드코딩 금지.

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| PIN 입력해도 로그인 안 됨 | Firebase Auth 비밀번호 불일치 또는 네트워크 오류 | 브라우저 콘솔에서 Firebase Auth 오류 코드 확인 |
| 데이터 불러오지 못했어요 | Firestore 연결 실패 또는 오프라인 캐시 만료 | Firebase Console → Firestore 접속 가능 여부 확인 |
| 수정 후 구글 시트에 반영 안 됨 | `syncToGoogleSheet()`는 신규 추가(addDoc)만 백업, 수정(updateDoc)은 미지원 | 정상 동작임. 시트는 신규 데이터만 백업됨 |
| GitHub Pages 반영 안 됨 | `main` 브랜치에 푸시 안 됨 | `git push origin main` 후 1~2분 대기 |
