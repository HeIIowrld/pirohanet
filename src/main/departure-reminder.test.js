import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE_EVENTS, SAMPLE_NOW } from '../calendar/sample.js';
import { planDepartureReminder } from './departure-reminder.js';
import { prepareTrip } from './trip.js';

test('출발 알림은 약속 5분 전 도착 목표에서 직행 시간을 올림해 뺀다', () => {
  const trip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);
  const reminder = planDepartureReminder(trip, { travelMinutes: 21.5 });

  assert.equal(reminder.leaveAt, Date.parse('2026-11-20T18:33:00+09:00'));
  assert.equal(reminder.travelMinutes, 22);
  assert.equal(reminder.location, '세종문화회관');
});

test('직접 입력한 도착 목표가 일정 시작 이후여도 시작 시각을 넘기지 않는다', () => {
  const trip = prepareTrip({ arriveBy: new Date('2026-11-20T19:10:00+09:00') }, SAMPLE_EVENTS, SAMPLE_NOW);
  const reminder = planDepartureReminder(trip, { travelMinutes: 22 });

  assert.equal(reminder.leaveAt, Date.parse('2026-11-20T18:38:00+09:00'));
});

test('다른 목적지로 가는 경로나 조회하지 못한 경로로는 일정 알림을 만들지 않는다', () => {
  const trip = prepareTrip({}, SAMPLE_EVENTS, SAMPLE_NOW);

  assert.equal(planDepartureReminder({ ...trip, destination: '서울역' }, { travelMinutes: 22 }), null);
  assert.equal(planDepartureReminder(trip, undefined), null);
});
