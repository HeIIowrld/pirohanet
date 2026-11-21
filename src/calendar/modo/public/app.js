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
const locationChoices = byId('location-choices');
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
  cards.replaceChildren();
  stops.replaceChildren();
  byId('stop-options').hidden = true;
  byId('reason').hidden = true;
  byId('map').setAttribute('aria-label', '출발지, 목적지와 도보 경로를 표시하는 지도');
  credit.textContent = hasCalendar() ? '서울 도심 예시 지도' : '실제 도보 경로';
  map.clear(mode === 'live' ? 'live' : 'demo');
}

function switchMode(next) {
  if (next === mode) return;
  pending?.abort();
  pending = null;
  submit.disabled = false;
  mode = next;
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === (hasCalendar() ? 'calendar' : 'live')));
  }
  byId('calendar-panel').hidden = !hasCalendar();
  byId('appointment').hidden = true;
  byId('title').textContent = hasCalendar() ? '다음 약속까지 걷는 길' : '도보 경로 찾기';
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
  fields.destination.placeholder = '예. 교보문고 광화문점';
  fields.arrive.value = localTime(Date.now() + 60 * 60_000);
  fields.fatigue.value = hasCalendar() ? '' : 'relaxed';
  byId('fatigue-note').textContent = '';
  byId('route-fatigue').textContent = '';
  byId('departure').textContent = '지금 출발하는 경로를 비교합니다.';
  byId('trip-label').textContent = hasCalendar() ? '다음 약속 경로를 여기에 표시해요.' : '출발지와 목적지를 입력해 주세요.';
  source.hidden = mode === 'calendar' && !calendarEvents;
  source.textContent = mode === 'demo' ? '광화문 샘플' : '실제 도보';
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
  fields.destination.value = next.location;
  fields.arrive.value = localTime(next.start);
  fields.fatigue.value = fatigue?.value ?? '';
  byId('fatigue-note').textContent = fatigue
    ? `캘린더 제안 · ${fatigue.reasons.join(' · ')}`
    : '컨디션을 선택할 수 있어요.';
  byId('departure').textContent = mode === 'demo' ? `샘플 시각 · ${fullDate.format(now)}` :
    summary.departAt > now ? `진행 중인 일정이 끝나는 ${clock.format(summary.departAt)}부터 출발할 수 있어요.` :
      '지금 출발하는 경로를 비교합니다.';
  byId('origin-note').textContent = origin
    ? needsConfirmation ? `직전 일정에 장소가 없어요. ${origin.location}에서 출발하시겠어요?` :
      `직전 일정 장소 기준 · ${origin.location}`
    : '출발지로 사용할 일정 장소가 없어요. 출발지를 입력해 주세요.';
  confirmOrigin = needsConfirmation;
  byId('confirm-origin').hidden = !confirmOrigin || !next.location;
  routeEdited = false;
  fatigueEdited = false;
  showRouteFatigue(summary.projectedFatigue);
  routeOptions.open = !origin || !next.location;
  byId('trip-label').textContent = origin && next.location
    ? `${origin.location} → ${next.location}` : '출발지와 목적지를 확인해 주세요.';
  if (origin && next.location && !confirmOrigin) compare(false);
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
  const titleText = type === 'baseline' ? (hasCalendar() ? '바로 가는 길' : '일반 경로') :
    route.place ? (hasCalendar() ? route.place.name : '경유 추천 경로') : '짧게 걷는 경로';
  title.append(node('span', '', titleText));
  if (recommended) title.append(node('span', 'card-state', '추천'));
  const extra = route.extra === 0 ? '' : ` · ${route.extra > 0 ? '+' : ''}${route.extra}분`;
  const distance = route.distance >= 1000 ? `${(route.distance / 1000).toFixed(2)} km` : `${route.distance} m`;
  button.append(title, node('span', 'duration', `${route.minutes}분`),
    node('span', 'details', `도보 ${distance}${extra}`),
    node('span', route.late ? 'details late' : 'details',
      `도착 ${clock.format(new Date(route.eta))}${route.late ? ` · ${route.late}분 지연` : ''}`));
  if (route.place) {
    if (route.maxStay !== undefined) {
      button.append(node('span', 'stop', `최대 ${route.maxStay}분 체류 · 추가 도보 ${route.extraWalk}분`),
        node('span', 'details', `${route.stay}분 체류 기준 도착 시각`));
      if (route.place.address) button.append(node('span', 'details', route.place.address));
    } else button.append(node('span', 'stop', `${route.place.name} · ${route.stay}분 체류`));
  }
  button.addEventListener('click', () => {
    for (const card of [...cards.children, ...stops.children]) card.setAttribute('aria-pressed', String(card === button));
    map.select(route);
  });
  return button;
}

