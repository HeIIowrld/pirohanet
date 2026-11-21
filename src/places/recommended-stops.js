import { searchPlaceCandidates, searchPlaces } from '../calendar/location.js';

export async function loadRecommendedStops(fetchFn = fetch) {
  const response = await fetchFn(new URL('./recommended-stops.json', import.meta.url));
  if (!response.ok) throw new Error('추천 경유지를 불러오지 못했어요.');
  return response.json();
}

const nameKey = (value) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const addressKey = (value) => value.trim().replace(/\s+/g, ' ').replace(/^서울특별시 /, '서울 ');

export async function resolveRecommendedStop({ name, location }, fetchFn = fetch) {
  const { search_query, route_target, target_type, district, route_address } = location;
  const byAddress = target_type === 'address';
  const candidates = await (byAddress ? searchPlaceCandidates : searchPlaces)(search_query, fetchFn);
  const matches = candidates.filter((place) => {
    if (!place.address || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return false;
    const address = addressKey(place.address);
    return address.startsWith(`서울 ${district} `) &&
      (!route_address || address === addressKey(route_address)) &&
      (byAddress || (place.name && nameKey(place.name) === nameKey(route_target)));
  });
  return matches.length === 1 ? { ...matches[0], name } : null;
}
