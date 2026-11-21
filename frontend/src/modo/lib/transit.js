import { distanceFrom, isKoreanPoint } from './naver.js';
import { railDirection, stationName } from './rail-directions.js';

const minute = 60_000;
const busAPI = 'http://ws.bus.go.kr/api/rest/';
const subwayAPI = 'http://swopenapi.seoul.go.kr/api/subway/';
const list = value => Array.isArray(value) ? value : value ? [value] : [];
const text = value => String(value ?? '').trim();
const digits = (value, length) => new RegExp('^\\d{' + length + '}$').test(text(value));
const specialStations = new Map([
  ['응암', '응암순환(상선)'], ['공릉', '공릉(서울산업대입구)'], ['대모산입구', '대모산'],
  ['천호', '천호(풍납토성)'], ['몽촌토성', '몽촌토성(평화의문)'],
  ['남한산성입구', '남한산성입구(성남법원, 검찰청)']
]);
const lineIds = new Map([
  ['경의중앙선', '1063'], ['공항철도', '1065'], ['경춘선', '1067'],
  ['수인분당선', '1075'], ['신분당선', '1077'], ['우이신설선', '1092'], ['신림선', '1093']
]);
class SeoulAccessError extends Error {}

function xmlValues(source, tag) {
  return [...source.matchAll(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g'))].map(match => match[1]);
}

function xmlFields(source) {
  const fields = {};
  for (const [, name, value] of source.matchAll(/<([A-Za-z][\w]*)>([^<]*)<\/\1>/g)) {
    fields[name] = value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
    }[entity])).trim();
  }
  return fields;
}

function publicItems(source) {
  if (!source.trimStart().startsWith('<')) {
    const body = JSON.parse(source);
    const payload = body.ServiceResult ?? body;
    const code = text(payload.msgHeader?.headerCd);
    if (code === '4') return [];
    if (code !== '0' || !payload.msgBody) throw new Error('Invalid Seoul API response');
    return list(payload.msgBody.itemList ?? payload.msgBody);
  }
  const code = xmlValues(source, 'headerCd')[0]?.trim();
  if (code === '4') return [];
  if (code !== '0') throw new Error('Invalid Seoul API response');
  const body = xmlValues(source, 'msgBody')[0] ?? '';
  return xmlValues(body, 'itemList').map(record => ({
    ...xmlFields(record.replace(/<pathList(?:\s[^>]*)?>[\s\S]*?<\/pathList>/g, '')),
    pathList: xmlValues(record, 'pathList').map(xmlFields)
  }));
}

async function busItems(path, key, params) {
  const url = new URL(path, busAPI);
  url.search = new URLSearchParams({ ...params, serviceKey: key, resultType: 'json' });
  const response = await fetch(url, { signal: AbortSignal.timeout(4500), redirect: 'error' });
  if (response.status === 401 || response.status === 403) throw new SeoulAccessError('Seoul service authorization required');
  if (!response.ok) throw new Error('Seoul bus request failed');
  return publicItems(await response.text());
}

function point(x, y) {
  const coordinate = [Number(x), Number(y)];
  return isKoreanPoint(coordinate) ? coordinate : null;
}

