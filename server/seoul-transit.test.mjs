import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeoulTransit } from './seoul-transit.mjs';
import { queryRoutes } from '../frontend/src/services.js';

const coords = { start_x: 126.9368, start_y: 37.5555, end_x: 127.0055, end_y: 37.5641 };
const bus = {
  routeNm: '721', routeId: '100100112', fid: '113000420', fname: '신촌오거리.현대백화점',
  fx: '126.9359', fy: '37.5553', tname: '서대문역사거리', tx: '126.9666', ty: '37.5655',
  railLinkList: null,
};
const rail = {
  routeNm: '5호선', routeId: null, fname: '서대문역',
  fx: '126.9666', fy: '37.5657', tname: '동대문역사문화공원역', tx: '127.0058', ty: '37.5646',
  railLinkList: [1, 2, 3, 4].map(railLinkId => ({ railLinkId })),
};
const response = (routes) => Response.json({ msgHeader: { headerCd: '0' }, msgBody: { itemList: routes } });

test('Seoul paths preserve candidate times and IDs through the weighted route comparison', async () => {
  let lookups = 0;
  const city = createSeoulTransit({ serviceKey: 'fixture%2Bkey', fetchFn: (url) => {
    lookups++;
    const params = new URL(url).searchParams;
    assert.equal(params.get('serviceKey'), 'fixture+key');
    assert.equal(Number(params.get('startX')), coords.start_x);
    return response([
      { time: '26', distance: '7634', pathList: [bus, rail] },
      { time: '30', distance: '8000', pathList: [{ ...bus, tx: coords.end_x, ty: coords.end_y }] },
    ]);
  } });
  const [result, same] = await Promise.all([city(coords), city(coords)]);
  assert.equal(result, same);
  assert.equal(lookups, 1);
  const previousFetch = globalThis.fetch;
  let requestedBus = false;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/transit') return Response.json(result);
    if (parsed.pathname === '/api/bus-information') {
      assert.equal(parsed.searchParams.get('stopId'), bus.fid);
      assert.equal(parsed.searchParams.get('routeId'), bus.routeId);
      assert.equal(parsed.searchParams.has('next'), false);
      requestedBus = true;
      return Response.json({ routes: [] });
    }
    throw new Error('No optional data in fixture');
  };
  try {
    const ranked = await queryRoutes({ departAt: new Date(), preferences: {} }, { places: {
      origin: { longitude: coords.start_x, latitude: coords.start_y },
      destination: { longitude: coords.end_x, latitude: coords.end_y },
    } });
    assert.equal(ranked.all.length, 2);
    assert.equal(ranked.direct[0].travelMinutes, 26);
    assert.equal(ranked.direct[0].transfers, 1);
    assert.ok(Number.isFinite(ranked.direct[0].comfortScore));
    assert.equal(ranked.direct[0].source, 'seoul');
    assert.ok(requestedBus);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a provider limit stays retryable and differs from a successful empty result', async () => {
  let lookups = 0;
  const city = createSeoulTransit({ serviceKey: 'fixture', fetchFn: () => {
    lookups++;
    return lookups === 1 ? new Response(null, { status: 429 }) : response([]);
  } });
  await assert.rejects(city(coords), { status: 429 });
  assert.deepEqual(await city(coords), { status: 'NO_RESULTS', routes: [], source: 'seoul' });
  assert.equal(lookups, 2);
});
