# 모도(MODO) 디자인 명세 (개발 전달용)

Figma 파일 `fxC3alx3BNxCgAOH156LaP`, 페이지 "모도 P1 화면"(13:44)을 기준으로 정리했다. 화면 크기는 390x844이다. 화면 아래의 설명 글은 Figma에 남아 있다.

## 0. 먼저 알아둘 것

- 폰트는 Pretendard로 바꾼 뒤 개발한다. 토큰 파일의 `--font-sans`가 이미 Pretendard 우선이다. 텍스트 스타일 11개는 모두 자동 줄바꿈 높이라서 폰트를 바꿔도 레이아웃이 깨지지 않게 확인했다.
- 화면에 보이는 숫자(40분, 18:35 등)는 모두 시연용 예시이며 화면의 `데모 예시` 배지로 표시한다. 실제 값은 `queryRoutes` 결과로 대체한다.
- 지도 영역은 회색 자리표시자(`Map (placeholder, 지도 SDK 영역)`)이다. 지도 SDK가 들어갈 자리이고, 마커와 경로선은 Figma의 마커 컴포넌트와 노선색을 참고해 SDK 오버레이로 구현한다.
- 컨디션은 피로의 정도를 1에서 5까지 고르는 5단계 슬라이더이다. 연속값이 아니라 5개 눈금에만 멈추는 방식(step 1)이다(1은 가장 가벼움, 5는 가장 피곤함). 기존 3단계(괜찮아요, 조금 피곤해요, 많이 피곤해요)에서 바꿨다. 화면 문구는 바뀔 예정이므로 코드에서는 숫자 값(1 to 5)으로 다루고, 제목과 양 끝 문구는 설정 한 곳에서만 정의한다. 선택하지 않은 상태는 `null`이다.

```js
// src/preferences/fatigueScale.js (문구만 바꾸면 되도록 분리)
export const FATIGUE_SCALE = {
  title: '피로의 정도를 알려 주세요.',
  min: 1, max: 5,
  minLabel: '괜찮아요',      // 1 아래 왼쪽 문구
  maxLabel: '많이 피곤해요', // 5 아래 오른쪽 문구
};
```

기존 `createPreferences`가 3단계 값을 받고 있다면 1 to 5를 받도록 맞추거나, 경로 가중치 계산 쪽에서 `(value - 1) / 4`로 0 to 1 값으로 정규화한다.

- 규칙: 테두리(border)를 쓰지 않는다. 선택 상태는 연한 배경색(`--brand-sky-low`)으로 표시한다. 그라데이션은 쓰지 않는다. 예외는 A01 시작 화면이며 직접 수정한 디자인 그대로 구현한다.
- 규칙: 카피에 가운뎃점을 쓰지 않는다. 열거는 쉼표나 슬래시로 쓴다.
- 규칙: 색은 역할이 정해져 있다. 라임은 주요 행동 버튼(Primary)에만 쓴다. 하늘색은 위치 마커와 선택 상태에 쓴다. 지하철 노선색은 경로선과 경로 단계에만 쓴다.

## 1. 토큰

`tokens.css` 참고. 색, 간격, 둥근 정도, 그림자, 타이포를 CSS 변수로 옮겨 두었다.

| 타이포 | 크기 | 굵기 | 줄간격 |
| --- | --- | --- | --- |
| Title 24, 20, 18 | 24, 20, 18 | 700 | 135% |
| Body 16 | 16 | 400, 500, 700 | 150%, 글자 간격 -2% |
| Body 14 | 14 | 400, 500, 700 | 150%, 글자 간격 -2% |
| Caption 12 | 12 | 400, 500 | 140%, 글자 간격 -2% |

레이아웃은 좌우 여백 20, 상단 상태바 47, 하단 홈 인디케이터 34이다. 하단 CTA 영역은 위 12, 아래 54(안전 영역 34 + 20)이고 BottomNav(높이 90, y=754)와 겹치지 않는다. 바텀시트는 화면 하단에 붙고, 하단 내비가 있는 화면에서는 내비 위(y=754)에서 끝난다.

## 2. 컴포넌트

