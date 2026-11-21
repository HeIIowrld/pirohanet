import { requestGoogleToken } from '../calendar/calendar.js';
import { exportSavedPlaces, pushMyPlaces, savedPlace, savePlace, searchPlaceCandidates, syncMyPlaces } from '../calendar/location.js';

const list = document.querySelector('#saved-place-list');
const status = document.querySelector('#saved-places-status');
const login = document.querySelector('#saved-places-login');
const addPanel = document.querySelector('#saved-place-add');
const addForm = addPanel.querySelector('form');
const addQuery = addForm.elements.query;
const addAlias = addForm.elements.alias;
const addStatus = addPanel.querySelector('[role="status"]');
const addChoices = addPanel.querySelector('.account-actions');
let googleToken = null; // 메모리에만 있어서 페이지를 떠나면 사라진다

// 이 브라우저에 먼저 반영하고, Google에 연결돼 있으면 계정에도 올린다. 사용자에게 보여 줄 안내를 돌려준다.
// 계정에 올리지 못한 변경은 location.js가 기록해 두었다가 다음에 계정과 맞출 때 반영한다.
async function applyPlace(alias, place) {
  savePlace(alias, place);
  if (Boolean(savedPlace(alias)) !== Boolean(place)) throw new Error('이 브라우저에 변경 사항을 저장하지 못했어요.');
  if (!googleToken) return '이 브라우저에만 반영했어요. Google 계정과 맞추면 다른 기기에도 반영돼요.';
  try {
    await pushMyPlaces(googleToken);
    return 'Google 계정에도 반영했어요.';
  } catch (error) {
    console.warn(error);
    return 'Google 계정에는 반영하지 못해 이 브라우저에만 반영했어요.';
  }
}

async function locateCurrentPlace() {
  if (!window.isSecureContext || !navigator.geolocation) {
    throw new Error('현재 위치는 위치 기능을 지원하는 브라우저에서 HTTPS 또는 localhost로 접속하면 사용할 수 있어요.');
  }

  const { coords: { latitude, longitude } } = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (error) => {
      const message = {
        1: '위치 권한이 차단됐어요. 브라우저의 사이트 설정에서 위치를 허용해 주세요.',
        2: '현재 위치를 확인할 수 없어요.',
        3: '현재 위치를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 시도해 주세요.',
      }[error.code];
      reject(new Error(message ?? '현재 위치를 확인할 수 없어요.'));
    }, { timeout: 10000 });
  });

  const params = new URLSearchParams({ latitude, longitude });
  const response = await fetch(`/api/reverse-geocode?${params}`);
  if (!response.ok) throw new Error('현재 위치의 주소를 조회하지 못했어요.');
  const hit = (await response.json()).documents?.[0];
  const address = hit?.road_address?.address_name || hit?.address?.address_name;
  if (!address) return [];
  return [{ address, latitude, longitude }];
}

function renderPlace(entry) {
  const item = document.createElement('li');
  const heading = document.createElement('h2');
  heading.textContent = entry.alias;
  const address = document.createElement('p');
  address.textContent = entry.address;
  const edit = document.createElement('form');
  edit.className = 'saved-place-edit';
  const query = document.createElement('input');
  query.required = true;
  query.value = entry.address;
  query.setAttribute('aria-label', `${entry.alias}의 새 주소`);
  const search = button('주소 검색', 'submit');
  const current = button('현재 위치 사용');
  const remove = button('삭제');
  const buttons = [search, current, remove];
  const choices = document.createElement('div');
  choices.className = 'account-actions';
  const feedback = document.createElement('p');
  feedback.className = 'status';
  feedback.setAttribute('role', 'status');
  edit.append(query, ...buttons);
  item.append(heading, address, edit, choices, feedback);

  query.addEventListener('input', () => choices.replaceChildren());
  async function findPlaces(trigger, lookup, pendingMessage, emptyMessage) {
    if (trigger.disabled) return;
    const entered = query.value.trim();
    choices.replaceChildren();
    feedback.textContent = pendingMessage;
    for (const control of buttons) control.disabled = true;
    try {
      const places = await lookup(entered);
      if (!item.isConnected || (trigger === search && entered !== query.value.trim())) {
        feedback.textContent = '';
        return;
      }
      for (const place of places) {
        if (!place.address || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) continue;
        const choice = button(`${place.name ? place.name + ' · ' : ''}${place.address}로 변경`);
        choice.addEventListener('click', async () => {
          const controls = [query, ...buttons, ...choices.children];
          for (const control of controls) control.disabled = true;
          try {
            const note = await applyPlace(entry.alias, place);
            address.textContent = query.value = place.address;
            choices.replaceChildren();
            feedback.textContent = `주소를 변경했어요. ${note}`;
          } catch (error) {
            feedback.textContent = error.message;
          } finally {
            for (const control of controls) control.disabled = false;
            if (!choice.isConnected && item.isConnected) trigger.focus();
          }
        });
        choices.append(choice);
      }
      feedback.textContent = choices.children.length ? '' : emptyMessage;
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      for (const control of buttons) control.disabled = false;
    }
  }

  edit.addEventListener('submit', (event) => {
    event.preventDefault();
    void findPlaces(search, searchPlaceCandidates, '', '주소를 찾지 못했어요.');
  });
  current.addEventListener('click', () => {
    void findPlaces(current, locateCurrentPlace, '현재 위치를 확인하는 중이에요.', '현재 위치의 주소를 찾지 못했어요.');
  });

  remove.addEventListener('click', async () => {
    if (!window.confirm(`‘${entry.alias}’에 저장한 장소를 삭제할까요?`)) return;
    const controls = [query, ...buttons, ...choices.children];
    for (const control of controls) control.disabled = true;
    try {
      const note = await applyPlace(entry.alias, null);
      item.remove();
      status.textContent = `${list.childElementCount ? `‘${entry.alias}’을 삭제했어요.` : '저장한 장소가 없어요.'} ${note}`;
      list.hidden = !list.childElementCount;
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      for (const control of controls) control.disabled = false;
    }
  });
  return item;
}

