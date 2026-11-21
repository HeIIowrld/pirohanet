const endpoint = 'https://gbis.go.kr/gbis2014/schBusAPI.action';
const seoulEndpoint = 'https://topis.seoul.go.kr/map/busMap/selectBusLineList.do';
const cacheTime = 6 * 60 * 60_000;
const maxCache = 256;
const maxConcurrent = 6;
const earthRadius = 6_378_137;

export const isGbisRouteId = id => /^(?:1[0-2]\d|2\d{2})\d{6}$/.test(id);
export const isSeoulRouteId = id => /^(?:1[01]\d|12[0-4])\d{6}$/.test(id);
export const isTopisRouteId = id => isGbisRouteId(id) || /^(?:16\d|170)\d{6}$/.test(id);

function toWgs84(row) {
  const longitude = Number(row.lon) / earthRadius * 180 / Math.PI;
  const latitude = Math.atan(Math.sinh(Number(row.lat) / earthRadius)) * 180 / Math.PI;
  return longitude >= 125 && longitude <= 129 && latitude >= 36 && latitude <= 39
    ? [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))]
    : null;
}

export function createGbisShape({fetchFn = fetch} = {}) {
  async function request(routeId) {
    const body = new URLSearchParams({cmd:'searchMapLineJson', routeId});
    const response = await fetchFn(endpoint, {
      method:'POST', body, redirect:'error',
      headers:{'X-Requested-With':'XMLHttpRequest'}, signal:AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const directions = data.success && data.result?.gg;
    if (!directions) return null;
    return [directions.upLine, directions.downLine].flatMap(direction => {
      const rows = direction?.list;
      if (!Array.isArray(rows) || rows.length > 4000) return [];
      const points = rows.filter(row => row.type !== '2').map(toWgs84);
      return points.length > 1 && points.every(Boolean) ? [points] : [];
    });
  }

  return cachedShapes(request,isGbisRouteId);
}

export function createSeoulBusShape({fetchFn = fetch} = {}) {
  async function request(routeId) {
    const url = new URL(seoulEndpoint);
    url.searchParams.set('routId',routeId);
    const response = await fetchFn(url,{redirect:'error',signal:AbortSignal.timeout(3500)});
    if (!response.ok) return null;
    const {rows} = await response.json();
    if (!Array.isArray(rows) || rows.length > 10_000) return null;
    const points = [];
    for (const row of rows) {
      const longitude = Number(row.posX);
      const latitude = Number(row.posY);
      if (String(row.routeId) !== routeId || !(longitude >= 125 && longitude <= 129 && latitude >= 36 && latitude <= 39)) return null;
      const previous = points.at(-1);
      if (previous?.[0] !== longitude || previous?.[1] !== latitude) points.push([longitude,latitude]);
    }
    return points.length > 1 ? [points] : [];
  }

  return cachedShapes(request,isTopisRouteId);
}

function cachedShapes(request,isRouteId) {
  const cache = new Map();
  let pending = 0;
  return async routeId => {
    if (!isRouteId(routeId)) return [];
    const now = Date.now();
    const cached = cache.get(routeId);
    if (cached?.until > now) return cached.result;
    if (pending >= maxConcurrent) return [];
    if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
    pending++;
    const result = request(routeId).catch(() => null).then(lines => {
      pending--;
      if (!lines && cache.get(routeId)?.result === result) cache.delete(routeId);
      return lines ?? [];
    });
    cache.set(routeId, {until:now+cacheTime, result});
    return result;
  };
}
