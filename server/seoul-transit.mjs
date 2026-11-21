import { busRideRange } from '../src/routing/bus-ride-range.js';
import turnStops from '../src/routing/bus-turn-stops.json' with { type: 'json' };
import seoulBusStops from '../frontend/public/assets/data/seoul-bus-stops.json' with { type: 'json' };
import incheonBusStops from '../frontend/public/assets/data/incheon-bus-stops.json' with { type: 'json' };
import stationPoints from '../src/routing/seoul-station-points.json' with { type: 'json' };

const ENDPOINT = 'http://ws.bus.go.kr/api/rest/pathinfo';
const SUBWAY = 'getPathInfoBySubway';
const MAX_STATION_DISTANCE = 1600;
const stations = Object.values(stationPoints).flatMap(line => Object.entries(line));
const CACHE_TIME = 60_000;
const MAX_CACHE_ENTRIES = 256;

function point(x, y) {
  const lon = Number(x);
  const lat = Number(y);
  if (lon >= 124 && lon <= 132 && lat >= 33 && lat <= 39) return [lon, lat];
  return null;
}

function metersBetween([lonA, latA], [lonB, latB]) {
  return Math.round(111_200 * Math.hypot((lonB - lonA) * Math.cos((latA + latB) * Math.PI / 360), latB - latA));
}

function rideStep(leg) {
  const from = point(leg?.fx, leg?.fy);
  const to = point(leg?.tx, leg?.ty);
  const name = typeof leg?.routeNm === 'string' ? leg.routeNm.trim() : '';
  if (!from || !to || !name || !leg.fname || !leg.tname) return null;
  const subway = Array.isArray(leg.railLinkList) || !leg.routeId;
  return {
    properties: {
      type: subway ? 'SUBWAY' : 'BUS',
      guidance: `${leg.fname}에서 ${name} 탑승 · ${leg.tname} 하차`,
      vehicles: [{ name }],
      ...(!subway && { seoulBusStopId: leg.fid, seoulBusRouteId: leg.routeId,
        ...(leg.tid && { seoulBusAlightStopId: leg.tid }) }),
      stops: [{ name: leg.fname }, { name: leg.tname }],
      ...(subway && leg.railLinkList?.length ? { railSegments: leg.railLinkList.length } : {}),
      distance: metersBetween(from, to),
    },
    path: { points: [from, to] },
  };
}

function walkStep(from, to, guidance) {
  const distance = metersBetween(from, to);
  if (distance === 0) return null;
  return {
    properties: { type: 'WALKING', guidance, distance, time: Math.round(distance * 60 / 75) },
    path: { points: [from, to] },
  };
}

function normalizeRoute(item, origin, destination, extraWalk = 0) {
  const totalTime = Number(item?.time) * 60 + Math.round(extraWalk * 60 / 75);
  const totalDistance = Number(item?.distance ?? NaN) + extraWalk;
  if (!(totalTime > 0) || !Number.isFinite(totalTime) || !item.pathList?.length || !Array.isArray(item.pathList)) return null;
  const rides = item.pathList.map(rideStep);
  if (rides.some(ride => !ride)) return null;
  const steps = [];
  let position = origin;
  for (const ride of rides) {
    const walk = walkStep(position, ride.path.points[0], `${ride.properties.stops[0].name}까지 도보`);
    if (walk) steps.push(walk);
    steps.push(ride);
    position = ride.path.points[1];
  }
  const lastWalk = walkStep(position, destination, '목적지까지 도보');
  if (lastWalk) steps.push(lastWalk);

  const walking = steps.filter(step => step.properties.type === 'WALKING');
  const estimatedWalk = walking.reduce((sum, step) => sum + step.properties.time, 0);
  if (estimatedWalk > totalTime * 0.8) return null;
  const wait = Math.min(rides.length * 120, Math.floor((totalTime - estimatedWalk) * 0.15));
  const rideTime = totalTime - estimatedWalk - wait;
  const rideDistance = rides.reduce((sum, step) => sum + Math.max(1, step.properties.distance), 0);
  for (const ride of rides) {
    ride.properties.time = rideTime * Math.max(1, ride.properties.distance) / rideDistance;
  }
  const types = new Set(rides.map(step => step.properties.type));
  return {
    properties: {
      type: types.size > 1 ? 'BUS_AND_SUBWAY' : rides[0].properties.type,
      totalTime, totalDistance: Number.isFinite(totalDistance) ? totalDistance : null,
      transfers: rides.length - 1,
    },
    steps,
  };
}

