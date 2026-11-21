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
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

let sampleLoaded = false;

function readTrip() {
  const fields = new FormData(form);
  const fatigue = fields.get('fatigue');
  return prepareTrip({
    origin: fields.get('origin'),
    destination: fields.get('destination'),
    preferences: { fatigueLevel: fatigue === null ? null : Number(fatigue) },
  }, sampleLoaded ? SAMPLE_EVENTS : [], sampleLoaded ? SAMPLE_NOW : new Date());
}

sampleButton.addEventListener('click', async () => {
  sampleLoaded = true;
  const trip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);
  destination.value = trip.destination;
  if (!trip.arriveBy) {
    summary.textContent = '장소가 있는 다음 일정이 없어요.';
    return;
  }

  const appointment = `${trip.destination} · ${timeFormat.format(trip.arriveBy)}까지 도착`;
  summary.textContent = `${appointment} · 주소 확인 중…`;
  sampleButton.disabled = true;
  try {
    const place = await resolvePlace(trip.destination);
    summary.textContent = `${appointment} · ${place?.address || '주소를 찾지 못했어요.'}`;
  } catch {
    summary.textContent = `${appointment} · 위치 검색에 실패했어요.`;
  } finally {
    sampleButton.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const trip = readTrip();
  if (!trip.origin || !trip.destination) {
    routeStatus.textContent = '출발지와 목적지를 입력해 주세요.';
    return;
  }

  confirmedPlaces.hidden = true;
  routeStatus.textContent = '장소를 찾는 중이에요.';
  checkButton.disabled = true;
  try {
    const places = await resolveTripPlaces(trip);
    document.querySelector('#origin-result').textContent = places.origin.address || places.origin.name;
    document.querySelector('#destination-result').textContent = places.destination.address || places.destination.name;
    confirmedPlaces.hidden = false;
    routeStatus.textContent = '장소를 확인했어요. 경로 조회는 준비 중이에요.';
  } catch {
    routeStatus.textContent = '장소를 확인하지 못했어요. 장소 이름이나 주소를 다시 확인해 주세요.';
  } finally {
    checkButton.disabled = false;
  }
});
