import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const LABELS = { 3: '여유', 4: '보통', 5: '혼잡', 6: '매우 혼잡' };
const MAX_REPORT_AGE = 3 * MINUTE;
const SEATED_GYEONGGI_TYPES = new Set([11, 12, 14, 16, 17, 21, 22]);
const GYEONGGI_CROWDED_TYPES = new Set([13, 15, 23]);

function nonnegativeInteger(value) {
  return /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value))
    ? Number(value) : null;
}
const normalizeStop = (name = '') => String(name ?? '').replace(/\(중\)\s*$/, '').replace(/[\s.]/g, '');
const normalizeRoute = (name = '') => String(name ?? '').replace(/\([^)]*\)$/, '').trim().toUpperCase();

function timeBucket(timestamp) {
  const kst = new Date(timestamp + 9 * 60 * MINUTE);
  const weekday = kst.getUTCDay();
  return {
    date: kst.toISOString().slice(0, 10),
    day: weekday === 0 || weekday === 6 ? weekday : 1,
    slot: kst.getUTCHours() * 2 + Math.floor(kst.getUTCMinutes() / 30),
  };
}

export function readArrival(row, index, now) {
  const message = row[`arrmsgSec${index}`] || row[`arrmsg${index}`];
  const report = row[`repTm${index}`];
  if (typeof report !== 'string' || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(report)) return null;
  const reportedAt = Date.parse(report.replace(' ', 'T') + '+09:00');
  if (!Number.isFinite(reportedAt) || now - reportedAt > MAX_REPORT_AGE || reportedAt - now > MINUTE) return null;
  const match = typeof message === 'string' && message.match(/^(?:(\d+)분\s*)?(?:(\d+)초\s*)?후/);
  const imminent = typeof message === 'string' && /^곧\s*도착/.test(message);
  if (!imminent && (!match || (!match[1] && !match[2]))) return null;
  const seconds = imminent ? 0 : Number(match[1] || 0) * 60 + Number(match[2] || 0);
  const occupancyType = Number(row[`rerdie_Div${index}`]);
  const occupancy = nonnegativeInteger(row[`reride_Num${index}`]);
  const code = occupancyType === 4 && LABELS[occupancy] ? occupancy : Number(row[`congestion${index}`]);
  const seats = Number(row.routeType) === 6 && occupancyType === 2 ? occupancy : null;
  return {
    seconds, congestion:LABELS[code] ?? null, code:LABELS[code] ? code : null,
    ...(seats === null ? {} : {remainingSeats:seats}),
  };
}

function createHistory(root) {
  const folder = path.join(root, '.data');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(folder, 'bus-crowding.sqlite'));
  db.exec(`PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS bus_crowding (
      stop TEXT, route TEXT, day INTEGER, slot INTEGER, date TEXT, code INTEGER,
      PRIMARY KEY (stop, route, day, slot, date)
    );`);
  const store = db.prepare('INSERT OR IGNORE INTO bus_crowding VALUES (?, ?, ?, ?, ?, ?)');
  const prune = db.prepare('DELETE FROM bus_crowding WHERE date < ?');
  const select = db.prepare(`SELECT code, date FROM bus_crowding
    WHERE stop = ? AND route = ? AND day = ? AND slot = ? AND date >= ? AND date < ?
    ORDER BY code`);
  return {
    record(stop, route, now, code) {
      const { day, slot, date } = timeBucket(now);
      store.run(stop, route, day, slot, date, code);
    },
    predict(stop, route, boardingAt, now) {
      const { day, slot } = timeBucket(boardingAt);
      const since = timeBucket(now - 56 * DAY).date;
      const today = timeBucket(now).date;
      prune.run(since);
      const samples = select.all(stop, route, day, slot, since, today);
      return samples.length < 3 ? null : {
        congestion: LABELS[samples[Math.floor(samples.length / 2)].code],
        sampleDays: samples.length,
      };
    },
  };
}

