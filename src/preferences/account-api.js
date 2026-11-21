export async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error ?? '요청에 실패했어요.'), { status: response.status });
  }
  return response.json();
}

export function savePlace(alias, { name, address, latitude, longitude }, method = 'PUT') {
  return api('/api/saved-places', method, {
    alias, name: name ?? '', address, latitude, longitude,
  });
}
