import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE_EVENTS, SAMPLE_NOW } from '../calendar/sample.js';
import { planDepartureReminder } from './departure-reminder.js';
import { prepareTrip } from './trip.js';

test('출발 알림은 약속 5분 전 도착 목표에서 추천 경로 시간을 올림해 뺀다', () => {
  const trip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);
  const reminder = planDepartureReminder(trip, { route: { travelMinutes: 23.5 } });

  assert.equal(reminder.leaveAt, Date.parse('2026-11-20T18:31:00+09:00'));
  assert.equal(reminder.travelMinutes, 24);
  assert.equal(reminder.location, '세종문화회관');
});

test('회의와 입장 일정은 시작 전 준비 시간을 각각 제안한다', () => {
  for (const [summary, minutes, arriveAt] of [
    ['팀 회의', 10, '18:50'],
    ['저녁 공연', 15, '18:45'],
  ]) {
    const trip = prepareTrip({}, [{ ...SAMPLE_EVENTS.at(-1), summary }], SAMPLE_NOW);

    assert.equal(trip.arrivalAdvice.minutes, minutes);
    assert.equal(+trip.arriveBy, Date.parse(`2026-11-20T${arriveAt}:00+09:00`));
  }
});

test('캘린더의 도착 안내를 제안으로 쓰고 사용자가 변경한 도착 목표로 알린다', () => {
  const events = [{ ...SAMPLE_EVENTS.at(-1), summary: '공연', description: '<p>시작 25분 전까지 입장</p>' }];
  const trip = prepareTrip({ arrivalBufferMinutes: 30 }, events, SAMPLE_NOW);
  const reminder = planDepartureReminder(trip, { route: { travelMinutes: 24 } });

  assert.equal(trip.arrivalAdvice.minutes, 25);
  assert.equal(+trip.arriveBy, Date.parse('2026-11-20T18:30:00+09:00'));
  assert.equal(reminder.leaveAt, Date.parse('2026-11-20T18:06:00+09:00'));
  assert.equal(+prepareTrip({ arrivalBufferMinutes: 0 }, events, SAMPLE_NOW).arriveBy,
    Date.parse('2026-11-20T19:00:00+09:00'));
});

test('캘린더 도착 안내의 시각과 전날 표기를 한국 시간으로 해석한다', () => {
  for (const [description, expected] of [
    ['18:40까지 도착해 주세요.', '2026-11-20T18:40:00+09:00'],
    ['<p>오후 6시&nbsp;35분까지 입장</p>', '2026-11-20T18:35:00+09:00'],
    ['전날 오후 11시 50분까지 접수', '2026-11-19T23:50:00+09:00'],
  ]) {
    const events = [{ ...SAMPLE_EVENTS.at(-1), summary: '팀 회의', description }];
    const trip = prepareTrip({}, events, SAMPLE_NOW);
    assert.equal(+trip.arriveBy, Date.parse(expected));
  }
});

test('선택한 곳에 들르는 경로의 알림은 체류 시간을 포함하고 해당 경로로 연결한다', () => {
  const trip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);
  const reminder = planDepartureReminder(trip, {
    route: { travelMinutes: 24, stayMinutes: 10 },
    reason: '서점에 들러요.',
    href: '#preferred-route',
  });

  assert.equal(reminder.leaveAt, Date.parse('2026-11-20T18:21:00+09:00'));
  assert.equal(reminder.stayMinutes, 10);
  assert.equal(reminder.reason, '서점에 들러요.');
  assert.equal(reminder.href, '#preferred-route');
});

test('직접 입력한 도착 목표가 일정 시작 이후여도 시작 시각을 넘기지 않는다', () => {
  const input = { arrivalBufferMinutes: 15, arriveBy: new Date('2026-11-20T19:10:00+09:00') };
  const trip = prepareTrip(input, SAMPLE_EVENTS, SAMPLE_NOW);
  const reminder = planDepartureReminder(trip, { route: { travelMinutes: 24 } });

  assert.equal(+trip.arriveBy, Date.parse('2026-11-20T19:00:00+09:00'));
  assert.equal(reminder.arriveBy, +trip.arriveBy);
  assert.equal(reminder.leaveAt, Date.parse('2026-11-20T18:36:00+09:00'));
  assert.equal(+prepareTrip(input, [], SAMPLE_NOW).arriveBy, +input.arriveBy);
});

test('다른 목적지로 가는 경로나 조회하지 못한 경로로는 일정 알림을 만들지 않는다', () => {
  const trip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);

  assert.equal(planDepartureReminder({ ...trip, destination: '서울역' }, { route: { travelMinutes: 24 } }), null);
  assert.equal(planDepartureReminder(trip, undefined), null);
});
