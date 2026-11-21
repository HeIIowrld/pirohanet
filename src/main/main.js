import { searchPlaceCandidates } from '../calendar/location.js';
import { SAMPLE_EVENTS, SAMPLE_NOW, SAMPLE_ORIGIN } from '../calendar/sample.js';
import { resolvePlace } from '../map/places.js';
import { loadRecommendedStops, resolveRecommendedStop } from '../places/recommended-stops.js';
import { api, savePlace } from '../preferences/account-api.js';
import { placeAliasKey } from '../preferences/place-alias.js';
import { isDirect } from '../routing/compare.js';
import { queryTransit } from '../routing/transit.js';
import { createDepartureReminder, planDepartureReminder } from './departure-reminder.js';
import { renderRoutes } from './route-results.js';
import { planTrip, prepareTrip } from './trip.js';

const form = document.querySelector('#trip-form');
const sampleButton = document.querySelector('#load-sample');
const checkButton = document.querySelector('#check-places');
const summary = document.querySelector('#trip-summary');
const routeResults = document.querySelector('#route-results');
const routeStatus = document.querySelector('#route-status');
const confirmedPlaces = document.querySelector('#confirmed-places');
const destination = form.elements.destination;
const stopSelect = form.elements.savedStop;
const stayMinutes = form.elements.stayMinutes;
const stopCatalogStatus = document.querySelector('#stop-catalog-status');
const stopInfo = document.querySelector('#stop-info');
const stopDescription = document.querySelector('#stop-description');
const stopVisitNote = document.querySelector('#stop-visit-note');
const stopSource = document.querySelector('#stop-source');
const login = document.querySelector('#google-login');
const calendarButton = document.querySelector('#google-calendar');
const logout = document.querySelector('#logout');
const accountStatus = document.querySelector('#account-status');
const candidates = document.querySelector('#calendar-place-candidates');
const previewDeparture = document.querySelector('#preview-departure');
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});
const departureReminder = createDepartureReminder(timeFormat);

let signedIn = false;
let events = [];
let source = null;
let scheduleVersion = 0;
let routeVersion = 0;
const saved = new Map();
let stopCatalog = null;
const sampleStopId = 'seoul_002';
const seoulTimeField = (date) => new Date(+date + 9 * 60 * 60_000).toISOString().slice(0, 16);
const sampleDeparture = seoulTimeField(SAMPLE_NOW);
const sampleTrip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);
const sampleArrival = seoulTimeField(sampleTrip.arriveBy);

function accountMessage(message) {
  accountStatus.textContent = message;
  accountStatus.hidden = !message;
}

function readTrip(stop) {
  const fields = new FormData(form);
  const fatigue = fields.get('fatigue');
  const localTime = (key) => fields.get(key) ? new Date(`${fields.get(key)}+09:00`) : undefined;
  return prepareTrip({
    origin: fields.get('origin'),
    destination: fields.get('destination'),
    departAt: localTime('departAt'),
    arriveBy: localTime('arriveBy'),
    preferences: {
      fatigueLevel: fatigue === null ? null : Number(fatigue),
      priority: fields.get('priority') || null,
      avoidLine: fields.get('avoidLine') || null,
      maxExtraTravelMinutes: Number(fields.get('maxExtra')),
      savedStop: stop ? { query: stop.name, stayMinutes: Number(fields.get('stayMinutes')) } : null,
    },
  }, events, source === 'sample' ? SAMPLE_NOW : new Date());
}

function lookup(query) {
  return saved.get(placeAliasKey(query)) ?? resolvePlace(query);
}

async function storePlace(alias, place) {
  const entry = await savePlace(alias, place);
  saved.set(placeAliasKey(entry.alias), entry);
  updateStopOptions();
}

