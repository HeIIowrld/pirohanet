import { demo } from '../public/scenario.js';
import { isKoreanPoint, naverSearch, nearbyPlaces } from './naver.js';

const minute = 60_000;
const stay = 5;
const arrivalBuffer = 5;
const HEIGIT = 'https://api.heigit.org';
const seoulDemoQueries = new Map([
  ['서울시청', 'Seoul City Hall'],
  ['서울특별시 중구 서울시청', 'Seoul City Hall'],
  ['광화문역', '광화문역'],
  ['서울특별시 종로구 광화문역', '광화문역'],
  ['교보문고 광화문점', '교보문고']
]);
const demoLines = {
  fast: [[126.97805,37.56657],[126.97820,37.56727],[126.97787,37.56805],[126.97754,37.56888],[126.97727,37.56986],[126.97691,37.57087],[126.97788,37.57096]],
  easy: [[126.97805,37.56657],[126.97781,37.56725],[126.97756,37.56868],[126.97730,37.56961],[126.97788,37.57096]],
  history: [[126.97805,37.56657],[126.97685,37.56620],[126.97515,37.56595],[126.97360,37.56410],[126.97434,37.56656],[126.97650,37.56900],[126.97788,37.57096]],
  coffee: [[126.97805,37.56657],[126.97707,37.56638],[126.97592,37.56609],[126.97492,37.56627],[126.97537,37.56743],[126.97519,37.56844],[126.97650,37.56900],[126.97727,37.56986],[126.97788,37.57096]],
  culture: [[126.97805,37.56657],[126.97701,37.56644],[126.97615,37.56678],[126.97510,37.56830],[126.97310,37.56950],[126.97204,37.57047],[126.97452,37.57072],[126.97788,37.57096]]
};

export class RouteError extends Error {
  constructor(status, message, choices) {
    super(message);
    this.status = status;
    this.choices = choices;
  }
}

function input(raw) {
  if (!raw || typeof raw !== 'object') throw new RouteError(400, '경로 조건을 입력해 주세요.');
  const { mode, fatigue, allowance } = raw;
  const origin = typeof raw.origin === 'string' ? raw.origin.trim() : '';
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
  const departAt = date(raw.departAt);
  const arriveBy = date(raw.arriveBy);
  if (!['demo', 'live'].includes(mode) || !['tired', 'normal', 'relaxed'].includes(fatigue) ||
      !Number.isInteger(allowance) || allowance < 0 || allowance > 30 ||
      !origin || !destination || origin.length > 100 || destination.length > 100 ||
      !Number.isFinite(departAt) || !Number.isFinite(arriveBy) || arriveBy < departAt) {
    throw new RouteError(400, '장소, 도착 희망 일시와 이동 조건을 다시 확인해 주세요.');
  }
  if (mode === 'demo' && (origin !== demo.origin || destination !== demo.destination)) {
    throw new RouteError(400, '다른 장소를 입력하려면 실제 경로로 전환해 주세요.');
  }
  const places = [];
  for (const place of Array.isArray(raw.places) ? raw.places.slice(0, 3) : []) {
    if (typeof place?.name !== 'string' || !place.name.trim() || place.name.length > 100) continue;
    const name = place.name.trim();
    if (places.some(existing => existing.name === name)) continue;
    const category = ['카페', '서점', '전시', '기타'].includes(place.category) ? place.category : '기타';
    places.push({ name, category });
  }
  const calendar = raw.calendar === true;
  const locations = {};
  if (calendar) for (const field of ['origin', 'destination']) {
    const place = raw.locations?.[field];
    if (isKoreanPoint(place?.coordinate) && typeof place.address === 'string') {
      locations[field] = { coordinate: place.coordinate, address: place.address.slice(0, 100) };
    }
  }
  return { mode, fatigue, allowance, origin, destination, departAt, arriveBy, places, calendar, locations, includeStops: raw.includeStops !== false };
}

