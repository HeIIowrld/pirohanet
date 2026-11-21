// 캘린더 일정 → 다음 약속 + 지금 컨디션 기본값 + 경로 추천에 넘길 최종 피로도.
// 입력은 Google Calendar events.list의 items 형식이라 실제 응답과 sample.js를 똑같이 넣을 수 있다.

// OAuth 클라이언트 ID는 비밀값이 아니다. 브라우저에 그대로 노출돼도 된다.
export const GOOGLE_CLIENT_ID = '858151438743-d9vem00hl0k18po3mjvimmfaf3mo2614.apps.googleusercontent.com';

export const LABELS = ['괜찮아요', '조금 피곤해요', '피곤해요', '많이 피곤해요', '녹초예요']; // 1~5점, 인덱스 = 점수 - 1

// 임의로 잡은 출발값. 시연 일정을 넣어 보고 여기만 조정한다.
export const TUNING = {
  busyHours: [4, 6], // 이 시간 이상이면 +1, +2
  chainGapMin: 15, // 간격이 이보다 짧으면 연속 일정으로 본다
  chainCount: 3, // 연속 일정이 이 개수 이상이면 +1
  earlyHour: 8, // 그날 첫 일정이 이 시각 전이면 +1 (늦은 밤과 합쳐 최대 +1)
  lateHour: 22, // 전날 일정이 이 시각 넘어 끝나면 +1
  locatedCount: 3, // 장소가 있는 일정이 이 개수 이상이면 +1
  levelScores: [2, 3, 4, 5], // 일정 점수가 이 값 이상이면 2점, 3점, 4점, 5점 (미만이면 1점)
};

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const KST = 9 * HOUR; // ponytail: 날짜 경계를 KST로 고정. 서울 전용이라 충분하고, 다른 시간대를 지원하면 Intl로 바꾼다

const kstDayStart = (t) => Math.floor((t + KST) / DAY) * DAY - KST;

const usable = (e) =>
  e.status !== 'cancelled' &&
  e.start?.dateTime && // 종일 일정은 date만 있다
  e.transparency !== 'transparent' && // '한가함'으로 표시한 일정
  !e.attendees?.some((a) => a.self && a.responseStatus === 'declined');

const formatDuration = (ms) => {
  const min = Math.round(ms / 60e3);
  return [min >= 60 && `${Math.floor(min / 60)}시간`, min % 60 && `${min % 60}분`].filter(Boolean).join(' ');
};

// userLevel: 사용자가 고른 지금 컨디션(1~5점, 높을수록 피곤). 고르지 않았으면 null.
// 반환값
//   nextAppointment  지금 이후 장소가 있는 가장 빠른 일정. 없으면 null.
//   suggestedFatigue 오늘 지금까지의 일정으로 추정한 지금 컨디션. 선택 화면의 기본값으로 쓴다. 근거가 없으면 null.
//   fatigue          경로 추천에 넘기는 최종값. 사용자 입력도 일정도 없으면 null.
export function summarize(items, now = new Date(), userLevel = null) {
  if (userLevel !== null && !(Number.isInteger(userLevel) && userLevel >= 1 && userLevel <= LABELS.length)) throw new RangeError('userLevel은 1~5의 정수 또는 null이어야 합니다');
  const t = +now;
  const events = items
    .filter(usable)
    .map((e) => ({
      title: e.summary ?? '',
      description: e.description ?? '',
      location: e.location?.trim() ?? '',
      startText: e.start.dateTime,
      start: Date.parse(e.start.dateTime),
      end: Date.parse(e.end.dateTime),
    }))
    .sort((a, b) => a.start - b.start);

  const next = events.find((e) => e.start > t && e.location);
  const until = next ? next.start : t;
  const soFar = load(events, kstDayStart(t), t, '오늘'); // 오늘 지금까지
  const byThen = load(events, kstDayStart(until), until, next ? '약속 전' : '오늘'); // 약속 당일, 약속 시각까지
  const sameDay = kstDayStart(until) === kstDayStart(t);
  return {
    nextAppointment: next ? {
      title: next.title,
      start: next.startText,
      location: next.location,
      ...(next.description && { description: next.description }),
    } : null,
    suggestedFatigue: soFar && describe(soFar.level, soFar.reasons),
    fatigue: userLevel === null ? byThen && describe(byThen.level, byThen.reasons) : combine(userLevel, byThen, sameDay ? soFar : null),
  };
}

const describe = (level, reasons) => ({ level, label: LABELS[level - 1], reasons }); // level은 1~5점

