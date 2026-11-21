import { requireSession, signOut } from './login-session.js';
import { fetchGoogleEvents } from '../calendar/calendar.js';
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
const scheduleArrival = document.querySelector('#schedule-arrival');
const arrivalBuffer = document.querySelector('#arrival-buffer');
const arrivalReason = document.querySelector('#arrival-reason');
const arrivalTarget = document.querySelector('#arrival-target');
const manualArrival = form.elements.arriveBy;
const manualArrivalOption = arrivalBuffer.querySelector('[value="manual"]');
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
const candidates = document.querySelector('#calendar-place-candidates');
const previewDeparture = document.querySelector('#preview-departure');
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});
const scheduleTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul',
});
const departureReminder = createDepartureReminder(timeFormat);

let events = [];
let source = null;
let scheduleVersion = 0;
let scheduleAppointmentKey = null;
let scheduleTimer;
let routeVersion = 0;
let selectedRouteKey = null;
let sampleReminder = null;
let stopCatalog = null;
const sampleStopId = 'seoul_002';
const seoulOffset = 9 * 60 * 60_000;
const seoulTimeField = (date) => new Date(+date + seoulOffset).toISOString().slice(0, 16);
const localTime = (field) => Number.isFinite(field.valueAsNumber) ? new Date(field.valueAsNumber - seoulOffset) : undefined;
const sampleDeparture = seoulTimeField(SAMPLE_NOW);

function accountMessage(message) {
  accountStatus.textContent = message || 'Google 계정이 연결됐어요.';
}

// ‘회사’가 / ‘집’이 — 받침에 맞춰 조사를 붙인다.
function subject(label) {
  const code = label.charCodeAt(label.length - 1) - 0xac00;
  return `‘${label}’${code >= 0 && code <= 11171 && code % 28 ? '이' : '가'}`;
}

function readTiming() {
  const buffer = arrivalBuffer.value;
  return {
    departAt: localTime(form.elements.departAt),
    arriveBy: localTime(manualArrival),
    arrivalBufferMinutes: buffer && buffer !== 'manual' ? Number(buffer) : undefined,
  };
}

