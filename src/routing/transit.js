import { expectedCrowding, expandSubwayStops, stationName, subwayDirection } from './crowding.js';

const MINUTE = 60_000;
export const MINIMUM_STOP_MINUTES = 5;
const TRANSFER_MINUTES = 3;
const MAX_REBOARD_PLANS = 2;
const MAX_WALK_DISTANCE_METERS = 800;

export function mapLink(origin, destination, mode = 'traffic') {
  return `https://map.kakao.com/link/by/${mode}/` + [origin, destination].map((place) =>
    `${encodeURIComponent(place.name || place.address || '장소')},${place.latitude},${place.longitude}`,
  ).join('/');
}

function routeParams(origin, destination) {
  return new URLSearchParams({
    start_x: origin.longitude, start_y: origin.latitude,
    end_x: destination.longitude, end_y: destination.latitude,
  });
}

// 대중교통 조회는 하루 한도가 작다. 성공한 응답을 이 브라우저에 보관해 같은 구간은 10분 동안 다시 묻지 않고,
// 한도가 끝났을 때는 전에 받아 둔 응답으로 보여 준다. 테스트처럼 fetch를 바꿔 넣으면 보관하지 않는다.
const TRANSIT_CACHE_KEY = 'modo.transit.v2';
const TRANSIT_FRESH_MS = 10 * 60_000;
const TRANSIT_CACHE_ENTRIES = 12;
const transitInFlight = new Map();
const transitStore = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
function readTransitCache() {
  try { return JSON.parse(transitStore()?.getItem(TRANSIT_CACHE_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function writeTransitCache(key, result) {
  const store = transitStore();
  if (!store) return;
  const entries = Object.entries({ ...readTransitCache(), [key]: { at: Date.now(), result } })
    .sort(([, a], [, b]) => b.at - a.at).slice(0, TRANSIT_CACHE_ENTRIES);
  // ponytail: 응답이 커서 저장 공간이 모자라면 가장 새 것 하나만 남긴다
  for (const kept of [entries, entries.slice(0, 1)]) {
    try { store.setItem(TRANSIT_CACHE_KEY, JSON.stringify(Object.fromEntries(kept))); return; } catch { /* 다음 크기로 */ }
  }
}

async function transitResponse(origin, destination, fetchFn) {
  const cacheable = fetchFn === globalThis.fetch;
  const key = [origin.longitude, origin.latitude, destination.longitude, destination.latitude]
    .map((value) => Number(value).toFixed(5)).join(',');
  const cached = cacheable ? readTransitCache()[key] : null;
  if (cached && Date.now() - cached.at < TRANSIT_FRESH_MS) return cached.result;
  if (cacheable && transitInFlight.has(key)) return transitInFlight.get(key); // 같은 구간을 동시에 두 번 묻지 않는다
  const pending = (async () => {
    const response = await fetchFn(`/api/transit?${routeParams(origin, destination)}`);
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      if (response.status === 429 || /api limit has been exceeded/i.test(failure?.msg ?? failure?.error ?? '')) {
        if (cached) return cached.result;
        throw new Error(failure?.error?.startsWith?.('서울시') ? failure.error : '대중교통 경로 서비스의 조회 한도가 초과됐어요.');
      }
      throw new Error(failure?.error?.startsWith?.('서울시') ? failure.error : '대중교통 경로 서비스에 연결하지 못했어요.');
    }
    const result = await response.json();
    if (cacheable && result.status === 'OK') writeTransitCache(key, result);
    return result;
  })();
  if (cacheable) {
    transitInFlight.set(key, pending);
    pending.finally(() => transitInFlight.delete(key)).catch(() => {});
  }
  return pending;
}

async function requestRoutes(origin, destination, fetchFn) {
  const result = await transitResponse(origin, destination, fetchFn);
  if (['NO_RESULTS', 'STARTNODES_NULL', 'ENDNODES_NULL', 'EQUAL_POINTS'].includes(result.status)) return [];
  if (result.status !== 'OK' || !Array.isArray(result.routes)) throw new Error('대중교통 경로를 조회하지 못했어요.');
  return result.routes.map(({ properties, steps }) => ({
    mode: properties.type,
    ...(result.source === 'seoul' && { source: 'seoul' }),
    links: [{ label: '카카오맵에서 길찾기', url: mapLink(origin, destination) }],
    travelMinutes: properties.totalTime / 60,
    transfers: properties.transfers,
    fare: properties.fare?.value ?? null,
    totalDistance: properties.totalDistance,
    steps: steps.map(({ properties, path }) => ({
      ...properties, points: path?.points,
      ...(result.source === 'seoul' && { approximate: true }),
      ...(properties.type === 'BUS' && { boardingPoint: path?.points?.[0] }),
    })),
  })).filter((route) => Number.isFinite(route.travelMinutes) && route.travelMinutes > 0 &&
    route.steps.some((step) => step.type === 'SUBWAY' || step.type === 'BUS'));
}

async function requestWalk(origin, destination, fetchFn) {
  const response = await fetchFn(`/api/walk?${routeParams(origin, destination)}`);
  if (!response.ok) return null;
  const { status, route } = await response.json();
  const seconds = route?.properties?.totalTime;
  const distance = route?.properties?.totalDistance;
  if (status !== 'OK' || !Number.isFinite(seconds) || seconds <= 0 ||
      !Number.isFinite(distance) || distance > MAX_WALK_DISTANCE_METERS) return null;
  return {
    mode: 'WALKING',
    links: [{ url: mapLink(origin, destination, 'walk') }],
    travelMinutes: seconds / 60,
    transfers: 0,
    fare: 0,
    totalDistance: distance,
    steps: (route.legs ?? []).flatMap((leg) =>
      leg.steps.map(({ properties, path }) => ({ ...properties, type: 'WALKING', points: path?.points }))),
  };
}

function isNearby(origin, destination) {
  const latitude = (origin.latitude + destination.latitude) * Math.PI / 360;
  return 111_200 * Math.hypot(destination.latitude - origin.latitude,
    (destination.longitude - origin.longitude) * Math.cos(latitude)) <= MAX_WALK_DISTANCE_METERS;
}

async function fastestStopLeg(origin, destination, fetchFn) {
  const walking = isNearby(origin, destination)
    ? requestWalk(origin, destination, fetchFn).catch(() => null) : null;
  const [transit, walk] = await Promise.all([
    requestRoutes(origin, destination, fetchFn).catch((error) => ({ error })),
    walking,
  ]);
  if (transit.error) {
    if (walk) return walk;
    throw transit.error;
  }
  return transit.reduce((best, route) => !best || route.travelMinutes < best.travelMinutes ? route : best, walk);
}

function profile(route, departAt, data) {
  if (route.mode === 'WALKING') {
    return { ...route, walkMinutes: route.travelMinutes, boardings: [],
      crowdMinutes: 0, crowdingBurden: 0, knownRideMinutes: 0, rideMinutes: 0, subwayMinutes: 0 };
  }
  const riding = route.steps.filter((step) => step.type !== 'WALKING');
  const stepSeconds = route.steps.reduce((sum, step) => sum + step.time, 0);
  const stepDistance = route.steps.reduce((sum, step) => sum + step.distance, 0);
  // 공급자가 별도 단계로 주지 않은 접근·하차 후 도보를 총 거리 차이로 추정한다.
  const missingWalk = route.source === 'seoul' ? 0 : Math.min(Math.max(0, route.travelMinutes - stepSeconds / 60),
    Math.max(0, route.totalDistance - stepDistance) / 75);
  const wait = Math.max(0, route.travelMinutes - stepSeconds / 60 - missingWalk) / riding.length;
  let elapsed = missingWalk / 2;
  let walkMinutes = missingWalk;
  let crowdMinutes = 0;
  let crowdingBurden = 0;
  let subwayMinutes = 0;
  let busMinutes = 0;
  const subwayLineMinutes = {};
  let knownRideMinutes = 0;
  let rideMinutes = 0;
  const boardings = [];

  const steps = route.steps.map((step) => {
    const minutes = step.time / 60;
    if (step.type === 'WALKING') {
      walkMinutes += minutes;
    } else {
      elapsed += wait;
      rideMinutes += minutes;
      if (step.type === 'BUS') busMinutes += minutes;
      if (step.type === 'SUBWAY') {
        subwayMinutes += minutes;
        const line = step.vehicles?.[0]?.name?.match(/^([1-9])호선$/)?.[1];
        if (line) subwayLineMinutes[line] = (subwayLineMinutes[line] ?? 0) + minutes;
      }
      if (step.railSegments) step = expandSubwayStops(step, data);
      const direction = subwayDirection(step, data);
      if (direction?.next) step = { ...step, nextSubwayStation: direction.next.name };
      const at = new Date(+departAt + elapsed * MINUTE);
      const averageAt = (name, offset) => direction ? expectedCrowding(
        data, direction, name, new Date(+at + offset * MINUTE),
      ) : null;
      const boarding = direction ? averageAt(direction.stops[0], 0) : null;
      boardings.push({ direction, boarding, at });
      if (direction) {
        let measuredMinutes = 0;
        let load = 0;
        const segmentMinutes = minutes / (direction.stops.length - 1);
        for (const [index, name] of direction.stops.slice(0, -1).entries()) {
          const crowding = averageAt(name, index * segmentMinutes);
          if (crowding === null) continue;
          measuredMinutes += segmentMinutes;
          load += segmentMinutes * crowding;
          knownRideMinutes += segmentMinutes;
          crowdMinutes += segmentMinutes * crowding / 100;
          crowdingBurden += segmentMinutes * Math.max(0, crowding / 100 - 1);
        }
        if (measuredMinutes > 0) step = {...step, railComfort:{
          knownMinutes:measuredMinutes, average:load/measuredMinutes,
          line:step.vehicles?.[0]?.name, direction:direction.direction,
        }};
      }
    }
    elapsed += minutes;
    return step.type === 'BUS'
      ? { ...step, boardingAt: Math.round(+departAt + (elapsed - minutes) * MINUTE) } : step;
  });

  return { ...route, steps, walkMinutes, boardings, crowdMinutes, crowdingBurden, knownRideMinutes, rideMinutes, subwayMinutes, busMinutes, subwayLineMinutes,
    stayMinutes: 0, viaStop: false };
}

async function lookupStation(line, name, fetchFn) {
  const params = new URLSearchParams({ query: `${name.endsWith('역') ? name : name + '역'} ${line}호선`, category_group_code: 'SW8' });
  const response = await fetchFn(`/api/place?${params}`);
  if (!response.ok) return null;
  const { documents } = await response.json();
  const place = documents?.find((item) => item.category_group_code === 'SW8' &&
    item.place_name.split(/\s+/).some((part) => stationName(part) === name) &&
    item.place_name.split(/\s+/).includes(`${line}호선`));
  return place && { name: place.place_name, latitude: Number(place.y), longitude: Number(place.x) };
}

function rideSteps(route) {
  return route.steps.filter((step) => step.type !== 'WALKING');
}

async function reboardRoute(base, places, departAt, data, fetchFn) {
  const { direction, boarding } = base.boardings[0];
  const { line, previous, stops } = direction;
  const station = await lookupStation(line, previous.name, fetchFn);
  if (!station) return null;
  const [reverse, onward] = await Promise.all([
    requestRoutes(places.origin, station, fetchFn),
    requestRoutes(station, places.destination, fetchFn),
  ]);
  const back = reverse.find((route) => {
    const rides = rideSteps(route);
    const leg = rides[0] && subwayDirection(expandSubwayStops(rides[0], data), data);
    return rides.length === 1 && leg?.line === line && leg.stops.length === 2 &&
      leg.stops[0] === stops[0] && leg.stops[1] === previous.name;
  });
  if (!back) return null;

  const onwardsAt = new Date(+departAt + (back.travelMinutes + TRANSFER_MINUTES) * MINUTE);
  const forward = onward.map((route) => profile(route, onwardsAt, data)).find(({ boardings }) => {
    const leg = boardings[0].direction;
    const expected = [previous.name, ...stops];
    return leg?.line === line && leg.direction === direction.direction &&
      leg.stops.length === expected.length && expected.every((name, index) => leg.stops[index] === name) &&
      boardings[0].boarding !== null && boarding - boardings[0].boarding >= 10;
  });
  if (!forward) return null;

  const first = profile(back, departAt, data);
  return {
    ...forward,
    travelMinutes: first.travelMinutes + TRANSFER_MINUTES + forward.travelMinutes,
    transfers: forward.transfers + 1,
    links: [
      { ...first.links[0], label: `${previous.name}까지 길찾기` },
      { ...forward.links[0], label: `${previous.name}에서 목적지까지 길찾기` },
    ],
    fare: first.fare === null || forward.fare === null ? null : first.fare + forward.fare,
    walkMinutes: first.walkMinutes + TRANSFER_MINUTES + forward.walkMinutes,
    rideMinutes: first.rideMinutes + forward.rideMinutes,
    knownRideMinutes: first.knownRideMinutes + forward.knownRideMinutes,
    crowdMinutes: first.crowdMinutes + forward.crowdMinutes,
    crowdingBurden: first.crowdingBurden + forward.crowdingBurden,
    subwayMinutes: first.subwayMinutes + forward.subwayMinutes,
    steps: [...first.steps, { guidance: `${previous.name}에서 반대편 방면으로 이동 후 다시 탑승` }, ...forward.steps],
    reboard: { from: stops[0], at: previous.name, before: boarding, after: forward.boardings[0].boarding },
  };
}

async function savedStopRoute(places, departAt, requestedStay, data, fetchFn, arriveBy) {
  const [firstRoute, secondRoute] = await Promise.all([
    fastestStopLeg(places.origin, places.stop, fetchFn),
    fastestStopLeg(places.stop, places.destination, fetchFn),
  ]);
  if (!firstRoute || !secondRoute) return null;

  const travelMinutes = firstRoute.travelMinutes + secondRoute.travelMinutes;
  const stayMinutes = arriveBy == null ? requestedStay : Math.floor((arriveBy - departAt) / MINUTE - travelMinutes + 1e-9);
  if (arriveBy != null && stayMinutes < MINIMUM_STOP_MINUTES) return null;
  const first = profile(firstRoute, departAt, data);
  const stopArrivalAt = +departAt + first.travelMinutes * MINUTE;
  const nextDeparture = new Date(stopArrivalAt + stayMinutes * MINUTE);
  const second = profile(secondRoute, nextDeparture, data);
  const stopName = places.stop.name || places.stop.address || '저장 장소';
  return {
    ...second,
    ...(first.source === 'seoul' && { source: 'seoul' }),
    mode: first.mode === 'WALKING' ? second.mode : second.mode === 'WALKING' || first.mode === second.mode
      ? first.mode : 'BUS_AND_SUBWAY',
    viaStop: true,
    stayMinutes,
    travelMinutes,
    stopArrivalAt,
    stopDepartureAt:+nextDeparture,
    walkMinutes: first.walkMinutes + second.walkMinutes,
    transfers: first.transfers + second.transfers,
    fare: first.fare === null || second.fare === null ? null : first.fare + second.fare,
    boardings: [...first.boardings, ...second.boardings],
    crowdMinutes: first.crowdMinutes + second.crowdMinutes,
    crowdingBurden: first.crowdingBurden + second.crowdingBurden,
    knownRideMinutes: first.knownRideMinutes + second.knownRideMinutes,
    rideMinutes: first.rideMinutes + second.rideMinutes,
    subwayMinutes: first.subwayMinutes + second.subwayMinutes,
    crowdingAsOf: data?.asOf,
    steps: [...first.steps, { guidance: `${stopName}에서 ${stayMinutes}분 체류` }, ...second.steps],
    links: [
      { ...first.links[0], label: `${stopName}까지 ${first.mode === 'WALKING' ? '도보 ' : ''}길찾기` },
      { ...second.links[0], label: `${stopName}에서 목적지까지 ${second.mode === 'WALKING' ? '도보 ' : ''}길찾기` },
    ],
  };
}

export async function queryTransit({ places, departAt, preferences, detourOnly = false, stopArriveBy }, fetchFn = fetch) {
  let transitError;
  const [rawRoutes, data] = await Promise.all([
    detourOnly ? [] : requestRoutes(places.origin, places.destination, fetchFn).catch(error => {
      transitError = error;
      return [];
    }),
    fetchFn(new URL('./seoul-crowding.json', import.meta.url)).then((response) =>
      response.ok ? response.json() : null,
    ).catch(() => null),
  ]);
  if (detourOnly) {
    const route = places.stop && preferences?.savedStop
      ? await savedStopRoute(places, departAt, preferences.savedStop.stayMinutes, data, fetchFn, stopArriveBy) : null;
    return route ? [route] : [];
  }
  // 대중교통 결과가 없는 가까운 거리는 걸어가는 길을 돌려준다. 없으면 '경로를 찾지 못했어요'에서 막힌다.
  if (!rawRoutes.length) {
    if (transitError && !isNearby(places.origin, places.destination)) throw transitError;
    const walk = await requestWalk(places.origin, places.destination, fetchFn).catch(() => null);
    if (walk) return [{ ...profile(walk, departAt, data), stayMinutes: 0, viaStop: false, links: [{ ...walk.links[0], label: '카카오맵에서 도보 길찾기' }] }];
    if (transitError) throw transitError;
  }
  const routes = rawRoutes.map((route) => ({ ...profile(route, departAt, data), crowdingAsOf: data?.asOf }));
  const seen = new Set();
  const bases = routes.filter(({ boardings }) => {
    const { direction, boarding } = boardings[0];
    if (!direction?.previous || boarding === null) return false;
    const key = [direction.line, ...direction.stops].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.boardings[0].boarding - a.boardings[0].boarding).slice(0, MAX_REBOARD_PLANS);

  const extraQueries = bases.map((base) => reboardRoute(base, places, departAt, data, fetchFn));
  if (places.stop && preferences?.savedStop) {
    extraQueries.push(savedStopRoute(places, departAt, preferences.savedStop.stayMinutes, data, fetchFn));
  }
  const detours = await Promise.allSettled(extraQueries);
  return routes.concat(detours.flatMap((result) => result.status === 'fulfilled' && result.value
    ? [{ ...result.value, crowdingAsOf: data?.asOf }] : []));
}
