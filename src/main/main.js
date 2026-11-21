import { searchPlaceCandidates } from '../calendar/location.js';
import { SAMPLE_EVENTS, SAMPLE_NOW } from '../calendar/sample.js';
import { resolvePlace, resolveTripPlaces } from '../map/places.js';
import { api, savePlace } from '../preferences/account-api.js';
import { placeAliasKey } from '../preferences/place-alias.js';
import { prepareTrip } from './trip.js';

const form = document.querySelector('#trip-form');
const sampleButton = document.querySelector('#load-sample');
const checkButton = document.querySelector('#check-places');
const summary = document.querySelector('#trip-summary');
const routeStatus = document.querySelector('#route-status');
const confirmedPlaces = document.querySelector('#confirmed-places');
const destination = form.elements.destination;
const login = document.querySelector('#google-login');
const calendarButton = document.querySelector('#google-calendar');
const logout = document.querySelector('#logout');
const accountStatus = document.querySelector('#account-status');
const candidates = document.querySelector('#calendar-place-candidates');
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

let signedIn = false;
let events = [];
let source = null;
let scheduleVersion = 0;
const saved = new Map();

function accountMessage(message) {
  accountStatus.textContent = message;
  accountStatus.hidden = !message;
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

function lookup(query) {
  return saved.get(placeAliasKey(query)) ?? resolvePlace(query);
}

async function storePlace(alias, place) {
  const entry = await savePlace(alias, place);
  saved.set(placeAliasKey(entry.alias), entry);
}

async function loadSaved() {
  const entries = await api('/api/saved-places');
  saved.clear();
  for (const entry of entries) saved.set(placeAliasKey(entry.alias), entry);
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

function showSchedule(items, kind) {
  events = items;
  source = kind;
  destination.value = scheduleTrip().destination;
  confirmedPlaces.hidden = true;
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

sampleButton.addEventListener('click', () => showSchedule(SAMPLE_EVENTS, 'sample'));
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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const trip = readTrip();
  if (!trip.origin || !trip.destination) {
    routeStatus.textContent = '출발지와 목적지를 입력해 주세요.';
    return;
  }

  const version = scheduleVersion;
  const alias = source === 'google' && signedIn ? trip.calendar.nextAppointment?.location : null;
  const corrected = alias && placeAliasKey(alias) !== placeAliasKey(trip.destination);
  confirmedPlaces.hidden = true;
  routeStatus.textContent = '장소를 찾는 중이에요.';
  checkButton.disabled = true;
  try {
    const places = await resolveTripPlaces(trip, source === 'sample' ? resolvePlace : lookup);
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
      routeStatus.textContent = '장소를 확인하지 못했어요. 장소 이름이나 주소를 다시 확인해 주세요.';
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
