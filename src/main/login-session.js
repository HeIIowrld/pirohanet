const SESSION_KEY = 'modo.google-session';
const HOME = '/src/main/';

export function returnPath(path) {
  try {
    const url = new URL(path, window.location.origin);
    if (url.origin === window.location.origin &&
        [HOME, '/src/main/index.html', '/src/main/saved-places.html'].includes(url.pathname)) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    // Fall back to the home page for an invalid destination.
  }
  return HOME;
}

export function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (typeof session?.token === 'string' && session.token && session.expiresAt > Date.now()) return session;
  } catch {
    // An unavailable or invalid session store requires a new login.
  }
  return null;
}

export function saveSession({ access_token: token, expires_in }) {
  const lifetime = Number(expires_in);
  if (typeof token !== 'string' || !token || !Number.isFinite(lifetime) || lifetime <= 0) {
    throw new Error('Google 로그인 세션을 확인하지 못했어요.');
  }
  const session = { token, expiresAt: Date.now() + lifetime * 1000 };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function requireSession() {
  const session = readSession();
  if (session) return session.token;
  signOut();
  return null;
}

export function guardSession() {
  const token = requireSession();
  if (!token) return false;
  window.addEventListener('pageshow', requireSession);
  setTimeout(requireSession, Math.max(0, readSession()?.expiresAt - Date.now() || 0));
  return true;
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function signOut() {
  try {
    clearSession();
  } finally {
    const next = returnPath(window.location.href);
    window.location.replace(`${HOME}login.html?${new URLSearchParams({ next })}`);
  }
}
