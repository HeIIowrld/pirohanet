import { returnPath, saveSession } from './login-session.js';

const button = document.querySelector('#login');
const status = document.querySelector('#login-status');
const next = returnPath(new URLSearchParams(window.location.search).get('next'));

const { requestGoogleAuthorization } = await import(`../calendar/calendar.js?t=${Date.now()}`);
if (!window.google?.accounts?.oauth2 && document.readyState !== 'complete') {
  await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
}
button.disabled = !window.google?.accounts?.oauth2;
if (button.disabled) status.textContent = 'Google 로그인 도구를 불러오지 못했어요. 페이지를 새로고침해 주세요.';
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = '';
  try {
    saveSession(await requestGoogleAuthorization());
    window.location.replace(next);
  } catch (error) {
    status.textContent = error.message === 'popup_closed'
      ? 'Google 로그인 창을 닫았어요. 다시 시도할 수 있어요.'
      : 'Google 로그인을 완료하지 못했어요. 다시 시도해 주세요.';
    button.disabled = false;
  }
});
