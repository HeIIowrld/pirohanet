import { locate } from '../calendar/location.js';

export async function resolvePlace(query, fetchFn = fetch) {
  const place = await locate(query, fetchFn);
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  return place;
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
