import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareRoutes } from '../routing/compare.js';
import { directRecommendations } from './route-results.js';

const departAt = new Date('2026-11-20T18:00:00+09:00');
const fastest = { travelMinutes: 22, walkMinutes: 8, transfers: 1 };

test('명시한 우선순위를 개선하는 경로가 없으면 별도 추천을 표시하지 않는다', () => {
  const candidates = [fastest, { travelMinutes: 24, walkMinutes: 8, transfers: 0 }];
  const routes = compareRoutes(candidates, { departAt, preferences: { fatigueLevel: 5, priority: 'walking' } });

  assert.equal(routes[0].travelMinutes, 24);
  assert.equal(directRecommendations(routes, 'walking').recommended.travelMinutes, 22);
});

test('우선순위 개선 후보도 가중치를 반영한 비교 점수를 따른다', () => {
  const preferences = { fatigueLevel: 1, priority: 'transfers' };
  const recommend = (travelMinutes) => directRecommendations(compareRoutes(
    [fastest, { travelMinutes, walkMinutes: 8, transfers: 0 }], { departAt, preferences },
  ), preferences.priority).recommended.travelMinutes;

  assert.equal(recommend(36), 22);
  assert.equal(recommend(24), 24);
});
