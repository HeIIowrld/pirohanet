import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCalendarEvents, summarize } from '../public/calendar.js';
import { demo, sampleEvents } from '../public/scenario.js';

const now = Date.parse(demo.departAt);
const friday = time => Date.parse(`2026-11-20T${time}:00+09:00`);

test('sample appointment, fallback origin and fatigue use the same Seoul time', () => {
  const result = summarize(sampleEvents, now);
  assert.equal(result.next.location, demo.destination);
  assert.equal(result.origin.location, demo.origin);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.fatigue.value, 'normal');
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
  assert.equal(automated.projectedFatigue.value, 'normal');
  const adjusted = summarize(events, morning, { currentFatigue: 'normal', arriveBy });
  assert.equal(adjusted.projectedFatigue.value, 'tired');
  assert.equal(adjusted.projectedFatigue.reasons[1], '약속 전 남은 일정 7시간 10분');
  assert.equal(summarize(events, now, { currentFatigue: 'relaxed', arriveBy }).projectedFatigue.value, 'relaxed');
});

test('a revised arrival time sets the end of the fatigue forecast', () => {
  const result = summarize(sampleEvents, friday('08:00'), { arriveBy: friday('12:35') });
  assert.equal(result.projectedFatigue.value, 'relaxed');
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