function nearbyStations(position) {
  const nearby = stations.map(([name, point]) => ({ name, point, distance: metersBetween(position, point) }))
    .filter(station => station.distance <= MAX_STATION_DISTANCE)
    .sort((a, b) => a.distance - b.distance);
  if (!nearby.length) return [];
  const [first] = nearby;
  const second = nearby.find(station => station.name !== first.name);
  return second ? [first, second] : [first];
}

function providerError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function createSeoulTransit({ serviceKey, fetchFn = fetch }) {
  const cache = new Map();
  const request = async (operation, origin, destination, start = origin, end = destination) => {
    const query = new URLSearchParams({
      serviceKey: decodeURIComponent(serviceKey), resultType: 'json',
      startX: start[0], startY: start[1], endX: end[0], endY: end[1],
    });
    const response = await fetchFn(`${ENDPOINT}/${operation}?${query}`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (response.status === 429) throw providerError(429, '서울시 경로 조회 한도에 도달했어요.');
    if (!response.ok) throw providerError(502, '서울시 경로 서비스가 요청을 처리하지 못했어요.');
    const { msgHeader, msgBody } = await response.json();
    const code = String(msgHeader?.headerCd);
    if (code === '4' || (code === '1' && metersBetween(origin, destination) < 100)) {
      return [];
    }
    if (code !== '0') {
      if (/limit|traffic|quota|초과/i.test(msgHeader?.headerMsg ?? '')) {
        throw providerError(429, '서울시 경로 조회 한도에 도달했어요.');
      }
      throw providerError(502, '서울시 경로 서비스가 요청을 처리하지 못했어요.');
    }
    const items = msgBody?.itemList;
    const rows = Array.isArray(items) ? items : items ? [items] : [];
    const extraWalk = metersBetween(origin, start) + metersBetween(end, destination);
    const routes = rows.map(item => normalizeRoute(item, origin, destination, extraWalk)).filter(Boolean);
    if (rows.length && !routes.length) throw providerError(502, '서울시 경로 응답을 처리하지 못했어요.');
    return routes.filter(route => route.steps.every(({properties,path}) => {
      const id = properties.seoulBusRouteId;
      if (!turnStops[id]) return true;
      const stops = seoulBusStops.routes[id] ?? incheonBusStops.routes[id];
      return busRideRange({...properties,points:path.points},stops) !== null;
    }));
  };

  const subwayRoutes = async (origin, destination) => {
    const direct = await request(SUBWAY, origin, destination);
    if (direct.length || metersBetween(origin, destination) < 700) return direct;
    const starts = nearbyStations(origin);
    const ends = nearbyStations(destination);
    if (!starts.length || !ends.length || (starts[0].distance <= 250 && ends[0].distance <= 250)) return direct;
    const stationPairs = starts.flatMap(start => ends.filter(end => end.name !== start.name)
      .map(end => [start.point, end.point]));
    const results = await Promise.allSettled(stationPairs.map(([start, end]) =>
      request(SUBWAY, origin, destination, start, end)));
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  };

  const lookup = async (params) => {
    if (!serviceKey) throw providerError(503, '서울시 경로 API 키가 설정되지 않았어요.');
    const origin = [params.start_x, params.start_y];
    const destination = [params.end_x, params.end_y];
    const results = await Promise.allSettled([
      request('getPathInfoByBusNSub', origin, destination),
      subwayRoutes(origin, destination),
    ]);
    const unique = new Map();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const route of result.value) {
        const key = JSON.stringify(route.steps.map(({ properties, path }) =>
          [properties.type, properties.vehicles?.[0]?.name, properties.seoulBusRouteId,
            properties.seoulBusStopId, properties.seoulBusAlightStopId, path.points]));
        if (!unique.has(key) || route.properties.totalTime < unique.get(key).properties.totalTime) unique.set(key, route);
      }
    }
    const routes = [...unique.values()];
    const failure = results.find(result => result.status === 'rejected');
    if (!routes.length && failure) throw failure.reason;
    return { status: routes.length ? 'OK' : 'NO_RESULTS', routes, source: 'seoul' };
  };
  return (params) => {
    const key = JSON.stringify([params.start_x, params.start_y, params.end_x, params.end_y]);
    const now = Date.now();
    const existing = cache.get(key);
    if (existing && existing.until > now) return existing.result;
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    const result = lookup(params).catch(error => {
      if (cache.get(key)?.result === result) cache.delete(key);
      throw error;
    });
    cache.set(key, { until: now + CACHE_TIME, result });
    return result;
  };
}