function readTrip(stop) {
  const fields = new FormData(form);
  const fatigue = fields.get('fatigue');
  return prepareTrip({
    origin: fields.get('origin'),
    destination: fields.get('destination'),
    ...readTiming(),
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
  const token = requireSession();
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
  return prepareTrip(readTiming(), events, source === 'sample' ? SAMPLE_NOW : new Date());
}

function showArrivalTarget(trip) {
  scheduleArrival.hidden = !trip.arrivalAdvice;
  if (!trip.arrivalAdvice) return;

  const { minutes, reason } = trip.arrivalAdvice;
  const recommended = minutes === 0 ? '시작 시각에 도착' : `${Math.ceil(minutes)}분 전`;
  arrivalBuffer.options[0].textContent = `추천 · ${recommended}`;
  manualArrivalOption.hidden = !manualArrival.value;
  if (manualArrival.value) arrivalBuffer.value = 'manual';
  else if (arrivalBuffer.value === 'manual') arrivalBuffer.value = '';
  const recommendationReason = arrivalBuffer.value ? `추천 ${recommended} · ${reason}` : reason;
  const manualAfterStart = localTime(manualArrival) > trip.arriveBy;
  const manualReason = manualAfterStart ? '입력한 시각이 일정 시작 이후라 일정 시작을 도착 목표로 적용했어요.' : '이동 계획에서 입력한 시각을 적용했어요.';
  arrivalReason.textContent = manualArrival.value ? manualReason : recommendationReason;
  const timingNote = trip.arriveBy <= trip.departAt ? ' 도착 목표가 출발 시각보다 앞서요.' : '';
  arrivalTarget.textContent = `도착 목표 · ${scheduleTimeFormat.format(trip.arriveBy)}까지${timingNote}`;
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

function appointmentKey(next) {
  return next ? JSON.stringify([source, next.start, next.title, next.location]) : null;
}

function syncAppointment() {
  if (source !== 'google' || appointmentKey(scheduleTrip().calendar.nextAppointment) === scheduleAppointmentKey) return false;
  void refreshSchedule();
  return true;
}

async function refreshSchedule(replaceDestination = false) {
  if (!source) return;
  const version = ++scheduleVersion;
  candidates.replaceChildren();
  let trip = scheduleTrip();
  const next = trip.calendar.nextAppointment;
  const key = appointmentKey(next);
  const changed = scheduleAppointmentKey !== key;
  if (scheduleAppointmentKey && changed) {
    arrivalBuffer.value = '';
    manualArrival.value = '';
    trip = scheduleTrip();
  }
  if (changed || replaceDestination) {
    if (next || scheduleAppointmentKey) destination.value = next?.location ?? '';
    clearRouteResults();
  }
  scheduleAppointmentKey = key;
  clearTimeout(scheduleTimer);
  if (source === 'google' && next) {
    scheduleTimer = setTimeout(() => refreshSchedule(), Math.min(Date.parse(next.start) - Date.now(), 2_147_483_647));
  }
  showArrivalTarget(trip);
  if (!next) {
    summary.textContent = '장소가 있는 다음 일정이 없어요.';
    return;
  }

  const alias = next.location;
  const appointment = `${scheduleTimeFormat.format(new Date(next.start))} · ${next.title || '약속'} · ${alias}`;
  const remembered = savedPlace(alias);
  if (remembered) {
    const name = remembered.name && placeKey(remembered.name) !== placeKey(alias) ? `${remembered.name} · ` : '';
    summary.textContent = `${appointment} · ${name}${remembered.address}`;
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
  selectedRouteKey = null;
  sampleReminder = null;
  previewDeparture.hidden = source !== 'sample';
  departureReminder.set(null);
  confirmedPlaces.hidden = true;
  routeResults.replaceChildren();
  routeStatus.textContent = '현재 조건으로 경로를 찾아보세요.';
}

function showSchedule(items, kind) {
  if (source === 'sample' && kind !== 'sample') {
    if (form.elements.departAt.value === sampleDeparture) form.elements.departAt.value = '';
  }
  events = items;
  source = kind;
  void refreshSchedule(true);
}

async function importCalendar() {
  const granted = requireSession();
  if (!granted) return;
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
    if (requireSession() !== granted) return;
    updateStopOptions();
    accountMessage(message);
    showSchedule(items, 'google');
  } catch (error) {
    console.warn(error);
    if (error.message === 'Calendar API 401') signOut();
    else accountMessage('Google 일정을 불러오지 못했어요. 다시 시도해 주세요.');
  } finally {
    calendarButton.disabled = false;
  }
}

sampleButton.addEventListener('click', () => {
  form.elements.origin.value = SAMPLE_ORIGIN;
  form.elements.departAt.value = sampleDeparture;
  manualArrival.value = '';
  arrivalBuffer.value = '';
  showSchedule(SAMPLE_EVENTS, 'sample');
  if (stopSelect.value === sampleStopId) stayMinutes.value = 10;
});
previewDeparture.addEventListener('click', () => {
  const reminder = sampleReminder ?? planDepartureReminder(scheduleTrip(), {
    route: { travelMinutes: 24 },
    reason: '환승 없이 가는 예시 경로예요.',
  });
  if (reminder) departureReminder.preview(reminder, previewDeparture);
});
calendarButton.addEventListener('click', () => importCalendar());
logout.addEventListener('click', signOut);

form.addEventListener('input', ({ target }) => {
  if (syncAppointment()) return;
  if (target === arrivalBuffer && arrivalBuffer.value !== 'manual') manualArrival.value = '';
  if (target === arrivalBuffer || target === manualArrival || target === form.elements.departAt) {
    showArrivalTarget(scheduleTrip());
  }
  clearRouteResults();
});
stopSelect.addEventListener('change', () => {
  const place = selectedRecommendation();
  if (place) stayMinutes.value = source === 'sample' && place.id === sampleStopId
    ? 10 : place.visit_duration_min.recommended;
  showStopInfo();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  syncAppointment();
  const stop = selectedStop();
  const trip = readTrip(stop);
  if (!trip.origin || !trip.destination) {
    routeStatus.textContent = '출발지와 목적지를 입력해 주세요.';
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
    let lateDirect;
    if (routes.some(isDirect)) messages.push('이동 시간과 혼잡도는 예상치예요.');
    else if (fastestDirect && trip.arriveBy && fastestDirect.arrivalAt > trip.arriveBy) {
      lateDirect = fastestDirect;
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
    let plannedRoute;
    function useRoute(option) {
      if (!isCurrent() || plannedRoute === option) return;
      plannedRoute = option;
      const reminder = planDepartureReminder(trip, option);
      if (source === 'google') departureReminder.set(reminder);
      if (source === 'sample') {
        sampleReminder = reminder;
        previewDeparture.hidden = !reminder;
      }
    }
    useRoute(renderRoutes(routeResults, routes, timeFormat, trip.preferences.priority, stop?.name, {
      onSelect(option) {
        selectedRouteKey = option.key;
        useRoute(option);
      },
      selectedKey: selectedRouteKey, lateDirect, departAt: trip.departAt, arriveBy: trip.arriveBy,
    }));
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
window.addEventListener('pageshow', syncAppointment);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncAppointment();
});
updateStopOptions();
void initializeStopCatalog();
