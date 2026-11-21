# A04 선호 등록 변경분 (Figma 페이지 "모도 P1 화면", y=7000 줄)

| A04/RoutePreferenceIntro | 55:1408 | 선호 질문 앞 안내 화면. 제목 "평소 편한 길을 알려 주세요", 설명 3줄(자주 쓰는 기준을 알면 약속 시간에 맞는 길을 먼저 보여 드려요 / 나중에 언제든 바꿀 수 있어요), "다음", "건너뛰기" | `onboarding-questions.json`의 `intro`. 일러스트는 `assets/illustrations/route-preference.svg` |
| A04/ArrivalBuffer | 57:1418 | "약속보다 얼마나 일찍 도착할까요?" 정각에 도착 / 5분 일찍 / 10분 일찍(기본) / 15분 일찍, "다음", "건너뛰기" | `arrivalBufferMinutes`. 약속 시각에서 이 시간을 빼서 도착 목표 시각을 만든다 |
| A04/Stairs | 57:1472 | "계단은 어떻게 할까요?" 상관없어요(기본) / 계단 적은 길 우선, "시작하기", "건너뛰기" | `avoidStairs`. 경로 후보 순위에서 계단이 많은 길을 뒤로 민다 |
| H01/DepartureAlert | 57:1592 | 출발 10분 전에 지도 화면 위에 내려오는 배너 (시계 아이콘, "10분 뒤에 출발해요", 약속 시각과 장소, "길 보기") | 설정 없이 모두 출발 10분 전 고정. 앱이 열려 있을 때 표시. "길 보기"는 H05/H07 경로 상세로 이어진다 |
| A04/RoutePreference | 54:1336 | "평소 어떤 길이 편해요?" 선택지 4개(빠른 길, 덜 걷는 길, 환승 적은 길, 덜 붐비는 길), 선택 전에는 "이대로 시작" 비활성화, "건너뛰기" | `onboarding-questions.json`의 `routePreference`. 캘린더 연결(A02) 다음, 지도(H01) 앞에 한 번 표시 |
| A04/RoutePreferenceFastest | 54:1379 | 빠른 길 선택 상태. 추가 질문 없음, "이대로 시작" 활성화 | `fastest`를 고르면 두 번째 질문을 건너뛴다 |
| A04/RoutePreferenceExtraTime | 54:1425 | 덜 걷는 길, 환승 적은 길, 덜 붐비는 길 중 하나를 고르면 "그런 길이라면 몇 분 더 걸려도 괜찮아요?" 칩(5분, 10분, 20분)이 같은 화면 아래에 나타남 | `maxExtraTravelMinutes`. 기존 `compareRoutes`의 추가 이동 한도와 같은 이름 |
- 처음 시작: A01, A02, A04/RoutePreferenceIntro, A04/RoutePreference, (선택에 따라 A04/RoutePreferenceFastest 또는 A04/RoutePreferenceExtraTime), A04/ArrivalBuffer, A04/Stairs, H01/MapDefault. "건너뛰기"는 어느 상태에서나 H01/MapDefault로 이어진다.
- [ ] 처음 선호 질문(A04)은 `onboarding-questions.json`을 그대로 읽어 렌더링한다. 답은 `createPreferences`의 우선순위(덜 걷기, 환승 줄이기, 혼잡 피하기)와 추가 이동 한도(`maxExtraTravelMinutes`)로 연결한다. 건너뛰면 기본값(빠른 길, 한도 없음)으로 둔다.
- [ ] 화면 전환: 안내(Intro)에서 질문으로 갈 때와 질문 단계 사이는 오른쪽에서 밀려 들어오는 push 전환(0.3초, ease-out). 캘린더 연결(A02)에서 Intro로 갈 때도 같다. "건너뛰기"는 H01/MapDefault로 이어진다.
- [ ] 출발 알림: 출발 10분 전 고정, 앱 안 배너로만 표시한다. 앱이 닫혀 있을 때(푸시)는 이번 범위에 넣지 않았다. 도착 여유 시간(arrivalBufferMinutes)이 있으면 출발 시각은 그만큼 앞당겨 계산한다.
- [ ] A04를 로그인 없이 시작하는 흐름에도 보여줄지 정한다. 디자인 연결은 캘린더 연결 흐름에만 있다.
- [ ] A04는 한 번만 표시하고, 나중에 바꾸는 위치(마이 화면의 새 항목)를 정한다. M01 디자인에는 아직 이동 선호 항목이 없다.
- [ ] A04의 평소 선호(오래 가는 기본값)와 H03의 피로의 정도(오늘의 상태)가 경로 순위에서 어떻게 합쳐지는지 정한다.
