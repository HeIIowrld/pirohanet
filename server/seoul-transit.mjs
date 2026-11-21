const ENDPOINT = 'http://ws.bus.go.kr/api/rest/pathinfo/getPathInfoByBusNSub';
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
      ...(!subway && { seoulBusStopId: leg.fid, seoulBusRouteId: leg.routeId }),
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

function normalizeRoute(item, origin, destination) {
  const totalTime = Number(item?.time) * 60;
  const totalDistance = Number(item?.distance ?? NaN);
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

function providerError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function createSeoulTransit({ serviceKey, fetchFn = fetch }) {
  const cache = new Map();
  const lookup = async (params) => {
    if (!serviceKey) throw providerError(503, '서울시 경로 API 키가 설정되지 않았어요.');
    const query = new URLSearchParams({
      serviceKey: decodeURIComponent(serviceKey), resultType: 'json',
      startX: params.start_x, startY: params.start_y, endX: params.end_x, endY: params.end_y,
    });
    const response = await fetchFn(`${ENDPOINT}?${query}`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (response.status === 429) throw providerError(429, '서울시 경로 조회 한도에 도달했어요.');
    if (!response.ok) throw providerError(502, '서울시 경로 서비스가 요청을 처리하지 못했어요.');
    const { msgHeader, msgBody } = await response.json();
    const origin = [params.start_x, params.start_y];
    const destination = [params.end_x, params.end_y];
    const code = String(msgHeader?.headerCd);
    if (code === '4' || (code === '1' && metersBetween(origin, destination) < 100)) {
      return { status: 'NO_RESULTS', routes: [], source: 'seoul' };
    }
    if (code !== '0') {
      if (/limit|traffic|quota|초과/i.test(msgHeader?.headerMsg ?? '')) {
        throw providerError(429, '서울시 경로 조회 한도에 도달했어요.');
      }
      throw providerError(502, '서울시 경로 서비스가 요청을 처리하지 못했어요.');
    }
    const items = msgBody?.itemList;
    const rows = Array.isArray(items) ? items : items ? [items] : [];
    const routes = rows.map(item => normalizeRoute(item, origin, destination)).filter(Boolean);
    if (rows.length && !routes.length) throw providerError(502, '서울시 경로 응답을 처리하지 못했어요.');
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
