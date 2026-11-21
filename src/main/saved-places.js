import { searchPlaceCandidates } from '../calendar/location.js';
import { api, savePlace } from '../preferences/account-api.js';

const list = document.querySelector('#saved-place-list');
const status = document.querySelector('#saved-places-status');
const login = document.querySelector('#saved-places-login');
const addPanel = document.querySelector('#saved-place-add');
const addForm = addPanel.querySelector('form');
const addQuery = addForm.elements.query;
const addAlias = addForm.elements.alias;
const addStatus = addPanel.querySelector('[role="status"]');
const addChoices = addPanel.querySelector('.account-actions');
const authFailed = new URLSearchParams(window.location.search).get('auth') === 'failed';
if (authFailed) window.history.replaceState(null, '', window.location.pathname);

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
            const updated = await savePlace(entry.alias, place);
            address.textContent = query.value = updated.address;
            choices.replaceChildren();
            feedback.textContent = '주소를 변경했어요.';
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
      await api('/api/saved-places', 'DELETE', { alias: entry.alias });
      item.remove();
      status.textContent = list.childElementCount ? `‘${entry.alias}’을 삭제했어요.` : '저장한 장소가 없어요.';
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
          const entry = await savePlace(alias, place, 'POST');
          list.append(renderPlace(entry));
          list.hidden = false;
          status.textContent = '';
          addStatus.textContent = `‘${entry.alias}’ 장소를 저장했어요.`;
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

async function loadPlaces() {
  try {
    const account = await api('/api/account');
    if (!account.signedIn) {
      addPanel.hidden = true;
      list.hidden = true;
      list.replaceChildren();
      status.textContent = !account.ready ? 'Google OAuth 설정이 필요해요.' : authFailed
        ? 'Google 연결을 완료하지 못했어요. 다시 시도해 주세요.'
        : 'Google로 로그인하면 저장한 장소를 볼 수 있어요.';
      login.hidden = !account.ready;
      return;
    }
    login.hidden = true;
    const entries = await api('/api/saved-places');
    list.replaceChildren(...entries.map(renderPlace));
    list.hidden = !entries.length;
    addPanel.hidden = false;
    status.textContent = entries.length ? '' : '저장한 장소가 없어요.';
  } catch (error) {
    status.textContent = error.message;
  }
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) void loadPlaces();
});

void loadPlaces();
