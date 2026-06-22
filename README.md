# 부부 가계부 (balance_hj)

부부가 함께 쓰는 모바일 가계부 웹앱. 외부 서버 없이 무료 티어만으로 반영구 운영 — 비용 0원.

> **구조 변천**: 초기에는 GAS가 화면까지 서빙하는 구조였으나, 현재는
> **GitHub Pages(프론트) + Firebase Auth/Firestore(인증·DB)** 구조로 전환되었고
> GAS + Google Sheets는 **백업 전용**으로만 남아 있다. (v9, 2026-06)

---

## 아키텍처

```
[index.html (단일 파일 SPA, GitHub Pages)]
        │
        ├── Firebase Auth ── PIN+"00" 이메일/비밀번호 인증 (hj@/jeong@ledger.com)
        ├── Firestore ────── 'expenses' 컬렉션 (원본 데이터)
        └── GAS 백업 ─────── 신규 기록 시 Google Sheets(RAW_DATA)에 백업
                             + 스마트 동기화 (Firestore ↔ Sheets diff 진단·복구)
```

| 구성 요소 | 내용 |
|---|---|
| 호스팅 | GitHub Pages — **`git push origin main`이 곧 배포** (1~2분) |
| 인증 | Firebase Auth, PIN 4자리 + `"00"` suffix, `browserLocalPersistence` 세션 유지 |
| DB | Firestore `expenses` 컬렉션 |
| 백업 | GAS 웹앱 → Google Sheets `RAW_DATA` 시트 |
| PWA | manifest + service worker + 홈화면 아이콘(₩), safe-area 대응 |
| 저장소 | github.com/bhlee-dev/balance_hj (**public** — 시크릿은 Config.gs로 분리) |

---

## 주요 기능 (v9)

- **지출 기록**: 분류 세그먼트(일상/고정비) + 카테고리 칩 + 사용자(희/정/희정) 선택
- **홈**: 월 총액 카운트업, 생활비 MTD 페이스 라인, 카테고리·사용자별 집계
- **연간 차트**: 막대 탭 → 하이라이트 + 고정 요약 카드
- **스마트 동기화**: 데이터 관리 시트에서 Firestore ↔ Google Sheets diff를 진단하고 한 번에 복구 (추가/수정/삭제 반영)
- **바텀시트 UX**: 모션 + 스와이프 닫기, 다크모드 고정
- **여행경비 연동**: trip_hj 앱에서 여행 총액이 `여행/숙박` 카테고리로 넘어옴 (앱 스위처로 상호 이동)

---

## 데이터 구조

### Firestore `expenses` (원본)
```json
{ "date": "2026-06-10", "item": "마트", "category": "식비", "user": "정",
  "amount": 45000, "memo": "", "createdAt": "..." }
```
- `user`: `'희'`(남편) / `'정'`(아내) / `'희정'`(공동, **고정비 전용**)
- 구버전 레코드에 `'남편'`/`'아내'` 잔존 — 프론트에서 자동 호환 처리
- ⚠️ 구버전(시트 이관) 레코드에 숫자 `rowIndex` 필드 잔존 — 프론트는 항상 `{ ...doc.data(), rowIndex: doc.id }` 순서로 읽어 **doc.id가 레거시 필드를 덮어쓰도록** 해야 함 (반대 순서면 수정/삭제가 엉뚱한 문서를 가리킴)
- `createdAt`은 신규 기록 시에만 부여, 수정 시 보존

### Google Sheets `RAW_DATA` (백업)
| date | item | category | user | amount | memo | created_at | docId |
|---|---|---|---|---|---|---|---|

- H열 `docId` = Firestore 문서 ID — 신규 기록 시 프론트가 `doc()`으로 ID를 먼저 만들어 백업에 포함 (docId 없는 행은 동기화 비교 불가 → 중복 누적 원인)
- 신규 추가, 수정, 삭제 시 모두 실시간으로 자동 백업됨 (스마트 동기화는 수동 복구용)
- 동기화 실행 시 docId 없는 옛 백업 행은 자동 정리되고, 대응 데이터가 docId와 함께 다시 추가됨

---

## 배포

### 프론트엔드
```bash
git push origin main   # GitHub Pages 자동 반영 (1~2분)
```

### GAS 백엔드 (clasp)
```bash
clasp push                              # Code.gs 등 업로드 (.claspignore 적용 확인!)
clasp deploy -i <기존_배포ID> -d "설명"   # 기존 배포 ID 유지 — URL이 바뀌면 안 됨
```
- 배포 ID는 `index.html`의 GAS URL 경로의 `AKfycb...` 문자열
- **수정 전 `clasp pull`로 배포본 확인** — 로컬/배포 불일치 사고 이력 있음
- 새 OAuth 스코프 추가 시 GAS 편집기에서 `authorizeOnce()` 실행 → 권한 승인 (1회)

---

## 보안 모델

- **GAS 요청 검증**: 프론트가 Firebase ID 토큰 전송 → GAS가 `identitytoolkit accounts:lookup`으로 검증, 허용 계정만 통과. 공유 시크릿 없음.
- **Spreadsheet ID 분리**: public repo이므로 ID는 `Config.gs`(gitignored, GAS에만 push)의 `SPREADSHEET_ID_FALLBACK` + Script Properties에만 존재. 코드에 직접 쓰지 말 것.
- **firebaseConfig의 apiKey**: 클라이언트 공개가 Firebase 표준 — Security Rules로 접근 제어
- **.claspignore**: sw.js/manifest/icons가 GAS에 올라가면 백엔드가 깨짐 (실제 사고 이력)

---

## 폰 설치 (PWA)

- **아이폰**: Safari에서 접속 → 공유(□↑) → "홈 화면에 추가"
- **안드로이드**: Chrome 메뉴(⋮) → "홈 화면에 추가"

---

## 형제 앱

| 앱 | 주소 | 역할 |
|---|---|---|
| 가계부 (이 앱) | bhlee-dev.github.io/balance_hj | 일상 지출 |
| 우상향 | snowball-hj.web.app | 자산 관리 |
| 여행경비 | trip-hj.web.app | 여행 환전·지출 |

AI 작업 규칙은 [CLAUDE.md](CLAUDE.md) 참고.