| 컴포넌트 | 노드 | 변형과 속성 | 비고 |
| --- | --- | --- | --- |
| Button | 14:208 | Type: Primary, PrimaryLow, Secondary, Text, Danger. State: Default, Pressed, Disabled, Loading. Size: L(350x52), S(58x44). 텍스트 속성 `label` | 둥근 정도 12. Primary는 라임 파스텔, Disabled는 아주 연한 회색 |
| Button/Google | 14:209 | 없음 | 로고는 "G" 자리표시자이다. 실제 Google 브랜드 가이드 로고로 교체한다 |
| Chip | 15:59 | State: Default, Selected | 선택은 연한 하늘색 배경과 진한 하늘색 글자 |
| SearchField | 15:75 | State: Default, Focus, Query | 지도 위에서는 흰색에 그림자 |
| RouteTabs | 15:90 | Active: Fast, Comfort | 빠른 길, 편한 길 |
| BottomNav | 15:113 | Active: Map, My | 높이 90 |
| SheetHandle | 15:114 | 없음 | 바텀시트 상단 |
| Toast | 15:117 | 메시지, 액션 텍스트 | 오류 알림용 |
| MapMarker | 15:145 | Type: Current, Origin, Destination, WaypointCandidate, Waypoint | 출발과 도착은 칩 모양 |
| TopAppBar | 15:146 | 뒤로 가기 버튼, 가운데 정렬 제목, 오른쪽 여백 | 제목은 한 줄 중앙 |
| ListRow | 15:177 | Trailing: Chevron, Value, Toggle | |
| RouteStep | 16:181 | Type: Walk, Ride, Transfer, Place, Arrive | 노선색 점과 선 |
| PlaceRow | 16:182 | pin-slot(56x56 둥근 사각형, 장소 사진 자리), 이름, 부제, 거리 | 사진은 장소 API 이미지로 교체 |
| EventRow | 16:201 | State: Default, Selected | 시간 열과 제목 열, 선택은 연한 하늘색 |
| NoticeCard | 16:212 | Type: Info, Error | |
| DemoBadge | 16:213 | 없음 | 시연용 수치 표시 |
| IconButton | 16:228 | Icon: locate, user, close, back | 48x48 |
| MapPill | 16:229 | 없음 | "내 장소" 바로가기 |
| FatigueScale | 48:1410 | Value: none, 1, 2, 3, 4, 5 | 눈금 5개에 걸리는 슬라이더. 트랙 높이 12, 눈금 간격 77.5, 지나온 구간은 연한 하늘색(brand/sky) 채움, 흰색 썸(지름 40, 그림자, 가운데 연한 하늘색 점)이 눈금에 딱 맞게 멈춘다. 아래에 숫자 1 to 5, 그 아래에 양 끝 문구. 값이 없으면 썸 없이 트랙만 표시 |
| ConditionRow | 16:248 | State: Default, Selected, Pressed | 이전 3단계용. 지금 화면에서는 쓰지 않는다 |
| RouteCard | 16:282 | State: Default, Selected, Unavailable | 경로 비교 카드 |
| FieldRow | 16:299 | State: Default, Error | 이동 조건 편집 행. Error는 연한 붉은 배경과 아래 안내 문구 |
| StatusBar, HomeIndicator | 14:99, 14:104 | 없음 | 구현에서는 실제 기기 영역이므로 생략 |

## 3. 화면 목록

노드 ID는 Figma 화면(프레임) 기준이다. 상태는 같은 화면의 변형이다.

### A. 시작과 캘린더 연동

| 화면 | 노드 | 핵심 구성과 CTA | 데이터와 전환 |
| --- | --- | --- | --- |
| A01/Welcome | 17:87 | 직접 수정한 시작 화면. "Google 계정으로 계속", "로그인 없이 시작" | 로그인 시 A02, 로그인 없이는 H01/CalendarUnlinked |
| A02/CalendarConnect | 17:105 | 캘린더 일러스트, "캘린더 연결하기" | Google Calendar 읽기 OAuth 후 H01/MapDefault |
| A03/Failed | 17:129 | 회색 캘린더와 경고 아이콘, 재시도 | 연결 실패. 일러스트 `calendar-failed` |
| A03/Expired | 17:149 | 새로고침 아이콘 배지, 다시 연결 | 토큰 만료. 일러스트 `calendar-expired` |

### H. 지도와 이동 흐름

