import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OAuth2Client } from 'google-auth-library';
import { calendarEventParams } from '../src/calendar/calendar.js';
import { placeAliasKey } from '../src/preferences/place-alias.js';

const calendarScope = 'https://www.googleapis.com/auth/calendar.readonly';
const sessionAge = 30 * 24 * 60 * 60;
const nonce = () => randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const mainPage = '/src/main/index.html';

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return null;
  }
}

export function createPersonalization({ root, origin, clientId, clientSecret, sendJson }) {
  const dataDir = path.join(root, '.data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'personalization.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS places (
      user_id INTEGER NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      alias TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      PRIMARY KEY (user_id, key)
    );
  `);
  const ready = Boolean(clientId && clientSecret);
  const redirectUri = new URL('/auth/google/callback', origin).href;
  const google = new OAuth2Client(clientId, clientSecret, redirectUri);
  const pending = new Map();
  const calendarTokens = new Map();
  const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
  function cookie(res, name, value, age) {
    res.appendHeader('Set-Cookie', `${name}=${value}; Max-Age=${age}; Path=/; HttpOnly; SameSite=Lax${secure}`);
  }

  function redirect(res, location) {
    res.writeHead(303, { Location: location });
    res.end();
  }

  function endSession(id) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    calendarTokens.delete(id);
  }

  return async function handle(req, res, url) {
    const route = url.pathname;
    if (!route.startsWith('/auth/') && !['/api/account', '/api/calendar', '/api/saved-places'].includes(route)) return false;
    res.setHeader('Cache-Control', 'no-store');
    try {
      await dispatch(req, res, url);
    } catch {
      if (route === '/auth/google/callback') redirect(res, mainPage + '?auth=failed');
      else sendJson(res, 502, { error: '계정 요청을 처리하지 못했어요.' });
    }
    return true;
  };

  async function dispatch(req, res, url) {
    const cookies = Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).map((part) => part.split('=')));
    const sessionId = hash(cookies.session ?? '');
    const now = Date.now();
    const session = db.prepare('SELECT user_id FROM sessions WHERE id = ? AND expires > ?').get(sessionId, now);
    const route = url.pathname;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) {
      return sendJson(res, 403, { error: '잘못된 요청 출처입니다.' });
    }
    if (route === '/api/account' && req.method === 'GET') {
      return sendJson(res, 200, { ready, signedIn: Boolean(session) });
    }
    if (route === '/auth/google' && req.method === 'GET') {
      if (!ready) return sendJson(res, 503, { error: 'Google OAuth 설정이 필요합니다.' });
      const calendar = url.searchParams.get('calendar') === '1';
      if (calendar && !session) return sendJson(res, 401, { error: '로그인이 필요합니다.' });
      for (const entries of [pending, calendarTokens]) {
        for (const [key, value] of entries) if (value.expires <= now) entries.delete(key);
      }
      const oldState = cookies.oauth_state;
      pending.delete(oldState);
      const state = nonce();
      const { codeVerifier, codeChallenge } = await google.generateCodeVerifierAsync();
      pending.set(state, { codeVerifier, calendar, sessionId, expires: now + 600_000 });
      cookie(res, 'oauth_state', state, 600);
      return redirect(res, google.generateAuthUrl({
        scope: calendar ? ['openid', calendarScope] : ['openid'],
        access_type: 'online',
        prompt: 'select_account',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }));
    }
    if (route === '/auth/google/callback' && req.method === 'GET') {
      const state = url.searchParams.get('state');
      const flow = state && state === cookies.oauth_state && pending.get(state);
      if (!flow || flow.expires <= now || flow.sessionId !== sessionId) return redirect(res, mainPage + '?auth=failed');
      pending.delete(state);
      cookie(res, 'oauth_state', '', 0);
      const code = url.searchParams.get('code');
      if (!code) return redirect(res, mainPage + '?auth=failed');
      const { tokens } = await google.getToken({ code, codeVerifier: flow.codeVerifier });
      const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const subject = ticket.getPayload().sub;
      if (flow.calendar) {
        const user = session && db.prepare('SELECT google_sub FROM users WHERE id = ?').get(session.user_id);
        if (user?.google_sub !== subject) return redirect(res, mainPage + '?auth=account');
        if (!tokens.access_token || !tokens.scope?.split(' ').includes(calendarScope)) {
          return redirect(res, mainPage + '?auth=failed');
        }
        calendarTokens.set(sessionId, { token: tokens.access_token, expires: tokens.expiry_date });
        return redirect(res, mainPage + '?calendar=1');
      }
      db.prepare('INSERT INTO users (google_sub) VALUES (?) ON CONFLICT DO NOTHING').run(subject);
      const user = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(subject);
      db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
      endSession(sessionId);
      const value = nonce();
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(value), user.id, now + sessionAge * 1000);
      cookie(res, 'session', value, sessionAge);
      return redirect(res, mainPage);
    }
    if (route === '/auth/logout' && req.method === 'POST') {
      endSession(sessionId);
      pending.delete(cookies.oauth_state);
      cookie(res, 'session', '', 0);
      cookie(res, 'oauth_state', '', 0);
      return sendJson(res, 200, {});
    }
    if (!session) return sendJson(res, 401, { error: '로그인이 필요합니다.' });
    if (route === '/api/calendar' && req.method === 'GET') {
      const access = calendarTokens.get(sessionId);
      if (!access || access.expires <= now) {
        calendarTokens.delete(sessionId);
        return sendJson(res, 401, { error: 'Google 일정 연결이 필요합니다.' });
      }
      const params = calendarEventParams();
      const items = [];
      do {
        const result = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
          headers: { Authorization: `Bearer ${access.token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (result.status === 401) {
          calendarTokens.delete(sessionId);
          return sendJson(res, 401, { error: 'Google 일정 연결이 필요합니다.' });
        }
        if (!result.ok) return sendJson(res, 502, { error: 'Google 일정을 가져오지 못했어요.' });
        const page = await result.json();
        items.push(...(page.items ?? []));
        if (!page.nextPageToken) break;
        params.set('pageToken', page.nextPageToken);
      } while (true);
      return sendJson(res, 200, items);
    }
    if (route !== '/api/saved-places') return sendJson(res, 404, { error: '경로를 찾지 못했어요.' });
    const userId = session.user_id;
    if (req.method === 'GET') {
      return sendJson(res, 200, db.prepare(
        'SELECT alias, name, address, latitude, longitude FROM places WHERE user_id = ? ORDER BY alias'
      ).all(userId));
    }
    const body = await readJson(req);
    const alias = typeof body?.alias === 'string' ? body.alias.trim() : '';
    const key = placeAliasKey(alias);
    if (!key || key.length > 200 || alias.length > 200) return sendJson(res, 400, { error: '장소 이름을 확인해 주세요.' });
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM places WHERE user_id = ? AND key = ?').run(userId, key);
      return sendJson(res, 200, {});
    }
    const { name, address, latitude, longitude } = body;
    if (req.method !== 'PUT' || typeof name !== 'string' || name.length > 500 ||
        typeof address !== 'string' || !address.trim() || address.length > 500 ||
        !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      return sendJson(res, 400, { error: '장소 정보를 확인해 주세요.' });
    }
    db.prepare(`
      INSERT INTO places VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, key) DO UPDATE SET
        alias = excluded.alias, name = excluded.name, address = excluded.address,
        latitude = excluded.latitude, longitude = excluded.longitude
    `).run(userId, key, alias, name, address, latitude, longitude);
    return sendJson(res, 200, { alias, name, address, latitude, longitude });
  }
}
