const endpoint = 'https://naverapihub.apigw.ntruss.com/search/v1/local';

export function naverSearch(env) {
  const { NAVER_SEARCH_KEY_ID: id, NAVER_SEARCH_KEY: key } = env;
  if (!id || !key) return null;
  return async query => {
    const params = new URLSearchParams({ query, display: '5' });
    const response = await fetch(`${endpoint}?${params}`, {
      headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': key },
      signal: AbortSignal.timeout(3500)
    });
    if (!response.ok) throw new Error('Local search failed');
    const { items } = await response.json();
    return (items ?? []).flatMap(item => {
      const coordinate = [Number(item.mapx) / 1e7, Number(item.mapy) / 1e7];
      if (!isKoreanPoint(coordinate) || typeof item.title !== 'string') return [];
      const name = item.title.replaceAll(/<\/?b>/gi, '').trim().slice(0, 100);
      const address = (item.roadAddress || item.address || '').trim().slice(0, 100);
      return name ? [{ name, address, coordinate, category: item.category ?? '' }] : [];
    });
  };
}

export function isKoreanPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) &&
    value[0] >= 124 && value[0] <= 132 && value[1] >= 32 && value[1] <= 39;
}

export function distanceFrom([lon, lat], [otherLon, otherLat]) {
  const x = (otherLon - lon) * Math.cos(lat * Math.PI / 180);
  return Math.hypot(x, otherLat - lat) * 111_195;
}

export async function nearbyPlaces(search, origin, destination) {
  const region = origin.address.split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
  if (!region) return { places: [], unavailable: true };
  const categories = [
    ['카페', '카페', /카페/], ['서점', '서점', /서점/], ['전시', '미술관', /박물관|미술관|전시/]
  ];
  const results = await Promise.allSettled(categories.map(async ([category, keyword, match]) => {
    const places = await search(`${region} ${keyword}`);
    return places.filter(place => match.test(place.category))
      .map(place => ({ ...place, category, distance: distanceFrom(origin.coordinate, place.coordinate) }))
      .filter(place => place.distance >= 25 && place.distance <= 1200 && distanceFrom(destination, place.coordinate) >= 25)
      .sort((a, b) => a.distance - b.distance)[0];
  }));
  return {
    places: results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []),
    unavailable: results.every(result => result.status === 'rejected')
  };
}
