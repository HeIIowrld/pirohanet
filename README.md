# 모도 (MODO)

모도는 다음 약속 시간과 오늘의 컨디션에 맞춰 서울 대중교통 경로를 비교하는 웹 앱입니다. 빠른 길과 도보·환승 부담이 적은 길을 비교하고, 시간이 남으면 들를 곳과 머물 수 있는 시간을 확인할 수 있습니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev
```

| 주소 | 용도 |
| --- | --- |
| [http://localhost:5173](http://localhost:5173) | React 앱. Google 로그인과 캘린더 연결 후 지도 홈으로 이동합니다. |
| [http://localhost:5173/?demo=1](http://localhost:5173/?demo=1) | 개발용 시연. 샘플 일정과 경로로 선호 등록부터 길안내까지 확인합니다. |
| [http://localhost:5174/src/main/index.html](http://localhost:5174/src/main/index.html) | 기존 HTML 화면. Google 로그인 후 샘플 일정이나 실제 일정을 불러옵니다. |

Vite는 5173 포트에서 React 앱을 제공하고 `/api`와 `/auth` 요청을 5174 포트의 Node 서버로 전달합니다. 기존 화면과 API만 실행하려면 `npm run dev` 대신 `npm start`를 사용합니다. 이때 기존 화면은 [5173 포트](http://localhost:5173/src/main/index.html)에서 엽니다.

`npm test`는 앱과 서버, 독립 예제의 테스트를 실행합니다. `npm run build`는 `dist/`에 정적 파일을 생성합니다. 빌드 결과만 확인하려면 `npm run preview`, 지도 설정과 API를 포함해 확인하려면 `npm run dev`를 사용합니다.

## 환경 설정

```sh
test -e .env || cp .env.example .env
```

사용할 기능의 키를 저장소 루트의 `.env`에 채웁니다.

| 기능 | 변수 |
| --- | --- |
| 카카오 장소 검색, 현재 위치 주소 확인, 도보 경로 | `kakao-rest-api` |
| 네이버 주소 검색 | `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY` |
| 로컬 네이버 지도 배경 | `NAVER_MAP_CLIENT_ID`. 비워 두면 `X-NCP-APIGW-API-KEY-ID`를 사용합니다. |
| 서울 대중교통 경로 | `SEOUL_TRANSIT_PATH_INFO`. 같은 API 권한이 있는 `DATA_GO_KR_SERVICE_KEY` 또는 `SEOUL_BUSSTATION_INFO`도 사용할 수 있습니다. |
| 서울 버스 도착·혼잡 | `SEOUL_BUSSTATION_INFO` 또는 같은 API 권한이 있는 `DATA_GO_KR_SERVICE_KEY` |
| 경기 버스 도착·잔여 좌석 | `GYEONGGI_BUS_INFO` |
| Node 서버의 계정 API와 OAuth 콜백 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN` |

React 앱의 Google 로그인은 [캘린더 모듈](src/calendar/calendar.js)의 `GOOGLE_CLIENT_ID`를 사용합니다. 자체 클라이언트를 쓸 때는 Google Cloud에서 Calendar API와 Drive API를 켜고 웹 클라이언트의 승인된 JavaScript 원본에 `http://localhost:5173`과 운영 원본을 등록합니다. 5174 포트의 기존 화면에서도 로그인하려면 해당 원본을 추가합니다. OAuth 동의 화면이 테스트 모드면 사용할 계정을 테스트 사용자로 등록합니다.

네이버 클라우드 Maps 앱에서 Web Dynamic Map을 활성화하고 로컬과 운영 호스트를 Web 서비스 URL에 등록합니다. 브라우저에는 지도 Client ID만 전달하고 Client Secret은 서버에 보관합니다. 지도 연결이 끊기면 화면에서 **지도 다시 불러오기**를 선택할 수 있습니다.

## 앱에서 할 수 있는 일

