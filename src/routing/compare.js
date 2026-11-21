// 이동 시간에는 체류 시간이 포함되지 않는다. 직행의 체류 시간은 0이다.
export function compareRoutes(candidates, { departAt, arriveBy, maxExtraTravelMinutes }) {
  const fastestDirect = Math.min(
    ...candidates.filter((route) => !route.viaStop).map((route) => route.travelMinutes),
  );

  return candidates
    .map((route) => ({
      ...route,
      arrivalAt: new Date(+departAt + (route.travelMinutes + route.stayMinutes) * 60_000),
      extraTravelMinutes: Number.isFinite(fastestDirect) ? route.travelMinutes - fastestDirect : null,
    }))
    .filter((route) =>
      (arriveBy === null || route.arrivalAt <= arriveBy) &&
      (maxExtraTravelMinutes === null || route.extraTravelMinutes === null
        || route.extraTravelMinutes <= maxExtraTravelMinutes),
    )
    .sort((a, b) => a.arrivalAt - b.arrivalAt);
}