function cachedLookup(ttl, lookup) {
  const cache = new Map();
  return (key, params) => {
    const now = Date.now();
    const existing = cache.get(key);
    if (existing && existing.until > now) return existing.result;
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    const result = lookup(params).catch((error) => {
      if (cache.get(key)?.result === result) cache.delete(key);
      throw error;
    });
    cache.set(key, { result, until: now + ttl });
    return result;
  };
}

function regionalArrival(row,index,checkedAt) {
  const seconds = nonnegativeInteger(row[`predictTimeSec${index}`]);
  const vehicle = nonnegativeInteger(row[`vehId${index}`]);
  if (seconds === null || !vehicle) return null;
  const type = Number(row.routeTypeCd);
  const seats = SEATED_GYEONGGI_TYPES.has(type) ? nonnegativeInteger(row[`remainSeatCnt${index}`]) : null;
  const code = GYEONGGI_CROWDED_TYPES.has(type) ? Number(row[`crowded${index}`]) + 2 : null;
  return {seconds, at:checkedAt + seconds*1000, congestion:LABELS[code] ?? null,
    ...(seats === null ? {} : {remainingSeats:seats})};
}

export function createBusInformation({ root, serviceKey, gyeonggiServiceKey, sendJson, fetchFn = fetch }) {
  const history = serviceKey ? createHistory(root) : null;
  async function getStationData(operation, params) {
    const url = new URL(`http://ws.bus.go.kr/api/rest/stationinfo/${operation}`);
    url.search = new URLSearchParams({ serviceKey: decodeURIComponent(serviceKey), resultType: 'json', ...params });
    const response = await fetchFn(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Bus provider unavailable');
    const { msgHeader, msgBody } = await response.json();
    if (String(msgHeader?.headerCd) === '4') return [];
    if (String(msgHeader?.headerCd) !== '0') throw new Error('Bus provider rejected the request');
    const rows = msgBody?.itemList;
    return Array.isArray(rows) ? rows : rows ? [rows] : [];
  }
  const nearby = cachedLookup(6 * 60 * MINUTE, (point) => getStationData('getStationByPos', point));
  const arrivals = cachedLookup(15_000, async (arsId) => {
    // The regular feed includes the next stop. The accessibility feed can have newer vehicle reports.
    const [rows, accessible] = await Promise.all([
      getStationData('getStationByUid', { arsId }),
      getStationData('getLowStationByUid', { arsId }).catch(() => []),
    ]);
    const reports = new Map(accessible.map((row) => [`${row.busRouteId}/${row.staOrd}`, row]));
    return { rows, reports, checkedAt: Date.now() };
  });

  const regionalArrivals = cachedLookup(15_000, async stationId => {
    const url = new URL('https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2');
    url.search = new URLSearchParams({serviceKey:decodeURIComponent(gyeonggiServiceKey),stationId,format:'json'});
    const response = await fetchFn(url,{signal:AbortSignal.timeout(3500)});
    if (!response.ok) throw new Error('Gyeonggi bus provider unavailable');
    const {response:body} = await response.json();
    const rows = body?.msgBody?.busArrivalList;
    return {rows:Array.isArray(rows) ? rows : rows ? [rows] : [], checkedAt:Date.now()};
  });

  return async (req, res, url) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET 요청이 필요합니다.' });
    const value = (key) => url.searchParams.get(key)?.trim();
    const latitude = Number(value('lat') || NaN);
    const longitude = Number(value('lon') || NaN);
    const stop = value('stop');
    const next = value('next');
    const stopId = value('stopId');
    const routeId = value('routeId');
    const exact = /^\d{9}$/.test(stopId) && /^\d{9}$/.test(routeId);
    const routes = (value('routes') ?? '').split(',').map(normalizeRoute);
    const boardingAt = Number(value('at') || NaN);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) ||
        Math.abs(longitude) > 180 || !stop || stop.length > 100 ||
        ((stopId !== undefined || routeId !== undefined) && !exact) || (!exact && (!next || next.length > 100)) ||
        routes.length > 12 || routes.some((route) => !route || route.length > 30) ||
        !Number.isSafeInteger(boardingAt) || Math.abs(boardingAt) > 8e15) {
      return sendJson(res, 400, { error: '버스 탑승 정보를 확인해 주세요.' });
    }
    if (!history) return sendJson(res, 503, { error: '서울시 버스 API 키가 설정되지 않았어요.' });
    try {
      const point = { tmX: longitude, tmY: latitude, radius: 100 };
      const stops = await nearby(`${longitude.toFixed(4)},${latitude.toFixed(4)}`, point);
      const matches = stops.filter((station) => /^\d{5}$/.test(station.arsId) && station.arsId !== '00000' &&
        (exact ? String(station.stationId) === stopId : normalizeStop(station.stationNm) === normalizeStop(stop)));
      // 카카오 경로선의 시작점과 가까운 동일 이름 정류소만 사용한다.
      matches.sort((a, b) => Number(a.dist) - Number(b.dist));
      if (!matches.length || (matches.length > 1 && Number(matches[1].dist) - Number(matches[0].dist) < 10)) {
        return sendJson(res, 200, { routes: [] });
      }
      const station = matches[0];
      const { rows, reports, checkedAt } = await arrivals(station.arsId, station.arsId);
      const showLive = boardingAt >= checkedAt - 5 * MINUTE && boardingAt <= checkedAt + 30 * MINUTE;
      const result = rows.filter((row) => exact
        ? String(row.busRouteId) === routeId && String(row.stId) === stopId
        : [row.rtNm, row.busRouteAbrv].some((name) => routes.includes(normalizeRoute(name))) &&
          normalizeStop(row.nxtStn) === normalizeStop(next) && /^\d+$/.test(row.busRouteId));
      // Leave loops with more than one matching stop order unverified.
      if (exact && result.length !== 1) return sendJson(res, 200, { routes: [] });
      // The regional seat feed shares the station ID, route ID and stop order with these Seoul rows.
      const regionalStation = result.find(row => Number(row.routeType) === 8 && /^\d+$/.test(row.stId))?.stId;
      const regional = showLive && gyeonggiServiceKey && regionalStation
        ? await regionalArrivals(regionalStation,regionalStation).catch(() => null)
        : null;
      return sendJson(res, 200, {
        checkedAt, showLive, routes: result.map((row) => {
          const accessible = reports.get(`${row.busRouteId}/${row.staOrd}`);
          const from = report => [1,2].map(index => readArrival({...report,routeType:row.routeType},index,checkedAt)).filter(Boolean);
          const accessibleLive = accessible ? from(accessible) : [];
          const regularLive = from(row);
          const live = regularLive.some(item => item.remainingSeats !== undefined) ? regularLive
            : accessibleLive.length ? accessibleLive : regularLive;
          const approaching = live.find(({code,seconds}) => code && seconds <= 180);
          if (approaching) history.record(station.arsId,row.busRouteId,checkedAt,approaching.code);
          const regionalRow = Number(row.routeType) === 8 && regional?.rows.find(entry =>
            String(entry.stationId) === String(row.stId) &&
            String(entry.routeId) === String(row.busRouteId) &&
            String(entry.staOrder) === String(row.staOrd));
          const regionalLive = regionalRow && !['STOP','WAIT'].includes(regionalRow.flag)
            ? [1,2].map(index => regionalArrival(regionalRow,index,regional.checkedAt)).filter(Boolean) : [];
          return {
            name:row.rtNm,
            aliases:[row.rtNm,row.busRouteAbrv,regionalRow?.routeName,...(exact ? routes : [])].filter(Boolean).map(String),
            source:regionalLive.length ? '경기버스정보' : '서울시 버스정보',
            arrivals:showLive ? regionalLive.length ? regionalLive : live.map(({seconds,congestion,remainingSeats}) => ({
              seconds,congestion,at:checkedAt + seconds*1000,
              ...(remainingSeats === undefined ? {} : {remainingSeats}),
            })) : [],
            prediction:history.predict(station.arsId,row.busRouteId,boardingAt,checkedAt),
          };
        }),
      });
    } catch {
      return sendJson(res, 502, { error: '서울시 버스 정보를 조회하지 못했어요.' });
    }
  };
}