| 화면 | 노드 | 핵심 구성과 CTA | 데이터와 전환 |
| --- | --- | --- | --- |
| H01/MapDefault | 17:170 | 지도, 검색창, 내 장소, 현재 위치 버튼, 일정 시트(다음 일정 1개), "길 찾기" | `calendar.js` 다음 약속. 길 찾기 시 일정 목록 확장 |
| H01/CalendarExpanded | 17:235 | 일정 목록(EventRow), 선택 일정 강조, "길 찾기" | 일정 선택 시 EventSelected. 길 찾기 시 H02/TripConfirm |
| H01/EventSelected | 17:298 | 선택 일정의 목적지 마커 | `locate(text)`로 좌표 확정. 모호하면 H02/DestinationCandidates |
| H01/CalendarUnlinked | 17:369 | "캘린더 연결하기" 안내, 검색창 | 연동 없이 사용할 때 |
| H01/Search | 17:431 | 검색 입력, 결과 목록 | 결과 선택 시 H02/TripConfirmDirect |
| H01/SavedPlaces | 17:491 | 내 장소 시트, "목적지로 설정" | `exportSavedPlaces` |
| H01/NoEvents | 36:830 | 일러스트 `no-events`, "목적지 검색" | 일정이 없을 때 |
| H01/LocationDenied | 36:875 | 일러스트 `location-denied`, 수동 출발지 입력 | 위치 권한 거절 |
| H01/SavedPlaceSelected | 36:915 | 장소 사진 3장, 이름, "목적지로 설정" | 사진은 장소 API 사진 |
| H02/TripConfirm | 21:345 | 출발, 도착, 약속 시간, 출발 시간, 도착 목표 필드, "컨디션 확인" | `prepareTrip`. 기본 도착 목표는 약속 5분 전 |
| H02/TripConfirmDirect | 36:962 | 직접 검색 흐름의 같은 화면. 도착 목표는 선택 입력 | 도착 목표 없이 진행 가능 |
| H02/LocationMissing | 21:406 | 출발 필드 오류, "출발 위치 선택" | 출발지를 확정하지 못했을 때 |
| H02/TimePickerDeparture | 44:1117 | 시간 휠 피커, 하단에 "지금"과 "확인" 두 버튼 | 출발 시각 필드 탭 시. "지금"은 현재 시각으로 설정 |
| H02/TimePickerArrival | 44:1176 | 시간 휠 피커, "확인", "도착 목표 없이 진행" | 약속 시각 이후는 선택 불가 |
| H02/OriginPicker | 44:1690 | 검색, "현재 위치로 설정", 내 장소 목록 | 선택 시 H02/TripConfirm으로 복귀 |
| H02/DestinationCandidates | 44:1750 | 후보 목록(선택 상태 강조), "이 장소로 선택" | `locateCandidates(text)` 결과 |
| H02/TimeError | 45:1227 | 도착 목표 필드 오류와 아래 안내, 컨디션 확인 비활성화 | 도착 목표가 약속 이후일 때 |
| H03/ConditionSuggested | 21:469 | 피로의 정도 1 to 5, 일정 기반 기본값(3) 선택, "경로 보기" | `preferences.js`. 일정은 참고만 하고 사용자가 수정 가능 |
| H03/ConditionUnselected | 21:507 | 선택 없음(경로 보기 비활성화). "건너뛰기" | 건너뛰면 기본 비교로 진행 |
| H03/ConditionChanged | 21:542 | 사용자가 바꾼 상태(4) | 최종 컨디션이 갱신되면 경로를 다시 조회 |
| H04/RouteLoading | 21:580 | 경로 조회 중 | `queryRoutes` 호출 중. 기존 성공 경로는 지우지 않는다 |
| H04/RouteComparison | 21:627 | 빠른 길, 편한 길 카드, "이 경로로 가기" | `compareRoutes` 결과. 도착 목표를 지키는 경로만 선택 가능 |
| H04/NoFeasibleRoute | 21:699 | 일러스트 `no-feasible`, 시각 수정 | 제시간에 도착하는 경로가 없을 때 |
| H04/RouteError | 21:745 | 일러스트 `route-error`, 재시도 | 조회 실패 |
| H04/RouteLate | 36:1015 | 가장 빠른 경로와 예상 지연 | "제시간에 도착" 배지를 붙이지 않는다 |
| H05/RecommendationAvailable | 22:578 | 들를 곳 추천 시트, "장소 보기", "바로 가기" | 경유 검증을 통과한 후보만 표시 |
| H05/NoRecommendation | 22:625 | 추천 없음, 직행 진행 | 여유가 없거나 후보가 없을 때 |
| H06/WaypointPreview | 22:653 | 경유지 지도 미리보기, 이동/체류/도착 시간, "이곳 들르기", "다른 곳 보기", "닫기" | |
| H06/WaypointConfirmed | 22:714 | 경유 확정, "경로 상세 보기" | |
| H07/DirectRouteDetails | 22:762 | 요약(출발, 이동, 도착), 경로 단계, "지도 앱에서 길안내" | 지도 앱 딥링크 |
| H07/WaypointTwoLegs | 22:818 | 경유지까지, 경유지에서 목적지까지 두 구간 | |
| H07/DeepLinkFailed | 36:1069 | 토스트로 딥링크 실패 안내 | |
| H07/DirectRouteDetailsNoTarget | 51:1335 | H07/DirectRouteDetails와 같은 구성에 "지도 앱에서 길안내"(주요)와 "들를 곳 찾기"(보조) 두 버튼 | 도착 목표가 없는 직행 경로일 때만 "들를 곳 찾기" 표시. H04/RouteLate에서 진입 |
| H07/DwellTimeSheet | 45:1291 | 체류 시간 칩(10분, 20분, 30분, 1시간), "들를 곳 찾기", "취소" | H07/DirectRouteDetailsNoTarget의 "들를 곳 찾기"로 열림. 취소 시 그 화면으로 복귀, 찾기 시 H05 |

