import { demo, sampleEvents } from './scenario.js';
import { createMap } from './map.js';
import { FATIGUE_LABELS, fetchCalendarEvents, requestCalendarToken, summarize } from './calendar.js';

const byId = id => document.getElementById(id);
const form = byId('route-form');
const fields = form.elements;
const cards = byId('cards');
const source = byId('source');
const status = byId('status');
const credit = byId('map-credit');
const submit = byId('submit');
const dialog = byId('place-dialog');
const placeForm = byId('place-form');
const routeOptions = byId('route-options');
const stops = byId('stops');
const transitCards = byId('transit-routes');
const transportButtons = document.querySelectorAll('[data-transport]');
const useLocation = byId('use-location');
const locationChoices = byId('location-choices');
const lookupButtons = document.querySelectorAll('[data-lookup]');
const typedFields = new Set();
const map = createMap(byId('map'));
const storageKey = 'today-route:places';
const timeZone = 'Asia/Seoul';
const clock = new Intl.DateTimeFormat('ko-KR', { timeZone, hour: 'numeric', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat('ko-KR', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
const fieldDate = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' });
const selected = { demo: new Set(), live: new Set() };
let mode;
let pending;
let saved = [];
let credentials;
let calendarEvents;
let loadingCalendar = false;
let lastSync = 0;
let appointment;
let appointmentKey;
let confirmOrigin = false;
let routeEdited = false;
let fatigueEdited = false;
let locations = {};
let calculatedAt = 0;
let currentPosition;
let locationRequest = 0;
let transport = 'all';
let shownResult;
let walkingSelection;
let placeLookup;
let landmarkDirectory;
let nearbyLandmarks;
let landmarkOrigin;
let landmarkRequest;
let landmarkExpanded = false;
let landmarkError = false;
try {
  const initial = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
  if (Array.isArray(initial)) saved = initial.filter(place =>
    typeof place?.id === 'string' && typeof place.name === 'string' && typeof place.category === 'string');
} catch {
  // A fresh session still supports in-memory place selection.
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function localTime(value) {
  return fieldDate.format(new Date(value)).replace(' ', 'T');
}

const placeMode = () => mode === 'demo' ? 'demo' : 'live';
const hasCalendar = () => mode !== 'live';

function setStatus(message = '', error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function displayedPlaces() {
  return mode === 'demo' ? demo.places : saved;
}

function renderPlaces() {
  const area = byId('places');
  const places = displayedPlaces();
  area.replaceChildren();
  for (const place of places) {
    const label = node('label', 'place-chip');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected[placeMode()].has(place.id);
    checkbox.addEventListener('change', () => {
      const active = selected[placeMode()];
      if (checkbox.checked && active.size >= 3) {
        checkbox.checked = false;
        setStatus('한 번에 관심 장소 3곳까지 비교할 수 있어요.');
        return;
      }
      if (checkbox.checked) active.add(place.id);
      else active.delete(place.id);
      invalidateRoute();
    });
    label.append(checkbox, node('span', '', place.name));
    area.append(label);
  }
  if (!places.length) area.append(node('p', '', '이 동선에 들르고 싶은 장소를 추가해 보세요.'));
}

function clearResult() {
  shownResult = undefined;
  walkingSelection = undefined;
  cards.replaceChildren();
  stops.replaceChildren();
  transitCards.replaceChildren();
  byId('transit-options').hidden = true;
  byId('transit-legend').hidden = true;
  byId('walking-legend').hidden = false;
  byId('stop-options').hidden = true;
  byId('reason').hidden = true;
  byId('map').setAttribute('aria-label', '출발지, 목적지와 도보 경로를 표시하는 지도');
  credit.textContent = hasCalendar() ? '서울 도심 예시 지도' : '실제 도보 경로';
  map.clear(mode === 'live' ? 'live' : 'demo');
  renderTransport();
}

function switchMode(next) {
  if (next === mode) return;
  pending?.abort();
  pending = null;
  submit.disabled = false;
  mode = next;
  resetLookup();
  typedFields.clear();
  resetLandmarks();
  for (const button of lookupButtons) button.hidden = mode === 'demo';
  locationRequest += 1;
  useLocation.disabled = false;
  byId('origin-actions').hidden = mode !== 'live';
  byId('location-status').textContent = '';
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === (hasCalendar() ? 'calendar' : 'live')));
  }
  byId('calendar-panel').hidden = !hasCalendar();
  byId('appointment').hidden = true;
  byId('title').textContent = hasCalendar() ? '다음 약속까지 가는 길' : '가는 길 찾기';
  byId('intro-text').textContent = hasCalendar() ? 'Google 캘린더를 연결하면 다음 목적지와 가는 길을 보여드려요.' :
    '출발지와 목적지를 입력하고 들를 곳을 찾아보세요.';
  routeOptions.hidden = hasCalendar();
  routeOptions.open = !hasCalendar();
  appointmentKey = undefined;
  appointment = undefined;
  routeEdited = false;
  fatigueEdited = false;
  calculatedAt = 0;
  locations = {};
  locationChoices.hidden = true;
  fields.origin.value = '';
  fields.destination.value = '';
  fields.origin.readOnly = mode === 'demo';
  fields.destination.readOnly = mode === 'demo';
  fields.arrive.readOnly = mode === 'demo';
  fields.origin.placeholder = '예. 서울시청';
  if (mode === 'live' && currentPosition) applyCurrentPosition();
  fields.destination.placeholder = '예. 교보문고 광화문점';
  fields.arrive.value = localTime(Date.now() + 60 * 60_000);
  fields.fatigue.value = hasCalendar() ? '' : 'relaxed';
  byId('fatigue-note').textContent = '';
  byId('route-fatigue').textContent = '';
  byId('departure').textContent = '지금 출발하는 경로를 비교합니다.';
  byId('trip-label').textContent = hasCalendar() ? '다음 약속 경로를 여기에 표시해요.' : '출발지와 목적지를 입력해 주세요.';
  source.hidden = mode === 'calendar' && !calendarEvents;
  source.textContent = mode === 'demo' ? '광화문 샘플' : '실제 경로';
  clearResult();
  renderPlaces();
  setStatus();
  if (mode === 'demo') showAppointment(sampleEvents, Date.parse(demo.departAt));
  if (mode === 'calendar' && calendarEvents) showAppointment(calendarEvents);
  updateCalendarActions();
}

function calendarStatus(message = '', error = false) {
  const element = byId('calendar-status');
  element.textContent = message;
  element.dataset.error = String(error);
}

function updateCalendarActions() {
  const connect = byId('connect-calendar');
  connect.disabled = loadingCalendar;
  connect.textContent = loadingCalendar ? '일정 불러오는 중…' :
    credentials ? 'Google 일정 새로고침' : 'Google 캘린더 연결';
  byId('show-sample').hidden = mode === 'demo';
  const disconnect = byId('disconnect-calendar');
  disconnect.hidden = !credentials && !calendarEvents;
  disconnect.disabled = loadingCalendar;
}

function showAppointment(events, now = Date.now()) {
  const summary = summarize(events, now);
  const { next, origin, needsConfirmation, fatigue } = summary;
  const key = JSON.stringify([next, origin, needsConfirmation]);
  const canUpdate = !routeEdited && !pending && !confirmOrigin && locationChoices.hidden;
  appointment = summary;
  if (appointmentKey === key) {
    if (mode === 'calendar' && canUpdate && !routeOptions.open && calculatedAt && now - calculatedAt >= 5 * 60_000) compare(false);
    return;
  }
  appointmentKey = key;
  resetLookup();
  typedFields.clear();
  resetLandmarks();
  pending?.abort();
  pending = null;
  submit.disabled = false;
  locations = {};
  locationChoices.hidden = true;
  calculatedAt = 0;
  clearResult();
  setStatus();
  source.hidden = false;
  routeOptions.hidden = !next;
  byId('appointment').hidden = !next;
  byId('origin-actions').hidden = mode === 'demo' || !next;
  if (!next) {
    routeOptions.open = false;
    byId('trip-label').textContent = '가져온 기간에 예정된 일정이 없어요.';
    return;
  }
  const time = byId('appointment-time');
  time.dateTime = new Date(next.start).toISOString();
  time.textContent = fullDate.format(next.start);
  byId('appointment-title').textContent = next.title;
  byId('appointment-location').textContent = next.location || '장소가 비어 있는 일정이에요.';
  fields.origin.value = origin?.location ?? '';
  const livePosition = mode === 'calendar' && currentPosition;
  if (livePosition) applyCurrentPosition();
  fields.destination.value = next.location;
  fields.arrive.value = localTime(next.start);
  fields.fatigue.value = fatigue?.value ?? '';
  byId('fatigue-note').textContent = fatigue
    ? `캘린더 제안 · ${fatigue.reasons.join(' · ')}`
    : '컨디션을 선택할 수 있어요.';
  byId('departure').textContent = mode === 'demo' ? `샘플 시각 · ${fullDate.format(now)}` :
    summary.departAt > now ? `진행 중인 일정이 끝나는 ${clock.format(summary.departAt)}부터 출발할 수 있어요.` :
      '지금 출발하는 경로를 비교합니다.';
  byId('origin-note').textContent = livePosition ? '현재 위치에서 출발해요.' : origin
    ? needsConfirmation ? `직전 일정에 장소가 없어요. ${origin.location}에서 출발하시겠어요?` :
      `직전 일정 장소 기준 · ${origin.location}`
    : '출발지로 사용할 일정 장소가 없어요. 출발지를 입력해 주세요.';
  confirmOrigin = !livePosition && needsConfirmation;
  byId('confirm-origin').hidden = !confirmOrigin || !next.location;
  routeEdited = false;
  fatigueEdited = false;
  showRouteFatigue(summary.projectedFatigue);
  routeOptions.open = !fields.origin.value || !next.location;
  byId('trip-label').textContent = fields.origin.value && next.location
    ? `${fields.origin.value} → ${next.location}` : '출발지와 목적지를 확인해 주세요.';
  if (fields.origin.value && next.location && !confirmOrigin) compare(false);
}

function applyCurrentPosition() {
  fields.origin.value = '현재 위치';
  locations.origin = { coordinate: currentPosition };
  loadNearbyLandmarks(currentPosition);
}

function getCurrentPosition() {
  const notice = byId('location-status');
  const fail = message => {
    useLocation.disabled = false;
    notice.textContent = message;
    notice.dataset.error = 'true';
    routeOptions.open = true;
  };
  if (!navigator.geolocation || !isSecureContext) {
    fail('이 환경에서 위치를 가져올 수 없어요. 출발지를 직접 입력해 주세요.');
    return;
  }
  const request = ++locationRequest;
  useLocation.disabled = true;
  notice.textContent = '현재 위치를 확인하고 있어요…';
  notice.dataset.error = 'false';
  navigator.geolocation.getCurrentPosition(position => {
    if (request !== locationRequest) return;
    const { longitude, latitude } = position.coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        longitude < 124 || longitude > 132 || latitude < 32 || latitude > 39) {
      fail('현재 위치에서 경로를 조회할 수 없어요. 출발지를 직접 입력해 주세요.');
      return;
    }
    currentPosition = [longitude, latitude].map(value => Number(value.toFixed(5)));
    resetLookup();
    applyCurrentPosition();
    useLocation.disabled = false;
    notice.textContent = '출발지를 현재 위치로 바꿨어요.';
    routeEdited = true;
    confirmOrigin = false;
    byId('confirm-origin').hidden = true;
    if (appointment?.next) byId('origin-note').textContent = '현재 위치에서 출발해요.';
    if (fields.destination.value.trim()) startCompare(false);
    else {
      invalidateRoute();
      routeOptions.open = true;
      fields.destination.focus();
    }
  }, error => {
    if (request !== locationRequest) return;
    fail(error.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저에서 허용하거나 출발지를 직접 입력해 주세요.' :
      '위치를 확인하지 못했어요. 다시 시도하거나 출발지를 직접 입력해 주세요.');
  }, { maximumAge: 30_000, timeout: 12_000, enableHighAccuracy: false });
}

async function syncCalendar(connect = false) {
  if (loadingCalendar) return;
  if (connect && mode !== 'calendar') switchMode('calendar');
  if (!connect && mode !== 'calendar') return;
  loadingCalendar = true;
  updateCalendarActions();
  try {
    if (!credentials || credentials.expiresAt <= Date.now()) {
      if (!connect) {
        if (credentials) {
          credentials = undefined;
          calendarStatus('Google 연결 시간이 끝났어요. 다시 연결하면 최신 일정을 가져와요.');
        }
        return;
      }
      credentials = await requestCalendarToken();
    }
    const events = await fetchCalendarEvents(credentials.accessToken);
    if (!events) {
      credentials = undefined;
      calendarStatus('Google 연결 시간이 끝났어요. 다시 연결해 주세요.', true);
      return;
    }
    calendarEvents = events;
    lastSync = Date.now();
    if (mode === 'calendar') {
      calendarStatus();
      showAppointment(calendarEvents);
    }
  } catch (error) {
    calendarStatus(error.message || 'Google 캘린더를 불러오지 못했어요.', true);
  } finally {
    loadingCalendar = false;
    updateCalendarActions();
  }
}

function routeCard(route, type, active, recommended) {
  const button = node('button', 'route-card');
  button.type = 'button';
  button.dataset.route = type;
  button.setAttribute('aria-pressed', String(active));
  const title = node('span', 'card-title');
  const titleText = type === 'baseline' ? (hasCalendar() ? '바로 걷는 길' : '일반 도보 경로') :
    route.place ? route.place.name : '짧게 걷는 경로';
  title.append(node('span', '', titleText));
  if (recommended) title.append(node('span', 'card-state', '추천'));
  const extra = route.extra === 0 ? '' : ` · ${route.extra > 0 ? '+' : ''}${route.extra}분`;
  const distance = route.distance >= 1000 ? `${(route.distance / 1000).toFixed(2)} km` : `${route.distance} m`;
  button.append(title, node('span', 'duration', `${route.minutes}분`),
    node('span', 'details', `도보 ${distance}${extra}`),
    node('span', route.late ? 'details late' : 'details',
      `도착 ${clock.format(new Date(route.eta))}${route.late ? ` · ${route.late}분 지연` : ''}`));
  if (route.place) {
    if (route.place.description) {
      button.append(node('span', 'place-meta', [route.place.category, route.place.area, ...route.place.interests].filter(Boolean).join(' · ')),
        node('span', 'details', route.place.description));
    }
    if (route.maxStay !== undefined) {
      button.append(node('span', 'stop', `최대 ${route.maxStay}분 체류 · 추가 도보 ${route.extraWalk}분`),
        node('span', 'details', `${route.stay}분 체류 기준 도착 시각`));
      if (route.place.address) button.append(node('span', 'details', route.place.address));
    } else button.append(node('span', 'stop', `${route.place.name} · ${route.stay}분 체류`));
  }
  button.addEventListener('click', () => selectRoute(button, route));
  return button;
}

function selectRoute(button, route) {
  if (!route.legs) walkingSelection = { button, route };
  for (const card of [...cards.children, ...stops.children, ...transitCards.children]) {
    card.setAttribute('aria-pressed', String(card === button));
  }
  byId('transit-legend').hidden = !route.legs;
  byId('walking-legend').hidden = Boolean(route.legs);
  byId('map').setAttribute('aria-label', route.legs ? '대중교통 승하차 지점을 표시하는 지도' : '도보 경로 지도');
  map.select(route);
}

function transitCard(route) {
  const button = node('button', 'route-card');
  button.type = 'button';
  button.setAttribute('aria-pressed', 'false');
  const modes = [...new Set(route.legs.map(leg => leg.kind === 'bus' ? '버스' : '지하철'))];
  button.append(node('span', 'card-title', modes.join(' + ')),
    node('span', 'duration', `약 ${route.minutes}분`),
    node('span', route.late ? 'details late' : 'details',
      `예상 도착 ${clock.format(new Date(route.eta))}${route.late ? ` · ${route.late}분 지연` : ''}`),
    node('span', 'details', `승차까지 도보 약 ${route.approach}분 · 하차 후 도보 약 ${route.exit}분 · 환승 ${route.legs.length - 1}회`));
  for (const leg of route.legs) {
    const step = node('span', 'travel-step');
    const times = leg.arrivals.map(arrival => {
      const label = arrival.minutes <= 1 ? '곧 도착' : `${arrival.minutes}분 후`;
      return arrival.catchable === false ? `${label} (도보 중 출발 가능)` : label;
    });
    const line = leg.kind === 'bus' ? `${leg.line}${leg.line.endsWith('번') ? '' : '번'} 버스` : leg.line;
    step.append(node('strong', '', line),
      node('span', 'details', `${leg.fromName} 승차 → ${leg.toName} 하차`),
      node('span', 'travel-arrival', times.length ? times.join(' · ') : '실시간 도착 정보 없음'));
    button.append(step);
  }
  if (!route.canBoard) button.append(node('span', 'details late', '현재 조회된 차량은 정류장에 도착하기 전에 출발할 수 있어요.'));
  button.addEventListener('click', () => selectRoute(button, route));
  return button;
}

function renderTransit(transit) {
  const kindTitle = { bus: '버스', subway: '지하철', all: '대중교통' }[transport];
  const available = transit.routes.filter(route => transport === 'all' || route.legs.every(leg => leg.kind === transport));
  const messages = {
    sample: '광화문 시연용 경로와 도착 정보예요.',
    unconfigured: '실제 대중교통 경로를 조회하려면 서울시 API 설정이 필요해요.',
    'authorization-required': '환승경로 API가 인증을 거부했어요. 공공데이터포털에서 해당 서비스의 활용 승인을 확인해 주세요.',
    outside: '대중교통 조회는 서울 지역을 지원해요.',
    unavailable: '서울시에서 대중교통 정보를 가져오지 못했어요.'
  };
  byId('transit-title').textContent = `${kindTitle} 경로`;
  if (transport !== 'all') byId('map-frame').hidden = !available.length;
  byId('refresh-transit').hidden = ['sample', 'unconfigured', 'outside'].includes(transit.status);
  byId('transit-setup').hidden = transit.status !== 'authorization-required';
  byId('transit-source').hidden = transit.status !== 'ready';
  const hasNoMatch = !available.length && ['ready', 'sample', 'empty'].includes(transit.status);
  byId('transit-status').textContent = hasNoMatch ? `이 구간에서 확인된 ${kindTitle} 경로가 없어요.` :
    messages[transit.status] ?? `${clock.format(new Date(transit.checkedAt))} 조회 · 전체 도착 시각은 예상이에요.`;
  transitCards.replaceChildren(...available.map(transitCard));
  if (available.length && transport !== 'all') selectRoute(transitCards.firstElementChild, available[0]);
}

function renderTransport() {
  const walk = transport === 'walk' || transport === 'all';
  const transit = transport !== 'walk';
  cards.hidden = !walk;
  byId('map-frame').hidden = !walk;
  byId('transport-help').hidden = walk || Boolean(shownResult) || Boolean(pending);
  byId('stop-options').hidden = !walk || !shownResult?.stops;
  byId('reason').hidden = !walk || !shownResult;
  byId('transit-options').hidden = !transit || !shownResult?.transit;
  if (!shownResult) return;
  if (walk && walkingSelection) selectRoute(walkingSelection.button, walkingSelection.route);
  if (transit && shownResult.transit) renderTransit(shownResult.transit);
  setStatus(walk && shownResult.failedStops ? `경유 후보 ${shownResult.failedStops}곳의 위치나 경로를 확인하지 못했어요.` : '');
}

function renderResult(result, trip) {
  const same = result.baseline.id === result.recommended.id;
  const calendar = hasCalendar();
  const activeWalking = calendar || result.recommended.place ? result.baseline : result.recommended;
  const baselineCard = routeCard(result.baseline, 'baseline', activeWalking === result.baseline, same);
  cards.replaceChildren(baselineCard);
  let activeCard = baselineCard;
  if (!same && !result.recommended.place) {
    const recommendedCard = routeCard(result.recommended, 'recommended', !calendar, true);
    cards.append(recommendedCard);
    if (activeWalking === result.recommended) activeCard = recommendedCard;
  }
  if (result.stops) {
    const message = result.stops.length ? '' : result.nearbyUnavailable ? '시간에 맞는 장소를 확인하지 못했어요.' :
      '현재 시간과 컨디션에 맞는 경유지가 없어요.';
    byId('stop-status').textContent = message;
    stops.replaceChildren(...result.stops.map(route => routeCard(route, route.id, false, route.id === result.recommended.id)));
  }
  byId('trip-label').textContent = `${trip.origin} → ${trip.destination}`;
  byId('reason-label').textContent = result.method === 'ai' ? 'AI 추천 이유' : '조건 기반 추천 이유';
  byId('reason-text').textContent = result.reason;
  byId('map').setAttribute('aria-label', `${trip.origin}에서 ${trip.destination}까지의 도보 경로 지도`);
  if (result.mode === 'live') {
    const routing = node('a', '', '© openrouteservice.org by HeiGIT');
    routing.href = 'https://openrouteservice.org/';
    const attribution = node('a', '', '© OpenStreetMap contributors');
    attribution.href = 'https://www.openstreetmap.org/copyright';
    const fix = node('a', '', '지도 수정');
    fix.href = 'https://www.openstreetmap.org/fixthemap';
    credit.replaceChildren(routing, ' · ', attribution, ' · ', fix);
  } else credit.textContent = '광화문 샘플 지도';
  shownResult = result;
  walkingSelection = { button: activeCard, route: activeWalking };
  map.show(result, trip, activeWalking);
  renderTransport();
  if (result.originPoint) loadNearbyLandmarks(result.originPoint);
  calculatedAt = Date.now();
}

function resetLandmarks() {
  landmarkRequest?.abort();
  landmarkRequest = undefined;
  landmarkOrigin = undefined;
  nearbyLandmarks = undefined;
  landmarkError = false;
  landmarkExpanded = false;
  renderLandmarks();
}

function renderLandmarks() {
  const section = byId('landmark-directory');
  const active = landmarkOrigin !== undefined;
  const places = active ? nearbyLandmarks : landmarkDirectory;
  const list = byId('landmark-list');
  const more = byId('landmark-more');
  section.hidden = !places && !active;
  byId('landmark-title').textContent = active ? '출발지 주변 명소' : '서울 명소';
  byId('landmark-status').textContent = !active ? '' : landmarkError ? '주변 명소를 불러오지 못했어요.' :
    !places ? '가까운 명소를 찾고 있어요…' : places.length
      ? `출발지 기준 2km 안에서 확인된 ${places.length}곳 · 직선거리순`
      : '출발지 기준 2km 안에 등록된 명소를 찾지 못했어요.';
  more.hidden = !places || places.length <= 4;
  more.textContent = landmarkExpanded ? '접기' : '명소 더 보기';
  more.setAttribute('aria-expanded', String(landmarkExpanded));
  const visible = landmarkExpanded ? places : places?.slice(0, 4);
  list.replaceChildren(...(visible ?? []).map(place => {
    const item = node('li');
    const facts = node('div', 'landmark-facts');
    facts.append(node('span', '', place.category), node('span', '', place.area));
    if (place.distance !== undefined) {
      const distance = place.distance < 1000 ? `${place.distance}m` : `${(place.distance / 1000).toFixed(1)}km`;
      facts.append(node('span', '', `직선 ${distance}`));
    }
    item.append(node('h4', '', place.name), facts, node('p', '', place.description));
    return item;
  }));
}

async function loadLandmarkDirectory() {
  try {
    const result = await fetch('/api/locations');
    if (!result.ok) return;
    landmarkDirectory = (await result.json()).places;
    renderLandmarks();
  } catch {
    // The route planner is usable even if the directory cannot load.
  }
}

async function loadNearbyLandmarks(coordinate) {
  const originKey = coordinate.map(value => value.toFixed(5)).join(',');
  if (originKey === landmarkOrigin && !landmarkError) return;
  landmarkRequest?.abort();
  const request = new AbortController();
  landmarkRequest = request;
  landmarkOrigin = originKey;
  nearbyLandmarks = undefined;
  landmarkError = false;
  landmarkExpanded = false;
  renderLandmarks();
  try {
    const response = await fetch('/api/locations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: request.signal, body: JSON.stringify({ coordinate })
    });
    if (!response.ok) throw new Error('Nearby lookup failed');
    const { places } = await response.json();
    if (landmarkRequest === request) nearbyLandmarks = places;
  } catch {
    if (landmarkRequest === request) landmarkError = true;
  } finally {
    if (landmarkRequest === request) renderLandmarks();
  }
}