// 사용자가 말한 지금 컨디션은 지금까지의 일정을 이미 반영한다고 보고,
// 달력으로는 지금부터 약속까지 남은 일정이 올리는 만큼만 더한다.
// 사용자가 기본값(suggestedFatigue)을 그대로 고르면 달력만으로 계산한 값과 같아진다.
// ponytail: 약속이 다른 날이면 오늘 컨디션에 그날 일정 부담을 그대로 더한다. 하루 지나면 회복한다고 볼 근거가 생기면 여기서 줄인다
function combine(userLevel, byThen, soFar) {
  const bump = Math.max(0, (byThen?.level ?? 1) - (soFar?.level ?? 1));
  const reasons = [`지금 컨디션 ${userLevel}점 '${LABELS[userLevel - 1]}'`];
  if (bump) reasons.push(`약속 전 남은 일정 ${formatDuration(byThen.busy - (soFar?.busy ?? 0))}`);
  return describe(Math.min(LABELS.length, userLevel + bump), reasons);
}

// dayStart부터 until까지 시작한 일정의 부담. 해당 일정이 없으면 null.
function load(events, dayStart, until, prefix) {
  const today = events.filter((e) => e.start >= dayStart && e.start < until);
  // 일정이 없다고 안 피곤한 건 아니다. 추정하지 않고 사용자에게 고르게 한다.
  if (!today.length) return null;

  let busy = 0;
  let cursor = 0;
  let chain = 0;
  let maxChain = 0;
  for (const e of today) {
    chain = e.start - cursor < TUNING.chainGapMin * 60e3 ? chain + 1 : 1;
    maxChain = Math.max(maxChain, chain);
    busy += Math.max(0, Math.min(e.end, until) - Math.max(e.start, cursor)); // 겹친 일정은 한 번만 센다
    cursor = Math.max(cursor, e.end);
  }

  const [someHours, manyHours] = TUNING.busyHours;
  const earlyStart = today[0].start < dayStart + TUNING.earlyHour * HOUR;
  const lateNight = events.some((e) => e.start < dayStart && e.end > dayStart - (24 - TUNING.lateHour) * HOUR);
  const located = today.filter((e) => e.location).length;

  const signals = [
    [busy >= manyHours * HOUR ? 2 : busy >= someHours * HOUR ? 1 : 0, `${prefix} 일정 ${formatDuration(busy)}`, true],
    [maxChain >= TUNING.chainCount, `쉬는 틈 없이 ${maxChain}개 연속`],
    [earlyStart || lateNight, lateNight ? `전날 일정이 ${TUNING.lateHour}시 넘어 끝남` : `첫 일정이 ${TUNING.earlyHour}시 전`],
    [located >= TUNING.locatedCount, `이동이 낀 일정 ${located}개`],
  ];
  const score = signals.reduce((sum, [points]) => sum + Number(points), 0);
  return {
    level: 1 + TUNING.levelScores.filter((min) => score >= min).length,
    busy,
    reasons: signals.filter(([points, , always]) => points || always).map(([, reason]) => reason),
  };
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly', // 일정 읽기
  'https://www.googleapis.com/auth/drive.appdata', // 내 장소를 사용자 계정의 앱 전용 숨김 폴더에 저장 (location.js의 syncMyPlaces)
].join(' ');

// 브라우저 전용. Google 로그인 창을 띄워 액세스 토큰을 받는다. 토큰은 1시간 동안 유효하다.
// 페이지에 <script src="https://accounts.google.com/gsi/client"></script>가 있어야 하고,
// 팝업이 막히지 않도록 버튼 클릭 핸들러 안에서 호출한다. 실패하면 reject한다.
export function requestGoogleAuthorization(clientId = GOOGLE_CLIENT_ID) {
  return new Promise((resolve, reject) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPES,
        prompt: '', // Let Google request sign-in or consent when needed.
        error_callback: (err) => reject(new Error(err.type ?? 'Google 로그인 실패')),
        callback: (token) => (token.error ? reject(new Error(token.error)) : resolve(token)),
      })
      .requestAccessToken();
  });
}

export async function requestGoogleToken(clientId = GOOGLE_CLIENT_ID) {
  return (await requestGoogleAuthorization(clientId)).access_token;
}

export function calendarEventParams(now = new Date()) {
  const dayStart = kstDayStart(+now);
  return new URLSearchParams({
    timeMin: new Date(dayStart - DAY).toISOString(), // 어제 늦은 일정까지
    timeMax: new Date(dayStart + 7 * DAY).toISOString(), // 오늘과 이후 6일
    singleEvents: 'true',
    orderBy: 'startTime',
  });
}

// requestGoogleToken으로 받은 토큰으로 어제부터 이후 6일까지의 일정을 읽는다. 실패하면 호출부에서 sample.js로 대체한다.
export async function fetchGoogleEvents(token, now = new Date()) {
  const params = calendarEventParams(now);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Calendar API ${res.status}`);
  return (await res.json()).items ?? [];
}
