import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demo } from '../public/scenario.js';
import { recommend } from '../lib/routes.js';

const input = { ...demo, places: [], mode: 'demo', calendar: true, allowance: 15, fatigue: 'normal' };
const env = { ORS_API_KEY: 'route-mock', NAVER_SEARCH_KEY_ID: 'search-mock', NAVER_SEARCH_KEY: 'search-secret-mock' };
const address = '서울특별시 중구 세종대로 110';
const place = (title, mapx, mapy, category = '', roadAddress = address) => ({ title, mapx, mapy, category, roadAddress });

test('calendar stops respect fatigue, budget and the five-minute arrival buffer', async () => {
  const result = await recommend(input, {});
  assert.deepEqual(result.stops.map(route => [route.id, route.extraWalk, route.maxStay]), [
    ['coffee', 4, 11], ['history', 6, 9], ['culture', 7, 8]
  ]);
  assert.deepEqual((await recommend({ ...input, fatigue: 'tired' }, {})).stops, []);
  assert.deepEqual((await recommend({ ...input, allowance: 0 }, {})).stops, []);
  assert.deepEqual((await recommend({ ...input, arriveBy: '2026-11-20T18:29:00+09:00' }, {})).stops, []);
  assert.equal((await recommend({ ...input, arriveBy: '2026-11-20T18:15:00+09:00' }, {})).baseline.late, 1);
});

test('places are resolved by name and nearby suggestions get actual walking routes', async context => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'naverapihub.apigw.ntruss.com') {
      assert.equal(options.headers['X-NCP-APIGW-API-KEY-ID'], env.NAVER_SEARCH_KEY_ID);
      const query = parsed.searchParams.get('query');
      const items = {
        [demo.origin]: [place(demo.origin, 1269780500, 375665700)],
        [demo.destination]: [place(demo.destination, 1269778800, 375709600)],
        '서울특별시 중구 카페': [
          place('<b>가까운 카페</b>', 1269759200, 375660900, '카페'),
          place('먼 카페', 1271000000, 376000000, '카페')
        ],
        '서울특별시 중구 미술관': [place('시립미술관', 1269736000, 375641000, '미술관')]
      };
      return Response.json({ items: items[query] ?? [] });
    }
    assert.match(parsed.pathname, /foot-walking/);
    const { coordinates } = JSON.parse(options.body);
    const stop = coordinates[1]?.[0];
    const duration = coordinates.length === 2 ? 480 : stop === 126.97592 ? 600 : 1800;
    return Response.json({ features: [{ geometry: { coordinates }, properties: { summary: { distance: duration, duration } } }] });
  });
  const result = await recommend({ ...input, mode: 'live' }, env);
  assert.equal(result.baseline.minutes, 8);
  assert.deepEqual(result.stops.map(route => route.place.name), ['가까운 카페']);
  assert.equal(result.stops[0].saved, false);
  assert.equal(result.stops[0].maxStay, 13);
  assert.equal(fetchMock.mock.callCount(), 9);
});

test('ambiguous names return address options before walking routes are requested', async context => {
  context.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'naverapihub.apigw.ntruss.com');
    const name = parsed.searchParams.get('query');
    return Response.json({ items: name === '스타벅스' ? [
      place('스타벅스 광화문점', 1269780500, 375665700),
      place('스타벅스 시청점', 1269778800, 375709600, '', '서울특별시 중구 세종대로 111')
    ] : [place(name, 1269778800, 375709600)] });
  });
  await assert.rejects(recommend({ ...input, mode: 'live', origin: '스타벅스' }, env), error =>
    error.status === 409 && error.choices.field === 'origin' && error.choices.places.length === 2);
});

test('a Google Calendar venue with a road address resolves the matching building', async context => {
  const destination = '교보문고 광화문점, 대한민국 서울특별시 종로구 종로 1';
  const addressQuery = '서울특별시 종로구 종로 1';
  const start = [126.97805, 37.56657];
  const end = [126.9779, 37.5709];
  const properties = { layer: 'address', street: '종로' };
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/pelias/')) {
      const query = parsed.searchParams.get('text');
      if (query === addressQuery) return Response.json({ features: [
        { geometry: { coordinates: start }, properties: { ...properties, housenumber: '10' } },
        { geometry: { coordinates: end }, properties: { ...properties, housenumber: '1' } }
      ] });
      assert.equal(query, 'Seoul City Hall');
      return Response.json({ features: [{ geometry: { coordinates: start }, properties: { name: query } }] });
    }
    const { coordinates } = JSON.parse(options.body);
    assert.deepEqual(coordinates, [start, end]);
    return Response.json({ features: [{ geometry: { coordinates }, properties: { summary: { distance: 685, duration: 540 } } }] });
  });
  const result = await recommend({ ...input, destination, mode: 'live', fatigue: 'tired' }, { ORS_API_KEY: env.ORS_API_KEY });
  assert.equal(result.baseline.minutes, 9);
});

test('a malformed AI response falls back to eligible route rules', async context => {
  context.mock.method(globalThis, 'fetch', async (_url, options) => {
    const details = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
    assert(!JSON.stringify(details).includes(demo.destination));
    return Response.json({ choices: [{ message: { content: '{"id":"unsupported","reason":"out of range"}' } }] });
  });
  const result = await recommend(input, { AI_BASE_URL: 'https://example.test/v1', AI_API_KEY: 'mock', AI_DEFAULT_MODEL: 'mock' });
  assert.equal(result.method, 'rules');
  assert(result.stops.some(route => route.id === result.recommended.id));
});
