const hour = 3_600_000;
const day = 24 * hour;
const minute = 60_000;
const kst = 9 * hour;
const dayStart = time => Math.floor((time + kst) / day) * day - kst;
const clientId = '858151438743-d9vem00hl0k18po3mjvimmfaf3mo2614.apps.googleusercontent.com';
const scope = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';

// Fatigue is an integer score from 1 to 5 and a higher score means more tired. Read a label with FATIGUE_LABELS[score].
export const FATIGUE_LABELS = { 1: '괜찮아요', 2: '조금 피곤해요', 3: '피곤해요', 4: '많이 피곤해요', 5: '녹초예요' };
// Each value the schedule score reaches raises the level by one: score 0-1 -> 1, 2 -> 2, 3 -> 3, 4 -> 4, 5 -> 5.
const levelScores = [2, 3, 4, 5];
const maxFatigue = levelScores.length + 1;

export function summarize(items, now = Date.now(), { currentFatigue, arriveBy } = {}) {
  // currentFatigue is the score the user chose: an integer from 1 to 5, or undefined/null when nothing is chosen.
  // Every other value (0, '', '3', 2.5, 6) is rejected, not ignored: Number('') is 0, so a caller that
  // forgot to turn an empty choice into null must fail loudly and never count as a real score.
  if (currentFatigue != null && !(Number.isInteger(currentFatigue) && currentFatigue >= 1 && currentFatigue <= maxFatigue)) {
    throw new RangeError('currentFatigue는 1~5의 정수여야 합니다.');
  }
  const time = Number(now);
  const startOfDay = dayStart(time);
  const events = items.flatMap(event => {
    if (event.status === 'cancelled' || event.transparency === 'transparent' ||
        ['workingLocation', 'outOfOffice', 'focusTime'].includes(event.eventType) ||
        event.attendees?.some(person => person.self && person.responseStatus === 'declined')) return [];
    const start = Date.parse(event.start?.dateTime);
    const end = Date.parse(event.end?.dateTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ title: event.summary?.trim() || '제목 없는 일정', location: event.location?.trim() || '', start, end }];
  }).sort((a, b) => a.start - b.start);

  const next = events.find(event => event.start > time) ?? null;
  const boundary = next?.start ?? time;
  const preceding = events.filter(event => event.start <= time && event.end > startOfDay)
    .sort((a, b) => b.end - a.end);
  const previous = preceding[0] ?? null;
  const origin = preceding.find(event => event.location && event.end <= boundary) ?? null;
  const departAt = Math.max(time, previous?.end ?? time);
  const until = Math.max(time, arriveBy ?? next?.start ?? time);
  const targetDay = dayStart(until);
  const soFar = load(events, startOfDay, time, '오늘');
  const byThen = until === time ? soFar : load(events, targetDay, until, '약속 전');
  let projectedFatigue = describe(byThen);
  if (currentFatigue != null) {
    const elapsed = targetDay === startOfDay ? soFar : null;
    // No schedule counts as level 1, so a morning with nothing behind it adds only what the schedule adds above 1.
    const extraLoad = Math.max(0, (byThen?.level ?? 1) - (elapsed?.level ?? 1));
    const level = Math.min(maxFatigue, currentFatigue + extraLoad);
    const reasons = [`지금 컨디션 ${currentFatigue}점 ‘${FATIGUE_LABELS[currentFatigue]}’`];
    if (extraLoad) reasons.push(`약속 전 남은 일정 ${formatDuration(byThen.busy - (elapsed?.busy ?? 0))}`);
    projectedFatigue = describe({ level, reasons });
  }
  return { next, origin, needsConfirmation: Boolean(origin && origin !== previous), departAt, fatigue: describe(soFar), projectedFatigue };
}

function describe(load) {
  return load && { value: load.level, reasons: load.reasons };
}

function formatDuration(ms) {
  const minutes = Math.round(ms / minute);
  return [minutes >= 60 && `${Math.floor(minutes / 60)}시간`, minutes % 60 && `${minutes % 60}분`].filter(Boolean).join(' ') || '0분';
}

function load(events, startOfDay, time, label) {
  const today = events.filter(event => event.end > startOfDay && event.start < time);
  if (!today.length) return null;
  let busy = 0;
  let cursor = startOfDay;
  let maxChain = 0;
  let chain = 0;
  for (const event of today) {
    const start = Math.max(event.start, startOfDay);
    chain = chain && start - cursor < 15 * minute ? chain + 1 : 1;
    maxChain = Math.max(maxChain, chain);
    busy += Math.max(0, Math.min(event.end, time) - Math.max(start, cursor));
    cursor = Math.max(cursor, event.end);
  }
  const early = today[0].start < startOfDay + 8 * hour;
  const late = events.some(event => event.start < startOfDay && event.end > startOfDay - 2 * hour);
  const located = today.filter(event => event.location).length;
  const score = (busy >= 6 * hour ? 2 : Number(busy >= 4 * hour)) +
    Number(maxChain >= 3) + Number(early || late) + Number(located >= 3);
  const level = 1 + levelScores.filter(min => score >= min).length;
  return {
    level, busy,
    reasons: [
      `${label} 일정 ${formatDuration(busy)}`,
      maxChain >= 3 && `15분 미만 간격으로 ${maxChain}개 연속`,
      (early || late) && (late ? '전날 일정이 22시 넘어 끝남' : '첫 일정이 8시 전'),
      located >= 3 && `장소가 있는 일정 ${located}개`
    ].filter(Boolean)
  };
}

export function requestCalendarToken() {
  return new Promise((resolve, reject) => {
    const oauth = globalThis.google?.accounts?.oauth2;
    if (!oauth) return reject(new Error('Google 연결을 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.'));
    const failure = () => reject(new Error('Google 캘린더 연결을 완료하지 못했어요. 팝업과 권한 설정을 확인해 주세요.'));
    oauth.initTokenClient({
      client_id: clientId,
      scope,
      include_granted_scopes: false,
      error_callback: failure,
      callback(response) {
        if (!response.access_token || !oauth.hasGrantedAllScopes(response, scope)) return failure();
        resolve({ accessToken: response.access_token, expiresAt: Date.now() + Number(response.expires_in) * 1000 });
      }
    }).requestAccessToken();
  });
}

export async function fetchCalendarEvents(token, now = Date.now()) {
  const start = dayStart(now);
  const params = new URLSearchParams({
    timeMin: new Date(start - day).toISOString(),
    timeMax: new Date(start + 7 * day).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', timeZone: 'Asia/Seoul',
    fields: 'nextPageToken,items(summary,location,start,end,status,transparency,eventType,attendees(self,responseStatus))'
  });
  const events = [];
  const signal = AbortSignal.timeout(15_000);
  do {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error('Google에서 일정을 가져오지 못했어요. Calendar API와 테스트 계정 설정을 확인해 주세요.');
    const page = await response.json();
    events.push(...(page.items ?? []));
    if (!page.nextPageToken) return events;
    params.set('pageToken', page.nextPageToken);
  } while (true);
}