function fixture(id, walk, distance, place, stopIndex) {
  return { id, walk, distance, coordinates: demoLines[id], place: place ? { ...place, coordinate: demoLines[id][stopIndex] } : null };
}

function sampleRoutes(request) {
  const saved = place => request.places.some(item => item.name === place.name);
  const candidates = [
    fixture('history', 22, 1420, demo.places[0], 3),
    fixture('coffee', 20, 1380, demo.places[1], 3),
    fixture('culture', 23, 1570, demo.places[2], 5)
  ];
  const detours = candidates.map(route => ({ ...route, saved: saved(route.place) }));
  return [fixture('fast', 16, 1050), fixture('easy', 17, 920), ...detours];
}

async function json(url, options, timeout = 8000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('Upstream request failed');
  return response.json();
}

const validPoint = point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite);

function normalizeName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
}

const streetNumber = /(\S+(?:로|길))\s+(\d+(?:-\d+)?)(?=$|[\s,])/u;

function calendarLocation(text) {
  const parts = text.split(',').map(part => part.replace(/^\s*대한민국\s*/u, '').trim()).filter(Boolean);
  const address = parts.slice(1).findLast(part => streetNumber.test(part));
  if (address) return { address, name: parts[0] };
  return { name: parts.length === 1 ? parts[0] : text };
}

async function locate(query, key, requireMatch = false) {
  const alias = seoulDemoQueries.get(query);
  const text = alias ?? query;
  const params = new URLSearchParams({ text, 'boundary.country': 'KR', size: alias || requireMatch ? '5' : '1' });
  if (alias) {
    params.set('boundary.circle.lon', '126.978');
    params.set('boundary.circle.lat', '37.569');
    params.set('boundary.circle.radius', '2');
  }
  const result = await json(`${HEIGIT}/pelias/v1/search?${params}`, { headers: { Authorization: key } });
  const search = normalizeName(text);
  const requestedAddress = text.match(streetNumber);
  const feature = alias || requireMatch
    ? result.features?.find(item => {
      const { name, label, layer, street, housenumber } = item.properties ?? {};
      if (requestedAddress && layer === 'address') {
        const candidate = (label ?? name ?? '').match(streetNumber);
        const sameStreet = normalizeName(street ?? candidate?.[1]) === normalizeName(requestedAddress[1]);
        if (sameStreet && String(housenumber ?? candidate?.[2]) === requestedAddress[2]) return true;
      }
      return search && (normalizeName(name).includes(search) || normalizeName(label).includes(search));
    })
    : result.features?.[0];
  const coordinate = feature?.geometry?.coordinates;
  if (!validPoint(coordinate)) throw new RouteError(422, `‘${query}’의 위치를 찾지 못했어요. 지역명이나 주소를 함께 입력해 주세요.`);
  const { label, region, county, locality, borough } = feature.properties ?? {};
  const address = [region, borough || county || locality].filter(Boolean).join(' ') || label || query;
  return { coordinate: coordinate.slice(0, 2), address };
}

async function resolveEndpoint(field, request, key, search) {
  if (request.locations[field]) return request.locations[field];
  const query = request[field];
  if (!request.calendar) return locate(query, key);
  const { name, address } = calendarLocation(query);
  if (address) {
    const byAddress = await locate(address, key, true).catch(() => null);
    if (byAddress) return { ...byAddress, address };
  }
  if (search) {
    const results = await search(name).catch(() => []);
    const normalized = normalizeName(name);
    const unique = results.filter((place, index) => results.findIndex(item =>
      item.name === place.name && item.address === place.address) === index);
    const exact = unique.filter(place => [place.name, place.address].some(value => normalizeName(value) === normalized));
    const matching = exact.length ? exact : unique.filter(place => normalizeName(place.name).includes(normalized));
    const byAddress = address && matching.find(place => normalizeName(place.address) === normalizeName(address));
    if (byAddress) return byAddress;
    if (!address && matching.length === 1) return matching[0];
    if (unique.length) throw new RouteError(409, '검색 결과에서 장소를 확인해 주세요.', {
      field, places: matching.length ? matching : unique
    });
  }
  return locate(name, key, Boolean(address));
}

