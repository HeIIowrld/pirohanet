// 실행: node src/calendar/myplaces.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pushMyPlaces, syncMyPlaces } from './myplaces.js';
import { exportSavedPlaces, savePlace } from './location.js';

const OFFICE = { name: '현대자동차 본사 양재사옥', address: '서울 서초구 헌릉로 12', latitude: 37.46, longitude: 127.04 };
const HOME = { name: '우리 집', address: '서울 마포구 어딘가', latitude: 37.55, longitude: 126.92 };

function fakeStore() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

// Google Drive 흉내. remote가 null이면 계정에 파일이 아직 없는 상태다.
function fakeDrive(remote, { status } = {}) {
  const drive = { remote, calls: [] };
  drive.fetchFn = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    drive.calls.push(`${method} ${pathname}`);
    assert.equal(init.headers.Authorization, 'Bearer TOKEN');
    if (status) return { ok: false, status };
    let body = {};
    if (method === 'GET' && pathname === '/drive/v3/files') {
      assert.equal(searchParams.get('spaces'), 'appDataFolder');
      assert.equal(searchParams.get('q'), "name = 'my-places.json'");
      body = { files: drive.remote ? [{ id: 'FILE1' }] : [] };
    } else if (method === 'GET' && pathname === '/drive/v3/files/FILE1') {
      assert.equal(searchParams.get('alt'), 'media');
      body = drive.remote;
    } else if (method === 'PATCH' && pathname === '/upload/drive/v3/files/FILE1') {
      drive.remote = JSON.parse(init.body);
    } else if (method === 'POST' && pathname === '/upload/drive/v3/files') {
      assert.equal(searchParams.get('uploadType'), 'multipart');
      assert.match(init.headers['Content-Type'], /^multipart\/related; boundary=/);
      const [, metadata, content] = init.body.split(/\r\n\r\n/).map((part) => part.split('\r\n--')[0]);
      assert.deepEqual(JSON.parse(metadata), { name: 'my-places.json', parents: ['appDataFolder'] });
      drive.remote = JSON.parse(content);
    } else {
      assert.fail(`예상하지 못한 요청: ${method} ${url}`);
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return drive;
}

test('계정에 파일이 없으면 이 브라우저의 내 장소로 새로 만든다', async () => {
  const store = fakeStore();
  savePlace('회사', OFFICE, store);
  const drive = fakeDrive(null);
  assert.deepEqual(await syncMyPlaces('TOKEN', drive.fetchFn, store), { 회사: OFFICE });
  assert.deepEqual(drive.remote, { 회사: OFFICE });
  assert.deepEqual(drive.calls, ['GET /drive/v3/files', 'POST /upload/drive/v3/files']);
});

test('새 브라우저에서 로그인하면 계정의 내 장소를 받아 온다', async () => {
  const store = fakeStore();
  const drive = fakeDrive({ 회사: OFFICE });
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(exportSavedPlaces(store), { 회사: OFFICE });
  assert.deepEqual(drive.calls, ['GET /drive/v3/files', 'GET /drive/v3/files/FILE1']); // 달라진 것이 없어 다시 저장하지 않는다
});

test('양쪽에 있는 내 장소를 합치고, 같은 글자는 계정 쪽을 따른다', async () => {
  const store = fakeStore();
  savePlace('집', HOME, store);
  savePlace('회사', { ...OFFICE, name: '이 브라우저의 옛 회사' }, store);
  const drive = fakeDrive({ 회사: OFFICE });
  const merged = await syncMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(merged, { 집: HOME, 회사: OFFICE });
  assert.deepEqual(drive.remote, { 집: HOME, 회사: OFFICE });
  assert.equal(drive.calls.at(-1), 'PATCH /upload/drive/v3/files/FILE1');
});

test('계정에 좌표 없는 항목이 있으면 버린다', async () => {
  const store = fakeStore();
  const drive = fakeDrive({ 회사: OFFICE, 깨진값: { name: '좌표 없음' } });
  assert.deepEqual(await syncMyPlaces('TOKEN', drive.fetchFn, store), { 회사: OFFICE });
  assert.deepEqual(drive.remote, { 회사: OFFICE });
});

test('기억을 지우고 올리면 계정에서도 지워진다', async () => {
  const store = fakeStore();
  const drive = fakeDrive({ 회사: OFFICE, 집: HOME });
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  savePlace('회사', null, store);
  await pushMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(drive.remote, { 집: HOME });
});

test('Drive 호출이 실패하면 예외를 던지고 이 브라우저의 내 장소는 그대로 둔다', async () => {
  const store = fakeStore();
  savePlace('회사', OFFICE, store);
  const drive = fakeDrive(null, { status: 403 });
  await assert.rejects(syncMyPlaces('TOKEN', drive.fetchFn, store), /Drive 403/);
  await assert.rejects(pushMyPlaces('TOKEN', drive.fetchFn, store), /Drive 403/);
  assert.deepEqual(exportSavedPlaces(store), { 회사: OFFICE });
});