function normalizeLeg(row) {
  const from = point(row.fx, row.fy);
  const to = point(row.tx, row.ty);
  const line = text(row.routeNm);
  const routeId = text(row.routeId);
  const fromId = text(row.fid || row.stId);
  const toId = text(row.tid);
  if (!from || !to || !line || !text(row.fname) || !text(row.tname)) return null;
  const shortLine = line.replace(/^(수도권|서울)\s*/u, '').replace(/\s번/u, '');
  const numberedLine = shortLine.match(/^([1-9])(?:호선)?$/u)?.[1];
  const subwayId = lineIds.get(shortLine) ?? (numberedLine ? '100' + numberedLine : '');
  const linkedStops = [row.railLinkId, ...list(row.railLinkList).map(link => link.railLinkId)]
    .flatMap(value => text(value).match(/\d{10}/g) ?? []);
  const stopCount = list(row.railLinkList).length;
  const subway = Boolean(linkedStops.length || digits(fromId, 10) || /호선|철도|경의|경춘|분당|신설선|신림선/u.test(line));
  const fromIndex = linkedStops.indexOf(fromId);
  const nextId = linkedStops[fromIndex < 0 ? 0 : fromIndex + 1] || '';
  return {
    kind: subway ? 'subway' : 'bus', line, routeId, subwayId, from, to, fromId, toId,
    fromName: text(row.fname), toName: text(row.tname),
    direction: text(row.direction), ord: text(row.ord ?? row.staOrd), nextId: nextId === fromId ? '' : nextId,
    intermediateStops: linkedStops.slice(fromIndex + 1, linkedStops.indexOf(toId) >= 0 ? linkedStops.indexOf(toId) : undefined),
    stopCount
  };
}

function walking(from, to) {
  const metres = distanceFrom(from, to) * 1.3;
  return metres < 15 ? 0 : Math.ceil(metres / 70);
}

function normalizePath(row, start, end) {
  const legs = list(row.pathList?.item ?? row.pathList).map(normalizeLeg);
  const base = Number(row.time);
  if (!legs.length || legs.length > 5 || legs.some(leg => !leg) || !Number.isFinite(base) || base <= 0 || base > 240) return null;
  const approach = walking(start, legs[0].from);
  const exit = walking(legs.at(-1).to, end);
  const transferWalk = legs.slice(1).reduce((sum, leg, i) => sum + walking(legs[i].to, leg.from), 0);
  return { legs, approach, exit, base: Math.max(Math.ceil(base), approach + exit + transferWalk + 1) };
}

function kstTime(value) {
  return Date.parse(text(value).replace(' ', 'T') + '+09:00');
}

function expectedBus(row, index, now) {
  const status = text(row['arrmsg' + index]);
  if (!status || /대기|없음|종료|미정|운행종료/u.test(status) || String(row['full' + index]) === '1') return null;
  const minuteMatch = status.match(/(\d+)\s*분/u);
  const secondsMatch = status.match(/(\d+)\s*초/u);
  const numeric = Number(row['exps' + index]);
  const seconds = /곧\s*도착|도착\s*임박|진입|^도착$/u.test(status) ? Math.min(numeric > 0 ? numeric : 30, 59) :
    numeric > 0 ? numeric : minuteMatch || secondsMatch ? Number(minuteMatch?.[1] ?? 0) * 60 + Number(secondsMatch?.[1] ?? 0) : null;
  const provided = kstTime(row.mkTm);
  if (Number.isFinite(provided) && now - provided > 3 * minute) return null;
  if (seconds === null || seconds > 60 * 60) return null;
  const eta = (Number.isFinite(provided) ? Math.min(provided, now) : now) + seconds * 1000;
  return eta >= now ? eta : null;
}

function busTimes(rows, leg, now) {
  const boarding = rows.filter(row => text(row.stId) === leg.fromId ||
    (digits(leg.fromId, 5) && text(row.arsId) === leg.fromId));
  const alighting = rows.filter(row => text(row.stId) === leg.toId);
  const compatible = boarding.filter(row => (!leg.ord || text(row.staOrd) === leg.ord) &&
    (!alighting.length || alighting.some(stop => Number(stop.staOrd) > Number(row.staOrd))));
  const [match] = compatible;
  if (!match || compatible.length !== 1) return [];
  return [1, 2].map(index => expectedBus(match, index, now)).filter(Number.isFinite);
}

async function trains(station, key) {
  const url = subwayAPI + encodeURIComponent(key) + '/json/realtimeStationArrival/0/30/' + encodeURIComponent(station);
  const response = await fetch(url, { signal: AbortSignal.timeout(4500), redirect: 'error' });
  if (!response.ok) throw new Error('Seoul subway request failed');
  const data = await response.json();
  return list(data.realtimeArrivalList);
}