function arrivalTime(value) {
  const original = appointment?.next?.start;
  return new Date(original && value === localTime(original) ? original : `${value}:00+09:00`);
}

function forecastFatigue(now, deadline) {
  if (!appointment?.next || !Number.isFinite(+deadline)) return null;
  return summarize(mode === 'demo' ? sampleEvents : calendarEvents, now, {
    currentFatigue: fatigueEdited ? fields.fatigue.value : undefined,
    arriveBy: +deadline
  }).projectedFatigue;
}

function showRouteFatigue(fatigue) {
  byId('route-fatigue').textContent = fatigue
    ? `약속 전 예상 컨디션 · ${FATIGUE_LABELS[fatigue.value]} (${fatigue.reasons.join(' · ')})`
    : '';
}

async function compare(userAction) {
  const request = new AbortController();
  pending?.abort();
  pending = request;
  submit.disabled = true;
  const values = Object.fromEntries(new FormData(form));
  const deadline = arrivalTime(values.arrive);
  const now = mode === 'demo' ? Date.parse(demo.departAt) : Date.now();
  const depart = new Date(Math.max(now, appointment?.departAt ?? 0));
  const trip = { origin: values.origin.trim(), destination: values.destination.trim() };
  resetLookup();
  clearResult();
  setStatus('경로를 계산하고 있어요…');
  try {
    if (!trip.origin || !trip.destination) throw new Error('출발지와 목적지를 입력해 주세요.');
    if (!Number.isFinite(deadline.getTime())) throw new Error('도착 희망 일시를 확인해 주세요.');
    if (deadline < depart) throw new Error(hasCalendar()
      ? '출발할 수 있는 시각보다 약속이 먼저예요. 일정 시간을 확인해 주세요.'
      : '도착 희망 일시는 출발 이후로 설정해 주세요.');
    const forecast = forecastFatigue(now, deadline);
    showRouteFatigue(forecast);
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: request.signal,
      body: JSON.stringify({
        ...trip, mode: placeMode(), fatigue: forecast?.value ?? values.fatigue ?? 'normal', allowance: Number(values.budget),
        calendar: hasCalendar(), catalog: true, transit: true, locations,
        departAt: depart.toISOString(), arriveBy: deadline.toISOString(),
        places: displayedPlaces().filter(place => selected[placeMode()].has(place.id))
      })
    });
    const result = await response.json();
    if (pending !== request) return;
    if (!response.ok) {
      if (result.choices) showLocationChoices(result.choices, userAction);
      throw new Error(result.error);
    }
    renderResult(result, trip);
    if (userAction && matchMedia('(max-width: 650px)').matches) byId('results').scrollIntoView({ block: 'start' });
  } catch (error) {
    if (pending === request) setStatus(error instanceof TypeError || error instanceof SyntaxError ?
      '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' : error.message, true);
  } finally {
    if (pending === request) {
      pending = null;
      submit.disabled = false;
    }
  }
}

