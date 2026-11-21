const storageKey = 'modo:recent-routes';

function compactPlace(place) {
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  const {name,address,latitude,longitude} = place;
  return name || address ? {name,address,latitude,longitude} : null;
}

function recentRoute(points) {
  const origin = compactPlace(points?.origin);
  const destination = compactPlace(points?.destination);
  if (!origin || !destination) return null;
  const id = [origin.latitude,origin.longitude,destination.latitude,destination.longitude].join(',');
  return {id,origin,destination};
}

export function readRecentRoutes() {
  try {
    const items = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(items) ? items.map(recentRoute).filter(Boolean).slice(0,5) : [];
  } catch {
    return [];
  }
}

export function addRecentRoute(items,points) {
  const route = recentRoute(points);
  return route ? [route,...items.filter(item => item.id !== route.id)].slice(0,5) : items;
}

export function storeRecentRoutes(items) {
  try {
    if (items.length) localStorage.setItem(storageKey,JSON.stringify(items));
    else localStorage.removeItem(storageKey);
  } catch {
    // The in-memory list is still available for the current session.
  }
}