function updateStopOptions() {
  const selected = stopSelect.value;
  const groups = [];
  if (saved.size) {
    const group = document.createElement('optgroup');
    group.label = '내 장소';
    for (const [key, { alias }] of saved) group.append(new Option(alias, `saved:${key}`));
    groups.push(group);
  }
  for (const [region, label] of Object.entries(stopCatalog?.regions ?? {})) {
    const group = document.createElement('optgroup');
    group.label = `추천 후보 · ${label}`;
    for (const place of stopCatalog.places.filter((item) => item.region === region)) {
      group.append(new Option(place.name, place.id));
    }
    if (group.childElementCount) groups.push(group);
  }
  stopSelect.replaceChildren(stopSelect.options[0], ...groups);
  stopSelect.value = selected;
  if (stopSelect.selectedIndex === -1) stopSelect.selectedIndex = 0;
  showStopInfo();
}

function selectedRecommendation() {
  return stopCatalog?.places.find(({ id }) => id === stopSelect.value);
}

function selectedStop() {
  const recommendation = selectedRecommendation();
  if (recommendation) return { name: recommendation.name, recommendation };
  const place = stopSelect.value.startsWith('saved:') && saved.get(stopSelect.value.slice('saved:'.length));
  return place ? { name: place.alias, place } : null;
}

function showStopInfo() {
  const place = selectedRecommendation();
  stopInfo.hidden = !place;
  stopDescription.textContent = place ? `${place.description} 권장 체류 ${place.visit_duration_min.recommended}분.` : '';
  if (!place) return;
  stopVisitNote.textContent = [place.operations.hours_note, place.operations.special_conditions].filter(Boolean).join(' ');
  const page = place.sources[0]?.url;
  stopSource.hidden = !page;
  if (page) stopSource.href = page;
}

async function initializeStopCatalog() {
  try {
    stopCatalog = await loadRecommendedStops();
    updateStopOptions();
  } catch {
    stopCatalogStatus.textContent = '추천 경유지 목록을 불러오지 못했어요.';
    stopCatalogStatus.hidden = false;
  }
}

async function loadSaved() {
  const entries = await api('/api/saved-places');
  saved.clear();
  for (const entry of entries) saved.set(placeAliasKey(entry.alias), entry);
  updateStopOptions();
}

function scheduleTrip() {
  return prepareTrip({}, events, source === 'sample' ? SAMPLE_NOW : new Date());
}

function offerConfirmation(alias, places, version) {
  candidates.replaceChildren();
  for (const place of places) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = place.name && place.name !== alias
      ? `${place.name} · ${place.address} 확인`
      : `${place.address} 확인`;
    candidates.append(button);
    button.addEventListener('click', async () => {
      const choices = [...candidates.children];
      for (const choice of choices) choice.disabled = true;
      try {
        await storePlace(alias, place);
        if (version === scheduleVersion) {
          destination.value = alias;
          clearRouteResults();
          await refreshSchedule();
        }
        accountMessage(`‘${alias}’ 장소를 기억했어요.`);
      } catch (error) {
        accountMessage(error.message);
      } finally {
        for (const choice of choices) choice.disabled = false;
      }
    });
  }
}

