const endpoint = 'https://gbis.go.kr/gbis2014/schBusAPI.action';
const cacheTime = 6 * 60 * 60_000;
const maxCache = 256;
const maxConcurrent = 6;
const earthRadius = 6_378_137;

export const isGbisRouteId = id => /^(?:1[0-2]\d|2\d{2})\d{6}$/.test(id);

function toWgs84(row) {
  const longitude = Number(row.lon) / earthRadius * 180 / Math.PI;
  const latitude = Math.atan(Math.sinh(Number(row.lat) / earthRadius)) * 180 / Math.PI;
  return longitude >= 125 && longitude <= 129 && latitude >= 36 && latitude <= 39
    ? [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))]
    : null;
}

export function createGbisShape({fetchFn = fetch} = {}) {
  const cache = new Map();
  let pending = 0;

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

  return async routeId => {
    if (!isGbisRouteId(routeId)) return [];
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
