import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionEvents, inferCondition } from './calendar-condition.mjs';

const at = (hour) => `2026-11-21T${hour}:00:00+09:00`;
const event = (id, start, end, fields = {}) => ({
  id, summary: id, start: { dateTime: at(start) }, end: { dateTime: at(end) }, ...fields,
});

test('only relevant schedule snippets and the selected destination supply model evidence', () => {
  const items = [
    event('외근', '10', '12', { description: '<b>두 시간 서 있음</b> https://example.com', location: '주소' }),
    event('비공개', '11', '12', { visibility: 'private' }),
    event('거절', '11', '12', { attendees: [{ self: true, responseStatus: 'declined' }] }),
    event('다른 약속', '16', '17', { description: '캐리어' }),
    event('발표', '17', '18', { description: '구두 착용' }),
  ];
  assert.deepEqual(conditionEvents(items, Date.parse(at('15')), '발표'), {
    schedule: [{ title: '외근', note: '두 시간 서 있음', minutes: 120 }],
    destination: { title: '발표', note: '구두 착용' },
  });
});

test('wrong evidence channels and invalid model enums cannot affect scoring', async () => {
  let request;
  const fetchFn = async (url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: '{"fatigue_signal":"prolonged_standing","mobility_signal":"footwear"}' } }],
    }) };
  };
  const inference = await inferCondition({ schedule: [], destination: { note: '구두' } },
    { apiKey: 'test', model: 'test', fetchFn });
  assert.deepEqual(inference, { fatigue_signal: 'none', mobility_signal: 'footwear' });
  assert.equal(request.store, false);
  assert.equal(await inferCondition({ schedule: [{}], destination: null }, {
    apiKey: 'test', model: 'test',
    fetchFn: async () => ({ ok: true, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: '{"fatigue_signal":"invented","mobility_signal":"none"}' } }],
    }) }),
  }), null);
});
