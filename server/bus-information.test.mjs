import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createBusInformation, readArrival } from './bus-information.mjs';

test('arrival parser rejects old vehicle reports and preserves unknown occupancy', () => {
  const now = Date.parse('2026-11-21T14:23:00+09:00');
  const row = { repTm1: '2026-11-21 14:22:00.0', arrmsgSec1: '2분30초후', congestion1: '0' };
  assert.deepEqual(readArrival(row, 1, now), { seconds: 150, congestion: null, code: null });
  assert.equal(readArrival({ ...row, repTm1: '2021-12-26 20:06:15.0' }, 1, now), null);
  assert.equal(readArrival({ ...row, arrmsgSec1: '운행종료' }, 1, now), null);
});

test('bus information matches the boarding direction, uses current reports, and predicts from distinct days', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modo-bus-'));
  try {
    const now = Date.now();
    const reportTime = new Date(now + 9 * 60 * 60_000).toISOString().replace('T', ' ').slice(0, -1);
    const route = { rtNm: '271', busRouteId: '100100047', staOrd: '83', nxtStn: '다음 정류소' };
    const row = { ...route, repTm1: '2021-12-26 20:06:15.0', arrmsg1: '3분후' };
    const handle = createBusInformation({
      root, serviceKey: 'test', sendJson: (_, status, body) => ({ status, body }),
      fetchFn: async (url) => {
        const itemList = url.pathname.endsWith('getStationByPos')
          ? [{ arsId: '14062', stationNm: '승차 정류소', dist: '10' }]
          : url.pathname.endsWith('getLowStationByUid')
            ? [{ ...route, repTm1: reportTime, arrmsg1: '2분후', congestion1: '5' }]
            : [row, { ...row, staOrd: '84', nxtStn: '반대 방향' }];
        return Response.json({ msgHeader: { headerCd: '0' }, msgBody: { itemList } });
      },
    });
    const call = (boardingAt) => {
      const query = new URLSearchParams({ lat: 37.5555, lon: 126.9357,
        stop: '승차 정류소(중)', next: '다음 정류소(중)', routes: '271', at: boardingAt });
      return handle({ method: 'GET' }, { setHeader() {} }, new URL(`http://localhost/api/bus-information?${query}`));
    };
    const { status, body } = await call(now);
    assert.equal(status, 200);
    assert.equal(body.routes.length, 1);
    assert.equal(body.routes[0].arrivals[0].seconds, 120);
    assert.equal(body.routes[0].arrivals[0].congestion, '혼잡');
    assert.equal(body.routes[0].prediction, null);

    const db = new DatabaseSync(join(root, '.data', 'bus-crowding.sqlite'));
    const sample = db.prepare('SELECT * FROM bus_crowding').get();
    assert.equal(sample.code, 5);
    const insert = db.prepare('INSERT INTO bus_crowding VALUES (?, ?, ?, ?, ?, ?)');
    for (const [weeks, code] of [[1, 3], [2, 4], [3, 5]]) {
      const date = new Date(now + 9 * 60 * 60_000 - weeks * 7 * 86_400_000).toISOString().slice(0, 10);
      insert.run(sample.stop, sample.route, sample.day, sample.slot, date, code);
    }
    db.close();
    const future = await call(now + 7 * 86_400_000);
    assert.equal(future.body.showLive, false);
    assert.deepEqual(future.body.routes[0].arrivals, []);
    assert.deepEqual(future.body.routes[0].prediction, { congestion: '보통', sampleDays: 3 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
