import { fetchGoogleEvents, requestGoogleToken } from '../calendar/calendar.js';
import { exportSavedPlaces, isPersonalLabel, locateCandidates, placeKey, pushMyPlaces, savedPlace, savePlace, syncMyPlaces } from '../calendar/location.js';
import { SAMPLE_EVENTS, SAMPLE_NOW, SAMPLE_ORIGIN } from '../calendar/sample.js';
import { resolvePlace } from '../map/places.js';
import { loadRecommendedStops, resolveRecommendedStop } from '../places/recommended-stops.js';
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
const calendarButton = document.querySelector('#google-calendar');
const logout = document.querySelector('#logout');
const accountStatus = document.querySelector('#account-status');
const signInMessage = accountStatus.textContent;
const candidates = document.querySelector('#calendar-place-candidates');
const previewDeparture = document.querySelector('#preview-departure');
const emptySummary = summary.textContent;
const emptyRouteStatus = routeStatus.textContent;
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});
const departureReminder = createDepartureReminder(timeFormat);

// Google 액세스 토큰. 메모리에만 두고, 연결돼 있을 때만 내 장소를 계정에도 저장한다.
let token = null;
let events = [];
let source = null;
let scheduleVersion = 0;
let routeVersion = 0;
let stopCatalog = null;
const sampleStopId = 'seoul_002';
const seoulTimeField = (date) => new Date(+date + 9 * 60 * 60_000).toISOString().slice(0, 16);
const sampleDeparture = seoulTimeField(SAMPLE_NOW);
const sampleTrip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);
const sampleArrival = seoulTimeField(sampleTrip.arriveBy);

function accountMessage(message) {
  accountStatus.textContent = message || (token ? 'Google 계정이 연결됐어요.' : signInMessage);
}

