import { findLocations } from '../lib/location.js';
import { isKoreanPoint } from '../lib/naver.js';
import { landmarkDirectory, originLandmarks } from '../lib/places.js';

const headers = { 'Cache-Control': 'no-store' };

export default {
  async fetch(request) {
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams.get('q');
      if (query === null) return reply({ places: landmarkDirectory() });
      if (query.trim().length < 1 || query.length > 100) {
        return reply({ error: '장소명이나 주소를 1~100자로 입력해 주세요.' }, 400);
      }
      return reply(await findLocations(query));
    }
    if (request.method === 'POST') {
      let body;
      try {
        const source = await request.text();
        if (source.length > 512) return reply({ error: '출발지 좌표를 확인해 주세요.' }, 400);
        body = JSON.parse(source);
      } catch {
        return reply({ error: '출발지 형식을 확인해 주세요.' }, 400);
      }
      if (!isKoreanPoint(body?.coordinate)) return reply({ error: '출발지 좌표를 확인해 주세요.' }, 400);
      return reply({ places: await originLandmarks(body.coordinate) });
    }
    return Response.json({ error: '이 요청 방식은 사용할 수 없어요.' },
      { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
  }
};
