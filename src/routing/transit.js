import { expectedCrowding, stationName, subwayDirection } from './crowding.js';

const MINUTE = 60_000;
const TRANSFER_MINUTES = 3;
const MAX_REBOARD_PLANS = 2;
const MAX_WALK_DISTANCE_METERS = 800;

function mapLink(origin, destination, mode = 'traffic') {
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

async function requestRoutes(origin, destination, fetchFn) {
  const response = await fetchFn(`/api/transit?${routeParams(origin, destination)}`);
  if (!response.ok) throw new Error('대중교통 경로 서비스에 연결하지 못했어요.');
  const result = await response.json();
  if (['NO_RESULTS', 'STARTNODES_NULL', 'ENDNODES_NULL', 'EQUAL_POINTS'].includes(result.status)) return [];
  if (result.status !== 'OK' || !Array.isArray(result.routes)) throw new Error('대중교통 경로를 조회하지 못했어요.');
  return result.routes.map(({ properties, steps }) => ({
    mode: properties.type,
    links: [{ label: '카카오맵에서 길찾기', url: mapLink(origin, destination) }],
    travelMinutes: properties.totalTime / 60,
    transfers: properties.transfers,
    fare: properties.fare?.value ?? null,
    totalDistance: properties.totalDistance,
    steps: steps.map(({ properties, path }) => ({
      ...properties, points: path?.points,
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

async function fastestStopLeg(origin, destination, fetchFn) {
  const latitude = (origin.latitude + destination.latitude) * Math.PI / 360;
  const distance = 111_200 * Math.hypot(destination.latitude - origin.latitude,
    (destination.longitude - origin.longitude) * Math.cos(latitude));
  const walking = distance <= MAX_WALK_DISTANCE_METERS
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
  const missingWalk = Math.min(Math.max(0, route.travelMinutes - stepSeconds / 60),
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
      const direction = subwayDirection(step, data);
      const at = new Date(+departAt + elapsed * MINUTE);
      const averageAt = (name, offset) => direction ? expectedCrowding(
        data, direction, name, new Date(+at + offset * MINUTE),
      ) : null;
      const boarding = direction ? averageAt(direction.stops[0], 0) : null;
      boardings.push({ direction, boarding, at });
      if (direction) {
        const segmentMinutes = minutes / (direction.stops.length - 1);
        for (const [index, name] of direction.stops.slice(0, -1).entries()) {
          const crowding = averageAt(name, index * segmentMinutes);
          if (crowding === null) continue;
          knownRideMinutes += segmentMinutes;
          crowdMinutes += segmentMinutes * crowding / 100;
          crowdingBurden += segmentMinutes * Math.max(0, crowding / 100 - 1);
        }
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
    const leg = subwayDirection(rides[0], data);
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

async function savedStopRoute(places, departAt, stayMinutes, data, fetchFn) {
  const [firstRoute, secondRoute] = await Promise.all([
    fastestStopLeg(places.origin, places.stop, fetchFn),
    fastestStopLeg(places.stop, places.destination, fetchFn),
  ]);
  if (!firstRoute || !secondRoute) return null;

  const first = profile(firstRoute, departAt, data);
  const nextDeparture = new Date(+departAt + (first.travelMinutes + stayMinutes) * MINUTE);
  const second = profile(secondRoute, nextDeparture, data);
  const stopName = places.stop.name || places.stop.address || '저장 장소';
  return {
    ...second,
    mode: first.mode === 'WALKING' ? second.mode : second.mode === 'WALKING' || first.mode === second.mode
      ? first.mode : 'BUS_AND_SUBWAY',
    viaStop: true,
    stayMinutes,
    travelMinutes: first.travelMinutes + second.travelMinutes,
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

export async function queryTransit({ places, departAt, preferences, detourOnly = false }, fetchFn = fetch) {
  const [rawRoutes, data] = await Promise.all([
    detourOnly ? [] : requestRoutes(places.origin, places.destination, fetchFn),
    fetchFn(new URL('./seoul-crowding.json', import.meta.url)).then((response) =>
      response.ok ? response.json() : null,
    ).catch(() => null),
  ]);
  if (detourOnly) {
    const route = places.stop && preferences?.savedStop
      ? await savedStopRoute(places, departAt, preferences.savedStop.stayMinutes, data, fetchFn) : null;
    return route ? [route] : [];
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
