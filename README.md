# 모도

저장소 루트에서 `node dev-server.mjs`를 실행한 뒤
[홈페이지](http://localhost:5173/src/main/index.html)를 열면 샘플 일정의 목적지와 도착 목표를 확인할 수 있다.
주소 검색은 개발 서버가 `.env`에 설정된 키로 처리한다.

| 경로 | 담당 |
| --- | --- |
| `src/main/` | 홈페이지와 이동 계획 조립. `trip.js`가 일정, 장소, 선호, 길찾기를 연결한다. |
| `src/calendar/` | Google Calendar 조회와 다음 약속, 피로도 요약 |
| `src/map/` | 장소 검색 결과를 확정 좌표로 변환. 지도 SDK 렌더링도 이 폴더에서 작업한다. |
| `src/preferences/` | 피로도, 이동 우선순위, 추가 이동 한도, 저장 경유지 입력 |
| `src/routing/` | 경로 후보 비교. 경로 API와 혼잡도·실시간 도착 연동도 이 폴더에서 작업한다. |

## 모듈 연결

- `prepareTrip(input, events, now)`는 일정 또는 직접 입력으로 이동 계획을 구성한다. 시간 입력은 `Date`를 사용한다. 기본 도착 목표는 약속 5분 전이다.
- `planTrip(trip, { resolvePlace, queryRoutes })`는 공급자 함수를 받는다. `resolvePlace`를 생략하면 기본 위치 검색을 사용한다. 기본 검색은 장소의 `{ name, address, latitude, longitude }`를 반환한다. 저장 경유지가 있다면 `preferences.savedStop`의 `{ query, stayMinutes }`로 전달한다.
- `queryRoutes({ origin, destination, places, departAt, arriveBy, preferences, calendar })`는 후보 배열을 반환한다. 각 후보에는 `travelMinutes`, `stayMinutes`, `viaStop`이 필요하다. 경유 후보를 보낼 때는 비교 기준인 직행 후보도 함께 보낸다. 경로선과 안내 단계는 후보에 추가해 그대로 화면에 전달할 수 있다.
- 현재 경로 비교는 체류 시간을 포함해 도착 목표를 확인하고, 가장 빠른 직행 대비 추가 이동 시간을 검사한다. 지도·경로 API, 지도 렌더링, 피로도와 우선순위를 반영한 추천은 각 모듈의 후속 작업이다.
