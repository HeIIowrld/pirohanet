// 내 장소를 사용자의 Google 계정에 저장해, 기기나 브라우저가 바뀌어도 다시 묻지 않게 한다.
//
// 저장 위치는 Google Drive의 앱 전용 숨김 폴더(appDataFolder)다. 이 앱만 읽고 쓸 수 있고 사용자의 Drive 화면에는 보이지 않는다.
// 필요한 것: 로그인 때 drive.appdata 권한(calendar.js의 requestGoogleToken이 함께 요청한다)과,
// Google Cloud 프로젝트에서 Google Drive API 사용 설정.
//
// 브라우저 저장소(location.js)는 그대로 쓰고, 이 파일은 그 내용을 계정과 맞추는 일만 한다.
import { exportSavedPlaces, importSavedPlaces } from './location.js';

const FILE_NAME = 'my-places.json';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

async function call(token, url, init, fetchFn) {
  const res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  if (!res.ok) {
    // 403은 원인이 여럿이라(Drive API 미사용 설정, 권한 미동의) Google이 준 사유를 함께 남긴다
    const detail = (await res.json?.().catch(() => null))?.error;
    const reason = detail?.errors?.[0]?.reason ?? detail?.status ?? '';
    throw new Error(`Drive ${res.status}${reason ? ` ${reason}` : ''}`);
  }
  return res;
}

async function findFileId(token, fetchFn) {
  const params = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${FILE_NAME}'`, fields: 'files(id)', pageSize: '1' });
  const { files = [] } = await (await call(token, `${FILES}?${params}`, undefined, fetchFn)).json();
  return files[0]?.id ?? null;
}

async function upload(token, fileId, places, fetchFn) {
  const body = JSON.stringify(places);
  if (fileId) {
    return call(token, `${UPLOAD}/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, fetchFn);
  }
  const boundary = 'pirohanet_my_places';
  const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  return call(
    token,
    `${UPLOAD}?uploadType=multipart`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`,
    },
    fetchFn,
  );
}

// 로그인 직후에 부른다. 계정에 저장된 내 장소를 받아 이 브라우저의 것과 합치고, 달라졌으면 계정에 다시 저장한다.
// 합친 내 장소 { 위치 글자: 장소 }를 돌려준다. 같은 글자가 양쪽에 있으면 계정 쪽을 따른다.
export async function syncMyPlaces(token, fetchFn = fetch, store) {
  const fileId = await findFileId(token, fetchFn);
  const remote = fileId ? await (await call(token, `${FILES}/${fileId}?alt=media`, undefined, fetchFn)).json() : {};
  importSavedPlaces({ ...exportSavedPlaces(store), ...remote }, store);
  const merged = exportSavedPlaces(store);
  if (JSON.stringify(merged) !== JSON.stringify(remote)) await upload(token, fileId, merged, fetchFn);
  return merged;
}

// 내 장소를 기억하거나 지운 직후에 부른다. 이 브라우저의 내 장소로 계정의 것을 덮어쓴다.
// ponytail: 로그인하지 않은 채 지운 기억은 계정에 남아 다음 로그인 때 돌아온다. 지운 기록을 따로 남겨야 고쳐진다
export async function pushMyPlaces(token, fetchFn = fetch, store) {
  await upload(token, await findFileId(token, fetchFn), exportSavedPlaces(store), fetchFn);
}
