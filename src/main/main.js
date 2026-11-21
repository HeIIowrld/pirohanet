import { fetchGoogleEvents, requestGoogleToken } from '../calendar/calendar.js';
import { isPersonalLabel, locateCandidates, placeKey, pushMyPlaces, savedPlace, savePlace, syncMyPlaces } from '../calendar/location.js';
import { SAMPLE_EVENTS, SAMPLE_NOW } from '../calendar/sample.js';
import { resolvePlace, resolveTripPlaces } from '../map/places.js';
import { prepareTrip } from './trip.js';

const form = document.querySelector('#trip-form');
const sampleButton = document.querySelector('#load-sample');
const checkButton = document.querySelector('#check-places');
const summary = document.querySelector('#trip-summary');
const routeStatus = document.querySelector('#route-status');
const confirmedPlaces = document.querySelector('#confirmed-places');
const destination = form.elements.destination;
const calendarButton = document.querySelector('#google-calendar');
const logout = document.querySelector('#logout');
const accountStatus = document.querySelector('#account-status');
const candidates = document.querySelector('#calendar-place-candidates');
const emptySummary = summary.textContent;
const emptyRouteStatus = routeStatus.textContent;
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

// Google 액세스 토큰. 메모리에만 두고, 연결돼 있을 때만 내 장소를 계정에도 저장한다.
let token = null;
let events = [];
let source = null;
let scheduleVersion = 0;

function accountMessage(message) {
  accountStatus.textContent = message;
  accountStatus.hidden = !message;
}

// ‘회사’가 / ‘집’이 — 받침에 맞춰 조사를 붙인다.
function subject(label) {
  const code = label.charCodeAt(label.length - 1) - 0xac00;
  return `‘${label}’${code >= 0 && code <= 11171 && code % 28 ? '이' : '가'}`;
}

function readTrip() {
  const fields = new FormData(form);
  const fatigue = fields.get('fatigue');
  return prepareTrip({
    origin: fields.get('origin'),
    destination: fields.get('destination'),
    preferences: { fatigueLevel: fatigue === null ? null : Number(fatigue) },
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

function showSchedule(items, kind) {
  events = items;
  source = kind;
  destination.value = scheduleTrip().destination;
  confirmedPlaces.hidden = true;
  void refreshSchedule();
}

async function importCalendar() {
  let granted;
  try {
    // 로그인 창이 막히지 않도록 다른 await보다 먼저 부른다.
    // 창을 닫아도 응답이 오지 않는 경우가 있어, 버튼은 토큰을 받은 뒤에 잠근다.
    granted = await requestGoogleToken();
  } catch {
    accountMessage('Google 연결을 완료하지 못했어요. 다시 시도해 주세요.');
    return;
  }

  token = granted;
  logout.hidden = false;
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
    accountMessage(message);
    showSchedule(items, 'google');
  } catch (error) {
    console.warn(error);
    if (token === granted) accountMessage('Google 일정을 불러오지 못했어요. 다시 시도해 주세요.');
  } finally {
    calendarButton.disabled = false;
  }
}

sampleButton.addEventListener('click', () => showSchedule(SAMPLE_EVENTS, 'sample'));
calendarButton.addEventListener('click', () => importCalendar());
// 연결 끊기: 토큰과 불러온 일정을 버리고 처음 화면으로 돌린다. 이 브라우저에 기억한 내 장소는 남는다.
logout.addEventListener('click', () => {
  token = null;
  events = [];
  source = null;
  scheduleVersion += 1; // 진행 중이던 조회 결과를 버린다
  logout.hidden = true;
  form.reset();
  candidates.replaceChildren();
  confirmedPlaces.hidden = true;
  summary.textContent = emptySummary;
  routeStatus.textContent = emptyRouteStatus;
  accountMessage('');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const trip = readTrip();
  if (!trip.origin || !trip.destination) {
    routeStatus.textContent = '출발지와 목적지를 입력해 주세요.';
    return;
  }

  const version = scheduleVersion;
  const alias = source === 'google' ? trip.calendar.nextAppointment?.location : null;
  const corrected = alias && placeKey(alias) !== placeKey(trip.destination);
  confirmedPlaces.hidden = true;
  routeStatus.textContent = '장소를 찾는 중이에요.';
  checkButton.disabled = true;
  try {
    const places = await resolveTripPlaces(trip, lookup);
    if (version !== scheduleVersion) return;
    document.querySelector('#origin-result').textContent = places.origin.address || places.origin.name;
    document.querySelector('#destination-result').textContent = places.destination.address || places.destination.name;
    confirmedPlaces.hidden = false;
    routeStatus.textContent = '장소를 확인했어요. 경로 조회는 준비 중이에요.';
    if (corrected && places.destination.address && destination.value.trim() === trip.destination) {
      offerConfirmation(alias, [places.destination], version);
    }
  } catch {
    if (version === scheduleVersion) {
      const unknown = [trip.origin, trip.destination].find((query) => isPersonalLabel(query) && !savedPlace(query));
      routeStatus.textContent = unknown
        ? `${subject(unknown)} 어디인지 주소를 입력해 주세요.`
        : '장소를 확인하지 못했어요. 장소 이름이나 주소를 다시 확인해 주세요.';
    }
  } finally {
    checkButton.disabled = false;
  }
});
