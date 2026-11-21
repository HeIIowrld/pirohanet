import { summarize } from '../calendar/calendar.js';
import { resolveTripPlaces } from '../map/places.js';
import { createPreferences } from '../preferences/preferences.js';
import { compareRoutes, isDirect } from '../routing/compare.js';

const minute = 60_000;
const day = 24 * 60 * minute;
const seoulOffset = 9 * 60 * minute;

function statedArrival(instructions, startsAt) {
  const localDay = Math.floor((startsAt + seoulOffset) / day) * day - seoulOffset;
  const relative = /(?:^|[^\d-])(\d{1,3})\s*분\s*전\s*(?:까지|에)?\s*(?:도착|입장|접수)/g;
  const clock = /(?:^|[^\d:])(?:(전날|전일)\s*)?(?:(오전|오후)\s*)?(\d{1,2})(?::([0-5]\d)|\s*시(?:\s*([0-5]?\d)\s*분)?)(?:\s*까지)\s*(?:도착|입장|접수)/g;
  const deadlines = [...instructions.matchAll(relative)].map(([, minutes]) => startsAt - Number(minutes) * minute);
  for (const [, priorDay, period, hour, colonMinutes, koreanMinutes] of instructions.matchAll(clock)) {
    const h = Number(hour);
    if (period ? h < 1 || h > 12 : h > 23) continue;
    const hour24 = period ? h % 12 + (period === '오후' ? 12 : 0) : h;
    const deadline = localDay - (priorDay ? day : 0) + (hour24 * 60 + Number(colonMinutes ?? koreanMinutes ?? 0)) * minute;
    if (deadline <= startsAt) deadlines.push(deadline);
  }
  return deadlines.length ? Math.min(...deadlines) : null;
}

function recommendArrival({ title, description = '' }, startsAt) {
  const instructions = `${title}\n${description.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')}`.normalize('NFKC');
  const deadline = statedArrival(instructions, startsAt);
  if (deadline !== null) {
    return {
      minutes: (startsAt - deadline) / minute,
      reason: '캘린더의 도착 안내를 기준으로 제안했어요.',
    };
  }
  if (/면접|시험|예약|공연|콘서트|\b(interview|exam|reservation|concert)\b/i.test(title)) {
    return { minutes: 15, reason: '입장이나 접수에 걸릴 시간을 고려했어요.' };
  }
  if (/회의|미팅|발표|수업|강의|\b(meeting|presentation|class|lecture)\b/i.test(title)) {
    return { minutes: 10, reason: '시작 전에 자리를 잡고 준비할 시간을 고려했어요.' };
  }
  return { minutes: 5, reason: '일반 약속에는 5분 여유를 제안해요.' };
}

export function prepareTrip(input, events = [], now = new Date()) {
  const preferences = createPreferences(input.preferences);
  const calendar = summarize(events, now, preferences.fatigueLevel);
  const appointment = calendar.nextAppointment;
  const startsAt = appointment ? Date.parse(appointment.start) : null;
  const arrivalAdvice = appointment ? recommendArrival(appointment, startsAt) : null;
  const arrivalBufferMinutes = input.arrivalBufferMinutes ?? arrivalAdvice?.minutes;
  const arriveBy = appointment
    ? new Date(input.arriveBy == null ? startsAt - arrivalBufferMinutes * minute : Math.min(+input.arriveBy, startsAt))
    : input.arriveBy ?? null;

  return {
    calendar,
    origin: input.origin?.trim() ?? '',
    destination: input.destination?.trim() || appointment?.location || '',
    departAt: input.departAt ?? now,
    arrivalAdvice,
    arriveBy,
    preferences: {
      ...preferences,
      fatigueLevel: preferences.fatigueLevel ?? calendar.fatigue?.level ?? null,
    },
  };
}

// resolveStop은 선택한 지점을 별도로 조회한다. 확인하지 못하면 직행을 비교한다.
export async function planTrip(trip, { resolvePlace, resolveStop, queryRoutes }) {
  if (!trip.origin || !trip.destination) {
    throw new Error('출발지와 목적지를 입력해 주세요.');
  }

  const stopQuery = trip.preferences.savedStop?.query;
  const [places, selectedStop] = await Promise.all([
    resolveTripPlaces({
      origin: trip.origin,
      destination: trip.destination,
      stop: resolveStop ? undefined : stopQuery,
    }, resolvePlace),
    stopQuery && resolveStop ? resolveStop() : null,
  ]);
  if (selectedStop) places.stop = selectedStop;
  const candidates = await queryRoutes({ ...trip, places });

  const options = { departAt: trip.departAt, preferences: trip.preferences, places };
  const unfiltered = compareRoutes(candidates, options)
    .sort((a, b) => a.arrivalAt - b.arrivalAt);
  return {
    places,
    fastestDirect: unfiltered.find(isDirect),
    fastestVia: unfiltered.find((route) => route.viaStop),
    routes: compareRoutes(candidates, {
      ...options,
      arriveBy: trip.arriveBy,
      maxExtraTravelMinutes: trip.preferences.maxExtraTravelMinutes,
    }),
  };
}
