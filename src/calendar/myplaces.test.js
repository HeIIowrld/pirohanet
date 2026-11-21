// 실행: node src/calendar/myplaces.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportSavedPlaces, importSavedPlaces, pushMyPlaces, savedPlace, savePlace, syncMyPlaces } from './location.js';

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

test('양쪽에 있는 내 장소를 합치고, 이미 맞춘 글자는 계정 쪽을 따른다', async () => {
  const store = fakeStore();
  // 예전에 계정과 맞춰 둔 옛 값(올리지 못한 변경이 아니다)과, 이 브라우저에서 새로 기억한 집
  importSavedPlaces({ 회사: { ...OFFICE, name: '이 브라우저의 옛 회사' } }, store);
  savePlace('집', HOME, store);
  const drive = fakeDrive({ 회사: OFFICE });
  const merged = await syncMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(merged, { 회사: OFFICE, 집: HOME });
  assert.deepEqual(drive.remote, { 회사: OFFICE, 집: HOME });
  assert.equal(drive.calls.at(-1), 'PATCH /upload/drive/v3/files/FILE1');
});

test('이 브라우저에서 고치고 아직 올리지 못한 장소는 맞출 때 되돌아가지 않는다', async () => {
  const store = fakeStore();
  const WRONG = { name: '엉뚱한 곳', address: '울산 북구 염포로 706', latitude: 35.5, longitude: 129.3 };
  const drive = fakeDrive({ '1공': WRONG, 회사: OFFICE });
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  savePlace('1공', HOME, store); // 로그인 없이, 또는 올리기에 실패한 채 고친 상태
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(savedPlace('1공', store), HOME);
  assert.deepEqual(drive.remote, { '1공': HOME, 회사: OFFICE });
  // 한 번 올라간 뒤에는 다시 계정 쪽을 따른다
  drive.remote = { '1공': OFFICE, 회사: OFFICE };
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(savedPlace('1공', store), OFFICE);
});

test('로그인 없이 지운 장소는 맞출 때 계정에서도 지워진다', async () => {
  const store = fakeStore();
  const drive = fakeDrive({ 회사: OFFICE, 집: HOME });
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  savePlace('회사', null, store);
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(exportSavedPlaces(store), { 집: HOME });
  assert.deepEqual(drive.remote, { 집: HOME });
});

test('맞추지 못한 채 기억해도 계정에만 있는 장소를 지우지 않는다', async () => {
  const store = fakeStore(); // 새 기기: 이 브라우저에는 아무것도 없고 계정에는 회사와 집이 있다
  const drive = fakeDrive({ 회사: OFFICE, 집: HOME });
  savePlace('1공', OFFICE, store);
  await pushMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(drive.remote, { 회사: OFFICE, 집: HOME, '1공': OFFICE });
  assert.deepEqual(exportSavedPlaces(store), { '1공': OFFICE, 회사: OFFICE, 집: HOME });
});

test('올리기에 실패한 변경은 남아 있다가 다음에 맞출 때 올라간다', async () => {
  const store = fakeStore();
  const drive = fakeDrive({ 회사: OFFICE });
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  savePlace('회사', HOME, store);
  await assert.rejects(pushMyPlaces('TOKEN', fakeDrive(null, { status: 503 }).fetchFn, store), /Drive 503/);
  assert.deepEqual(savedPlace('회사', store), HOME); // 이 브라우저의 값은 그대로
  await syncMyPlaces('TOKEN', drive.fetchFn, store);
  assert.deepEqual(drive.remote, { 회사: HOME });
});

test('저장이 막힌 브라우저에서 맞춰도 계정의 내 장소를 비우지 않는다', async () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const drive = fakeDrive({ 회사: OFFICE, 집: HOME });
  assert.deepEqual(await syncMyPlaces('TOKEN', drive.fetchFn, blocked), { 회사: OFFICE, 집: HOME });
  assert.deepEqual(drive.remote, { 회사: OFFICE, 집: HOME });
  assert.deepEqual(drive.calls, ['GET /drive/v3/files', 'GET /drive/v3/files/FILE1']); // 올리지 않는다
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
