import { summarize } from '../calendar/calendar.js';
import { resolveTripPlaces } from '../map/places.js';
import { createPreferences } from '../preferences/preferences.js';
import { compareRoutes, isDirect } from '../routing/compare.js';

export function prepareTrip(input, events = [], now = new Date()) {
  const preferences = createPreferences(input.preferences);
  const calendar = summarize(events, now, preferences.fatigueLevel);
  const appointment = calendar.nextAppointment;
  const arrivalBufferMinutes = input.arrivalBufferMinutes ?? 5;

  return {
    calendar,
    origin: input.origin?.trim() ?? '',
    destination: input.destination?.trim() || appointment?.location || '',
    departAt: input.departAt ?? now,
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
