// 실행: node src/calendar/location.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locate, locateAll, locateCandidates, staticMapUrl } from './location.js';

const KYOBO = { roadAddress: '서울특별시 종로구 종로 1', jibunAddress: '서울특별시 종로구 종로1가 1', x: '126.9779', y: '37.5709' };
const KYOBO_PLACE = { name: '교보문고 광화문점', address: '서울특별시 종로구 종로 1', latitude: 37.5709, longitude: 126.9779 };
const kakao = (name, address, x, y) => ({ place_name: name, road_address_name: address, address_name: address, x: String(x), y: String(y) });

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
  const candidates = await locateCandidates('교보문고 광화문점, 대한민국 서울특별시 종로구 종로 1', fetchFn);
  assert.deepEqual(candidates, [KYOBO_PLACE]);
  assert.deepEqual(calls, ['/api/geocode 교보문고 광화문점, 대한민국 서울특별시 종로구 종로 1', '/api/geocode 서울특별시 종로구 종로 1']);
});

test('같은 이름이 여러 곳이면 검색 순서대로 후보를 돌려준다', async () => {
  const { fetchFn, calls } = fakeServer({
    '/api/place 현대자동차': {
      documents: [
        kakao('현대자동차 남부하이테크센터', '서울 동작구 노량진로 53', 126.93, 37.51),
        kakao('현대자동차 대전하이테크센터', '대전 동구 동대전로 271', 127.44, 36.33),
        kakao('현대자동차 본사 양재사옥', '서울 서초구 헌릉로 12', 127.04, 37.46),
      ],
    },
  });
  const candidates = await locateCandidates('현대자동차', fetchFn);
  assert.deepEqual(candidates.map((place) => place.name), ['현대자동차 남부하이테크센터', '현대자동차 대전하이테크센터', '현대자동차 본사 양재사옥']);
  assert.deepEqual(candidates[2], { name: '현대자동차 본사 양재사옥', address: '서울 서초구 헌릉로 12', latitude: 37.46, longitude: 127.04 });
  assert.deepEqual(calls, ['/api/geocode 현대자동차', '/api/place 현대자동차']);
});

test('후보는 5개까지만 돌려준다', async () => {
  const documents = Array.from({ length: 15 }, (_, i) => kakao(`지점 ${i + 1}`, `주소 ${i + 1}`, 127, 37));
  const { fetchFn } = fakeServer({ '/api/place 스타벅스': { documents } });
  const candidates = await locateCandidates('스타벅스', fetchFn);
  assert.deepEqual(candidates.map((place) => place.name), ['지점 1', '지점 2', '지점 3', '지점 4', '지점 5']);
});

test('locate는 첫 번째 후보 하나를 돌려준다', async () => {
  const { fetchFn } = fakeServer({ '/api/geocode 서울특별시 종로구 종로 1': { addresses: [KYOBO] } });
  assert.deepEqual(await locate('서울특별시 종로구 종로 1', fetchFn), { ...KYOBO_PLACE, name: '서울특별시 종로구 종로 1' });
});

test('어디서도 못 찾으면 빈 배열, locate는 null', async () => {
  const { fetchFn } = fakeServer({});
  assert.deepEqual(await locateCandidates('회의실 B', fetchFn), []);
  assert.deepEqual(await locateCandidates('', fetchFn), []);
  assert.deepEqual(await locateCandidates(undefined, fetchFn), []);
  assert.equal(await locate('회의실 B', fetchFn), null);
});

test('장소 검색 키가 없는 서버에서는 못 찾은 것으로 처리한다', async () => {
  const { fetchFn } = fakeServer({ '/api/place': { status: 501 } });
  assert.deepEqual(await locateCandidates('교보문고 광화문점', fetchFn), []);
});

test('Geocoding 호출이 실패하면 예외를 던진다', async () => {
  const { fetchFn } = fakeServer({ '/api/geocode': { status: 500 } });
  await assert.rejects(locateCandidates('서울특별시 종로구 종로 1', fetchFn), /Geocoding 500/);
});

test('여러 위치를 한꺼번에 바꾸고, 같은 글자는 한 번만 찾는다', async () => {
  const { fetchFn, calls } = fakeServer({
    '/api/geocode 서울특별시 종로구 종로 1': { addresses: [KYOBO] },
    '/api/place 여의도': { documents: [kakao('여의도역', '서울 영등포구 여의나루로 40', 126.9243, 37.5216), kakao('여의도공원', '서울 영등포구 여의공원로 68', 126.92, 37.52)] },
  });
  const places = await locateAll(['서울특별시 종로구 종로 1', '여의도', undefined, ' 여의도 ', '', '회의실 B'], fetchFn);
  assert.deepEqual([...places.keys()], ['서울특별시 종로구 종로 1', '여의도', '회의실 B']);
  assert.equal(places.get('서울특별시 종로구 종로 1')[0].longitude, 126.9779);
  assert.deepEqual(places.get('여의도').map((place) => place.name), ['여의도역', '여의도공원']);
  assert.deepEqual(places.get('회의실 B'), []);
  assert.equal(calls.filter((call) => call === '/api/place 여의도').length, 1);
});

test('지도 이미지 주소', () => {
  assert.equal(
    staticMapUrl([{ longitude: 126.9779, latitude: 37.5709 }, { longitude: 126.9, latitude: 37.5 }], 'KEYID', { width: 300, height: 200 }),
    'https://maps.apigw.ntruss.com/map-static/v2/raster-cors?w=300&h=200' +
      '&markers=type%3Ad%7Csize%3Amid%7Cpos%3A126.9779%2037.5709&markers=type%3Ad%7Csize%3Amid%7Cpos%3A126.9%2037.5&X-NCP-APIGW-API-KEY-ID=KEYID',
  );
});
