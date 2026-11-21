import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadRecommendedStops, resolveRecommendedStop } from './recommended-stops.js';

const catalog = await loadRecommendedStops(async (url) => new Response(await readFile(url)));
const findStop = (id) => catalog.places.find((place) => place.id === id);

function keywordResult(place_name, address_name, y) {
  return { place_name, address_name, x: '126.925', y };
}

test('추천 경유지는 지역과 고유 ID, 체류 시간, 방문 안내를 갖는다', () => {
  assert.equal(catalog.places.length, catalog.place_count);
  assert.equal(new Set(catalog.places.map(({ id }) => id)).size, catalog.place_count);
  for (const place of catalog.places) {
    assert.ok(catalog.regions[place.region], place.id);
    assert.ok(place.location.district && place.location.search_query && place.location.route_target, place.id);
    const { min, recommended, max } = place.visit_duration_min;
    assert.ok(Number.isInteger(recommended) && 0 < min && min <= recommended && recommended <= max, place.id);
    assert.ok(place.sources[0]?.url.startsWith('https://'), place.id);
  }
});

test('같은 이름의 경의선숲길 구간은 지정한 주소로 구별한다', async () => {
  const stop = findStop('seoul_025');
  const otherSegment = keywordResult('경의선숲길', '서울 마포구 동교동 190-1', '37.557');
  const parkSegment = keywordResult('경의선 숲길', '서울 마포구 연남동 375', '37.562');
  const mockSearch = (...documents) => async (path) => {
    const url = new URL(path, 'http://localhost');
    assert.equal(url.pathname, '/api/place');
    assert.equal(url.searchParams.get('query'), stop.location.search_query);
    return Response.json({ documents });
  };

  const match = await resolveRecommendedStop(stop, mockSearch(otherSegment, parkSegment));
  assert.equal(match.latitude, 37.562);
  assert.equal(match.name, stop.name);
  assert.equal(await resolveRecommendedStop(stop, mockSearch(otherSegment)), null);
});

test('건물 주소로 지정한 경유지는 도로명 주소를 조회한다', async () => {
  const stop = findStop('seoul_027');
  const match = await resolveRecommendedStop(stop, async (path) => {
    const url = new URL(path, 'http://localhost');
    assert.equal(url.pathname, '/api/geocode');
    assert.equal(url.searchParams.get('query'), '서울 서대문구 연희로11라길 10-6');
    return Response.json({ addresses: [{ roadAddress: '서울특별시 서대문구 연희로11라길 10-6', x: '126.93', y: '37.568' }] });
  });
  assert.equal(match.name, '유어마인드');
  assert.equal(match.latitude, 37.568);
});