async function directions(id, coordinates, preference, key, place = null) {
  const result = await json(`${HEIGIT}/openrouteservice/v2/directions/foot-walking/geojson`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates, preference, instructions: false })
  });
  const feature = result.features?.[0];
  const geometry = feature?.geometry?.coordinates;
  const { distance, duration } = feature?.properties?.summary ?? {};
  if (!Array.isArray(geometry) || geometry.length < 2 || !geometry.every(validPoint) ||
      !Number.isFinite(distance) || !Number.isFinite(duration) || distance < 0 || duration < 0) {
    throw new Error('Invalid route geometry');
  }
  return { id, coordinates: geometry, distance: Math.round(distance), walk: Math.ceil(duration / 60), place, saved: Boolean(place) };
}

async function liveRoutes(request, env) {
  const key = env.ORS_API_KEY;
  if (!key) throw new RouteError(503, '실제 경로에 필요한 지도 API 키가 아직 설정되지 않았어요. 광화문 샘플은 바로 사용할 수 있어요.');
  const search = naverSearch(env);
  try {
    const [origin, destination] = await Promise.all([
      resolveEndpoint('origin', request, key, search), resolveEndpoint('destination', request, key, search)
    ]);
    const start = origin.coordinate;
    const end = destination.coordinate;
    if (start.every((value, index) => value === end[index])) throw new RouteError(422, '출발지와 목적지를 서로 다르게 입력해 주세요.');
    const direct = await directions('fast', [start, end], 'fastest', key);
    const shortest = directions('easy', [start, end], 'shortest', key).catch(() => null);
    const open = request.includeStops && request.fatigue !== 'tired' && request.allowance >= stay &&
      direct.walk + stay + arrivalBuffer <= (request.arriveBy - request.departAt) / minute;
    const nearby = request.calendar && open
      ? await (search ? nearbyPlaces(search, origin, end) : { places: [], unavailable: true })
      : { places: [], unavailable: false };
    const candidates = [...request.places, ...nearby.places.filter(place =>
      !request.places.some(saved => saved.name === place.name))];
    const stops = request.includeStops && (!request.calendar || open) && request.fatigue !== 'tired' && request.allowance >= stay
      ? candidates.map(async (place, index) => {
        const coordinate = place.coordinate ?? (await locate(place.name, key, true)).coordinate;
        if ([start, end].some(point => point.every((value, i) => value === coordinate[i]))) return null;
        const { name, category, address } = place;
        const route = await directions(`stop-${index + 1}`, [start, coordinate, end], 'recommended', key,
          { name, category, address, coordinate });
        return { ...route, saved: index < request.places.length };
      }) : [];
    const [easy, results] = await Promise.all([shortest, Promise.allSettled(stops)]);
    const failedStops = results.filter(result => result.status === 'rejected').length;
    return { routes: [direct, easy, ...results.map(result => result.value)].filter(Boolean), failedStops, nearbyUnavailable: nearby.unavailable };
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(502, '지도 서비스에서 경로를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

function metrics(route, baseline, request) {
  const minutes = route.walk + (route.place ? stay : 0);
  const eta = request.departAt + minutes * minute;
  return {
    ...route, minutes, extra: minutes - baseline.walk, stay: route.place ? stay : 0,
    ...(route.place && request.calendar && {
      extraWalk: Math.max(0, route.walk - baseline.walk),
      maxStay: Math.min(Math.floor((request.arriveBy - request.departAt) / minute) - route.walk - arrivalBuffer,
        request.allowance - (route.walk - baseline.walk))
    }),
    eta: new Date(eta).toISOString(),
    late: Math.max(0, Math.ceil((eta - request.arriveBy) / minute))
  };
}

function choose(baseline, eligible, fatigue) {
  const easy = eligible.find(route => route.id === 'easy');
  if (fatigue === 'tired') return easy ?? baseline;
  const detours = eligible.filter(route => route.place);
  detours.sort((a, b) => Number(b.saved) - Number(a.saved) || a.extra - b.extra || a.distance - b.distance);
  return detours[0] ?? easy ?? baseline;
}

function ruleReason(route, baseline, fatigue) {
  if (route.id === 'easy') return `일반 경로보다 도보 거리가 ${baseline.distance - route.distance}m 짧아요.`;
  if (route.place) return `${route.saved ? '저장한 ' : ''}${route.place.name}에 ${stay}분 머물고도 시간 안에 도착할 수 있어요.`;
  if (route.late) return `현재 출발하면 희망 시각보다 약 ${route.late}분 늦어요.`;
  if (fatigue === 'tired') return '경유 없이 도착할 수 있고, 조건을 만족하는 더 짧은 도보 경로가 없어요.';
  return '시간과 추가 이동 조건을 고려하면 바로 걷는 경로가 맞아요.';
}

async function aiChoice(candidates, request, env) {
  const { AI_BASE_URL: base, AI_API_KEY: key, AI_DEFAULT_MODEL: model } = env;
  if (!base || !key || !model || candidates.length < 2) return null;
  const available = candidates.map(({ id, minutes, distance, extra, place, saved }) => ({
    id, minutes, distance, extra, category: place?.category ?? null, saved: Boolean(saved)
  }));
  const endpoint = new URL(base);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) return null;
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + '/chat/completions';
  const response = await json(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '도보 경로 추천 도우미. 주어진 후보 중 하나만 고른다. tired는 도보 거리가 짧은 경로, relaxed는 여유가 있는 경유, normal은 저장한 장소가 있는 합리적인 짧은 경유를 우선한다. 후보 데이터에서 확인 가능한 근거만 한국어 한 문장에 쓴다. JSON 객체로만 답한다. 형식 {"id":"후보 ID","reason":"추천 이유"}' },
        { role: 'user', content: JSON.stringify({ fatigue: request.fatigue, candidates: available }) }
      ]
    })
  });
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const answer = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
  const route = candidates.find(candidate => candidate.id === answer?.id);
  const reason = typeof answer?.reason === 'string' ? answer.reason.trim() : '';
  return route && reason && reason.length <= 150 ? { route, reason } : null;
}