// ‘회사’가 / ‘집’이 — 받침에 맞춰 조사를 붙인다.
function subject(label) {
  const code = label.charCodeAt(label.length - 1) - 0xac00;
  return `‘${label}’${code >= 0 && code <= 11171 && code % 28 ? '이' : '가'}`;
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

// 내 장소에 있으면 그 장소를 쓰고, ‘회사’처럼 사용자만 아는 이름은 검색하지 않는다.
function lookup(query) {
  return savedPlace(query) ?? (isPersonalLabel(query) ? null : resolvePlace(query));
}

// 이 브라우저에 먼저 기억하고, Google에 연결돼 있으면 계정에도 올린다. 화면에 보여 줄 안내를 돌려준다.
async function storePlace(alias, place) {
  savePlace(alias, place);
  // 저장소가 막힌 브라우저에서는 기억되지 않는다. 그대로 계정에 올리면 계정의 내 장소가 빈 목록으로 덮인다.
  if (!savedPlace(alias)) throw new Error('이 브라우저에 장소를 기억하지 못했어요.');
  updateStopOptions();
  if (token) {
    try {
      await pushMyPlaces(token);
    } catch (error) {
      console.warn(error);
      return `‘${alias}’ 장소를 이 브라우저에만 기억했어요. Google 계정에는 반영하지 못했어요.`;
    }
  }
  return `‘${alias}’ 장소를 기억했어요.`;
}

function updateStopOptions() {
  const selected = stopSelect.value;
  const groups = [];
  const aliases = Object.keys(exportSavedPlaces());
  if (aliases.length) {
    const group = document.createElement('optgroup');
    group.label = '내 장소';
    for (const alias of aliases) group.append(new Option(alias, `saved:${alias}`));
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
  const alias = stopSelect.value.startsWith('saved:') ? stopSelect.value.slice('saved:'.length) : '';
  const place = alias && savedPlace(alias);
  return place ? { name: alias, place } : null;
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
        const message = await storePlace(alias, place);
        if (version === scheduleVersion) {
          destination.value = alias;
          clearRouteResults();
          await refreshSchedule();
        }
        accountMessage(message);
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
  const remembered = savedPlace(alias);
  if (remembered) {
    summary.textContent = `${appointment} · ${remembered.name ? remembered.name + ' · ' : ''}${remembered.address}`;
    return;
  }

  summary.textContent = `${appointment} · 주소 확인 중…`;
  try {
    const places = (await locateCandidates(alias)).filter((place) => place.address &&
      Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
    if (version !== scheduleVersion) return;
    if (!places.length && isPersonalLabel(alias)) {
      summary.textContent = `${appointment} · ${subject(alias)} 어디인지 목적지에 주소를 입력해 알려 주세요.`;
    } else if (source === 'google') {
      summary.textContent = `${appointment} · ${places.length
        ? `일정 장소를 확인해 주세요. 맞는 곳이 없으면 목적지에 실제 장소를 입력해 확인하면 ‘${alias}’(으)로 기억해요.`
        : `목적지에 실제 장소나 주소를 입력해 확인하면 ‘${alias}’(으)로 기억해요.`}`;
      offerConfirmation(alias, places, version);
    } else {
      summary.textContent = `${appointment} · ${places[0]?.address || '주소를 찾지 못했어요.'}`;
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

async function importCalendar() {
  let granted;
  try {
    // 로그인 창이 막히지 않도록 다른 await보다 먼저 부른다.
    // 창을 닫아도 응답이 오지 않는 경우가 있어, 버튼은 토큰을 받은 뒤에 잠근다.
    granted = token ?? await requestGoogleToken();
  } catch {
    accountMessage('Google 연결을 완료하지 못했어요. 다시 시도해 주세요.');
    return;
  }

  token = granted;
  logout.hidden = false;
  calendarButton.textContent = 'Google 일정 다시 불러오기';
  calendarButton.disabled = true;
  try {
    const items = await fetchGoogleEvents(granted);
    let message = '';
    // 계정의 내 장소를 받지 못해도 일정은 보여 준다. 이 브라우저에 기억한 장소는 그대로 쓴다.
    try {
      await syncMyPlaces(granted);
    } catch (error) {
      console.warn(error);
      message = 'Google 계정의 내 장소를 불러오지 못했어요. 이 브라우저에 기억한 장소만 써요.';
    }
    if (token !== granted) return; // 그사이 연결을 끊었거나 다시 연결했다
    updateStopOptions();
    accountMessage(message);
    showSchedule(items, 'google');
  } catch (error) {
    console.warn(error);
    if (token === granted) {
      const expired = error.status === 401 || /401/.test(error.message);
      if (expired) {
        token = null;
        logout.hidden = true;
        calendarButton.textContent = 'Google로 로그인';
      }
      accountMessage(expired ? 'Google 연결이 만료됐어요. 다시 로그인해 주세요.' : 'Google 일정을 불러오지 못했어요. 다시 시도해 주세요.');
    }
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
// 연결 끊기: 토큰과 불러온 일정을 버리고 처음 화면으로 돌린다. 이 브라우저에 기억한 내 장소는 남는다.
logout.addEventListener('click', () => {
  token = null;
  events = [];
  source = null;
  scheduleVersion += 1; // 진행 중이던 조회 결과를 버린다
  logout.hidden = true;
  calendarButton.textContent = 'Google로 로그인';
  form.reset();
  candidates.replaceChildren();
  clearRouteResults();
  previewDeparture.hidden = true;
  showStopInfo();
  summary.textContent = emptySummary;
  routeStatus.textContent = emptyRouteStatus;
  accountMessage('');
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
  const alias = source === 'google' ? trip.calendar.nextAppointment?.location : null;
  const corrected = alias && placeKey(alias) !== placeKey(trip.destination);
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
      const unknown = [trip.origin, trip.destination].find((query) => isPersonalLabel(query) && !savedPlace(query));
      routeStatus.textContent = confirmedPlaces.hidden
        ? (unknown ? `${subject(unknown)} 어디인지 주소를 입력해 주세요.` : '장소를 확인하지 못했어요. 장소 이름이나 주소를 다시 확인해 주세요.')
        : error.message;
    }
  } finally {
    checkButton.disabled = false;
  }
});

window.addEventListener('pageshow', updateStopOptions);
updateStopOptions();
void initializeStopCatalog();
