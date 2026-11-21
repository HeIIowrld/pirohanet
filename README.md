# 모도

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

## Google 계정과 내 장소

홈페이지와 내 장소 페이지는 서버를 거치지 않고 브라우저에서 바로 Google에 연결한다. 정적 호스팅에서도 동작한다.

1. Google Cloud 프로젝트에서 Google Calendar API와 Google Drive API를 활성화하고 웹 애플리케이션 OAuth 클라이언트를 만든다. 승인된 JavaScript 원본에 `http://localhost:5173`과 배포 주소를 추가한다. 동의 화면이 테스트 모드면 로그인할 계정을 테스트 사용자로 등록한다. 클라이언트 ID는 `src/calendar/calendar.js`의 `GOOGLE_CLIENT_ID`에 있다. 비밀 키는 쓰지 않는다.
2. 메인 화면에서 **Google 일정 불러오기**를 누르고 캘린더 읽기와 앱 데이터 저장을 허용한다. 토큰은 메모리에만 두므로 페이지를 새로 열면 다시 누른다.
3. 일정의 장소가 `1공`처럼 사용자만 아는 이름이면, 목적지에 실제 장소(`제1공학관`)를 입력해 확인한 뒤 일정 카드에 표시된 주소를 선택한다. 그러면 `1공 → 그 장소`로 기억하고, 다음에 `1공`이 나오면 검색하지 않고 기억한 주소와 좌표를 그대로 쓴다. `회사`, `집`, `학교`처럼 흔한 이름은 처음부터 검색하지 않고 주소를 묻는다.
4. 상단의 **내 장소**에서 기억한 장소의 주소를 바꾸거나 지울 수 있다. **현재 위치 사용**은 HTTPS 또는 localhost에서 동작하고, 서버의 `/api/reverse-geocode`(`.env`의 `kakao-rest-api` 키)가 필요하다.

내 장소는 이 브라우저의 저장소에 먼저 기억하고, Google에 연결돼 있으면 사용자 본인 Google Drive의 앱 전용 숨김 폴더에도 저장한다. 다른 기기에서 연결하면 그대로 이어 쓴다. 관련 함수는 `src/calendar/location.js`에 있다(`savedPlace`, `savePlace`, `locateCandidates`, `syncMyPlaces`, `pushMyPlaces`).

`server/personalization.mjs`의 서버 로그인과 SQLite 저장 장소(`/auth/*`, `/api/account`, `/api/calendar`, `/api/saved-places`)는 저장소에 남아 있지만 화면에서는 더 이상 쓰지 않는다.

## 모듈 연결

- `prepareTrip(input, events, now)`는 일정 또는 직접 입력으로 이동 계획을 구성한다. 시간 입력은 `Date`를 사용한다. 기본 도착 목표는 약속 5분 전이다.
- `planTrip(trip, { resolvePlace, queryRoutes })`는 공급자 함수를 받는다. `resolvePlace`를 생략하면 기본 위치 검색을 사용한다. 기본 검색은 장소의 `{ name, address, latitude, longitude }`를 반환한다. 저장 경유지가 있다면 `preferences.savedStop`의 `{ query, stayMinutes }`로 전달한다.
- `queryRoutes({ origin, destination, places, departAt, arriveBy, preferences, calendar })`는 후보 배열을 반환한다. 각 후보에는 `travelMinutes`, `stayMinutes`, `viaStop`이 필요하다. 경유 후보를 보낼 때는 비교 기준인 직행 후보도 함께 보낸다. 경로선과 안내 단계는 후보에 추가해 그대로 화면에 전달할 수 있다.
- 현재 경로 비교는 체류 시간을 포함해 도착 목표를 확인하고, 가장 빠른 직행 대비 추가 이동 시간을 검사한다. 지도·경로 API, 지도 렌더링, 피로도와 우선순위를 반영한 추천은 각 모듈의 후속 작업이다.
