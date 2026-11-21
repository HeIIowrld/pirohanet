# 모도(MODO) 디자인 명세 (개발 전달용)

Figma 파일 `fxC3alx3BNxCgAOH156LaP`, 페이지 "모도 P1 화면"(13:44)을 기준으로 정리했다. 화면 크기는 390x844이다. 화면 목록과 프로토타입 연결은 Figma 기준이다. React 앱의 현재 동작과 코드 위치는 [구현 대응표](#5-현재-구현과-코드-위치)와 [README](../README.md)를 참고한다. 첫 이용 선호 등록은 [A04 명세](A04_SPEC_DELTA.md)에 정리했다.

## 0. 먼저 알아둘 것

- React 앱은 자체 호스팅 Pretendard Variable을 사용한다. `--font-sans`는 [토큰 파일](../frontend/src/tokens.css)에서 관리한다.
- Figma에 표시된 시간과 경로는 시연값이다. React의 개발용 `?demo=1`에서도 샘플 경로에 `데모 예시` 배지를 표시한다. 일반 화면은 [경로 조회](../frontend/src/services.js)의 결과를 사용한다.
- Figma의 지도 자리에는 운영 화면에서 네이버 지도가 들어간다. 지도 위에 출발·도착·경유·현재 위치 마커와 노선색 경로선을 표시한다. 개발용 시연은 Figma 경로 에셋을 사용한다.
- 컨디션 슬라이더는 1에서 5까지의 정수와 미선택 상태를 받는다. 화면 문구는 [copy.js](../frontend/src/copy.js)에서 관리하고, 일정 기반 기본값과 최종 피로도는 [캘린더 모듈](../src/calendar/calendar.js)에서 계산한다.

- 규칙: 테두리(border)를 쓰지 않는다. 선택 상태는 연한 배경색(`--brand-sky-low`)으로 표시한다. 그라데이션은 쓰지 않는다. 예외는 A01 시작 화면이며 직접 수정한 디자인 그대로 구현한다.
- 규칙: 카피에 가운뎃점을 쓰지 않는다. 열거는 쉼표나 슬래시로 쓴다.
- 규칙: 색은 역할이 정해져 있다. 라임은 주요 행동 버튼(Primary)에만 쓴다. 하늘색은 위치 마커와 선택 상태에 쓴다. 지하철 노선색은 경로선과 경로 단계에만 쓴다.

## 1. 토큰

[tokens.css](../frontend/src/tokens.css) 참고. 색, 간격, 둥근 정도, 그림자, 타이포를 CSS 변수로 옮겨 두었다.

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

## 5. 현재 구현과 코드 위치

Google 로그인으로 캘린더를 불러온 뒤 처음 이용할 때는 A04 질문을 거쳐 지도 홈으로 가고, 완료한 브라우저에서는 홈으로 바로 간다. 도착 목표의 기본값은 약속 시각에서 도착 여유 시간을 뺀 값이며, 기본 여유 시간은 10분이다. 경로 안내를 시작하면 지도에서 이동 단계를 따라갈 수 있다.

| 화면 요소 | 코드 |
| --- | --- |
| 지도 홈, 캘린더와 이동 흐름 | [App.jsx](../frontend/src/App.jsx), [HomeEvents.jsx](../frontend/src/HomeEvents.jsx), [screen-history.js](../frontend/src/screen-history.js) |
| Google 로그인과 캘린더 | [GoogleSignInButton.jsx](../frontend/src/GoogleSignInButton.jsx), [calendar.js](../src/calendar/calendar.js), [login-session.js](../src/main/login-session.js) |
| 목적지 후보, 내 장소와 Drive 동기화 | [location.js](../src/calendar/location.js), [places.js](../src/map/places.js) |
| 피로도, 이동 선호 등록, 시각 선택 | [copy.js](../frontend/src/copy.js), [Onboarding.jsx](../frontend/src/Onboarding.jsx), [TimeWheel.jsx](../frontend/src/TimeWheel.jsx) |
| 경로 조회와 비교 | [services.js](../frontend/src/services.js), [transit.js](../src/routing/transit.js), [compare.js](../src/routing/compare.js) |
| 경유 후보와 남은 체류 시간 | [gap-places.js](../frontend/src/gap-places.js), [gap-timing.js](../frontend/src/gap-timing.js), [GapStops.jsx](../frontend/src/GapStops.jsx) |
| 네이버 지도, 경로 상세와 이동 안내 | [LiveMap.jsx](../frontend/src/LiveMap.jsx), [route-geometry.js](../frontend/src/route-geometry.js), [RouteFlow.jsx](../frontend/src/RouteFlow.jsx), [Journey.jsx](../frontend/src/Journey.jsx) |

## 6. 에셋

[frontend/public](../frontend/public/)에 브랜드 워드마크, 아이콘, 일러스트, 개발용 시연 경로, Pretendard Variable 폰트를 둔다. 공통 아이콘과 일러스트는 [design.jsx](../frontend/src/design.jsx)의 `Icon`과 `Art`로 표시한다. [폰트 라이선스](../frontend/public/fonts/OFL.txt)

## 7. 디자인에서 확인할 항목

- 장소 사진 공급자와 사진이 없을 때 사용할 표시
- 이동 선호를 나중에 다시 편집할 위치
- 슬라이더와 시각 휠의 키보드 탐색 및 터치 영역
