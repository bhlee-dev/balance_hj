# 부부 가계부

Google Apps Script + Google Sheets 기반 모바일 가계부 웹앱.
외부 서버, 별도 비용 없이 Google 계정 하나로 반영구 운영 가능.

---

## 1단계 — Google Sheets 준비

1. [Google Drive](https://drive.google.com) 접속
2. **새로 만들기 > Google 스프레드시트** 클릭
3. 하단 시트 탭 `Sheet1` 더블클릭 → `RAW_DATA` 입력 후 Enter
4. A1부터 순서대로 헤더 입력:
   ```
   date | item | category | user | amount | memo | created_at
   ```
5. 하단 `+` 버튼으로 새 시트 추가 → 이름: `FIXED_EXPENSES`
6. FIXED_EXPENSES A1부터 헤더 입력:
   ```
   year | month | management_fee | gas | water | tax_label | tax_amount | updated_at
   ```
7. 브라우저 주소창에서 스프레드시트 ID 복사
   - URL 형식: `https://docs.google.com/spreadsheets/d/【여기가 ID】/edit`

---

## 2단계 — Apps Script 열기

1. 스프레드시트 상단 메뉴: **확장 프로그램 > Apps Script** 클릭
2. 새 창(스크립트 편집기)이 열림
3. 주소창 URL에서 스크립트 ID 복사
   - URL 형식: `https://script.google.com/home/projects/【여기가 scriptId】/edit`

---

## 3단계 — 코드 붙여넣기

### Code.gs
1. 좌측 파일 목록에서 `코드.gs` 클릭
2. 전체 선택(Ctrl+A) 후 삭제
3. 이 프로젝트의 `Code.gs` 내용 전체 붙여넣기
4. **저장** (Ctrl+S)

### index.html
1. 좌측 `+` 버튼 > **HTML** 선택 > 파일명 `index` 입력 (`.html` 자동 추가)
2. `index.html` 내용 전체 붙여넣기
3. **저장**

---

## 4단계 — 보안 설정 (SPREADSHEET_ID 분리 저장) ⚠️ 필수

> SPREADSHEET_ID를 코드에 직접 쓰지 않고 Google의 안전한 저장소(PropertiesService)에 보관합니다.
> 이렇게 하면 GitHub에 코드를 올려도 스프레드시트 ID가 노출되지 않습니다.

1. `Code.gs`에서 `setupSpreadsheetId` 함수를 찾습니다:
   ```javascript
   function setupSpreadsheetId() {
     PropertiesService.getScriptProperties()
       .setProperty('SPREADSHEET_ID', 'YOUR_SPREADSHEET_ID_HERE');
   }
   ```
2. `'YOUR_SPREADSHEET_ID_HERE'` 부분을 1단계에서 복사한 **실제 스프레드시트 ID**로 교체
3. 편집기 상단의 함수 선택 드롭다운에서 `setupSpreadsheetId` 선택
4. ▶ 실행 버튼 클릭 → 권한 허용 → 하단 로그에 `SPREADSHEET_ID 저장 완료` 확인
5. **중요**: 실행 후 코드의 ID 값을 다시 `'YOUR_SPREADSHEET_ID_HERE'`로 되돌리고 저장
   - 이후 GitHub에 올려도 ID가 노출되지 않음

---

## 5단계 — 웹앱 배포

1. 우측 상단 **배포** 버튼 클릭
2. **새 배포** 선택
3. 톱니바퀴 아이콘 클릭 > 유형: **웹 앱** 선택
4. 설명: `가계부 v1`
5. **다음 사용자로 실행**: 나 (본인 계정)
6. **액세스 권한**: 모든 사용자
7. **배포** 클릭
8. 권한 요청 팝업 → **권한 검토** → 본인 계정 선택 → **고급** → **안전하지 않은 페이지로 이동** → **허용**
9. 표시된 **웹앱 URL** 복사 (이것이 가계부 주소)

---

## 6단계 — clasp 로컬 개발 환경 설정 (선택, 폰 디버깅 권장)

> clasp를 사용하면 로컬에서 코드를 수정하고 바로 폰으로 테스트할 수 있습니다.

### 설치
```bash
# Node.js가 없다면 https://nodejs.org 에서 설치 후 진행
npm install -g @google/clasp
clasp login   # 브라우저에서 Google 계정 인증
```

### 프로젝트 연결
1. `.clasp.json` 파일을 열어 `scriptId` 값을 2단계에서 복사한 실제 scriptId로 교체:
   ```json
   {
     "scriptId": "실제_스크립트_ID_입력",
     "rootDir": "."
   }
   ```
2. 코드 업로드:
   ```bash
   cd D:\app_hj\balance_hj
   clasp push
   ```

### 개발용 배포 URL 만들기 (폰 즉시 테스트용)
```bash
clasp deploy --description "개발용"
# 출력된 deploymentId 메모
```
- 이 URL은 `clasp push` 즉시 최신 코드가 반영됨 → **폰에서 바로 확인 가능**
- 운영 배포(아내와 공유하는 URL)는 별도로 5단계의 버전 고정 URL 사용

### 코드 수정 후 반영 순서
```bash
# 1. 코드 수정 (VSCode 등)
# 2. GAS에 업로드
clasp push
# 3. 개발 URL로 폰 테스트
# 4. 문제 없으면 운영 배포 업데이트
clasp deploy --deploymentId 운영_배포_ID --description "가계부 v2"
# 5. GitHub에 백업
git add . && git commit -m "기능 추가: ..." && git push
```

---

## 7단계 — GitHub private 저장소 설정

> 코드를 GitHub에 백업하여 기기 분실·포맷 시에도 복구 가능합니다.

```bash
cd D:\app_hj\balance_hj
git init
git add .
git commit -m "초기 커밋: 부부 가계부 웹앱"
```

1. [github.com](https://github.com) 접속 → **New repository**
2. Repository name: `balance_hj` (또는 원하는 이름)
3. **Private** 선택 (중요: 가계부 데이터 구조 비공개)
4. **Create repository** 클릭
5. 안내에 따라 remote 추가 후 push:
   ```bash
   git remote add origin https://github.com/본인계정/balance_hj.git
   git branch -M main
   git push -u origin main
   ```

---

## 8단계 — 스마트폰 홈화면에 추가

### 아이폰 (Safari 필수)
1. Safari에서 웹앱 URL 열기
2. 하단 공유 버튼 (□↑) 탭
3. "홈 화면에 추가" 탭
4. 이름 `가계부` 확인 후 **추가**

### 안드로이드 (Chrome)
1. Chrome에서 URL 열기
2. 우측 상단 메뉴(⋮) 탭
3. "홈 화면에 추가" 탭

---

## 9단계 — 아내와 공유

- 5단계의 **운영 배포 URL**을 카카오톡 1:1 채팅으로 전송
- 아내도 8단계와 동일하게 홈화면에 추가
- 두 사람이 같은 Google Sheets에 실시간으로 기록됨

---

## 코드 수정 후 운영 업데이트

1. 스크립트 편집기에서 코드 수정 후 저장
2. **배포 > 배포 관리**
3. 연필(수정) 아이콘 클릭
4. 버전: **새 버전** 선택
5. **배포** 클릭
6. 기존 URL 그대로 사용 가능 (URL 변경 없음)

---

## 보안 체크리스트

- [ ] `setupSpreadsheetId()` 실행 후 코드의 ID를 `'YOUR_SPREADSHEET_ID_HERE'`로 되돌렸는지 확인
- [ ] SPREADSHEET_ID가 GitHub에 올라가지 않았는지 확인 (`git log` 또는 GitHub 웹에서 Code.gs 확인)
- [ ] GitHub repository가 **Private**으로 설정됐는지 확인
- [ ] 웹앱 URL을 SNS, 블로그 등 공개 장소에 게시하지 않기
- [ ] URL은 카카오톡 1:1 채팅 등 비공개 채널로만 공유

---

## 데이터 구조 참고

### RAW_DATA (일상 지출)
| A: date | B: item | C: category | D: user | E: amount | F: memo | G: created_at |
|---|---|---|---|---|---|---|
| 2025-01-15 | 마트 | 식비 | 아내 | 45000 | | 2025-01-15T... |

### FIXED_EXPENSES (월 고정 지출)
| A: year | B: month | C: management_fee | D: gas | E: water | F: tax_label | G: tax_amount | H: updated_at |
|---|---|---|---|---|---|---|---|
| 2025 | 1 | 293840 | 188710 | 0 | 자동차세 | 174660 | 2025-01-01T... |
