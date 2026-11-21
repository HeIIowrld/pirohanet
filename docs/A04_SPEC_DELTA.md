# A04 첫 이용 선호 등록

Figma의 "모도 P1 화면"을 기준으로 선호 등록 프레임과 현재 구현을 기록한다.

| 화면 | 노드 | 질문과 저장값 |
| --- | --- | --- |
| A04/RoutePreferenceIntro | 55:1408 | "평소 편한 길을 알려 주세요" 안내와 "다음", "건너뛰기". |
| A04/RoutePreference | 54:1336 | 빠른 길, 덜 걷는 길, 환승 적은 길, 덜 붐비는 길 중 하나를 선택한다. 선택하면 "다음"이 활성화된다. |
| A04/RoutePreferenceFastest | 54:1379 | 빠른 길을 고르면 추가 이동 시간 질문을 생략한다. |
| A04/RoutePreferenceExtraTime | 54:1425 | 빠른 길 외의 선택에는 5분, 10분, 20분 중 추가 이동 한도(`maxExtraTravelMinutes`)를 고를 수 있다. |
| A04/ArrivalBuffer | 57:1418 | 정각, 5분, 10분, 15분 중 도착 여유 시간(`arrivalBufferMinutes`)을 선택한다. 기본값은 10분이다. |
| A04/Stairs | 57:1472 | 기본값인 "상관없어요"와 "계단 적은 길 우선" 중 선택한다(`avoidStairs`). |

Google 로그인 후 캘린더를 불러오면 안내 → 경로 선호 → 도착 여유 시간 → 계단 선호 → 지도 순서로 진행한다. 어느 단계에서든 건너뛰면 빠른 길, 추가 이동 한도 없음, 도착 여유 10분, 계단 상관없음으로 저장하고 지도를 연다.

문구와 선택지는 [onboarding-questions.json](../frontend/src/onboarding-questions.json)에 있다. [Onboarding.jsx](../frontend/src/Onboarding.jsx)가 질문을 표시하고, [onboarding.js](../frontend/src/onboarding.js)가 완료 여부와 선호를 브라우저에 저장한다. 시연 기록은 별도의 키를 사용한다.

출발 알림의 Figma 프레임(H01/DepartureAlert, 57:1592)은 출발 10분 전 안내를 그렸다. 현재 앱은 설정한 도착 목표에서 경로 소요 시간을 뺀 권장 출발 시각에 알림을 표시한다. 앱이 열려 있고 일정으로 가는 직행 경로를 조회했을 때 확인할 수 있다. [출발 알림 계산](../src/main/departure-reminder.js)

다른 화면의 Figma 노드와 구현 위치는 [디자인 명세](MODO_DESIGN_SPEC.md)에 정리했다.
