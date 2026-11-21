import { SAMPLE_EVENTS, SAMPLE_NOW } from '../calendar/sample.js';
import { prepareTrip } from './trip.js';

const sampleButton = document.querySelector('#load-sample');
const summary = document.querySelector('#trip-summary');
const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

sampleButton.addEventListener('click', () => {
  const trip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);
  summary.textContent = trip.arriveBy
    ? `${trip.destination} · ${timeFormat.format(trip.arriveBy)}까지 도착`
    : '장소가 있는 다음 일정이 없어요.';
});
