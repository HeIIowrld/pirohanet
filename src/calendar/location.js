// 일정의 위치 글자(장소 이름 또는 주소) → 후보 장소들의 주소와 좌표, 좌표 → 지도 이미지 주소.
//
// 비밀 키가 필요한 호출은 서버가 대신 한다. 브라우저는 아래 두 경로만 부른다(개발용 구현은 dev-server.mjs).
//   /api/geocode?query=주소      → 네이버 클라우드 Maps Geocoding 응답 그대로
//   /api/place?query=장소 이름   → 카카오 로컬 키워드 장소 검색 응답 그대로
//
// Geocoding은 주소만 찾는다. 그래서 주소로 안 잡히는 위치는 이름으로 장소를 검색한다.
// 같은 이름의 장소가 여러 곳일 수 있어 후보를 여러 개 돌려주고, 어느 곳인지는 화면에서 사용자가 고른다.
//
// "회사", "집"처럼 사용자만 아는 이름은 검색하면 무관한 곳이 나온다. 그래서 사용자가 한 번 알려 준 장소를
// 브라우저에 "내 장소"로 저장해 두고, 위치를 찾을 때 저장된 것부터 본다.
// 내 장소는 사용자의 Google 계정에도 저장해 기기가 바뀌어도 이어 쓴다(파일 아래쪽의 syncMyPlaces, pushMyPlaces).

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

const STORE_KEY = 'pirohanet.myPlaces';
const PENDING_KEY = 'pirohanet.myPlaces.pending'; // 이 브라우저에서 바꾸고 아직 계정에 올리지 못한 글자(기억·삭제)의 키 목록
// 검색하지 않고 사용자에게 물어야 하는 이름. 여기 없는 별명은 사용자가 후보를 고쳐 저장하면 그 뒤로 맞게 나온다.
const PERSONAL_LABELS = new Set(['회사', '직장', '사무실', '오피스', '집', '우리집', '우리 집', '본가', '자취방', '기숙사', '학교', '학원', '헬스장', 'home', 'work', 'office', 'school']);

const keyOf = (text) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// ponytail: 한 브라우저를 여러 Google 계정이 번갈아 쓰면 이 저장소의 내 장소가 섞인다. 계정별로 나누려면 저장 키에 계정을 넣는다
const defaultStore = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 저장소 접근이 막힌 브라우저
  }
};

const readSaved = (store) => {
  try {
    const all = JSON.parse(store?.getItem(STORE_KEY) ?? '{}');
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {}; // 저장소가 막혔거나 값이 깨졌으면 저장된 것이 없는 것으로 본다
  }
};

const validPlace = (place) => Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude);

const writeSaved = (all, store) => {
  try {
    store?.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // 저장이 막힌 브라우저에서는 기억하지 못할 뿐, 위치 찾기는 계속 동작한다
  }
};

