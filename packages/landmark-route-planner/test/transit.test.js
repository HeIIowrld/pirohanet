import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demo } from '../public/scenario.js';
import { recommend } from '../lib/routes.js';
import { transitRoutes } from '../lib/transit.js';

const start = [126.97805, 37.56657];
const end = [126.97788, 37.57096];
const now = Date.parse(demo.departAt);
const request = { departAt: now, arriveBy: Date.parse(demo.arriveBy) };
const keys = { SEOUL_TRANSIT_KEY: 'test-transit-key', SEOUL_BUS_KEY: 'test-bus-key', SEOUL_SUBWAY_KEY: 'test-subway-key' };

function publicXML(items) {
  return '<ServiceResult><msgHeader><headerCd>0</headerCd></msgHeader><msgBody>' +
    items.map(fields => '<itemList>' + fields + '</itemList>').join('') + '</msgBody></ServiceResult>';
}

function fields(values) {
  return Object.entries(values).map(([key, value]) => '<' + key + '>' + value + '</' + key + '>').join('');
}

test('bus departures before walking arrival remain visible without being used for the itinerary', async context => {
  const boarding = '100000001';
  const alighting = '100000002';
  const leg = fields({ fid: boarding, tid: alighting, fx: 126.9778, fy: 37.5679,
    tx: 126.9776, ty: 37.571, fname: '시청', tname: '광화문', routeId: '100100001', routeNm: '7016' });
  context.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url);
    if (path.pathname.includes('pathinfo')) {
      assert.equal(path.searchParams.get('startX'), String(start[0]));
      assert.equal(path.searchParams.get('serviceKey'), keys.SEOUL_TRANSIT_KEY);
      return new Response(publicXML(['<time>12</time><pathList>' + leg + '</pathList>']));
    }
    assert.equal(path.searchParams.get('serviceKey'), keys.SEOUL_BUS_KEY);
    assert.equal(path.searchParams.get('busRouteId'), '100100001');
    return new Response(publicXML([
      fields({ stId: boarding, staOrd: '5', mkTm: '2026-11-20 18:00:00.0',
        arrmsg1: '곧 도착', exps1: 30, arrmsg2: '5분 후', exps2: 300 }),
      fields({ stId: alighting, staOrd: '9' })
    ]));
  });
  const result = await transitRoutes(start, end, request, keys, now);
  const route = result.routes[0];
  assert.equal(result.status, 'ready');
  assert.equal(route.approach, 3);
  assert.equal(route.wait, 2);
  assert.equal(route.minutes, 14);
  assert.deepEqual(route.legs[0].arrivals.map(item => [item.minutes, item.catchable]), [[1, false], [5, true]]);
});

test('subway arrivals must match line and direction and use the observation time', async context => {
  const leg = { fid: '1001000132', tid: '1001000130', routeNm: '1호선', fname: '시청역', tname: '종로3가역',
    railLinkId: '1001000132|1001000131|1001000130', fx: 126.978, fy: 37.567, tx: 126.99, ty: 37.57 };
  const record = { statnNm: '시청', subwayId: '1001', statnTid: '1001000131',
    recptnDt: '2026-11-20 17:59:00', barvlDt: '300' };
  context.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/pathinfo/')) {
      return Response.json({ msgHeader: { headerCd: 0 }, msgBody: { itemList: { time: 19, pathList: [leg] } } });
    }
    assert.match(String(url), /\/json\/realtimeStationArrival\/0\/30\//);
    return Response.json({ realtimeArrivalList: [
      { ...record }, { ...record, subwayId: '1002' }, { ...record, statnTid: '1001000133' },
      { ...record, bstatnId: '1001000131' }, { ...record, recptnDt: '2026-11-20 17:55:00' }
    ] });
  });
  const result = await transitRoutes(start, end, request, keys, now);
  assert.equal(result.routes[0].legs[0].kind, 'subway');
  assert.deepEqual(result.routes[0].legs[0].arrivals.map(item => item.minutes), [4]);
});

