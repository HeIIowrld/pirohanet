// resolvePlace는 장소 검색 결과에서 확정된 { name, latitude, longitude }를 반환한다.
export async function resolveTripPlaces({ origin, destination, stop }, resolvePlace) {
  const placeQueries = [origin, destination];
  if (stop) placeQueries.push(stop);

  const [originPlace, destinationPlace, stopPlace = null] = await Promise.all(
    placeQueries.map((query) => resolvePlace(query)),
  );
  if (!originPlace || !destinationPlace || (stop && !stopPlace)) {
    throw new Error('장소를 찾지 못했습니다.');
  }

  return { origin: originPlace, destination: destinationPlace, stop: stopPlace };
}
