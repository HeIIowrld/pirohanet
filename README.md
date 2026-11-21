# 모도

Node.js 22.13 이상에서 저장소 루트의 `npm ci`와 `npm start`를 차례로 실행한 뒤
[홈페이지](http://localhost:5173/src/main/index.html)를 열면 샘플 일정의 목적지와 도착 목표를 확인할 수 있다.
주소 검색은 개발 서버가 `.env`에 설정된 키로 처리한다.

| 경로 | 담당 |
| --- | --- |
| `src/main/` | 홈페이지와 이동 계획 조립. `trip.js`가 일정, 장소, 선호, 길찾기를 연결한다. |
| `src/calendar/` | Google Calendar 조회와 다음 약속, 피로도 요약 |
| `src/map/` | 장소 검색 결과를 확정 좌표로 변환. 지도 SDK 렌더링도 이 폴더에서 작업한다. |
| `src/places/` | 서울 추천 경유지 데이터와 지도 검색 지점 확인 |
| `src/preferences/` | 피로도, 이동 우선순위, 추가 이동 한도, 저장 경유지 입력 |
| `src/routing/` | 대중교통 후보 조회, 지하철 혼잡도 추정, 이동 조건 비교 |

## Google 계정과 내 장소

홈페이지와 내 장소 페이지는 서버를 거치지 않고 브라우저에서 바로 Google에 연결한다. 길찾기와 실시간 버스 정보는 앱 서버를 통해 조회한다.

1. Google Cloud 프로젝트에서 Google Calendar API와 Google Drive API를 활성화하고 웹 애플리케이션 OAuth 클라이언트를 만든다. 승인된 JavaScript 원본에 `http://localhost:5173`과 배포 주소를 추가한다. 동의 화면이 테스트 모드면 로그인할 계정을 테스트 사용자로 등록한다. 클라이언트 ID는 `src/calendar/calendar.js`의 `GOOGLE_CLIENT_ID`에 있다. 비밀 키는 쓰지 않는다.
2. 로그인 화면에서 **Google로 로그인**을 누르고 캘린더 읽기와 앱 데이터 저장을 허용한다. 세션은 같은 브라우저 탭에서 만료 또는 로그아웃까지 유지된다. 홈으로 돌아오면 **Google 일정 불러오기**를 눌러 일정을 확인한다.
3. 일정의 장소가 `1공`처럼 사용자만 아는 이름이면, 목적지에 실제 장소(`제1공학관`)를 입력해 확인한 뒤 일정 카드에 표시된 주소를 선택한다. 그러면 `1공 → 그 장소`로 기억하고, 다음에 `1공`이 나오면 검색하지 않고 기억한 주소와 좌표를 그대로 쓴다. `회사`, `집`, `학교`처럼 흔한 이름은 처음부터 검색하지 않고 주소를 묻는다.
4. 상단의 **내 장소**에서 검색으로 장소를 추가하고, 기억한 장소의 주소를 바꾸거나 지울 수 있다. **현재 위치 사용**은 HTTPS 또는 localhost에서 동작하고, 서버의 `/api/reverse-geocode`(`.env`의 `kakao-rest-api` 키)가 필요하다.

내 장소는 이 브라우저의 저장소에 먼저 기억하고, Google에 연결돼 있으면 사용자 본인 Google Drive의 앱 전용 숨김 폴더에도 저장한다. 다른 기기에서 연결하면 그대로 이어 쓴다. 관련 함수는 `src/calendar/location.js`에 있다(`savedPlace`, `savePlace`, `locateCandidates`, `syncMyPlaces`, `pushMyPlaces`).

`server/personalization.mjs`의 서버 로그인과 SQLite 저장 장소(`/auth/*`, `/api/account`, `/api/calendar`, `/api/saved-places`)는 저장소에 남아 있지만 화면에서는 더 이상 쓰지 않는다.

## 추천 경유지

**이동 계획 → 들를 장소**에서 로그인 없이 지역별 추천 후보를 고를 수 있다. 후보를 선택하면 장소 설명, 권장 체류 시간과 방문 안내가 표시되고 체류 시간은 조정할 수 있다. **경로 찾기**를 누르면 선택한 지점의 지도 위치와 실제 경로를 조회해 도착 목표와 추가 이동 한도를 적용한다. 운영 일정과 예약 조건은 장소 안내에서 확인한다.

후보와 출처는 [추천 경유지 데이터](src/places/recommended-stops.json)에서 관리한다. 각 항목의 `route_target`은 지도 검색 결과에서 확인할 지점 이름이다. 같은 이름의 지점이 여러 개면 `route_address`로 구분한다. 주소 조회를 지정한 항목은 건물 주소를 확인한다.

## 모듈 연결

- `prepareTrip(input, events, now)`는 일정 또는 직접 입력으로 이동 계획을 구성한다. 시간 입력은 `Date`를 사용한다. 기본 도착 목표는 약속 5분 전이다.
- `planTrip(trip, { resolvePlace, queryRoutes })`는 공급자 함수를 받는다. `resolvePlace`를 생략하면 기본 위치 검색을 사용한다. 기본 검색은 장소의 `{ name, address, latitude, longitude }`를 반환한다. 저장 경유지가 있다면 `preferences.savedStop`의 `{ query, stayMinutes }`로 전달한다.
- `queryRoutes({ origin, destination, places, departAt, arriveBy, preferences, calendar })`는 후보 배열을 반환한다. 각 후보에는 `travelMinutes`, `stayMinutes`, `viaStop`이 필요하다. 경유 후보를 보낼 때는 비교 기준인 직행 후보도 함께 보낸다. 경로선과 안내 단계는 후보에 추가해 그대로 화면에 전달할 수 있다.
- 메인 화면은 수동 출발 시각과 도착 목표를 지원하며, 가장 빠른 직행 대비 추가 이동 한도의 기본값은 20분이다. 컨디션과 이동 우선순위로 도보·환승·예상 혼잡에 가중치를 적용한다. 저장 장소를 선택하면 두 구간의 이동 시간과 체류 시간으로 예상 도착을 계산한다.
- 대중교통과 도보 조회는 `kakao-rest-api` 키를 사용하는 `GET /api/transit`과 `GET /api/walk`가 필요하다. 저장 장소를 거치는 구간의 직선거리가 800m 이내이면 카카오 도보 경로도 확인하고, 도보 경로 길이가 800m 이내일 때 대중교통 후보와 함께 비교한다.
- `src/routing/seoul-crowding.json`은 [서울교통공사 혼잡도 정보](https://data.seoul.go.kr/dataList/OA-12928/S/1/datasetView.do)의 2026-09-30 엑셀을 변환한 스냅샷이다. `days`는 평일·토요일·일요일 순서이고, 각 역·방향 배열은 05:30부터 30분 간격이다. 빈 칸과 0은 정보 없음으로 처리했다. 탑승 시각은 카카오의 경로 총 시간과 단계 시간으로 추정한다.
- 한 정거장 먼저 타는 후보는 원래 탑승역에서 역방향으로 한 정거장 이동한 뒤 같은 노선의 원래 경로를 이어 타는 두 구간을 확인한다. 재탑승 지점의 혼잡도가 10%p 이상 낮을 때 비교하며, 승강장 이동에 3분을 추가하고 요금은 두 구간의 합계로 표시한다. 열차 시간표, 실시간 혼잡 및 좌석 정보는 연결되어 있지 않다.

## yccthon 배포

GitHub 워크플로는 `/var/www/pirohanet/current`에 정적 파일을 배포한다. 운영 Node 서비스를 먼저 같은 버전의 코드로 갱신하고 5173 포트에서 재시작한다. [Nginx 설정](/deploy/yccthon-nginx.conf)은 정적 파일과 Node의 API·OAuth 경로를 연결한다. 워크플로는 새 정적 파일을 활성화하기 전에 `/api/account` 응답과 두 경로 API의 좌표 검증을 확인한다. Google 로그인을 쓰는 공개 HTTPS 주소는 Node의 `APP_ORIGIN` 및 OAuth 리디렉션 URI에 등록한다.

## 서울 버스 도착·혼잡

`SEOUL_BUSSTATION_INFO`에 서울 버스 정류소 정보 서비스 키를 설정한다. 기존 `DATA_GO_KR_SERVICE_KEY`도 같은 서비스 권한이 있으면 사용할 수 있다. 경로 카드의 **이동 단계**에 서울시 정류장·노선·진행 방향을 확인한 버스의 도착 예정 시각과 차내 혼잡을 표시한다. 탑승 예상 시각이 조회 시각의 5분 전부터 30분 후까지이고, 3분 이내의 차량 보고가 있는 경우 실시간 정보를 제공한다. 버스 도착을 조회해도 목적지 도착 추정에는 카카오 경로 시간을 사용한다. [서울시 정류장 정보](https://data.seoul.go.kr/dataList/OA-15331/L/1/datasetView.do) · [서울시 버스 혼잡 안내](https://news.seoul.go.kr/traffic/archives/512733)

정류장 도착이 3분 이내인 차량의 혼잡을 노선·정류장·서울 시간 30분 구간별로 `.data/bus-crowding.sqlite`에 저장한다. 평일·토요일·일요일을 각각 집계하고, 최근 8주에서 오늘을 제외한 관측일이 3일 이상인 구간만 중앙값과 관측일 수를 표시한다. 경로 카드에서 버스 정보를 조회할 때 관측이 쌓인다. 운영 배포에서는 `.data`를 유지한다.