function renderResult(result, trip) {
  const same = result.baseline.id === result.recommended.id;
  const calendar = hasCalendar();
  const active = calendar ? result.baseline : result.recommended;
  cards.replaceChildren(routeCard(result.baseline, 'baseline', active === result.baseline, same));
  if (!same && (!calendar || !result.recommended.place)) {
    cards.append(routeCard(result.recommended, 'recommended', !calendar, true));
  }
  if (calendar) {
    byId('stop-options').hidden = false;
    const message = result.nearbyUnavailable ? '주변 장소 검색을 사용할 수 없어요.' :
      result.stops.length ? '' : '현재 시간과 컨디션에 맞는 경유지가 없어요.';
    byId('stop-status').textContent = message;
    stops.replaceChildren(...result.stops.map(route => routeCard(route, route.id, false, route.id === result.recommended.id)));
  }
  byId('trip-label').textContent = `${trip.origin} → ${trip.destination}`;
  byId('reason').hidden = false;
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
  map.show(result, trip, active);
  calculatedAt = Date.now();
  setStatus(result.failedStops ? `관심 장소 ${result.failedStops}곳은 위치나 경로를 확인하지 못했어요.` : '');
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
  locationChoices.hidden = true;
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
        calendar: hasCalendar(), locations,
        departAt: depart.toISOString(), arriveBy: deadline.toISOString(),
        places: displayedPlaces().filter(place => selected[placeMode()].has(place.id))
      })
    });
    const result = await response.json();
    if (pending !== request) return;
    if (!response.ok) {
      if (result.choices) showLocationChoices(result.choices);
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

function showLocationChoices({ field, places }) {
  const label = field === 'origin' ? '출발지' : '목적지';
  const heading = node('p', 'departure', `${label}의 주소를 선택해 주세요.`);
  locationChoices.replaceChildren(heading);
  for (const place of places) {
    const button = node('button', '', [place.name, place.address].filter(Boolean).join(' · '));
    button.type = 'button';
    button.addEventListener('click', () => {
      locations[field] = { coordinate: place.coordinate, address: place.address };
      fields[field].value = place.name;
      compare(false);
    });
    locationChoices.append(button);
  }
  locationChoices.hidden = false;
  routeOptions.open = true;
  locationChoices.querySelector('button')?.focus();
}

function invalidateRoute() {
  routeEdited = true;
  pending?.abort();
  pending = null;
  submit.disabled = false;
  clearResult();
  setStatus('경로를 다시 계산해 주세요.');
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
function refreshVisibleCalendar() {
  if (document.hidden || mode !== 'calendar') return;
  if (calendarEvents) showAppointment(calendarEvents);
  if (credentials && (credentials.expiresAt <= Date.now() || Date.now() - lastSync >= 5 * 60_000)) syncCalendar();
}
document.addEventListener('visibilitychange', refreshVisibleCalendar);
setInterval(refreshVisibleCalendar, 30_000);
fields.budget.addEventListener('input', () => { byId('allowance').value = `${fields.budget.value}분`; });
form.addEventListener('input', event => {
  if (['origin', 'destination'].includes(event.target.name)) {
    delete locations[event.target.name];
    locationChoices.hidden = true;
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
  if (confirmOrigin || (appointment?.next && routeEdited)) {
    byId('origin-note').textContent = `확인한 출발지 · ${fields.origin.value.trim()}`;
  }
  confirmOrigin = false;
  byId('confirm-origin').hidden = true;
  compare(true);
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
