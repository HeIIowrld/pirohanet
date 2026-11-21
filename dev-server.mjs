// 개발용 서버: 정적 파일 + 비밀 키를 붙여 대신 호출해 주는 두 경로.
// 실행: node dev-server.mjs  (키는 이 파일 옆의 .env에서 읽는다)
//   /api/geocode?query=  네이버 클라우드 Maps Geocoding   (.env: X-NCP-APIGW-API-KEY-ID, X-NCP-APIGW-API-KEY)
//   /api/place?query=    카카오 로컬 키워드 장소 검색     (.env: kakao-rest-api)
// 키가 없는 경로는 501을 돌려준다. 배포 서버에도 같은 두 경로가 있어야 한다.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseEnv } from 'node:util';

const ROOT = import.meta.dirname;
const PORT = Number(process.env.PORT ?? 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const envFile = path.join(ROOT, '.env');
const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const ncpKeyId = env['X-NCP-APIGW-API-KEY-ID'];
const ncpKey = env['X-NCP-APIGW-API-KEY'];
const kakaoRestKey = env['kakao-rest-api'];
const UPSTREAMS = {
  '/api/geocode': {
    url: 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode',
    headers: ncpKeyId && ncpKey && { 'x-ncp-apigw-api-key-id': ncpKeyId, 'x-ncp-apigw-api-key': ncpKey },
  },
  '/api/place': {
    url: 'https://dapi.kakao.com/v2/local/search/keyword.json',
    headers: kakaoRestKey && { Authorization: `KakaoAK ${kakaoRestKey}` },
  },
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

async function proxy(upstream, query, res) {
  if (!upstream.headers) return sendJson(res, 501, { error: '이 경로의 키가 설정되지 않았습니다' });
  // 검색어 하나만 넘긴다. 클라이언트가 보낸 다른 값은 외부 API로 전달하지 않는다.
  if (!query || query.length > 200) return sendJson(res, 400, { error: 'query는 1~200자여야 합니다' });
  try {
    const upstreamRes = await fetch(`${upstream.url}?${new URLSearchParams({ query })}`, {
      headers: { Accept: 'application/json', ...upstream.headers },
      signal: AbortSignal.timeout(5000),
    });
    sendJson(res, upstreamRes.status, await upstreamRes.text());
  } catch (err) {
    sendJson(res, 502, { error: `외부 API 호출 실패: ${err.message}` });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const upstream = UPSTREAMS[url.pathname];
  if (upstream) return proxy(upstream, url.searchParams.get('query'), res);

  const file = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname)));
  // .env, .git처럼 점으로 시작하는 파일과 폴더는 내보내지 않는다. 키가 들어 있다.
  const hidden = path.relative(ROOT, file).split(path.sep).some((part) => part.startsWith('.'));
  if (hidden || !file.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}).listen(PORT, 'localhost', () => console.log(`http://localhost:${PORT}/src/calendar/demo.html`));