### M. 마이

| 화면 | 노드 | 핵심 구성 |
| --- | --- | --- |
| M01/My | 22:877 | 내 정보 목록(내 장소, 캘린더 설정), BottomNav |
| M02/SavedPlacesManage | 22:921 | 저장 장소 목록, "장소 추가" |
| M02/SavedPlacesEmpty | 39:1056 | 일러스트 `empty-saved`, 안내 문구 |
| M03/CalendarSettings | 22:966 | 연결 상태, 연결 해제 등 |

## 4. 프로토타입 연결 (Figma에서 확인 가능)

시작 지점은 `P1 시연`(A01)이다.

- 메인 흐름: A01, A02, H01/MapDefault, H01/CalendarExpanded, H02/TripConfirm, H03/ConditionSuggested, H04/RouteLoading, H04/RouteComparison, H05/RecommendationAvailable, H06/WaypointPreview, H06/WaypointConfirmed, H07/WaypointTwoLegs. H05에서 "바로 가기"는 H07/DirectRouteDetails로 이어진다.
- 로그인 없이 시작: A01, H01/CalendarUnlinked, H01/Search, H02/TripConfirmDirect, H03/ConditionUnselected, H04/RouteLoading. H04/RouteLate의 "이 경로로 가기"는 H07/DirectRouteDetailsNoTarget으로 이어지고, 거기서 "들를 곳 찾기"를 누르면 H07/DwellTimeSheet가 열린다.
- H02 파생: H02/TripConfirm의 출발, 도착, 출발 시간, 도착 목표 필드가 각각 OriginPicker, DestinationCandidates, TimePickerDeparture, TimePickerArrival로 이어진다. 확인, "지금", 선택 버튼은 H02/TripConfirm으로 돌아온다.
- 경로 로딩은 1.2초 후 경로 비교로 자동 전환된다(시연용).

## 5. 저장소와 연결할 때의 대응

현재 `HeIIowrld/pirohanet`은 바닐라 JS이며 React 화면은 아직 없다. 모듈별 대응은 다음과 같다.

| 화면 요소 | 기존 코드 |
| --- | --- |
| 일정과 다음 약속 | `src/calendar/calendar.js` |
| 일정 위치를 좌표로 확정, 후보 조회 | `src/calendar/location.js`의 `locate`, `locateCandidates` |
| 내 장소 저장, 조회, 동기화 | `location.js`의 `savePlace`, `exportSavedPlaces`, `myplaces.js`의 `syncMyPlaces`, `pushMyPlaces` |
| 이동 계획 구성 | `src/main/trip.js`의 `prepareTrip`, `planTrip` |
| 컨디션과 선호 | `src/preferences/preferences.js`의 `createPreferences` |
| 경로 후보 비교 | `src/routing/compare.js`의 `compareRoutes` |
| 장소 검색 확정 | `src/map/places.js`의 `resolveTripPlaces` |

React에서는 위 함수를 훅이나 서비스 계층으로 감싸서 쓰고, 화면은 `queryRoutes` 결과 모양(`travelMinutes`, `stayMinutes`, `viaStop`, 경로선, 안내 단계)을 그대로 받아 표시한다.

## 6. 에셋

