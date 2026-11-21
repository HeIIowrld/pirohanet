// 실행: node src/calendar/calendar.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from './calendar.js';
import { SAMPLE_EVENTS, SAMPLE_NOW } from './sample.js';

const event = (start, end, extra = {}) => ({ summary: 'x', start: { dateTime: start }, end: { dateTime: end }, ...extra });

test('시연 일정: 조금 피곤해요 + 광화문 약속', () => {
  assert.deepEqual(summarize(SAMPLE_EVENTS, SAMPLE_NOW), {
    nextAppointment: { title: '저녁 약속', start: '2026-11-20T19:00:00+09:00', location: '교보문고 광화문점' },
    suggestedFatigue: { level: 1, label: '조금 피곤해요', reasons: ['오늘 일정 7시간 10분', '쉬는 틈 없이 4개 연속'] },
  });
});

test('어제 22시 넘어 끝난 일정이 있으면 많이 피곤해요', () => {
  const lateNight = event('2026-11-19T20:00:00+09:00', '2026-11-19T23:00:00+09:00');
  const { suggestedFatigue } = summarize([...SAMPLE_EVENTS, lateNight], SAMPLE_NOW);
  assert.equal(suggestedFatigue.level, 2);
  assert.ok(suggestedFatigue.reasons.includes('어제 일정이 22시 넘어 끝남'));
});

test('오늘 지난 일정이 없으면 추정하지 않는다', () => {
  const result = summarize(SAMPLE_EVENTS, new Date('2026-11-20T08:00:00+09:00'));
  assert.equal(result.suggestedFatigue, null);
  assert.equal(result.nextAppointment.location, '여의도');
});

test('취소·거절·한가함 일정은 빼고, 겹친 일정은 한 번만 센다', () => {
  const allDay = ['2026-11-20T00:30:00+09:00', '2026-11-20T17:50:00+09:00'];
  const noise = [
    event(...allDay, { status: 'cancelled' }),
    event(...allDay, { transparency: 'transparent' }),
    event(...allDay, { attendees: [{ self: true, responseStatus: 'declined' }] }),
    event('2026-11-20T10:00:00+09:00', '2026-11-20T11:00:00+09:00'), // 주간 회의와 겹침
  ];
  const { suggestedFatigue } = summarize([...SAMPLE_EVENTS, ...noise], SAMPLE_NOW);
  assert.equal(suggestedFatigue.reasons[0], '오늘 일정 7시간 10분');
  assert.equal(suggestedFatigue.level, 1);
});