function button(label, type = 'button') {
  const element = document.createElement('button');
  element.type = type;
  element.className = 'secondary';
  element.textContent = label;
  return element;
}

addQuery.addEventListener('input', () => {
  addChoices.replaceChildren();
  addStatus.textContent = '';
});
addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = addQuery.value.trim();
  if (!query) {
    addStatus.textContent = '장소 이름 또는 주소를 입력해 주세요.';
    return;
  }
  const search = addForm.querySelector('button');
  search.disabled = true;
  addChoices.replaceChildren();
  addStatus.textContent = '장소를 찾는 중이에요.';
  try {
    const places = await searchPlaceCandidates(query);
    if (query !== addQuery.value.trim()) return;
    for (const place of places) {
      if (!place.address || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) continue;
      const choice = button(`${place.name ? place.name + ' · ' : ''}${place.address} 저장`);
      choice.addEventListener('click', async () => {
        const alias = addAlias.value.trim();
        if (!alias) {
          addStatus.textContent = '저장할 이름을 입력해 주세요.';
          addAlias.focus();
          return;
        }
        const controls = [...addForm.elements, ...addChoices.children];
        for (const control of controls) control.disabled = true;
        try {
          if (savedPlace(alias)) throw new Error('같은 이름의 장소가 있어요. 다른 이름을 입력해 주세요.');
          const note = await applyPlace(alias, place);
          loadPlaces();
          addStatus.textContent = `‘${alias}’ 장소를 저장했어요. ${note}`;
          addForm.reset();
          addChoices.replaceChildren();
        } catch (error) {
          addStatus.textContent = error.message;
        } finally {
          for (const control of controls) control.disabled = false;
          if (!choice.isConnected) addAlias.focus();
        }
      });
      addChoices.append(choice);
    }
    addStatus.textContent = addChoices.children.length ? '저장할 검색 결과를 선택해 주세요.' : '장소를 찾지 못했어요.';
  } catch (error) {
    if (query === addQuery.value.trim()) addStatus.textContent = error.message;
  } finally {
    search.disabled = false;
  }
});

// 이 브라우저에 저장된 내 장소를 그린다. 항목의 이름은 저장 키다. notice는 목록 위에 보여 줄 안내.
function loadPlaces(notice = '') {
  const entries = Object.entries(exportSavedPlaces()).map(([alias, place]) => ({ alias, address: place?.address ?? '' }));
  list.replaceChildren(...entries.map(renderPlace));
  list.hidden = !entries.length;
  status.textContent = entries.length ? notice : `${notice} 저장한 장소가 없어요. 장소 검색으로 추가할 수 있어요.`.trim();
}

login.addEventListener('click', async () => {
  try {
    // 팝업이 막히지 않게 다른 await보다 먼저 부른다.
    // 창을 닫아도 응답이 오지 않는 경우가 있어, 버튼은 토큰을 받은 뒤에 잠근다.
    const token = await requestGoogleToken();
    login.disabled = true;
    googleToken = token;
    const count = Object.keys(await syncMyPlaces(token)).length;
    loadPlaces(`Google 계정의 내 장소 ${count}곳과 맞췄어요.`);
  } catch (error) {
    console.warn(error);
    loadPlaces('Google 계정과 맞추지 못했어요. 잠시 뒤 다시 눌러 주세요. 이 브라우저에 저장한 장소는 그대로 쓸 수 있어요.');
  } finally {
    login.disabled = false;
  }
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) loadPlaces();
});

loadPlaces();
