# 모도

## React 프론트엔드

```sh
npm ci
npm run dev
```

[React 화면](http://localhost:5173)을 연다. Vite는 5173, 기존 API 서버는 5174 포트에서 함께 실행된다. Google OAuth 리디렉션 URI는 `http://localhost:5173/auth/google/callback`을 등록한다. `npm run build`는 `dist/`를 생성하며, 배포 시 정적 파일과 `/api`, `/auth` 서버를 같은 출처에 연결해야 한다. `npm run preview`는 정적 빌드 확인용이며 API 서버를 포함하지 않는다.

`frontend/`는 전달된 디자인 토큰과 SVG를 사용하는 React 구현이다. 장소 검색은 기존 검색 모듈과 카카오 대체 검색, 캘린더와 계정 저장은 기존 서버 API, 이동 계획은 `prepareTrip`, 비교는 `compareRoutes`에 연결한다. 5단계 컨디션은 서비스 계층에서 1–5와 정규화 값으로 관리하며 기존 캘린더 모듈의 0–2 인터페이스는 유지한다. 실제 경로는 저장소의 ORS 도보 공급자를 사용한다.

개발 중인 화면은 `http://localhost:5173/?demo=1`에서 확인한다. 이 주소의 Google/캘린더 버튼은 명시적인 시연 흐름이며 실제 계정에 연결하지 않는다. 일반 주소에서는 Google 로그인과 캘린더 연결이 필수다. 실제 경로에는 `.env`의 `ORS_API_KEY`, 장소 검색에는 카카오 또는 네이버 키가 필요하다. 로그인은 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`이 필요하다. 설정되지 않은 서비스를 샘플 데이터로 자동 대체하지 않는다.

현재 범위: 시작, 일정 선택, 장소 후보 확정, 내 장소 저장과 삭제, 이동 시간 입력(KST), 5단계 컨디션, 도보 경로 비교, 경유 체류 시간 검증, 지도 앱 두 구간 길안내. 지도 SDK 렌더링과 장소 사진, 대중교통 및 혼잡도 API, 디자인 명세 전체의 세부 변형은 후속 작업이다. 지도 영역은 준비 중 표시를 사용한다. 시작 화면은 명세의 카피와 제공 에셋을 사용한 구현으로, Figma의 직접 편집된 A01과 픽셀 단위 대조는 아직 하지 않았다.

검증: `npm test`, `npm run build`. 원래 바닐라 화면은 `npm start`로 실행한다.

## 기존 화면

Node.js 22.13 이상에서 저장소 루트의 `npm ci`와 `npm start`를 차례로 실행한 뒤
[홈페이지](http://localhost:5173/src/main/index.html)를 열면 샘플 일정의 목적지와 도착 목표를 확인할 수 있다.
주소 검색은 개발 서버가 `.env`에 설정된 키로 처리한다.

| 경로 | 담당 |
| --- | --- |
| `src/main/` | 홈페이지와 이동 계획 조립. `trip.js`가 일정, 장소, 선호, 길찾기를 연결한다. |
| `src/calendar/` | Google Calendar 조회와 다음 약속, 피로도 요약 |
| `src/map/` | 장소 검색 결과를 확정 좌표로 변환. 지도 SDK 렌더링도 이 폴더에서 작업한다. |
| `src/preferences/` | 피로도, 이동 우선순위, 추가 이동 한도, 저장 경유지 입력 |
| `src/routing/` | 경로 후보 비교. 경로 API와 혼잡도·실시간 도착 연동도 이 폴더에서 작업한다. |

## Google 계정과 저장 장소

1. Google Cloud 프로젝트에서 Google Calendar API를 활성화하고 웹 애플리케이션 OAuth 클라이언트를 설정한다. 승인된 리디렉션 URI에 `http://localhost:5173/auth/google/callback`을 추가한다. 동의 화면이 테스트 모드면 로그인할 계정을 테스트 사용자로 등록한다.
2. 서버의 `.env` 또는 환경 변수에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 설정한다. 배포 시 `APP_ORIGIN`을 실제 HTTPS 주소로 설정하고 해당 주소의 `/auth/google/callback`도 Google Cloud에 등록한다.
3. 메인 화면에서 Google 로그인 후 **Google 일정 불러오기**를 누른다. 같은 Google 계정으로 캘린더 읽기를 허용한다.
4. 일정 카드의 후보 주소를 확인하면 일정의 장소 이름으로 자동 저장된다. 주소가 다르거나 검색 결과가 없으면 목적지에 실제 주소를 입력하고 이동 계획에서 장소를 확인한 뒤, 일정 카드에 표시된 주소를 선택한다. 이후 같은 이름의 일정이 나오면 저장 주소와 좌표를 사용한다. 상단의 **내 장소**에서 주소를 변경하거나 별칭을 삭제할 수 있다.

**내 장소**의 **현재 위치 사용**을 누르고 브라우저에서 위치를 허용하면 주소 후보가 표시된다. 후보를 선택하면 해당 장소의 주소와 좌표가 갱신된다. 이 기능은 HTTPS 또는 localhost에서 동작하며, 서버의 `.env`에 `kakao-rest-api` 키가 필요하다. 배포 환경에서는 `/api/reverse-geocode`를 애플리케이션 서버로 연결한다.

사용자 식별자, 30일 세션, 저장 장소는 `.data/personalization.sqlite`에 저장한다. 배포할 때는 이 디렉터리에 영속 디스크를 연결한다. Calendar 액세스 토큰은 현재 세션의 서버 메모리에만 있으며, 만료되거나 서버가 재시작되면 일정을 다시 연결한다.

## 모듈 연결

- `prepareTrip(input, events, now)`는 일정 또는 직접 입력으로 이동 계획을 구성한다. 시간 입력은 `Date`를 사용한다. 기본 도착 목표는 약속 5분 전이다.
- `planTrip(trip, { resolvePlace, queryRoutes })`는 공급자 함수를 받는다. `resolvePlace`를 생략하면 기본 위치 검색을 사용한다. 기본 검색은 장소의 `{ name, address, latitude, longitude }`를 반환한다. 저장 경유지가 있다면 `preferences.savedStop`의 `{ query, stayMinutes }`로 전달한다.
- `queryRoutes({ origin, destination, places, departAt, arriveBy, preferences, calendar })`는 후보 배열을 반환한다. 각 후보에는 `travelMinutes`, `stayMinutes`, `viaStop`이 필요하다. 경유 후보를 보낼 때는 비교 기준인 직행 후보도 함께 보낸다. 경로선과 안내 단계는 후보에 추가해 그대로 화면에 전달할 수 있다.
- 현재 경로 비교는 체류 시간을 포함해 도착 목표를 확인하고, 가장 빠른 직행 대비 추가 이동 시간을 검사한다. 지도·경로 API, 지도 렌더링, 피로도와 우선순위를 반영한 추천은 각 모듈의 후속 작업이다.


### 첫 이용 선호 등록

Google 로그인 → 캘린더 연결 → 선호 안내 → 평소 편한 길(빠른 길 이외에는 추가 이동 5/10/20분 선택) → 약속 전 여유 시간 → 계단 선호 → 지도 순서다. 캘린더를 나중에 연결하거나 로그인 없이 이용하는 버튼은 제공하지 않는다. 완료/건너뛰기 기록은 브라우저에 저장하며, 재방문에서도 캘린더 연결 상태는 별도로 확인한다. 시연 기록과 실제 이용 기록은 분리한다.

질문은 `frontend/src/onboarding-questions.json`, 저장과 값 검증은 `onboarding.js`가 관리한다. 도착 목표에는 여유 시간을 반영하며, 경로 선택은 실제 데이터가 있는 도보/환승/계단/혼잡도 지표만 비교한다. 현재 도보 공급자에서 계단과 혼잡도 정보가 오지 않으면 해당 지표를 임의로 추정하지 않는다. 계정 간/기기 간 선호 동기화와 출발 10분 전 배너는 아직 구현하지 않았다.
