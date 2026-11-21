// 일정의 위치 글자(장소 이름 또는 주소) → 도로명 주소와 좌표, 좌표 → 지도 이미지 주소.
//
// 비밀 키가 필요한 호출은 서버가 대신 한다. 브라우저는 아래 두 경로만 부른다(개발용 구현은 dev-server.mjs).
//   /api/geocode?query=주소      → 네이버 클라우드 Maps Geocoding 응답 그대로
//   /api/place?query=장소 이름   → 카카오 로컬 키워드 장소 검색 응답 그대로
//
// Geocoding은 주소만 찾는다. 그래서 주소로 안 잡히는 위치는 이름으로 장소를 검색해 주소와 좌표를 얻는다.

const MAX_QUERIES = 3; // 위치 글자 하나에 시도할 검색어 수

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
  const [hit] = (await res.json()).addresses ?? [];
  return hit ? { address: hit.roadAddress || hit.jibunAddress, lon: Number(hit.x), lat: Number(hit.y) } : null;
}

async function searchPlace(query, fetchFn) {
  const res = await get('/api/place', query, fetchFn);
  if (!res.ok) return null; // 장소 검색 키가 없는 서버에서는 주소로 찾는 단계까지만 동작한다
  const [hit] = (await res.json()).documents ?? [];
  return hit ? { name: hit.place_name, address: hit.road_address_name || hit.address_name, lon: Number(hit.x), lat: Number(hit.y) } : null;
}

// 찾으면 { name, address, lon, lat }, 못 찾으면 null. null이면 화면에서 직접 입력받는다.
// 여러 곳이 검색돼도 첫 결과만 돌려주므로, 화면에서 사용자가 목적지를 확인하게 한다.
export async function locate(text, fetchFn = fetch) {
  const queries = queriesFor(text ?? '');
  for (const query of queries) {
    const hit = await geocode(query, fetchFn);
    if (hit) return { name: queries.at(-1), ...hit };
  }
  for (const query of queries) {
    const place = await searchPlace(query, fetchFn);
    if (place) return place;
  }
  return null;
}

// 좌표들에 마커를 찍은 지도 이미지 주소. <img src>에 그대로 넣는다.
// keyId는 네이버 클라우드 Application의 키 ID(공개돼도 되는 값)이고,
// 그 Application의 Web 서비스 URL에 이 페이지 주소가 등록돼 있어야 이미지가 나온다.
export function staticMapUrl(points, keyId, { width = 600, height = 400 } = {}) {
  const markers = points.map(({ lon, lat }) => `markers=${encodeURIComponent(`type:d|size:mid|pos:${lon} ${lat}`)}`);
  return `https://maps.apigw.ntruss.com/map-static/v2/raster-cors?w=${width}&h=${height}&${markers.join('&')}&X-NCP-APIGW-API-KEY-ID=${encodeURIComponent(keyId)}`;
}