function resetLookup(message = '') {
  placeLookup?.abort();
  placeLookup = undefined;
  locationChoices.hidden = true;
  byId('lookup-status').textContent = message;
}

async function searchPlace(field, resumeTrip) {
  const query = fields[field].value.trim();
  const label = field === 'origin' ? '출발지' : '목적지';
  if (!query) {
    resetLookup(`${label}의 장소명이나 주소를 입력해 주세요.`);
    fields[field].focus();
    return;
  }
  resetLookup(`${label} 후보를 찾고 있어요…`);
  const request = new AbortController();
  placeLookup = request;
  try {
    const response = await fetch('/api/locations?' + new URLSearchParams({ q: query }), { signal: request.signal });
    if (!response.ok) throw new Error('Search unavailable');
    const result = await response.json();
    if (placeLookup !== request) return;
    if (result.status === 'ready') {
      resetLookup();
      showLocationChoices({ field, places: result.places }, resumeTrip);
      return;
    }
    const messages = {
      'personal-label': '집이나 회사의 실제 주소 또는 장소명을 입력해 주세요.',
      empty: '일치하는 장소가 없어요. 지역명이나 도로명 주소를 함께 입력해 주세요.',
      unavailable: '장소 검색을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.'
    };
    resetLookup(messages[result.status]);
  } catch {
    if (placeLookup === request) resetLookup('장소를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

function showLocationChoices({ field, places }, resumeTrip = false) {
  const label = field === 'origin' ? '출발지' : '목적지';
  const heading = node('p', 'departure', `${label}의 주소를 선택해 주세요.`);
  locationChoices.replaceChildren(heading);
  locationChoices.setAttribute('aria-label', `${label} 검색 후보`);
  for (const place of places) {
    const button = node('button');
    button.type = 'button';
    button.append(node('strong', '', place.name));
    if (place.address && place.address !== place.name) button.append(node('span', '', place.address));
    button.addEventListener('click', () => {
      locations[field] = { coordinate: place.coordinate, address: place.address };
      fields[field].value = place.name;
      resetLookup(`${label}로 ${place.name}을 선택했어요.`);
      if (field === 'origin') {
        currentPosition = undefined;
        locationRequest += 1;
        useLocation.disabled = false;
        byId('location-status').textContent = '';
        confirmOrigin = false;
        byId('confirm-origin').hidden = true;
        if (appointment?.next) byId('origin-note').textContent = `확인한 출발지 · ${place.name}`;
        loadNearbyLandmarks(place.coordinate);
      }
      if (resumeTrip) startCompare(true);
      else {
        invalidateRoute();
        for (const lookup of lookupButtons) {
          if (lookup.dataset.lookup === field) lookup.focus({ preventScroll: true });
        }
      }
    });
    locationChoices.append(button);
  }
  locationChoices.hidden = false;
  routeOptions.open = true;
  locationChoices.querySelector('button')?.focus();
}

function startCompare(userAction) {
  const unresolved = ['origin', 'destination'].find(field =>
    (mode === 'live' || typedFields.has(field)) && !locations[field]);
  if (unresolved) {
    searchPlace(unresolved, true);
    return;
  }
  if (confirmOrigin || (appointment?.next && routeEdited)) {
    byId('origin-note').textContent = `확인한 출발지 · ${fields.origin.value.trim()}`;
  }
  confirmOrigin = false;
  byId('confirm-origin').hidden = true;
  compare(userAction);
}

function invalidateRoute() {
  const hadRoute = Boolean(shownResult || pending);
  routeEdited = true;
  pending?.abort();
  pending = null;
  submit.disabled = false;
  clearResult();
  setStatus(hadRoute ? '경로를 다시 계산해 주세요.' : '');
}

function persistPlaces(message) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
    byId('place-status').textContent = message;
  } catch {
    byId('place-status').textContent = '브라우저 저장소를 사용할 수 없어 이번 세션에만 적용돼요.';
  }
  renderSaved();
  renderPlaces();
}

function renderSaved() {
  const list = byId('saved-list');
  list.replaceChildren();
  for (const place of saved) {
    const item = node('li');
    const remove = node('button', 'text-button', '삭제');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${place.name} 삭제`);
    remove.addEventListener('click', () => {
      saved = saved.filter(entry => entry.id !== place.id);
      selected.live.delete(place.id);
      persistPlaces('장소를 삭제했어요.');
    });
    item.append(node('span', '', `${place.name} · ${place.category}`), remove);
    list.append(item);
  }
}

for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
  switchMode(button.dataset.mode);
  if (mode === 'calendar') syncCalendar();
});
byId('connect-calendar').addEventListener('click', () => syncCalendar(true));
byId('show-sample').addEventListener('click', () => {
  switchMode('demo');
  calendarStatus();
  byId('confirm-origin').focus();
});
byId('disconnect-calendar').addEventListener('click', () => {
  if (credentials?.expiresAt > Date.now()) globalThis.google?.accounts?.oauth2?.revoke(credentials.accessToken);
  credentials = undefined;
  calendarEvents = undefined;
  calendarStatus('캘린더 연결을 해제했어요.');
  if (mode === 'calendar') {
    mode = undefined;
    switchMode('calendar');
  } else updateCalendarActions();
  byId('connect-calendar').focus();
});
byId('confirm-origin').addEventListener('click', () => form.requestSubmit());
useLocation.addEventListener('click', getCurrentPosition);
byId('landmark-more').addEventListener('click', () => {
  landmarkExpanded = !landmarkExpanded;
  renderLandmarks();
});
for (const button of lookupButtons) {
  const { lookup: field } = button.dataset;
  button.addEventListener('click', () => searchPlace(field));
  fields[field].addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || mode === 'demo' || locations[field]) return;
    event.preventDefault();
    searchPlace(field);
  });
}
byId('refresh-transit').addEventListener('click', () => compare(false));
for (const button of transportButtons) button.addEventListener('click', () => {
  if (transport === button.dataset.transport) return;
  transport = button.dataset.transport;
  for (const option of transportButtons) option.setAttribute('aria-pressed', String(option === button));
  renderTransport();
});
function refreshVisibleCalendar() {
  if (document.hidden || mode !== 'calendar') return;
  if (calendarEvents) showAppointment(calendarEvents);
  if (credentials && (credentials.expiresAt <= Date.now() || Date.now() - lastSync >= 5 * 60_000)) syncCalendar();
}
document.addEventListener('visibilitychange', refreshVisibleCalendar);
setInterval(refreshVisibleCalendar, 30_000);
fields.budget.addEventListener('input', () => { byId('allowance').value = `${fields.budget.value}분`; });
form.addEventListener('input', event => {
  if (event.target.name === 'origin') {
    currentPosition = undefined;
    locationRequest += 1;
    useLocation.disabled = false;
    byId('location-status').textContent = '';
    resetLandmarks();
  }
  if (['origin', 'destination'].includes(event.target.name)) {
    typedFields.add(event.target.name);
    delete locations[event.target.name];
    resetLookup();
  }
  if (event.target.name === 'fatigue') {
    fatigueEdited = true;
    byId('fatigue-note').textContent = '';
  }
  if (['fatigue', 'arrive'].includes(event.target.name)) {
    const now = mode === 'demo' ? Date.parse(demo.departAt) : Date.now();
    showRouteFatigue(forecastFatigue(now, arrivalTime(fields.arrive.value)));
  }
  invalidateRoute();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  startCompare(true);
});
byId('zoom-in').addEventListener('click', () => map.zoom(1.3));
byId('zoom-out').addEventListener('click', () => map.zoom(1 / 1.3));
byId('reset-map').addEventListener('click', map.reset);
byId('manage-places').addEventListener('click', () => {
  byId('place-status').textContent = mode === 'demo' ? '등록한 장소는 실제 경로에서 선택할 수 있어요.' : '';
  renderSaved();
  dialog.showModal();
});
byId('close-dialog').addEventListener('click', () => dialog.close());
placeForm.addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(placeForm));
  const name = values.name.trim();
  if (!name || saved.some(place => place.name === name)) {
    byId('place-status').textContent = name ? '이미 등록한 장소예요.' : '장소 이름을 입력해 주세요.';
    return;
  }
  const place = { id: crypto.randomUUID(), name, category: values.category };
  saved.push(place);
  if (selected.live.size < 3) selected.live.add(place.id);
  placeForm.reset();
  persistPlaces(mode === 'demo' ? '저장했어요. 실제 경로에서 선택할 수 있어요.' : '장소를 저장했어요.');
});

switchMode('calendar');
loadLandmarkDirectory();
