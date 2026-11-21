import { summarize } from '../calendar/calendar.js';
import { resolveTripPlaces } from '../map/places.js';
import { createPreferences } from '../preferences/preferences.js';
import { compareRoutes } from '../routing/compare.js';

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
      fatigueLevel: calendar.fatigue?.level ?? null,
    },
  };
}

export async function planTrip(trip, { resolvePlace, queryRoutes }) {
  if (!trip.origin || !trip.destination) {
    throw new Error('출발지와 목적지를 입력해 주세요.');
  }

  const places = await resolveTripPlaces({
    origin: trip.origin,
    destination: trip.destination,
    stop: trip.preferences.savedStop?.query,
  }, resolvePlace);
  const candidates = await queryRoutes({ ...trip, places });

  return {
    places,
    routes: compareRoutes(candidates, {
      departAt: trip.departAt,
      arriveBy: trip.arriveBy,
      maxExtraTravelMinutes: trip.preferences.maxExtraTravelMinutes,
    }),
  };
}