- **일정과 내 장소** — Google Calendar에서 다가오는 일정을 확인합니다. 날짜·시간이 있는 일정은 24시간 이내와 이후로 나눠 표시합니다. 일정에 쓰는 별칭을 **내 장소**에 저장하면 주소를 다시 찾을 때 사용할 수 있고, 저장한 장소는 Google Drive 앱 저장소로 동기화됩니다.
- **경로 비교** — 출발·도착과 시간 조건을 확인하고 5단계 컨디션을 선택합니다. 처음 등록한 이동 선호, 추가 이동 한도, 도착 여유 시간과 피할 지하철 노선도 경로 비교에 반영합니다. 위치 권한을 거절하면 출발지를 직접 검색할 수 있습니다.
- **경유와 이동 안내** — 약속 전 여유 시간에 들를 곳을 찾아 직행과 비교합니다. 선택하면 추가 이동 시간, 체류 가능 시간과 다시 출발할 시각을 확인할 수 있습니다. 이동 중에는 앱에서 도보·탑승·환승 단계를 보거나 지도 앱에서 길안내를 열 수 있습니다.

경로 제공처, 소요 시간 추정, 버스 혼잡과 지하철 빠른 하차 데이터는 [경로와 교통 데이터](docs/ROUTING.md)에 정리했습니다.

## 저장소 구조

| 경로 | 내용 |
| --- | --- |
| [frontend/src/](frontend/src/) | React 앱, 화면 이동, 지도, 선호 등록, 경유와 이동 안내 |
| [frontend/public/](frontend/public/) | 로고, 아이콘, 일러스트, 시연 지도와 Pretendard 폰트 |
| [src/](src/) | 캘린더·장소·경로 비교 공용 모듈과 기존 HTML 화면 |
| [server/](server/) · [dev-server.mjs](dev-server.mjs) | 계정·장소·교통 API와 Node 서버 진입점 |
| [src/calendar/modo/](src/calendar/modo/) | 캘린더 경로 플래너 예제와 개발 서버의 `/api/recommend` 로직 |
| [packages/landmark-route-planner/](packages/landmark-route-planner/) | 독립 실행용 랜드마크 경로 플래너와 React 지도에서 함께 쓰는 지하철 역 순서 모듈 |
| [deploy/](deploy/) · [.github/workflows/](.github/workflows/) | Nginx 라우팅과 yccthon 배포 |
| [docs/](docs/) | [초기 기획안](docs/PRD.md), [Figma 디자인 명세](docs/MODO_DESIGN_SPEC.md), [선호 등록 명세](docs/A04_SPEC_DELTA.md), [경로와 교통 데이터](docs/ROUTING.md) |

두 경로 플래너는 각각 독립 실행할 수 있습니다. 실행한 플래너는 기본적으로 [http://127.0.0.1:3000](http://127.0.0.1:3000)에서 열립니다.

```sh
npm --prefix src/calendar/modo run dev
npm --prefix packages/landmark-route-planner run dev
```

## yccthon 배포

`main`에 푸시하면 [GitHub Actions 워크플로](.github/workflows/deploy-yccthon.yml)가 테스트와 빌드를 실행합니다. Nginx 응답을 확인하며 `/var/www/pirohanet/current`에 정적 파일을 배포합니다. `/`는 `/src/main/`으로 이동하고, 이 주소가 React 앱을 제공합니다.

[Nginx 설정](deploy/yccthon-nginx.conf)은 API와 OAuth 요청을 5173 포트의 Node 서비스로 전달합니다. Node 코드를 변경한 경우 운영 서비스를 같은 버전으로 갱신하고 재시작합니다. 버스 관측 기록을 이어 쓰려면 운영 서비스의 `.data/`를 유지합니다.

운영 지도 설정은 `/var/www/pirohanet/map-config.json`의 `naverClientId`입니다. Nginx가 이 파일을 `/assets/map-config.json`으로 제공합니다.
