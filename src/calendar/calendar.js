// 캘린더 일정 → 다음 약속 + 컨디션 기본값.
// 입력은 Google Calendar events.list의 items 형식이라 실제 응답과 sample.js를 똑같이 넣을 수 있다.

// OAuth 클라이언트 ID는 비밀값이 아니다. 브라우저에 그대로 노출돼도 된다.
export const GOOGLE_CLIENT_ID = '858151438743-d9vem00hl0k18po3mjvimmfaf3mo2614.apps.googleusercontent.com';

export const LABELS =['괜찮아요', '조금 피곤해요', '많이 피곤해요'];

// 임의로 잡은 출발값. 시연 일정을 넣어 보고 여기만 조정한다.
export const TUNING = {
  busyHours: [4, 6], // 이 시간 이상이면 +1, +2
  chainGapMin: 15, // 간격이 이보다 짧으면 연속 일정으로 본다
  chainCount: 3, // 연속 일정이 이 개수 이상이면 +1
  earlyHour: 8, // 오늘 첫 일정이 이 시각 전이면 +1 (늦은 밤과 합쳐 최대 +1)
  lateHour: 22, // 어제 일정이 이 시각 넘어 끝나면 +1
  locatedCount: 3, // 장소가 있는 일정이 이 개수 이상이면 +1
  levelScores: [2, 4], // 이 점수 이상이면 '조금 피곤해요', '많이 피곤해요'
};

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const KST = 9 * HOUR; // ponytail: 날짜 경계를 KST로 고정. 서울 전용이라 충분하고, 다른 시간대를 지원하면 Intl로 바꾼다

const usable = (e) =>
  e.status !== 'cancelled' &&
  e.start?.dateTime && // 종일 일정은 date만 있다
  e.transparency !== 'transparent' && // '한가함'으로 표시한 일정
  !e.attendees?.some((a) => a.self && a.responseStatus === 'declined');

const formatDuration = (ms) => {
  const min = Math.round(ms / 60e3);
  return [min >= 60 && `${Math.floor(min / 60)}시간`, min % 60 && `${min % 60}분`].filter(Boolean).join(' ');
};

export function summarize(items, now = new Date()) {
  const t = +now;
  const dayStart = Math.floor((t + KST) / DAY) * DAY - KST;
  const events = items
    .filter(usable)
    .map((e) => ({
      title: e.summary ?? '',
      location: e.location?.trim() ?? '',
      startText: e.start.dateTime,
      start: Date.parse(e.start.dateTime),
      end: Date.parse(e.end.dateTime),
    }))
    .sort((a, b) => a.start - b.start);

  const next = events.find((e) => e.start > t && e.location);
  return {
    nextAppointment: next ? { title: next.title, start: next.startText, location: next.location } : null,
    suggestedFatigue: fatigue(events, dayStart, t),
  };
}

function fatigue(events, dayStart, t) {
  const today = events.filter((e) => e.start >= dayStar다. 추정하지 않고 사용자에t && e.start < t);
  // 일정이 없다고 안 피곤한 건 아니게 고르게 한다.
  if (!today.length) return null;

  let busy = 0;
  let cursor = 0;
  let chain = 0;
  let maxChain = 0;
  for (const e of today) {
    chain = e.start - cursor < TUNING.chainGapMin * 60e3 ? chain + 1 : 1;
    maxChain = Math.max(maxChain, chain);
    busy += Math.max(0, Math.min(e.end, t) - Math.max(e.start, cursor)); // 겹친 일정은 한 번만 센다
    cursor = Math.max(cursor, e.end);
  }

  const [someHours, manyHours] = TUNING.busyHours;
  const earlyStart = today[0].start < dayStart + TUNING.earlyHour * HOUR;
  const lateNight = events.some((e) => e.start < dayStart && e.end > dayStart - (24 - TUNING.lateHour) * HOUR);
  const located = today.filter((e) => e.location).length;

  const signals = [
    [busy >= manyHours * HOUR ? 2 : busy >= someHours * HOUR ? 1 : 0, `오늘 일정 ${formatDuration(busy)}`, true],
    [maxChain >= TUNING.chainCount, `쉬는 틈 없이 ${maxChain}개 연속`],
    [earlyStart || lateNight, lateNight ? `어제 일정이 ${TUNING.lateHour}시 넘어 끝남` : `오늘 첫 일정이 ${TUNING.earlyHour}시 전`],
    [located >= TUNING.locatedCount, `이동이 낀 일정 ${located}개`],
  ];
  const score = signals.reduce((sum, [points]) => sum + Number(points), 0);
  const level = TUNING.levelScores.filter((min) => score >= min).length;
  return {
    level, // 0, 1, 2 — LABELS의 인덱스
    label: LABELS[level],
    reasons: signals.filter(([points, , always]) => points || always).map(([, reason]) => reason),
  };
}

// 브라우저 전용. 페이지에 <script src="https://accounts.google.com/gsi/client"></script>가 있어야 하고,
// 팝업이 막히지 않도록 버튼 클릭 핸들러 안에서 호출한다. 실패하면 reject하니 호출부에서 sample.js로 대체한다.
export function fetchGoogleEvents(clientId = GOOGLE_CLIENT_ID, now = new Date()) {
  const dayStart = Math.floor((+now + KST) / DAY) * DAY - KST;
  const params = new URLSearchParams({
    timeMin: new Date(dayStart - DAY).toISOString(), // 어제 늦은 일정까지
    timeMax: new Date(dayStart + 7 * DAY).toISOString(), // 오늘과 이후 6일
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  return new Promise((resolve, reject) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        error_callback: (err) => reject(new Error(err.type ?? 'Google 로그인 실패')),
        callback: async (token) => {
          if (token.error) return reject(new Error(token.error));
          try {
            const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
              headers: { Authorization: `Bearer ${token.access_token}` },
            });
            if (!res.ok) throw new Error(`Calendar API ${res.status}`);
            resolve((await res.json()).items ?? []);
          } catch (err) {
            reject(err);
          }
        },
      })
      .requestAccessToken();
  });
}
