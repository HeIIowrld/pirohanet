// 실행: node src/calendar/calendar.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from './calendar.js';
import { SAMPLE_EVENTS, SAMPLE_NOW } from './sample.js';

const event = (start, end, extra = {}) => ({ summary: 'x', start: { dateTime: start }, end: { dateTime: end }, ...extra });
const friday = (hhmm) => new Date(`2026-11-20T${hhmm}:00+09:00`);
// 점심 미팅의 장소를 지워 다음 약속이 19시 저녁 약속 하나만 남게 한 일정
const DINNER_ONLY = SAMPLE_EVENTS.map((e) => (e.summary === '점심 미팅' ? { ...e, location: undefined } : e));

test('시연 일정: 3점 피곤해요 + 광화문 약속', () => {
  assert.deepEqual(summarize(SAMPLE_EVENTS, SAMPLE_NOW), {
    nextAppointment: { title: '저녁 약속', start: '2026-11-20T19:00:00+09:00', location: '교보문고 광화문점' },
    suggestedFatigue: { level: 3, label: '피곤해요', reasons: ['오늘 일정 7시간 10분', '쉬는 틈 없이 4개 연속'] },
    fatigue: { level: 3, label: '피곤해요', reasons: ['약속 전 일정 7시간 10분', '쉬는 틈 없이 4개 연속'] },
  });
});

test('전날 22시 넘어 끝난 일정이 있으면 많이 피곤해요', () => {
  const lateNight = event('2026-11-19T20:00:00+09:00', '2026-11-19T23:00:00+09:00');
  const { fatigue } = summarize([...SAMPLE_EVENTS, lateNight], SAMPLE_NOW);
  assert.equal(fatigue.level, 4);
  assert.ok(fatigue.reasons.includes('전날 일정이 22시 넘어 끝남'));
});

test('남은 일정이 없으면 사용자가 고른 컨디션을 그대로 쓴다', () => {
  for (const level of [1, 2, 3, 4, 5]) assert.equal(summarize(SAMPLE_EVENTS, SAMPLE_NOW, level).fatigue.level, level);
  assert.deepEqual(summarize(SAMPLE_EVENTS, SAMPLE_NOW, 1).fatigue.reasons, ["지금 컨디션 1점 '괜찮아요'"]);
});

test('아침에 고른 컨디션에 약속 전 남은 일정 부담을 더한다', () => {
  const at8 = (level) => summarize(DINNER_ONLY, friday('08:00'), level);
  assert.equal(at8(null).suggestedFatigue, null); // 지금까지 일정이 없어 기본값 없음
  assert.equal(at8(null).fatigue.level, 3); // 입력이 없으면 달력만으로
  assert.deepEqual(at8(1).fatigue, { level: 3, label: '피곤해요', reasons: ["지금 컨디션 1점 '괜찮아요'", '약속 전 남은 일정 7시간 10분'] });
  assert.equal(at8(2).fatigue.level, 4);
  assert.equal(at8(4).fatigue.level, 5); // 상한
});

test('기본값을 그대로 고르면 달력만으로 계산한 값과 같다', () => {
  const calendarOnly = summarize(DINNER_ONLY, friday('12:35'));
  assert.equal(calendarOnly.suggestedFatigue.level, 1); // 오전 일정 2시간 30분
  const accepted = summarize(DINNER_ONLY, friday('12:35'), calendarOnly.suggestedFatigue.level);
  assert.equal(accepted.fatigue.level, calendarOnly.fatigue.level);
  assert.deepEqual(accepted.fatigue.reasons, ["지금 컨디션 1점 '괜찮아요'", '약속 전 남은 일정 4시간 40분']);
});

