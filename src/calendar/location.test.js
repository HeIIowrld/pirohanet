// 실행: node src/calendar/location.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locate, staticMapUrl } from './location.js';

const KYOBO = { roadAddress: '서울특별시 종로구 종로 1', jibunAddress: '서울특별시 종로구 종로1가 1', x: '126.9779', y: '37.5709' };

// 경로와 검색어별 응답을 정해 둔 가짜 서버. 부른 순서를 calls에 남긴다.
function fakeServer(routes) {
  const calls = [];
  const fetchFn = async (url) => {
    const { pathname, searchParams } = new URL(url, 'http://test');
    const key = `${pathname} ${searchParams.get('query')}`;
    calls.push(key);
    const body = routes[key] ?? routes[pathname] ?? {};
    return { ok: !body.status, status: body.status ?? 200, json: async () => body };
  };
  return { fetchFn, calls };
}

test('주소가 함께 적힌 위치는 주소 부분으로 좌표를 찾는다', async () => {
  const { fetchFn, calls } = fakeServer({ '/api/geocode 서울특별시 종로구 종로 1': { addresses: [KYOBO] } });
  const place = await locate('교보문고 광화문점, 대한민국 서울특별시 종로구 종로 1', fetchFn);
  assert.deepEqual(place, { name: '교보문고 광화문점', address: '서울특별시 종로구 종로 1', lon: 126.9779, lat: 37.5709 });
  assert.deepEqual(calls, ['/api/geocode 교보문고 광화문점, 대한민국 서울특별시 종로구 종로 1', '/api/geocode 서울특별시 종로구 종로 1']);
});

test('이름만 적힌 위치는 장소 검색으로 주소와 좌표를 얻는다', async () => {
  const { fetchFn, calls } = fakeServer({
    '/api/place 교보문고 광화문점': {
      documents: [{ place_name: '교보문고 광화문점', road_address_name: '서울 종로구 종로 1', address_name: '서울 종로구 종로1가 1', x: '126.9779', y: '37.5709' }],
    },
  });
  const place = await locate('교보문고 광화문점', fetchFn);
  assert.deepEqual(place, { name: '교보문고 광화문점', address: '서울 종로구 종로 1', lon: 126.9779, lat: 37.5709 });
  assert.deepEqual(calls, ['/api/geocode 교보문고 광화문점', '/api/place 교보문고 광화문점']);
});

test('어디서도 못 찾으면 null', async () => {
  const { fetchFn } = fakeServer({});
  assert.equal(await locate('회의실 B', fetchFn), null);
  assert.equal(await locate('', fetchFn), null);
  assert.equal(await locate(undefined, fetchFn), null);
});

test('장소 검색 키가 없는 서버에서는 못 찾은 것으로 처리한다', async () => {
  const { fetchFn } = fakeServer({ '/api/place': { status: 501 } });
  assert.equal(await locate('교보문고 광화문점', fetchFn), null);
});

test('Geocoding 호출이 실패하면 예외를 던진다', async () => {
  const { fetchFn } = fakeServer({ '/api/geocode': { status: 500 } });
  await assert.rejects(locate('서울특별시 종로구 종로 1', fetchFn), /Geocoding 500/);
});

test('지도 이미지 주소', () => {
  assert.equal(
    staticMapUrl([{ lon: 126.9779, lat: 37.5709 }, { lon: 126.9, lat: 37.5 }], 'KEYID', { width: 300, height: 200 }),
    'https://maps.apigw.ntruss.com/map-static/v2/raster-cors?w=300&h=200' +
      '&markers=type%3Ad%7Csize%3Amid%7Cpos%3A126.9779%2037.5709&markers=type%3Ad%7Csize%3Amid%7Cpos%3A126.9%2037.5&X-NCP-APIGW-API-KEY-ID=KEYID',
  );
});