function trainTimes(rows, leg, now) {
  const line = leg.subwayId || (digits(leg.fromId, 10) ? leg.fromId.slice(0, 4) : '');
  const direction = stationName(leg.direction);
  const destination = stationName(leg.toName);
  if (!line || !destination) return [];
  const from = stationName(leg.fromName);
  const inferred = leg.nextId || direction || !leg.stopCount ? null : railDirection(line, from, destination, leg.stopCount);
  return rows.flatMap(row => {
    const nextId = text(row.statnTid);
    const nextName = stationName(text(row.trainLineNm).split(' - ').at(-1).replace(/방면$/u, ''));
    const terminal = stationName(row.bstatnNm);
    const expectedNext = direction || inferred?.next;
    const sameDirection = leg.nextId ? nextId === leg.nextId :
      expectedNext ? nextName === expectedNext : nextId === leg.toId || nextName === destination || terminal === destination;
    if (text(row.subwayId) !== line || !sameDirection ||
        stationName(row.statnNm) !== from || /급행|특급|ITX/u.test(text(row.btrainSttus)) ||
        (inferred && !inferred.canReach(terminal)) ||
        !sameBranch(row, leg)) return [];
    const provided = kstTime(row.recptnDt);
    const seconds = Number(row.barvlDt);
    if (!Number.isFinite(provided) || now - provided > 3 * minute || provided > now + minute ||
        !Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return [];
    if (seconds === 0 && !['0', '1'].includes(text(row.arvlCd))) return [];
    const eta = Math.min(provided, now) + (seconds || 30) * 1000;
    return eta >= now ? [eta] : [];
  });
}

function sameBranch(row, leg) {
  const terminal = text(row.bstatnId);
  return !terminal || (terminal !== leg.fromId && !leg.intermediateStops.includes(terminal));
}

function arrivalsFor(leg, env, cache, now) {
  if (leg.kind === 'bus' && env.SEOUL_BUS_KEY && digits(leg.routeId, 9)) {
    const id = 'bus:' + leg.routeId;
    if (!cache.has(id)) cache.set(id, busItems('arrive/getArrInfoByRouteAll', env.SEOUL_BUS_KEY, { busRouteId: leg.routeId }).catch(() => []));
    return cache.get(id).then(rows => busTimes(rows, leg, now));
  }
  if (leg.kind === 'subway' && env.SEOUL_SUBWAY_KEY) {
    const name = stationName(leg.fromName);
    const id = 'subway:' + name;
    if (!cache.has(id)) cache.set(id, trains(specialStations.get(name) ?? name, env.SEOUL_SUBWAY_KEY).catch(() => []));
    return cache.get(id).then(rows => trainTimes(rows, leg, now));
  }
  return [];
}

function summarizePath(path, start, end, request, arrivals, now, id) {
  const ready = request.departAt + path.approach * minute;
  const next = arrivals[0].find(eta => eta >= ready);
  const canBoard = !arrivals[0].length || Boolean(next);
  const wait = next ? Math.max(0, Math.ceil((next - ready) / minute)) : null;
  const minutes = path.base + (wait ?? 0);
  const eta = request.departAt + minutes * minute;
  return {
    id, minutes, eta: new Date(eta).toISOString(), late: Math.max(0, Math.ceil((eta - request.arriveBy) / minute)),
    canBoard, wait, approach: path.approach, exit: path.exit,
    approachPath: path.approachPath ?? null,
    coordinates: [start, ...path.legs.flatMap(leg => [leg.from, leg.to]), end],
    legs: path.legs.map((leg, index) => ({
      kind: leg.kind, line: leg.line, from: leg.from, to: leg.to, fromName: leg.fromName, toName: leg.toName,
      arrivals: arrivals[index].slice(0, 2).map(at => ({
        at: new Date(at).toISOString(), minutes: Math.max(0, Math.ceil((at - now) / minute)),
        ...(index === 0 && { catchable: at >= ready })
      }))
    }))
  };
}

export async function transitRoutes(start, end, request, env, now = Date.now(), boardingWalk) {
  if (!env.SEOUL_TRANSIT_KEY) return { status: 'unconfigured', routes: [] };
  if ([start, end].some(([lon, lat]) => lon < 126.75 || lon > 127.20 || lat < 37.40 || lat > 37.72)) {
    return { status: 'outside', routes: [] };
  }
  const params = { startX: start[0], startY: start[1], endX: end[0], endY: end[1] };
  try {
    const sources = ['getPathInfoByBusNSub', 'getPathInfoByBus', 'getPathInfoBySubway'];
    const replies = await Promise.allSettled(sources.map(source => busItems('pathinfo/' + source, env.SEOUL_TRANSIT_KEY, params)));
    const available = replies.filter(reply => reply.status === 'fulfilled');
    if (!available.length) throw replies[0].reason;
    const rows = available.flatMap(reply => reply.value);
    const paths = rows.map(row => normalizePath(row, start, end)).filter(Boolean).sort((a, b) => a.base - b.base);
    const signatures = new Set();
    const unique = paths.filter(path => {
      const key = path.legs.map(leg => [leg.line, leg.fromId || leg.fromName, leg.toId || leg.toName].join('/')).join('|');
      if (signatures.has(key)) return false;
      signatures.add(key);
      return true;
    });
    const byMode = new Map();
    for (const path of unique) {
      const kind = path.legs.every(leg => leg.kind === path.legs[0].kind) ? path.legs[0].kind : 'mixed';
      if (!byMode.has(kind)) byMode.set(kind, path);
    }
    const candidates = Array.from(new Set([...byMode.values(), ...unique])).slice(0, 3);
    const cache = new Map();
    const walkCache = new Map();
    const routes = await Promise.all(candidates.map(async (path, index) => {
      const arrivalRequest = request.departAt - now < 30 * minute
        ? Promise.all(path.legs.map(leg => arrivalsFor(leg, env, cache, now))) : path.legs.map(() => []);
      const boarding = path.legs[0].from;
      const walkId = boarding.join(',');
      if (boardingWalk && !walkCache.has(walkId) && path.approach) {
        walkCache.set(walkId, boardingWalk(start, boarding).catch(() => null));
      }
      const [arrivalLists, walked] = await Promise.all([arrivalRequest, walkCache.get(walkId)]);
      if (walked) {
        path.base += Math.max(0, walked.walk - path.approach);
        path.approach = walked.walk;
        path.approachPath = walked.coordinates;
      }
      return summarizePath(path, start, end, request, arrivalLists.map(times => times.sort((a, b) => a - b)), now, 'transit-' + index);
    }));
    routes.sort((a, b) => Number(b.canBoard) - Number(a.canBoard) || a.minutes - b.minutes);
    return { status: routes.length ? 'ready' : 'empty', checkedAt: new Date(now).toISOString(), routes };
  } catch (error) {
    return { status: error instanceof SeoulAccessError ? 'authorization-required' : 'unavailable', routes: [] };
  }
}

export function sampleTransit(start, end, request) {
  const now = request.departAt;
  const bus = { kind: 'bus', line: '7016', fromName: '시청앞', toName: '광화문',
    from: [126.9784, 37.5669], to: [126.9771, 37.5711] };
  const subway = { kind: 'subway', line: '1호선', fromName: '시청역', toName: '종각역',
    from: [126.9772, 37.5657], to: [126.9826, 37.5702] };
  const routes = [
    summarizePath({ legs: [bus], approach: 3, exit: 3, base: 11 }, start, end, request,
      [[now + 40_000, now + 5 * minute]], now, 'sample-bus'),
    summarizePath({ legs: [subway], approach: 5, exit: 8, base: 16 }, start, end, request,
      [[now + 7 * minute, now + 11 * minute]], now, 'sample-subway')
  ];
  return { status: 'sample', checkedAt: new Date(now).toISOString(), routes };
}
