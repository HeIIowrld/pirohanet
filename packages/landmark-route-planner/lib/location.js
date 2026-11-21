import { isKoreanPoint } from './naver.js';

const maximum = 5;
const kakaoRoot = 'https://dapi.kakao.com/v2/local/search/';
const generic = new Set(['집', '우리집', '본가', '자취방', '기숙사', '회사', '직장', '사무실', '오피스',
  '학교', '학원', '헬스장', 'home', 'work', 'office', 'school']);
const compact = value => value.trim().replace(/\s+/gu, ' ');
export const locationName = value => typeof value === 'string'
  ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
const looksLikeAddress = value => /(?:로|길|동|읍|면|리)\s*\d/u.test(value);

function alternatives(value) {
  const parts = value.split(',').map(part => compact(part.replace(/^\s*대한민국\s*/u, ''))).filter(Boolean);
  return [...new Set([value, ...parts.reverse()])].slice(0, 3);
}

export async function peliasFeatures(parameters, key, timeout = 8000) {
  const url = new URL('https://api.heigit.org/pelias/v1/search');
  url.search = parameters;
  const response = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('Place service rejected the search');
  return (await response.json()).features ?? [];
}

async function kakaoSearch(kind, query, key) {
  const url = new URL(kind + '.json', kakaoRoot);
  url.search = new URLSearchParams({ query, size: String(maximum) });
  const response = await fetch(url, {
    headers: { Authorization: 'KakaoAK ' + key },
    signal: AbortSignal.timeout(3200)
  });
  if (!response.ok) throw new Error('Place service rejected the search');
  return (await response.json()).documents ?? [];
}

function candidates(items) {
  const identities = new Set();
  return items.filter(place => {
    const identity = [locationName(place.name), place.coordinate.map(value => value.toFixed(5)).join(',')].join(':');
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  }).slice(0, maximum);
}

async function kakaoLocations(queries, key) {
  for (const query of queries.filter(looksLikeAddress)) {
    const rows = await kakaoSearch('address', query, key);
    const places = rows.flatMap(row => {
      const address = row.road_address?.address_name || row.address_name;
      const coordinate = [Number(row.x), Number(row.y)];
      if (!address || !isKoreanPoint(coordinate)) return [];
      return [{ name: row.road_address?.building_name || address, address, coordinate }];
    });
    if (places.length) return candidates(places);
  }
  for (const query of queries) {
    const rows = await kakaoSearch('keyword', query, key);
    const places = rows.flatMap(row => {
      const coordinate = [Number(row.x), Number(row.y)];
      const address = row.road_address_name || row.address_name;
      if (!row.place_name || !address || !isKoreanPoint(coordinate)) return [];
      return [{ name: row.place_name, address, coordinate }];
    });
    if (places.length) return candidates(places);
  }
  return [];
}

async function peliasLocations(queries, key) {
  for (const query of queries) {
    const parameters = new URLSearchParams({ text: query, 'boundary.country': 'KR', size: String(maximum) });
    const features = await peliasFeatures(parameters, key, 3200);
    const places = features.flatMap(feature => {
      const coordinate = feature.geometry?.coordinates?.slice(0, 2);
      const { name, label, region, locality, borough } = feature.properties ?? {};
      if (!name || !isKoreanPoint(coordinate)) return [];
      const address = label || [region, locality, borough].filter(Boolean).join(' ');
      return [{ name, address, coordinate }];
    });
    if (places.length) return candidates(places);
  }
  return [];
}

export async function findLocations(input, env = process.env) {
  const query = compact(input);
  if (generic.has(locationName(query))) return { status: 'personal-label', places: [] };
  const queries = alternatives(query);
  const searches = [
    [env.KAKAO_REST_API_KEY, kakaoLocations], [env.ORS_API_KEY, peliasLocations]
  ];
  let completed = false;
  for (const [key, search] of searches) {
    if (!key) continue;
    const places = await search(queries, key).catch(() => null);
    if (places) completed = true;
    if (places?.length) return { status: 'ready', places };
  }
  return { status: completed ? 'empty' : 'unavailable', places: [] };
}
