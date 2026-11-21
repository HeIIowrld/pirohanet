import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRoutes } from './compare.js';
import { queryTransit } from './transit.js';

test('a short walking leg keeps a saved stop eligible only when there is time to stay', async () => {
  const origin = { name: '출발', latitude: 37.56, longitude: 127.03 };
  const stop = { name: '서점', latitude: 37.57, longitude: 126.978 };
  const destination = { name: '약속', latitude: 37.572, longitude: 126.976 };
  const departAt = new Date('2026-11-20T18:00:00+09:00');
  let walkRequests = 0;
  const routes = await queryTransit({
    places: { origin, stop, destination }, departAt, preferences: { savedStop: { stayMinutes: 10 } },
  }, (url) => {
    if (url instanceof URL) return Promise.resolve(new Response(null, { status: 404 }));
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    if (pathname === '/api/walk') {
      walkRequests++;
      assert.equal(searchParams.get('start_x'), String(stop.longitude));
      assert.equal(searchParams.get('end_x'), String(destination.longitude));
      return Promise.resolve(Response.json({ status: 'OK', route: {
        properties: { totalTime: 240, totalDistance: 320 },
        legs: [{ steps: [{ properties: { time: 240, distance: 320, guidance: '약속 장소까지 도보' } }] }],
      } }));
    }
    if (searchParams.get('start_x') === String(stop.longitude)) {
      return Promise.resolve(Response.json({ status: 'NO_RESULTS' }));
    }
    return Promise.resolve(Response.json({ status: 'OK', routes: [{
      properties: { type: 'BUS', totalTime: 1200, transfers: 0, totalDistance: 5000 },
      steps: [{ properties: { type: 'BUS', time: 1200, distance: 5000 } }],
    }] }));
  });
  assert.equal(walkRequests, 1);
  const via = routes.find((route) => route.viaStop);
  assert.equal(via.travelMinutes, 24);
  assert.equal(via.walkMinutes, 4);
  assert.equal(via.steps.at(-1).type, 'WALKING');
  assert.match(via.links.at(-1).url, /\/by\/walk\//);
  for (const [minutes, expected] of [[34, true], [30, false]]) {
    const result = compareRoutes(routes, {
      departAt, arriveBy: new Date(+departAt + minutes * 60_000), maxExtraTravelMinutes: 4,
    });
    assert.equal(result.some((route) => route.viaStop), expected);
    assert.ok(result.some((route) => !route.viaStop));
  }
});