test('a subway-only endpoint and numbered rail links resolve the real boarding direction', async context => {
  const boarding = [126.924, 37.5217];
  const alighting = [126.977, 37.5716];
  const leg = { fid: '25270', tid: '25340', routeNm: '5호선', fname: '여의도역', tname: '광화문역',
    railLinkList: Array.from({ length: 7 }, (_, i) => ({ railLinkId: String(i + 1) })),
    fx: boarding[0], fy: boarding[1], tx: alighting[0], ty: alighting[1] };
  const record = { statnNm: '여의도', subwayId: '1005', trainLineNm: '마천행 - 여의나루방면',
    bstatnNm: '마천', recptnDt: '2026-11-20 18:00:00', barvlDt: '300' };
  context.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url).pathname;
    if (path.includes('/pathinfo/')) {
      return Response.json(path.endsWith('getPathInfoBySubway')
        ? { msgHeader: { headerCd: 0 }, msgBody: { itemList: [{ time: 18, pathList: [leg] }] } }
        : { msgHeader: { headerCd: 4 } });
    }
    return Response.json({ realtimeArrivalList: [
      record, { ...record, trainLineNm: '방화행 - 신길방면' }, { ...record, bstatnNm: '공덕' }
    ] });
  });
  const result = await transitRoutes(boarding, alighting, request, keys, now);
  assert.equal(result.routes[0].legs[0].line, '5호선');
  assert.deepEqual(result.routes[0].legs[0].arrivals.map(item => item.minutes), [5]);
});

test('demo includes both transit modes and curated places within the dwell budget', async () => {
  const payload = { ...demo, mode: 'demo', fatigue: 'normal', calendar: true, catalog: true, transit: true, allowance: 15, places: [] };
  const result = await recommend(payload, {});
  assert.deepEqual(result.transit.routes.map(route => route.legs[0].kind), ['bus', 'subway']);
  assert.equal(result.transit.status, 'sample');
  for (const route of result.stops.filter(route => route.place.minStay)) {
    assert(route.stay >= route.place.minStay && route.stay <= route.maxStay);
    assert(route.place.description);
    assert(route.place.interests.length);
  }
  assert(result.stops.some(route => route.place.name === '덕수궁 돌담길'));
  const short = await recommend({ ...payload, allowance: 12 }, {});
  assert(!short.stops.some(route => route.place.name === '덕수궁 돌담길'));
});

test('alternatives keep bus-only and subway-only routes alongside faster mixed routes', async context => {
  const bus = { fx: 126.978, fy: 37.567, tx: 126.979, ty: 37.568,
    fname: '시청앞', tname: '광화문', routeId: '100100001', routeNm: '7016' };
  const subway = { fx: 126.979, fy: 37.568, tx: 126.981, ty: 37.57,
    fname: '시청역', tname: '종각역', routeNm: '1호선' };
  context.mock.method(globalThis, 'fetch', async () => Response.json({
    msgHeader: { headerCd: 0 }, msgBody: { itemList: [
      { time: 8, pathList: [bus, subway] },
      { time: 10, pathList: [{ ...bus, routeNm: '150' }, subway] },
      { time: 12, pathList: [{ ...bus, routeNm: '402' }, subway] },
      { time: 18, pathList: [bus] }, { time: 20, pathList: [subway] }
    ] }
  }));
  const result = await transitRoutes(start, end, request, { SEOUL_TRANSIT_KEY: keys.SEOUL_TRANSIT_KEY }, now);
  assert.deepEqual(result.routes.map(route => route.legs.map(leg => leg.kind)),
    [['bus', 'subway'], ['bus'], ['subway']]);
});

test('route service authorization failures are separate from missing keys and empty routes', async context => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Unauthorized' }, { status: 401 }));
  assert.deepEqual(await transitRoutes(start, end, request, keys, now), { status: 'authorization-required', routes: [] });
  assert.deepEqual(await transitRoutes(start, end, request, {}, now), { status: 'unconfigured', routes: [] });
});

test('manual trip current-position coordinates go straight to route computation', async context => {
  const endPoint = [126.97788, 37.57096];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url);
    if (path.pathname.includes('/pelias/')) {
      assert.equal(path.searchParams.get('text'), '교보문고');
      return Response.json({ features: [{ geometry: { coordinates: endPoint }, properties: { name: '교보문고' } }] });
    }
    const { coordinates } = JSON.parse(options.body);
    assert.deepEqual(coordinates, [start, endPoint]);
    return Response.json({ features: [{ geometry: { coordinates }, properties: { summary: { distance: 600, duration: 480 } } }] });
  });
  const result = await recommend({ ...demo, mode: 'live', origin: '현재 위치', fatigue: 'tired', allowance: 0,
    locations: { origin: { coordinate: start } }, places: [], transit: true }, { ORS_API_KEY: 'test' });
  assert.equal(result.baseline.minutes, 8);
  assert.equal(result.transit.status, 'unconfigured');
});
