import { recommend, RouteError } from '../lib/routes.js';

const headers = { 'Cache-Control': 'no-store' };

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'POST 요청만 지원해요.' }, { status: 405, headers: { ...headers, Allow: 'POST' } });
    }
    try {
      const source = await request.text();
      if (source.length > 4096) throw new RouteError(413, '입력이 너무 길어요.');
      let input;
      try {
        input = JSON.parse(source);
      } catch {
        throw new RouteError(400, '입력 형식을 확인해 주세요.');
      }
      return Response.json(await recommend(input), { headers });
    } catch (error) {
      const known = error instanceof RouteError;
      return Response.json({ error: known ? error.message : '경로를 계산하지 못했어요. 다시 시도해 주세요.',
        ...(known && error.choices && { choices: error.choices }) },
        { status: known ? error.status : 500, headers });
    }
  }
};
