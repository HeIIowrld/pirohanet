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

test('a deadline gives each stop only the whole minutes left after both legs', async () => {
  const departAt = new Date('2026-11-21T16:00:00+09:00');
  const places = {
    origin:{latitude:37.50,longitude:127.02},
    stop:{name:'중간 카페',latitude:37.53,longitude:127.00},
    destination:{latitude:37.57,longitude:126.98},
  };
  const fetchFn = async url => {
    if (url instanceof URL) return new Response(null,{status:404});
    const first = new URL(url,'http://localhost').searchParams.get('start_y') === '37.5';
    const seconds = first ? 780 : 1320;
    return Response.json({status:'OK',routes:[{
      properties:{type:'BUS',totalTime:seconds,transfers:0,totalDistance:4000},
      steps:[{properties:{type:'BUS',time:seconds,distance:4000}}],
    }]});
  };
  const query = minutes => queryTransit({
    places,departAt,detourOnly:true,stopArriveBy:new Date(+departAt+minutes*60_000),
    preferences:{savedStop:{stayMinutes:20}},
  },fetchFn);
  const [stop] = await query(60);
  assert.equal(stop.travelMinutes,35);
  assert.equal(stop.stayMinutes,25);
  assert.equal(new Date(stop.stopArrivalAt).toISOString(),'2026-11-21T07:13:00.000Z');
  assert.equal(new Date(stop.stopDepartureAt).toISOString(),'2026-11-21T07:38:00.000Z');
  assert.deepEqual(await query(39),[]);
});

test('a route already fetched in this browser is reused, also after the transit quota runs out', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } });
  let transitCalls = 0;
  let exhausted = false;
  globalThis.fetch = (url) => {
    if (url instanceof URL) return Promise.resolve(new Response(null, { status: 404 }));
    if (!String(url).startsWith('/api/transit')) return Promise.resolve(new Response(null, { status: 404 }));
    transitCalls++;
    if (exhausted) return Promise.resolve(Response.json({ code: -10, msg: 'API limit has been exceeded.' }, { status: 400 }));
    return Promise.resolve(Response.json({ status: 'OK', routes: [{
      properties: { type: 'SUBWAY', totalTime: 1200, transfers: 0, totalDistance: 5000 },
      steps: [{ properties: { type: 'SUBWAY', time: 1200, guidance: '2호선' }, path: { points: [] } }],
    }] }));
  };
  const places = { origin: { latitude: 37.5552, longitude: 126.937 }, destination: { latitude: 37.5777, longitude: 126.986 } };
  const departAt = new Date('2026-11-21T16:30:00+09:00');
  try {
    const first = await queryTransit({ places, departAt, preferences: {} });
    assert.equal(first.length, 1);
    assert.equal(transitCalls, 1);
    await queryTransit({ places, departAt, preferences: {} });
    assert.equal(transitCalls, 1); // 10분 안에는 다시 묻지 않는다

    // 보관한 지 오래됐고 한도가 끝났으면: 한 번 물어보고, 전에 받아 둔 응답으로 보여 준다
    const stored = JSON.parse(data.get('modo.transit.v2'));
    for (const entry of Object.values(stored)) entry.at -= 60 * 60_000;
    data.set('modo.transit.v2', JSON.stringify(stored));
    exhausted = true;
    const reused = await queryTransit({ places, departAt, preferences: {} });
    assert.equal(transitCalls, 2);
    assert.equal(reused[0].travelMinutes, 20);

    // 받아 둔 적 없는 구간은 한도 초과를 그대로 알린다
    const other = { ...places, destination: { latitude: 37.5, longitude: 127.0 } };
    await assert.rejects(queryTransit({ places: other, departAt, preferences: {} }), /한도가 초과/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
});
