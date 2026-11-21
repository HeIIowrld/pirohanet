import {rideProfile} from './ride-comfort.js';

const weights = [
  null,
  { walking: 0.2, transfers: 1, crowding: 1 },
  { walking: 0.35, transfers: 1.5, crowding: 1.5 },
  { walking: 0.5, transfers: 2, crowding: 2 },
  { walking: 0.8, transfers: 4, crowding: 3 },
  { walking: 1, transfers: 5, crowding: 4 },
];

export function isDirect(route) {
  return !route.viaStop && !route.reboard;
}

export function routeArrivalAt(route, departAt) {
  return new Date(+departAt + (route.travelMinutes + (route.stayMinutes ?? 0)) * 60_000);
}

export function routeKey(route) {
  return JSON.stringify([
    route.mode, route.transfers, route.links?.map(({ url }) => url),
    route.steps?.map(({ type, guidance, stops, vehicles }) =>
      [type, guidance, stops?.map(({ name }) => name), vehicles?.map(({ name }) => name)]),
  ]);
}

const seoulTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', weekday: 'short', hour: 'numeric', hourCycle: 'h23',
});

function trafficPeriod(departAt, places) {
  // 광화문·종로·시청 일대에 출발지나 목적지가 있는 이동에 적용한다.
  const downtown = [places?.origin, places?.destination].some((place) =>
    place?.latitude >= 37.55 && place.latitude <= 37.59 &&
    place.longitude >= 126.96 && place.longitude <= 127.02,
  );
  if (!downtown) return null;

  const parts = seoulTime.formatToParts(departAt);
  const weekday = parts.find(({ type }) => type === 'weekday').value;
  const hour = Number(parts.find(({ type }) => type === 'hour').value);
  if (weekday === 'Sat' || weekday === 'Sun') return hour >= 11 && hour < 20 ? '주말 도심' : null;
  return (hour >= 7 && hour < 10) || (hour >= 17 && hour < 20) ? '평일 도심 출퇴근 시간' : null;
}

function contextFor(route, { traffic, avoidLine, arriveBy }) {
  const busMinutes = route.busMinutes ?? 0;
  const trafficPenalty = traffic
    ? Math.min(8, busMinutes * 0.2) * (arriveBy && arriveBy - route.arrivalAt <= 10 * 60_000 ? 1.5 : 1)
    : 0;
  const avoidedLineMinutes = avoidLine ? route.subwayLineMinutes?.[avoidLine] ?? 0 : 0;
  return { traffic, trafficPenalty, avoidLine, avoidedLineMinutes };
}

function score(route, preferences, useLegacyCrowding) {
  const base = weights[preferences.fatigueLevel] ?? weights[1];
  const weight = (key) => base[key] + (preferences.priority === key ? 2 : 0);
  const load = route.rideLoad;
  const effort = 0.55 + (preferences.fatigueLevel ?? 1) * 0.22;
  const rideScore = load.minutes
    ? effort * (load.baseline + load.seats + load.mixedTransfers * 0.5)
      + load.crowding * (effort + (preferences.priority === 'crowding' ? 0.6 : 0))
    : useLegacyCrowding ? route.crowdingBurden * weight('crowding') : 0;
  return route.travelMinutes + route.context.trafficPenalty + Math.min(8, route.context.avoidedLineMinutes * 0.4)
    + (route.walkMinutes ?? 0) * weight('walking')
    + (route.transfers ?? 0) * weight('transfers')
    + rideScore;
}

export function compareRoutes(candidates, { departAt, arriveBy, maxExtraTravelMinutes, places, preferences = {} }) {
  const fastestDirect = Math.min(...candidates.filter(isDirect).map((route) => route.travelMinutes));
  const eligible = candidates.map((route) => ({
    ...route,
    arrivalAt: routeArrivalAt(route, departAt),
    extraTravelMinutes: Number.isFinite(fastestDirect) ? route.travelMinutes - fastestDirect : null,
  })).filter((route) =>
    (arriveBy == null || route.arrivalAt <= arriveBy) &&
    (maxExtraTravelMinutes == null || route.extraTravelMinutes == null ||
      route.extraTravelMinutes <= maxExtraTravelMinutes),
  );

  const direct = eligible.filter(isDirect);
  const legacyCrowding = direct.length > 1 && direct.every((route) =>
    route.subwayMinutes > 0 && route.knownRideMinutes >= route.subwayMinutes - 1e-6 &&
    Number.isFinite(route.crowdingBurden),
  );
  const traffic = trafficPeriod(departAt, places);
  return eligible.map((route) => {
    const context = contextFor(route, { traffic, avoidLine: preferences.avoidLine, arriveBy });
    const rideLoad=rideProfile(route.steps);
    const crowdingCompared=rideLoad.minutes ? rideLoad.knownMinutes > 0 : legacyCrowding;
    const result = {...route,crowdingCompared,rideLoad,context};
    return {...result,comfortScore:isDirect(route) ? score(result,preferences,legacyCrowding) : null};
  }).sort((a, b) => (a.comfortScore ?? Infinity) - (b.comfortScore ?? Infinity) || a.arrivalAt - b.arrivalAt);
}