async function refreshSchedule() {
  if (!source) return;
  const version = ++scheduleVersion;
  candidates.replaceChildren();
  const trip = scheduleTrip();
  const alias = trip.destination;
  if (!trip.arriveBy) {
    summary.textContent = '장소가 있는 다음 일정이 없어요.';
    return;
  }

  const appointment = `${alias} · ${timeFormat.format(trip.arriveBy)}까지 도착`;
  const remembered = source === 'google' && saved.get(placeAliasKey(alias));
  if (remembered) {
    summary.textContent = `${appointment} · ${remembered.name ? remembered.name + ' · ' : ''}${remembered.address}`;
    return;
  }

  summary.textContent = `${appointment} · 주소 확인 중…`;
  try {
    if (source === 'google' && signedIn) {
      const places = (await searchPlaceCandidates(alias)).filter((place) => place.address &&
        Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
      if (version !== scheduleVersion) return;
      summary.textContent = `${appointment} · ${places.length ? '일정 장소를 확인해 주세요.' : '목적지에 주소를 직접 입력해 주세요.'}`;
      offerConfirmation(alias, places, version);
    } else {
      const place = await resolvePlace(alias);
      if (version === scheduleVersion) {
        summary.textContent = `${appointment} · ${place?.address || '주소를 찾지 못했어요.'}`;
      }
    }
  } catch {
    if (version === scheduleVersion) summary.textContent = `${appointment} · 위치 검색에 실패했어요.`;
  }
}

function clearRouteResults() {
  routeVersion++;
  departureReminder.set(null);
  confirmedPlaces.hidden = true;
  routeResults.replaceChildren();
  routeStatus.textContent = '현재 조건으로 경로를 찾아보세요.';
}

function showSchedule(items, kind) {
  if (source === 'sample' && kind !== 'sample') {
    if (form.elements.departAt.value === sampleDeparture) form.elements.departAt.value = '';
    if (form.elements.arriveBy.value === sampleArrival) form.elements.arriveBy.value = '';
  }
  events = items;
  source = kind;
  previewDeparture.hidden = source !== 'sample';
  destination.value = scheduleTrip().destination;
  clearRouteResults();
  void refreshSchedule();
}

async function importCalendar(afterRedirect = false) {
  calendarButton.disabled = true;
  try {
    showSchedule(await api('/api/calendar'), 'google');
  } catch (error) {
    if (error.status === 401 && !afterRedirect) {
      window.location.assign('/auth/google?calendar=1');
      return;
    }
    accountMessage(error.message);
  } finally {
    calendarButton.disabled = false;
  }
}

sampleButton.addEventListener('click', () => {
  showSchedule(SAMPLE_EVENTS, 'sample');
  form.elements.origin.value = SAMPLE_ORIGIN;
  form.elements.departAt.value = sampleDeparture;
  form.elements.arriveBy.value = sampleArrival;
  if (stopSelect.value === sampleStopId) stayMinutes.value = 10;
});
previewDeparture.addEventListener('click', () => {
  const reminder = planDepartureReminder(sampleTrip, { travelMinutes: 22 });
  departureReminder.preview(reminder, previewDeparture);
});
calendarButton.addEventListener('click', () => importCalendar());
logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    await api('/auth/logout', 'POST');
    window.location.replace(window.location.pathname);
  } catch (error) {
    accountMessage(error.message);
    logout.disabled = false;
  }
});

