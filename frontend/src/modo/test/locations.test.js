import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/locations.js';
import { findLocations } from '../lib/location.js';
import { originLandmarks } from '../lib/places.js';

const env = { KAKAO_REST_API_KEY: 'kakao-mock', ORS_API_KEY: 'geo-mock' };

test('address-first lookup uses the road address inside a place-and-address entry', async context => {
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const query = new URL(url);
    assert.equal(query.pathname, '/v2/local/search/address.json');
    assert.equal(options.headers.Authorization, 'KakaoAK kakao-mock');
    if (query.searchParams.get('query') !== '서울 종로구 종로 1') return Response.json({ documents: [] });
    return Response.json({ documents: [{ x: '126.97788', y: '37.57096',
      road_address: { building_name: '교보문고', address_name: '서울 종로구 종로 1' } }] });
  });
  assert.deepEqual(await findLocations('교보문고, 대한민국 서울 종로구 종로 1', env), {
    status: 'ready', places: [{ name: '교보문고', address: '서울 종로구 종로 1', coordinate: [126.97788, 37.57096] }]
  });
});

test('same-name branches stay distinct, in provider order, up to five candidates', async context => {
  context.mock.method(globalThis, 'fetch', async url => {
    assert.match(new URL(url).pathname, /keyword/);
    const rows = Array.from({ length: 7 }, (_, index) => ({
      place_name: '스타벅스', road_address_name: '서울 종로구 종로 ' + (index + 1),
      x: String(126.977 + index / 1000), y: '37.57'
    }));
    return Response.json({ documents: [rows[0], ...rows] });
  });
  const result = await findLocations('스타벅스', env);
  assert.deepEqual(result.places.map(place => place.address), Array.from({ length: 5 }, (_, i) => '서울 종로구 종로 ' + (i + 1)));
});

test('personal labels bypass providers and failed search falls back to Pelias', async context => {
  const mock = context.mock.method(globalThis, 'fetch', async url => new URL(url).hostname === 'dapi.kakao.com'
    ? Response.json({}, { status: 403 }) : Response.json({ features: [{
      geometry: { coordinates: [126.978, 37.567] }, properties: { name: '서울시청', label: '서울시청, 서울 중구' }
    }] }));
  assert.deepEqual(await findLocations('우리 집', env), { status: 'personal-label', places: [] });
  assert.equal(mock.mock.callCount(), 0);
  assert.equal((await findLocations('서울시청', env)).places[0].name, '서울시청');
});

test('the directory returns all Seoul landmarks and validates location coordinates', async () => {
  const response = await handler.fetch(new Request('http://localhost/api/locations'));
  const result = await response.json();
  assert.equal(result.places.length, 34);
  assert(result.places.some(place => place.name === '덕수궁 돌담길'));
  assert(result.places.every(place => !('coordinate' in place)));
  const invalid = await handler.fetch(new Request('http://localhost/api/locations', {
    method: 'POST', body: JSON.stringify({ coordinate: [0, 0] })
  }));
  assert.equal(invalid.status, 400);
});

test('nearby recommendations use resolved coordinates, filter radius, and sort by distance', async context => {
  context.mock.method(globalThis, 'fetch', async url => {
    const query = new URL(url).searchParams.get('query');
    const publicPlaces = {
      광화문광장: [126.9769, 37.572],
      교보문고광화문점: [126.9779, 37.5709],
      세종문화회관: [127.12, 37.5716]
    };
    const name = query.replace(/\s/gu, '');
    const coordinates = publicPlaces[name];
    return Response.json({ documents: coordinates ? [{
      place_name: query, road_address_name: '서울 종로구 세종대로 172', x: coordinates[0], y: coordinates[1]
    }] : [] });
  });
  const places = await originLandmarks([126.977, 37.5716], { KAKAO_REST_API_KEY: env.KAKAO_REST_API_KEY });
  assert.deepEqual(places.slice(0, 2).map(place => place.name), ['광화문광장', '교보문고 광화문점']);
  assert(places[0].distance < places[1].distance);
  assert(!places.some(place => place.name === '세종문화회관'));
});
