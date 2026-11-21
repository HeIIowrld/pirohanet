import assert from 'node:assert/strict';
import test from 'node:test';
import { tripCondition } from './calendar-condition.js';
import { makeTrip, routeResult } from './services.js';

test('schedule content adjusts the estimate and footwear affects route ranking separately', () => {
  const now = new Date('2026-11-21T14:00:00+09:00');
  const events = [{
    summary: '외근',
    start: { dateTime: '2026-11-21T10:00:00+09:00' },
    end: { dateTime: '2026-11-21T13:00:00+09:00' },
  }];
  const inference = { fatigue_signal: 'prolonged_standing', mobility_signal: 'footwear' };
  const automatic = tripCondition(events, now, now, null, inference);
  assert.equal(automatic.level, 2);
  assert.equal(automatic.mobility, 'footwear');
  assert.equal(tripCondition(events, now, now, 1, inference).level, 1);
  assert.equal(tripCondition(events, now, now, null, null).level, 1);
  assert.equal(tripCondition([], now, now, null, null).level, null);

  const form = { origin: '출발', destination: '도착', departure: '2026-11-21T14:00' };
  const trip = makeTrip(form, null, automatic.level);
  const routes = [
    { id: 'fast', travelMinutes: 20, walkMinutes: 14, transfers: 1 },
    { id: 'easy', travelMinutes: 31, walkMinutes: 5, transfers: 0 },
  ];
  assert.equal(routeResult(routes, trip).secondLabel, '환승 적은 길');
  const withMobility = { ...trip, preferences: { ...trip.preferences, mobility: automatic.mobility } };
  const result = routeResult(routes, withMobility);
  assert.equal(result.secondLabel, '편한 길');
  assert.ok(result.direct[1].comfortScore < result.direct[0].comfortScore);
});
