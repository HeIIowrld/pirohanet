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
    if (new URL(url).pathname.endsWith('/getPathInfoBySubway')) return response([]);
    return response([
      { time: '26', distance: '7634', pathList: [bus, rail] },
      { time: '30', distance: '8000', pathList: [{ ...bus, tx: coords.end_x, ty: coords.end_y }] },
    ]);
  } });
  const [result, same] = await Promise.all([city(coords), city(coords)]);
  assert.equal(result, same);
  assert.equal(lookups, 2);
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
    return lookups <= 2 ? new Response(null, { status: 429 }) : response([]);
  } });
  await assert.rejects(city(coords), { status: 429 });
  assert.deepEqual(await city(coords), { status: 'NO_RESULTS', routes: [], source: 'seoul' });
  assert.equal(lookups, 4);
});

test('Seoul subway-only trips appear alongside bus trips and survive a mixed endpoint failure', async () => {
  const stationPair = { start_x: 126.93698, start_y: 37.5552, end_x: 126.91445, end_y: 37.54991 };
  const sinchonToHapjeong = {
    routeNm:'2호선', fname:'신촌역', tname:'합정역',
    fx:'126.93702', fy:'37.55515', tx:'126.91447', ty:'37.54990',
    railLinkList:[{railLinkId:'1'}, {railLinkId:'2'}],
  };
  const subwayTrip = {time:'8', distance:'3110',pathList:[sinchonToHapjeong]};
  const nearbyBus = {...bus, tname:'합정역',tx:'126.91384',ty:'37.54949'};
  const city = createSeoulTransit({serviceKey:'fixture', fetchFn:url =>
    new URL(url).pathname.endsWith('/getPathInfoBySubway') ? response([subwayTrip]) : response([
      {time:'11',pathList:[nearbyBus]}, subwayTrip,
    ])});
  const result = await city(stationPair);
  assert.deepEqual(result.routes.map(route=>route.properties.type),['BUS','SUBWAY']);
  assert.equal(result.routes[1].steps.find(step=>step.properties.type==='SUBWAY').properties.railSegments,2);

  const partial = createSeoulTransit({serviceKey:'fixture', fetchFn:url =>
    new URL(url).pathname.endsWith('/getPathInfoBySubway') ? response([subwayTrip]) : new Response(null,{status:429})});
  assert.equal((await partial(stationPair)).routes[0].properties.totalTime,480);
});

test('walks to a nearby station when the subway service cannot route from the original place', async () => {
  const places = {start_x:126.93893572,start_y:37.56433711,end_x:126.91702776,end_y:37.54962397};
  let stationRequests = 0;
  const city = createSeoulTransit({serviceKey:'fixture',fetchFn:url => {
    const {pathname,searchParams} = new URL(url);
    if (!pathname.endsWith('/getPathInfoBySubway')) return response([]);
    if (+searchParams.get('startX') === places.start_x) {
      return Response.json({msgHeader:{headerCd:'4'}});
    }
    stationRequests++;
    return response([{time:'8',distance:'3110',pathList:[{
      routeNm:'2호선',fname:'신촌역',tname:'합정역',fx:'126.93702',fy:'37.55515',
      tx:'126.91447',ty:'37.54990',railLinkList:[{railLinkId:'1'},{railLinkId:'2'}],
    }]}]);
  }});
  const result = await city(places);
  assert.equal(result.status,'OK');
  assert.ok(stationRequests > 0 && stationRequests <= 4);
  const [route] = result.routes;
  assert.equal(route.properties.type,'SUBWAY');
  assert.ok(route.properties.totalTime > 20 * 60);
  assert.deepEqual(route.steps.map(step=>step.properties.type),['WALKING','SUBWAY','WALKING']);
  assert.deepEqual(route.steps[0].path.points[0],[places.start_x,places.start_y]);
  assert.deepEqual(route.steps.at(-1).path.points.at(-1),[places.end_x,places.end_y]);
});


test('known turnover boundaries reject wrong-direction bus candidates and keep the verified returns', async () => {
  const m6724 = {...bus,routeId:'165000381',routeNm:'M6724인천',tid:'113000412',
    tname:'합정역',tx:126.913856,ty:37.549532};
  const city602 = {...m6724,routeId:'100100087',routeNm:'602'};
  const at = (leg,fid,fx,fy) => ({...leg,fid,fx,fy});
  const candidates = [
    at(m6724,'113000419',126.940153,37.556107),
    at(m6724,'112000031',126.935306,37.559819),
    at(city602,'113000419',126.940153,37.556107),
    at(city602,'113000417',126.93869,37.55573),
  ];
  const city = createSeoulTransit({serviceKey:'fixture',fetchFn:url =>
    response(url.includes('getPathInfoBySubway') ? [] : candidates.map(leg => ({time:'17',pathList:[leg]})))});
  const result = await city({start_x:126.937,start_y:37.556,end_x:126.914,end_y:37.5496});
  const rides = result.routes.map(route => route.steps.find(step => step.properties.type === 'BUS').properties);
  assert.deepEqual(rides.map(ride => ride.seoulBusStopId),['112000031','113000417']);
  assert.deepEqual(rides.map(ride => ride.seoulBusAlightStopId),['113000412','113000412']);
});
