import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRoutes } from './compare.js';

const departAt = new Date('2026-11-20T18:00:00+09:00');
const fast = { travelMinutes: 35, walkMinutes: 11, transfers: 1 };
const comfortable = { travelMinutes: 41, walkMinutes: 6, transfers: 0 };

test('the Gwanghwamun direct recommendation changes with fatigue', () => {
  for (const [fatigueLevel, expected] of [[1, 35], [2, 35], [3, 35], [4, 41], [5, 41]]) {
    const [best] = compareRoutes([fast, comfortable], { departAt, preferences: { fatigueLevel } });
    assert.equal(best.travelMinutes, expected);
  }
});

test('crowding is scored only when every eligible direct candidate has coverage', () => {
  const crowded = { ...fast, subwayMinutes: 20, knownRideMinutes: 20, crowdingBurden: 10 };
  const quiet = { ...comfortable, subwayMinutes: 20, knownRideMinutes: 20, crowdingBurden: 0 };
  const options = { departAt, preferences: { priority: 'crowding' } };
  assert.equal(compareRoutes([crowded, quiet], options)[0].travelMinutes, 41);
  const [best] = compareRoutes([crowded, { ...quiet, knownRideMinutes: 19 }], options);
  assert.equal(best.travelMinutes, 35);
  assert.equal(best.crowdingCompared, false);
});

test('a stop includes stay time in arrival but excludes it from the extra travel budget', () => {
  const via = { travelMinutes: 40, stayMinutes: 10, viaStop: true };
  const options = { departAt, maxExtraTravelMinutes: 5 };
  const routes = compareRoutes([fast, via], { ...options, arriveBy: new Date(+departAt + 55 * 60_000) });
  assert.equal(routes[1].extraTravelMinutes, 5);
  assert.equal(routes[1].arrivalAt.getTime(), +departAt + 50 * 60_000);
  const tooLate = compareRoutes([fast, via], { ...options, arriveBy: new Date(+departAt + 45 * 60_000) });
  assert.equal(tooLate.length, 1);
});

test('weekend downtown traffic can favor rail without changing ETA or eligibility', () => {
  const bus = { mode: 'BUS', travelMinutes: 28, busMinutes: 24, walkMinutes: 6 };
  const rail = { mode: 'SUBWAY', travelMinutes: 32, walkMinutes: 6 };
  const saturday = new Date('2026-11-21T18:00:00+09:00');
  const places = { destination: { latitude: 37.572, longitude: 126.976 } };
  const options = { departAt: saturday, places };
  const [best, fastest] = compareRoutes([bus, rail], options);
  assert.equal(best.mode, 'SUBWAY');
  assert.equal(fastest.arrivalAt.getTime(), +saturday + 28 * 60_000);
  assert.equal(compareRoutes([bus, rail], { ...options, places: {} })[0].mode, 'BUS');
  assert.equal(compareRoutes([bus, rail], {
    ...options, departAt: new Date('2026-11-21T09:00:00+09:00'),
  })[0].mode, 'BUS');
  assert.equal(compareRoutes([bus, rail], {
    ...options, arriveBy: new Date(+saturday + 30 * 60_000),
  })[0].mode, 'BUS');
});

test('line avoidance depends on the selected line and time spent aboard', () => {
  const line1 = { travelMinutes: 30, subwayLineMinutes: { 1: 20 } };
  const line5 = { travelMinutes: 34, subwayLineMinutes: { 5: 23 } };
  const options = { departAt, preferences: { avoidLine: '1' } };
  assert.equal(compareRoutes([line1, line5], { departAt })[0].travelMinutes, 30);
  assert.equal(compareRoutes([line1, line5], options)[0].travelMinutes, 34);
  assert.equal(compareRoutes([
    { ...line1, subwayLineMinutes: { 1: 2 } }, line5,
  ], options)[0].travelMinutes, 30);
});