test('오후에 기본값을 고르면 달력만의 값과 같고, 더 높게 고르면 남은 일정만큼 오른다', () => {
  const at1405 = (level) => summarize(SAMPLE_EVENTS, friday('14:05'), level);
  assert.equal(at1405(null).suggestedFatigue.level, 1); // 지금까지 3시간 50분, 3개 연속
  assert.equal(at1405(null).fatigue.level, 3);
  assert.deepEqual(at1405(1).fatigue, { level: 3, label: '피곤해요', reasons: ["지금 컨디션 1점 '괜찮아요'", '약속 전 남은 일정 3시간 20분'] });
  assert.equal(at1405(2).fatigue.level, 4);
  assert.equal(at1405(4).fatigue.level, 5); // 상한
});

test('같은 날이면 어느 시각에든 기본값을 그대로 고른 결과가 달력만의 값과 같다', () => {
  for (const hhmm of ['08:00', '10:30', '12:35', '14:05', '16:00', '18:00']) {
    const calendarOnly = summarize(DINNER_ONLY, friday(hhmm));
    if (!calendarOnly.suggestedFatigue) continue;
    const accepted = summarize(DINNER_ONLY, friday(hhmm), calendarOnly.suggestedFatigue.level);
    assert.equal(accepted.fatigue.level, calendarOnly.fatigue.level, hhmm);
  }
});

test('약속이 내일이면 내일 일정으로 계산한다', () => {
  const saturday = [
    event('2026-11-21T07:00:00+09:00', '2026-11-21T09:00:00+09:00'),
    event('2026-11-21T12:00:00+09:00', '2026-11-21T13:00:00+09:00', { location: '신촌' }),
  ];
  const result = summarize([...SAMPLE_EVENTS, ...saturday], friday('22:00'));
  assert.equal(result.nextAppointment.location, '신촌');
  assert.equal(result.suggestedFatigue.reasons[0], '오늘 일정 9시간 10분'); // 지금 컨디션은 오늘 기준
  assert.deepEqual(result.fatigue.reasons, ['약속 전 일정 2시간', '첫 일정이 8시 전']);
});

test('남은 약속이 없으면 오늘 지금까지의 일정으로 계산한다', () => {
  const result = summarize(SAMPLE_EVENTS, friday('22:00'));
  assert.equal(result.nextAppointment, null);
  assert.equal(result.fatigue.reasons[0], '오늘 일정 9시간 10분');
  assert.equal(summarize(SAMPLE_EVENTS, friday('22:00'), 1).fatigue.level, 1);
});

test('일정 근거가 없으면 추정하지 않고, 사용자 입력이 있으면 그 값을 쓴다', () => {
  const onlyDinner = SAMPLE_EVENTS.filter((e) => e.summary === '저녁 약속');
  const result = summarize(onlyDinner, SAMPLE_NOW);
  assert.equal(result.suggestedFatigue, null);
  assert.equal(result.fatigue, null);
  assert.equal(summarize(onlyDinner, SAMPLE_NOW, 1).fatigue.level, 1);
});

test('취소·거절·한가함 일정은 빼고, 겹친 일정은 한 번만 센다', () => {
  const allDay = ['2026-11-20T00:30:00+09:00', '2026-11-20T17:50:00+09:00'];
  const noise = [
    event(...allDay, { status: 'cancelled' }),
    event(...allDay, { transparency: 'transparent' }),
    event(...allDay, { attendees: [{ self: true, responseStatus: 'declined' }] }),
    event('2026-11-20T10:00:00+09:00', '2026-11-20T11:00:00+09:00'), // 주간 회의와 겹침
  ];
  const { fatigue } = summarize([...SAMPLE_EVENTS, ...noise], SAMPLE_NOW);
  assert.equal(fatigue.reasons[0], '약속 전 일정 7시간 10분');
  assert.equal(fatigue.level, 3);
});

test('userLevel이 1~5의 정수나 null이 아니면 거부한다', () => {
  for (const bad of [0, 6, -1, '3', 2.5]) assert.throws(() => summarize(SAMPLE_EVENTS, SAMPLE_NOW, bad), RangeError);
});
