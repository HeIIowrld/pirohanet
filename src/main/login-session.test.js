import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSession, returnPath, saveSession, signOut } from './login-session.js';

test('protected pages redirect signed-out and expired users and allow only app return paths', () => {
  let redirect;
  const storage = new Map();
  globalThis.window = {
    location: {
      origin: 'https://modo.example',
      href: 'https://modo.example/src/main/saved-places.html#places',
      replace: (url) => { redirect = url; },
    },
  };
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }});
  assert.equal(requireSession(), null);
  assert.equal(new URL(redirect, window.location.origin).searchParams.get('next'), '/src/main/saved-places.html#places');
  assert.equal(returnPath('//outside.example/src/main/'), '/src/main/');
  assert.equal(returnPath('/src/main/login.html'), '/src/main/');
  saveSession({ access_token: 'test-token', expires_in: 3600 });
  assert.equal(requireSession(), 'test-token');
  signOut();
  assert.equal(storage.size, 0);
  storage.set('modo.google-session', JSON.stringify({ token: 'expired-token', expiresAt: 0 }));
  assert.equal(requireSession(), null);
});
