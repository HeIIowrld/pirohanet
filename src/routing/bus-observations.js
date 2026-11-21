const MINUTE = 60_000;
const MAX_LOOKUPS = 14;
const CONCURRENCY = 6;
const MAX_OBSERVATION_AGE = 2 * MINUTE;
const busName = name => String(name ?? '').replace(/\([^)]*\)$/,'').trim().toUpperCase();

export function busInformationParams(step) {
  const [lon,lat] = step.boardingPoint ?? [];
  const [stop,next] = step.stops ?? [];
  const names = step.vehicles?.map(({name}) => name).filter(name => name && !name.includes(','));
  if (step.type !== 'BUS' || !Number.isFinite(lon) || !Number.isFinite(lat) ||
      !stop?.name || !names?.length || !Number.isFinite(step.boardingAt)) return null;
  const params = new URLSearchParams({lon,lat,stop:stop.name,
    routes:[...new Set(names)].slice(0,12).join(','),at:Math.round(step.boardingAt)});
  if (/^\d{9}$/.test(step.seoulBusStopId) && /^\d{9}$/.test(step.seoulBusRouteId)) {
    params.set('stopId', step.seoulBusStopId);
    params.set('routeId', step.seoulBusRouteId);
  } else if (next?.name && !step.approximate) {
    params.set('next', next.name);
  } else {
    return null;
  }
  return params;
}

export function pickBusObservation(step,data,now=Date.now()) {
  const vehicles = new Map((step.vehicles ?? []).map(item => [busName(item.name),item]));
  const options = (data?.routes ?? []).flatMap(row => {
    const vehicle = (row.aliases ?? [row.name]).map(name => vehicles.get(busName(name))).find(Boolean);
    return vehicle ? [{row,vehicle}] : [];
  });
  const checkedAt = data?.checkedAt;
  const live = data?.showLive && Number.isFinite(checkedAt) &&
    checkedAt <= now + 15_000 && now - checkedAt <= MAX_OBSERVATION_AGE;
  const first = live ? options.flatMap(option =>
    (option.row.arrivals ?? []).filter(item => Number.isFinite(item.at) &&
      item.at >= Math.max(now - 30_000,step.boardingAt - 45_000) && item.at <= step.boardingAt + 8*MINUTE)
      .map(arrival => ({...option,arrival})),
  ).sort((a,b) => a.arrival.at-b.arrival.at)[0] : null;
  const historical = first ?? options.find(option => option.row.prediction?.congestion);
  if (!historical) return null;
  const {row,vehicle,arrival} = historical;
  const remainingSeats = Number.isSafeInteger(arrival?.remainingSeats) && arrival.remainingSeats >= 0
    ? arrival.remainingSeats : null;
  const useHistory = !arrival?.congestion && Boolean(row.prediction?.congestion);
  return {
    name:vehicle.name,type:vehicle.type,
    congestion:arrival?.congestion ?? row.prediction?.congestion ?? null,
    congestionSource:arrival?.congestion ? '실시간' : useHistory ? '시간대 관측' : null,
    remainingSeats,checkedAt,source:row.source ?? '서울시 버스정보',
  };
}

export async function addBusObservations(routes, fetchFn=fetch) {
  const requests = new Map();
  const routeParams = routes.map(route => (route.steps ?? []).map(step => {
    const params = busInformationParams(step);
    if (!params) return null;
    // Combine near-identical transfers within the same minute, retaining exact times for vehicle selection.
    const key = new URLSearchParams(params);
    key.set('at',Math.floor(step.boardingAt/MINUTE));
    key.sort();
    const id = key.toString();
    if (!requests.has(id) && requests.size < MAX_LOOKUPS) requests.set(id,{params,data:null});
    return id;
  }));
  const entries = requests.values();
  const signal = AbortSignal.timeout(5500);
  const workers = Array.from({length:Math.min(CONCURRENCY, requests.size)},async () => {
    for (const entry of entries) {
      if (signal.aborted) break;
      try {
        const response = await fetchFn(`/api/bus-information?${entry.params}`,{signal});
        if (response.ok) entry.data = await response.json();
      } catch {
        // Missing provider data leaves the vehicle-type estimate in place.
      }
    }
  });
  await Promise.all(workers);
  const checked = Date.now();
  return routes.map((route,index) => ({...route,
    steps:(route.steps ?? []).map((step,i) => {
      const data = requests.get(routeParams[index][i])?.data;
      const busComfort = data && pickBusObservation(step,data,checked);
      return busComfort ? {...step,busComfort} : step;
    }),
  }));
}