form.addEventListener('input', clearRouteResults);
stopSelect.addEventListener('change', () => {
  const place = selectedRecommendation();
  if (place) stayMinutes.value = source === 'sample' && place.id === sampleStopId
    ? 10 : place.visit_duration_min.recommended;
  showStopInfo();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const stop = selectedStop();
  const trip = readTrip(stop);
  if (!trip.origin || !trip.destination) {
    routeStatus.textContent = '출발지와 목적지를 입력해 주세요.';
    return;
  }

  if (trip.arriveBy && trip.arriveBy <= trip.departAt) {
    routeStatus.textContent = '도착 목표는 출발 시각보다 늦어야 해요.';
    return;
  }

  const version = ++routeVersion;
  const schedule = scheduleVersion;
  const alias = source === 'google' && signedIn ? trip.calendar.nextAppointment?.location : null;
  const corrected = alias && placeAliasKey(alias) !== placeAliasKey(trip.destination);
  const isCurrent = () => version === routeVersion && schedule === scheduleVersion;
  confirmedPlaces.hidden = true;
  routeResults.replaceChildren();
  routeStatus.textContent = '장소를 찾는 중이에요.';
  checkButton.disabled = true;
  try {
    const { places, routes, fastestDirect, fastestVia } = await planTrip(trip, {
      resolvePlace: source === 'sample' ? resolvePlace : lookup,
      resolveStop: stop && (() => stop.recommendation
        ? resolveRecommendedStop(stop.recommendation).catch(() => null) : stop.place),
      queryRoutes: (request) => {
        if (!isCurrent()) return [];
        const { places } = request;
        document.querySelector('#origin-result').textContent = places.origin.address || places.origin.name;
        document.querySelector('#destination-result').textContent = places.destination.address || places.destination.name;
        confirmedPlaces.hidden = false;
        routeStatus.textContent = '대중교통 경로를 찾는 중이에요.';
        if (corrected && places.destination.address) offerConfirmation(alias, [places.destination], schedule);
        return queryTransit(request);
      },
    });
    if (!isCurrent()) return;
    const messages = [];
    if (routes.some(isDirect)) messages.push('이동 시간과 혼잡도는 예상치예요.');
    else if (fastestDirect && trip.arriveBy && fastestDirect.arrivalAt > trip.arriveBy) {
      const late = Math.ceil((fastestDirect.arrivalAt - trip.arriveBy) / 60_000);
      messages.push(`가장 이른 직행은 ${timeFormat.format(fastestDirect.arrivalAt)} 도착으로, 도착 목표보다 ${late}분 늦어요.`);
    } else messages.push('조건을 만족하는 대중교통 직행 경로를 찾지 못했어요.');
    if (stop && !routes.some((route) => route.viaStop)) {
      const stopLabel = stop.recommendation ? `‘${stop.name}’` : '저장 장소';
      if (!places.stop) messages.push(`${stopLabel}의 경유 지점을 지도에서 확인하지 못했어요.`);
      else if (!fastestVia) messages.push(`${stopLabel} 경유 경로를 찾지 못했어요.`);
      else if (trip.arriveBy && fastestVia.arrivalAt > trip.arriveBy) {
        const late = Math.ceil((fastestVia.arrivalAt - trip.arriveBy) / 60_000);
        messages.push(`${stopLabel}에 ${fastestVia.stayMinutes}분 머무르면 도착 목표보다 최소 ${late}분 늦어요.`);
      } else {
        const extra = Math.ceil(fastestVia.extraTravelMinutes - trip.preferences.maxExtraTravelMinutes);
        messages.push(`${stopLabel}에 들르면 추가 이동 한도를 최소 ${extra}분 넘어요.`);
      }
    }
    routeStatus.textContent = messages.join(' ');
    renderRoutes(routeResults, routes, timeFormat, trip.preferences.priority, stop?.recommendation?.name);
    if (source === 'google') departureReminder.set(planDepartureReminder(trip, fastestDirect));
  } catch (error) {
    if (isCurrent()) {
      routeStatus.textContent = confirmedPlaces.hidden
        ? '장소를 확인하지 못했어요. 장소 이름이나 주소를 다시 확인해 주세요.'
        : error.message;
    }
  } finally {
    checkButton.disabled = false;
  }
});

async function initializeAccount() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('auth') || params.has('calendar')) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  try {
    const account = await api('/api/account');
    signedIn = account.signedIn;
    login.hidden = signedIn || !account.ready;
    logout.hidden = !signedIn;
    calendarButton.hidden = !signedIn;
    if (!account.ready) accountMessage('Google OAuth 설정이 필요해요.');
    if (signedIn) {
      try {
        await loadSaved();
      } catch (error) {
        accountMessage(error.message);
      }
    }
    if (params.get('auth') === 'account') accountMessage('로그인에 사용한 Google 계정으로 일정을 연결해 주세요.');
    if (params.get('auth') === 'failed') accountMessage('Google 연결을 완료하지 못했어요. 다시 시도해 주세요.');
    if (signedIn && params.get('calendar') === '1') await importCalendar(true);
  } catch (error) {
    accountMessage(error.message);
  }
}

window.addEventListener('pageshow', async (event) => {
  if (!event.persisted) return;
  try {
    const account = await api('/api/account');
    if (account.signedIn !== signedIn || signedIn) window.location.reload();
  } catch (error) {
    accountMessage(error.message);
  }
});

void initializeAccount();
void initializeStopCatalog();
