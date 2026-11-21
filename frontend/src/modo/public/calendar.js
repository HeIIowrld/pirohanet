const hour = 3_600_000;
const day = 24 * hour;
const minute = 60_000;
const kst = 9 * hour;
const dayStart = time => Math.floor((time + kst) / day) * day - kst;
const clientId = '858151438743-d9vem00hl0k18po3mjvimmfaf3mo2614.apps.googleusercontent.com';
const scope = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';

export const FATIGUE_LABELS = { relaxed: '괜찮아요', normal: '조금 피곤해요', tired: '많이 피곤해요' };
const fatigueLevels = Object.keys(FATIGUE_LABELS);

export function summarize(items, now = Date.now(), { currentFatigue, arriveBy } = {}) {
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
  const userLevel = fatigueLevels.indexOf(currentFatigue);
  let projectedFatigue = describe(byThen);
  if (userLevel >= 0) {
    const elapsed = targetDay === startOfDay ? soFar : null;
    const extraLoad = Math.max(0, (byThen?.level ?? 0) - (elapsed?.level ?? 0));
    const level = Math.min(fatigueLevels.length - 1, userLevel + extraLoad);
    const reasons = [`지금 컨디션 ‘${FATIGUE_LABELS[currentFatigue]}’`];
    if (extraLoad) reasons.push(`약속 전 남은 일정 ${formatDuration(byThen.busy - (elapsed?.busy ?? 0))}`);
    projectedFatigue = describe({ level, reasons });
  }
  return { next, origin, needsConfirmation: Boolean(origin && origin !== previous), departAt, fatigue: describe(soFar), projectedFatigue };
}

function describe(load) {
  return load && { value: fatigueLevels[load.level], reasons: load.reasons };
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
  const level = score >= 4 ? 2 : Number(score >= 2);
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
