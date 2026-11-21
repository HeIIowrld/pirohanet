import { locate } from '../calendar/location.js';

export async function resolvePlace(query, fetchFn = fetch) {
  const place = await locate(query, fetchFn);
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;

  return {
    name: place.name,
    address: place.address,
    latitude: place.lat,
    longitude: place.lon,
  };
}

export async function resolveTripPlaces({ origin, destination, stop }, lookup = resolvePlace) {
  const placeQueries = [origin, destination];
  if (stop) placeQueries.push(stop);

  const [originPlace, destinationPlace, stopPlace = null] = await Promise.all(
    placeQueries.map((query) => lookup(query)),
  );
  if (!originPlace || !destinationPlace || (stop && !stopPlace)) {
    throw new Error('장소를 찾지 못했습니다.');
  }

  return { origin: originPlace, destination: destinationPlace, stop: stopPlace };
}
