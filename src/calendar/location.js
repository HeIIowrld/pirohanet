// 일정의 위치 글자(장소 이름 또는 주소) → 후보 장소들의 주소와 좌표, 좌표 → 지도 이미지 주소.
//
// 비밀 키가 필요한 호출은 서버가 대신 한다. 브라우저는 아래 두 경로만 부른다(개발용 구현은 dev-server.mjs).
//   /api/geocode?query=주소      → 네이버 클라우드 Maps Geocoding 응답 그대로
//   /api/place?query=장소 이름   → 카카오 로컬 키워드 장소 검색 응답 그대로
//
// Geocoding은 주소만 찾는다. 그래서 주소로 안 잡히는 위치는 이름으로 장소를 검색한다.
// 같은 이름의 장소가 여러 곳일 수 있어 후보를 여러 개 돌려주고, 어느 곳인지는 화면에서 사용자가 고른다.

const MAX_QUERIES = 3; // 위치 글자 하나에 시도할 검색어 수
const MAX_CANDIDATES = 5; // 사용자에게 보여 줄 후보 수

// "교보문고 광화문점, 대한민국 서울특별시 종로구 종로 1" → 전체, 주소 부분, 이름 부분 순서로 시도한다.
// Google 캘린더 자동완성으로 넣은 위치가 "이름, 주소" 형식이라 뒤쪽부터 본다.
const queriesFor = (text) => {
  const parts = text
    .split(',')
    .map((part) => part.replace(/^\s*대한민국\s*/, '').trim())
    .filter(Boolean);
  return [...new Set([text.trim(), ...parts.reverse()])].filter(Boolean).slice(0, MAX_QUERIES);
};

const get = (path, query, fetchFn) => fetchFn(`${path}?${new URLSearchParams({ query })}`, { headers: { Accept: 'application/json' } });

async function geocode(query, fetchFn) {
  const res = await get('/api/geocode', query, fetchFn);
  if (!res.ok) throw new Error(`Geocoding ${res.status}`);
  return ((await res.json()).addresses ?? []).map((hit) => ({
    address: hit.roadAddress || hit.jibunAddress,
    latitude: Number(hit.y),
    longitude: Number(hit.x),
  }));
}

async function searchPlaces(query, fetchFn) {
  const res = await get('/api/place', query, fetchFn);
  if (!res.ok) return []; // 장소 검색 키가 없는 서버에서는 주소로 찾는 단계까지만 동작한다
  return ((await res.json()).documents ?? []).map((hit) => ({
    name: hit.place_name,
    address: hit.road_address_name || hit.address_name,
    latitude: Number(hit.y),
    longitude: Number(hit.x),
  }));
}

// 후보 장소 배열 [{ name, address, latitude, longitude }]. 검색 서비스가 준 순서 그대로이고, 못 찾으면 빈 배열.
// 후보가 둘 이상이면 화면에서 사용자가 고르게 한다. 빈 배열이면 직접 입력받는다.
export async function locateCandidates(text, fetchFn = fetch) {
  const queries = queriesFor(text ?? '');
  for (const query of queries) {
    const hits = await geocode(query, fetchFn);
    if (hits.length) return hits.slice(0, MAX_CANDIDATES).map((hit) => ({ name: queries.at(-1), ...hit }));
  }
  for (const query of queries) {
    const places = await searchPlaces(query, fetchFn);
    if (places.length) return places.slice(0, MAX_CANDIDATES);
  }
  return [];
}

// 첫 번째 후보 하나, 없으면 null. src/map/places.js의 resolvePlace 형식과 같다.
// 같은 이름이 여러 곳이면 엉뚱한 곳일 수 있으니, 사용자가 고를 수 없는 자리에서만 쓴다.
export async function locate(text, fetchFn = fetch) {
  return (await locateCandidates(text, fetchFn))[0] ?? null;
}

// 여러 위치 글자를 한꺼번에 바꾼다. 같은 글자는 한 번만 찾고, 빈 값은 건너뛴다.
// 결과는 Map(위치 글자 → 후보 배열)이라 places.get(event.location)으로 꺼낸다.
// 사용 예: const places = await locateAll(items.map((e) => e.location));
export async function locateAll(texts, fetchFn = fetch) {
  const unique = [...new Set(texts.map((text) => text?.trim()).filter(Boolean))];
  // ponytail: 전부 동시에 요청한다. 일주일 치 일정 수준이면 충분하고, 위치가 수십 곳을 넘으면 동시 요청 수를 제한한다
  const candidates = await Promise.all(unique.map((text) => locateCandidates(text, fetchFn)));
  return new Map(unique.map((text, i) => [text, candidates[i]]));
}

// 좌표들에 마커를 찍은 지도 이미지 주소. <img src>에 그대로 넣는다.
// keyId는 네이버 클라우드 Application의 키 ID(공개돼도 되는 값)이고,
// 그 Application의 Web 서비스 URL에 이 페이지 주소가 등록돼 있어야 이미지가 나온다.
export function staticMapUrl(points, keyId, { width = 600, height = 400 } = {}) {
  const markers = points.map(({ longitude, latitude }) => `markers=${encodeURIComponent(`type:d|size:mid|pos:${longitude} ${latitude}`)}`);
  return `https://maps.apigw.ntruss.com/map-static/v2/raster-cors?w=${width}&h=${height}&${markers.join('&')}&X-NCP-APIGW-API-KEY-ID=${encodeURIComponent(keyId)}`;
}
