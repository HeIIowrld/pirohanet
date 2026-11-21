import { summarize } from '../calendar/calendar.js';
import { resolveTripPlaces } from '../map/places.js';
import { createPreferences } from '../preferences/preferences.js';
import { compareRoutes, isDirect } from '../routing/compare.js';

function recommendArrival({ title, description = '' }) {
  const instructions = `${title}\n${description.replace(/<[^>]*>/g, ' ')}`;
  const stated = instructions.normalize('NFKC').match(/(?:^|[^\d-])(\d{1,3})\s*분\s*전(?:까지|에)?\s*(?:도착|입장|접수)/);
  if (stated) return { minutes: Number(stated[1]), reason: '캘린더에 적힌 도착 안내를 반영했어요.' };
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
  const arrivalAdvice = appointment ? recommendArrival(appointment) : null;
  const arrivalBufferMinutes = input.arrivalBufferMinutes ?? arrivalAdvice?.minutes;

  return {
    calendar,
    origin: input.origin?.trim() ?? '',
    destination: input.destination?.trim() || appointment?.location || '',
    departAt: input.departAt ?? now,
    arrivalAdvice,
    arriveBy: input.arriveBy ?? (appointment
      ? new Date(Date.parse(appointment.start) - arrivalBufferMinutes * 60_000)
      : null),
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