`assets/illustrations`에 일러스트 8개, `assets/icons`에 아이콘 17개가 있다. 모든 아이콘은 `currentColor`를 써서 CSS 색으로 바꿀 수 있다. 일러스트는 고정 색(하늘 #ADDFF9, 라임 #B5E27E, 검정 #212124, 회색 #DADFE5와 #ADB1BA)이다. 로고(MODO 워드마크)는 `assets/brand/modo-wordmark.svg`에 있다.

## 7. 개발할 때 정할 것

디자인에서 정하지 않았거나 실제 구현에서 결정이 필요한 항목이다. 정해지면 체크한다.

### 외부 연동과 데이터

- [ ] Google 로그인 버튼의 로고를 Google 공식 로고로 교체하고 Calendar 읽기 OAuth 범위를 확정한다. 디자인의 "G"는 자리표시자이다.
- [ ] 지도 SDK를 정한다(PRD는 카카오맵을 기준으로 한다). 마커(출발, 도착, 경유)와 노선색 경로선은 SDK 오버레이로 구현하고, 바텀시트 높이를 고려한 bounds 맞춤이 필요하다.
- [ ] `queryRoutes` 공급자와 응답 모양을 정한다. 경로선과 안내 단계(RouteStep 5종)를 후보에 담아 전달한다.
- [ ] 장소 사진 출처를 정한다(장소 API 사진). 사진이 없을 때의 대체 표시와 로딩 상태가 필요하다. 디자인은 회색 자리표시자만 있다.
- [ ] 혼잡도 데이터가 없을 때 "정보 없음" 표시 방식을 정한다. 혼잡이 낮은 것으로 계산하지 않는다.
- [ ] 지도 앱 딥링크(카카오맵, 네이버 지도) 스킴과 실패 시 H07/DeepLinkFailed 토스트의 재시도 동작을 정한다.
- [ ] 내 장소 저장소를 정한다(`location.js`의 localStorage, `myplaces.js`의 Drive 동기화 사이의 충돌 처리).

### 화면 동작

- [ ] 시연용 숫자와 `데모 예시` 배지를 언제 제거할지 정한다. 실제 데이터가 연결된 화면부터 배지를 뺀다.
- [ ] H04/RouteLoading은 시연용으로 1.2초 뒤 자동 전환한다. 실제로는 응답 기준으로 전환하고, 기존 성공 경로는 로딩 중에 지우지 않는다.
- [ ] 시간 휠 피커 구현 방식을 정한다(CSS scroll-snap 직접 구현 또는 라이브러리). 분 단위(5분), 자정을 넘기는 시간, 약속 이후 시각 선택 불가 규칙이 필요하다.
- [ ] 출발 시각 피커의 "지금" 동작을 정한다(현재 시각 그대로 또는 가장 가까운 5분 단위로 올림).
- [ ] 피로의 정도 슬라이더의 일정 기반 기본값(디자인은 3) 계산 규칙과 기존 `createPreferences` 값(3단계)과의 변환 규칙을 정한다.
- [ ] 체류 시간 시트의 선택지(10분, 20분, 30분, 1시간)와 기본 선택(디자인은 20분)을 확정하고, 선택한 값이 경유 후보 검증에 쓰이도록 연결한다.
- [ ] 도착 목표 없이 진행하는 흐름에서 자동 경유 추천을 하지 않는 규칙을 코드에 반영한다(들를 곳 찾기를 눌렀을 때만 후보 검증).
- [ ] 목적지 후보(H02/DestinationCandidates) 표시 기준을 정한다(`locateCandidates` 결과 수, 최대 개수, 거리 정렬).
- [ ] 위치 권한 거절, 캘린더 토큰 만료, 조회 실패 화면으로 들어가고 나오는 조건(재시도 횟수 등)을 정한다.
- [ ] 마이 화면의 캘린더 설정(M03)에서 연결 해제 시 저장 장소와 일정 캐시를 어떻게 다룰지 정한다.

### 구현 환경

- [ ] 현재 저장소는 바닐라 JS이다. React 도입 방식(Vite 등)과 기존 `src/` 모듈을 그대로 쓸지 훅으로 감쌀지 정한다.
- [ ] 화면 폭은 390 모바일 기준이다. 데스크톱에서 열 때의 표시 방식(모바일 프레임 중앙 배치 등)을 정한다.
- [ ] Pretendard 웹폰트 로딩 방식(Variable, 서브셋)과 라이선스 표기를 정한다. Figma의 텍스트 스타일 폰트는 이미 Pretendard Variable이다.
- [ ] 접근성: 슬라이더는 `aria-valuemin/max/now`와 키보드 조작, 터치 영역 44px 이상, 휠 피커 키보드 조작을 확인한다.
- [ ] 컨디션 문구, 오류 문구, 빈 상태 문구의 최종 카피를 한 파일(예: `copy.js`)에서 관리할지 정한다.