export async function recommend(raw, env = process.env) {
  const request = input(raw);
  const result = request.mode === 'demo' ? { routes: sampleRoutes(request), failedStops: 0 } : await liveRoutes(request, env);
  const [direct, ...others] = result.routes;
  const baseline = metrics(direct, direct, request);
  const directCandidates = result.routes.filter(route => !route.place).map(route => metrics(route, direct, request));
  const eligible = others.filter(route => request.includeStops || !route.place).map(route => metrics(route, direct, request)).filter(route =>
    !route.late && route.extra <= request.allowance &&
    (route.place ? request.fatigue !== 'tired' && (!request.calendar || route.maxStay >= stay) : route.distance < baseline.distance));
  const rule = choose(baseline, eligible, request.fatigue);
  const candidates = [baseline, ...eligible].filter(route => !route.late &&
    (request.fatigue !== 'tired' || route.distance === rule.distance));
  const ai = await aiChoice(candidates, request, env).catch(() => null);
  const selected = ai?.route ?? rule;
  return {
    mode: request.mode,
    method: ai ? 'ai' : 'rules',
    baseline,
    direct: directCandidates,
    recommended: selected,
    ...(request.calendar && {
      stops: eligible.filter(route => route.place).sort((a, b) => a.extra - b.extra),
      nearbyUnavailable: Boolean(result.nearbyUnavailable)
    }),
    reason: ai?.reason ?? ruleReason(selected, baseline, request.fatigue),
    failedStops: result.failedStops
  };
}