const readPending = (store) => {
  try {
    const keys = JSON.parse(store?.getItem(PENDING_KEY) ?? '[]');
    return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
};

const writePending = (keys, store) => {
  try {
    store?.setItem(PENDING_KEY, JSON.stringify(keys));
  } catch {
    // 저장이 막힌 브라우저
  }
};

export const isPersonalLabel = (text) => PERSONAL_LABELS.has(keyOf(text));

// 두 위치 글자가 같은 내 장소를 가리키는지 비교할 때 쓰는 키(앞뒤 공백 제거, 공백 정리, 소문자).
export const placeKey = keyOf;

// 저장된 내 장소 전체 { 위치 글자: 장소 }. 계정과 맞출 때 쓴다.
export const exportSavedPlaces = (store = defaultStore()) => readSaved(store);

// 내 장소 전체를 바꿔 넣는다. 좌표가 없는 항목은 버린다.
export function importSavedPlaces(places, store = defaultStore()) {
  writeSaved(Object.fromEntries(Object.entries(places ?? {}).filter(([, place]) => validPlace(place))), store);
}

// 이 위치 글자로 저장해 둔 내 장소. 없으면 null.
export function savedPlace(text, store = defaultStore()) {
  const place = readSaved(store)[keyOf(text)];
  return validPlace(place) ? place : null;
}

// 위치 글자를 이 장소로 기억한다. place가 null이면 기억을 지운다.
export function savePlace(text, place, store = defaultStore()) {
  const key = keyOf(text);
  if (!key) return;
  const all = readSaved(store);
  if (place) all[key] = { name: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude };
  else delete all[key];
  writeSaved(all, store);
  // 계정에 올릴 때까지 기록해 둔다. 그래야 다음에 계정과 맞출 때 계정의 옛 값으로 되돌아가지 않는다.
  writePending([...new Set([...readPending(store), key])], store);
}

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

export async function searchPlaces(query, fetchFn = fetch) {
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
// 내 장소로 저장된 글자는 검색하지 않고 그 장소 하나만 돌려준다.
export async function locateCandidates(text, fetchFn = fetch, store = defaultStore()) {
  const saved = savedPlace(text, store);
  if (saved) return [saved];
  if (isPersonalLabel(text)) return []; // 검색하면 무관한 곳이 나온다. 화면에서 어디인지 묻고 savePlace로 저장한다
  return searchPlaceCandidates(text, fetchFn);
}

export async function searchPlaceCandidates(text, fetchFn = fetch) {
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
export async function locate(text, fetchFn = fetch, store = defaultStore()) {
  return (await locateCandidates(text, fetchFn, store))[0] ?? null;
}

// 여러 위치 글자를 한꺼번에 바꾼다. 같은 글자는 한 번만 찾고, 빈 값은 건너뛴다.
// 결과는 Map(위치 글자 → 후보 배열)이라 places.get(event.location)으로 꺼낸다.
// 사용 예: const places = await locateAll(items.map((e) => e.location));
export async function locateAll(texts, fetchFn = fetch, store = defaultStore()) {
  const unique = [...new Set(texts.map((text) => text?.trim()).filter(Boolean))];
  // ponytail: 전부 동시에 요청한다. 일주일 치 일정 수준이면 충분하고, 위치가 수십 곳을 넘으면 동시 요청 수를 제한한다
  const candidates = await Promise.all(unique.map((text) => locateCandidates(text, fetchFn, store)));
  return new Map(unique.map((text, i) => [text, candidates[i]]));
}

// 좌표들에 마커를 찍은 지도 이미지 주소. <img src>에 그대로 넣는다.
// keyId는 네이버 클라우드 Application의 키 ID(공개돼도 되는 값)이고,
// 그 Application의 Web 서비스 URL에 이 페이지 주소가 등록돼 있어야 이미지가 나온다.
export function staticMapUrl(points, keyId, { width = 600, height = 400 } = {}) {
  const markers = points.map(({ longitude, latitude }) => `markers=${encodeURIComponent(`type:d|size:mid|pos:${longitude} ${latitude}`)}`);
  return `https://maps.apigw.ntruss.com/map-static/v2/raster-cors?w=${width}&h=${height}&${markers.join('&')}&X-NCP-APIGW-API-KEY-ID=${encodeURIComponent(keyId)}`;
}

// ---- 내 장소를 Google 계정에 저장 ----
// 저장 위치는 Google Drive의 앱 전용 숨김 폴더(appDataFolder)다. 이 앱만 읽고 쓸 수 있고 사용자의 Drive 화면에는 보이지 않는다.
// 필요한 것: 로그인 때 drive.appdata 권한(calendar.js의 requestGoogleToken이 함께 요청한다)과,
// Google Cloud 프로젝트에서 Google Drive API 사용 설정.
// 시연 서버가 정해 둔 파일만 내보내서, 따로 파일을 만들지 않고 여기에 둔다.

const FILE_NAME = 'my-places.json';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

async function call(token, url, init, fetchFn) {
  const res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  if (!res.ok) {
    // 403은 원인이 여럿이라(Drive API 미사용 설정, 권한 미동의) Google이 준 사유를 함께 남긴다
    const detail = (await res.json?.().catch(() => null))?.error;
    const reason = detail?.errors?.[0]?.reason ?? detail?.status ?? '';
    throw new Error(`Drive ${res.status}${reason ? ` ${reason}` : ''}`);
  }
  return res;
}

async function findFileId(token, fetchFn) {
  const params = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${FILE_NAME}'`, fields: 'files(id)', pageSize: '1' });
  const { files = [] } = await (await call(token, `${FILES}?${params}`, undefined, fetchFn)).json();
  return files[0]?.id ?? null;
}

async function upload(token, fileId, places, fetchFn) {
  const body = JSON.stringify(places);
  if (fileId) {
    return call(token, `${UPLOAD}/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, fetchFn);
  }
  const boundary = 'pirohanet_my_places';
  const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  return call(
    token,
    `${UPLOAD}?uploadType=multipart`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`,
    },
    fetchFn,
  );
}

// 계정에 저장된 내 장소를 받아 이 브라우저의 것과 합치고, 달라졌으면 계정에 다시 저장한다. 합친 내 장소 { 위치 글자: 장소 }를 돌려준다.
// 같은 글자가 양쪽에 있으면 계정 쪽을 따른다. 단, 이 브라우저에서 바꾸고 아직 계정에 올리지 못한 글자(삭제 포함)는 이 브라우저 쪽을 따른다.
// 계정의 파일을 통째로 덮어쓰는 일은 없다. 그래서 맞추지 못한 상태에서 불러도 계정에만 있는 장소가 지워지지 않는다.
export async function syncMyPlaces(token, fetchFn = fetch, store = defaultStore()) {
  const fileId = await findFileId(token, fetchFn);
  const remote = fileId ? await (await call(token, `${FILES}/${fileId}?alt=media`, undefined, fetchFn)).json() : {};
  const local = readSaved(store);
  const pending = readPending(store);
  const all = { ...local, ...remote };
  for (const key of pending) {
    if (key in local) all[key] = local[key];
    else delete all[key];
  }
  // 저장소에서 다시 읽지 않고 합친 값을 그대로 올린다. 저장이 막힌 브라우저에서 다시 읽으면 빈 목록이 계정을 덮어쓴다.
  const merged = Object.fromEntries(Object.entries(all).filter(([, place]) => validPlace(place)));
  writeSaved(merged, store);
  if (JSON.stringify(merged) !== JSON.stringify(remote)) await upload(token, fileId, merged, fetchFn);
  // 올리는 동안 같은 글자를 또 바꿨으면 그 변경은 아직 올라가지 않았으니 남겨 둔다.
  const uploaded = new Map(pending.map((key) => [key, JSON.stringify(merged[key] ?? null)]));
  const now = readSaved(store);
  writePending(readPending(store).filter((key) => !uploaded.has(key) || JSON.stringify(now[key] ?? null) !== uploaded.get(key)), store);
  return merged;
}

// 내 장소를 기억하거나 지운 직후에 부른다. 방금 바꾼 것을 계정에 반영한다(syncMyPlaces와 같은 합치기).
export async function pushMyPlaces(token, fetchFn = fetch, store = defaultStore()) {
  await syncMyPlaces(token, fetchFn, store);
}
