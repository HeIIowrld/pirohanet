import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FATIGUE_LABELS, fetchCalendarEvents, summarize } from '../public/calendar.js';
import { demo, sampleEvents } from '../public/scenario.js';

const now = Date.parse(demo.departAt);
const friday = time => Date.parse(`2026-11-20T${time}:00+09:00`);

test('sample appointment, fallback origin and fatigue use the same Seoul time', () => {
  const result = summarize(sampleEvents, now);
  assert.equal(result.next.location, demo.destination);
  assert.equal(result.origin.location, demo.origin);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.fatigue.value, 3);
  assert.equal(result.fatigue.reasons[0], '오늘 일정 7시간 10분');
});

test('an appointment without a location stays first and overlaps count once', () => {
  const next = { ...sampleEvents.at(-1), location: undefined };
  const copy = { ...sampleEvents[1], location: '잘못된 출발지', status: 'cancelled' };
  const result = summarize([...sampleEvents.slice(0, -1), copy, sampleEvents[1], next], now);
  assert.equal(result.next.location, '');
  assert.equal(result.fatigue.reasons[0], '오늘 일정 7시간 10분');
  assert.equal(summarize(sampleEvents, Date.parse('2026-11-20T08:00:00+09:00')).fatigue, null);
});

test('the planner waits until an ongoing appointment ends', () => {
  const current = { ...sampleEvents[4], location: demo.origin, end: { dateTime: '2026-11-20T18:40:00+09:00' } };
  const result = summarize([sampleEvents[3], current, sampleEvents[5]], now);
  assert.equal(result.departAt, Date.parse(current.end.dateTime));
  assert.equal(result.needsConfirmation, false);
});

test('a morning fatigue preference includes only the remaining schedule load', () => {
  const events = sampleEvents.map((event, index) => index === 3 ? { ...event, location: undefined } : event);
  const morning = friday('08:00');
  const arriveBy = Date.parse(demo.arriveBy);
  const automated = summarize(events, morning, { arriveBy });
  assert.equal(automated.fatigue, null);
  assert.equal(automated.projectedFatigue.value, 3);
  const forecast = (time, currentFatigue) => summarize(events, time, { currentFatigue, arriveBy }).projectedFatigue;
  assert.deepEqual(forecast(morning, 1), { value: 3, reasons: ['지금 컨디션 1점 ‘괜찮아요’', '약속 전 남은 일정 7시간 10분'] });
  assert.equal(forecast(morning, 2).value, 4);
  assert.deepEqual(forecast(now, 1), { value: 1, reasons: ['지금 컨디션 1점 ‘괜찮아요’'] });
  assert.equal(forecast(now, 3).value, automated.projectedFatigue.value);
});

test('the fatigue forecast never goes above 5', () => {
  const arriveBy = Date.parse(demo.arriveBy);
  const forecast = currentFatigue => summarize(sampleEvents, friday('08:00'), { currentFatigue, arriveBy }).projectedFatigue;
  assert.equal(forecast(3).value, 5);
  assert.equal(forecast(4).value, 5);
  assert.deepEqual(forecast(5), { value: 5, reasons: ['지금 컨디션 5점 ‘녹초예요’', '약속 전 남은 일정 7시간 10분'] });
});

test('only an integer from 1 to 5 counts as a chosen fatigue score', () => {
  const calendarOnly = summarize(sampleEvents, now).projectedFatigue;
  assert.equal(calendarOnly.reasons[0], '약속 전 일정 7시간 10분');
  for (const missing of [undefined, null]) {
    assert.deepEqual(summarize(sampleEvents, now, { currentFatigue: missing }).projectedFatigue, calendarOnly);
  }
  for (const invalid of [0, '', '3', 6, -1, 2.5, NaN, true]) {
    assert.throws(() => summarize(sampleEvents, now, { currentFatigue: invalid }), RangeError, String(invalid));
  }
  assert.deepEqual(Object.keys(FATIGUE_LABELS), ['1', '2', '3', '4', '5']);
});

test('the schedule score maps to a fatigue level from 1 to 5', () => {
  const event = (start, end, location) => ({ start: { dateTime: `2026-11-20T${start}:00+09:00` }, end: { dateTime: `2026-11-20T${end}:00+09:00` }, location });
  const chain = location => [event('07:00', '09:00', location), event('09:00', '11:00', location), event('11:00', '13:00', location)];
  // Score signals: 4 hours busy +1 (6 hours +2), 3 events in a row +1, a start before 8:00 +1, 3 events with a place +1.
  const table = [
    [0, 1, [event('10:00', '11:00')]],
    [1, 1, [event('10:00', '14:00')]],
    [2, 2, [event('10:00', '16:00')]],
    [3, 3, [event('07:00', '13:00')]],
    [4, 4, chain()],
    [5, 5, chain('서울시청')]
  ];
  for (const [score, level, events] of table) {
    assert.equal(summarize(events, friday('20:00')).fatigue.value, level, `score ${score}`);
  }
});

test('a revised arrival time sets the end of the fatigue forecast', () => {
  const result = summarize(sampleEvents, friday('08:00'), { arriveBy: friday('12:35') });
  assert.equal(result.projectedFatigue.value, 1);
  assert.equal(result.projectedFatigue.reasons[0], '약속 전 일정 2시간 30분');
});

test('Google Calendar reads later pages and requests only needed fields', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', async url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('timeMin'), '2026-11-18T15:00:00.000Z');
    assert.equal(params.get('timeMax'), '2026-11-26T15:00:00.000Z');
    assert.equal(params.get('singleEvents'), 'true');
    assert(!params.get('fields').includes('description'));
    return Response.json(params.has('pageToken') ? { items: [sampleEvents[5]] } :
      { items: [sampleEvents[1]], nextPageToken: 'page-two' });
  });
  assert.deepEqual(await fetchCalendarEvents('test-token', now), [sampleEvents[1], sampleEvents[5]]);
  assert.equal(fetch.mock.callCount(), 2);
});
