import {requestWalk} from '../../src/routing/transit.js';
import {railPath,stationName} from '../../packages/landmark-route-planner/lib/rail-directions.js';
import stationPoints from '../../src/routing/seoul-station-points.json' with {type:'json'};

// 서울 열린데이터광장 역사마스터(OA-21232)의 호선별 역사 좌표.
const stationsByLine = new Map(Object.entries(stationPoints).map(([line,stations]) => [
  line,new Map(Object.entries(stations).map(([name,point]) => [stationName(name),point])),
]));

const walkingPaths = new Map();
const maxWalkingPaths = 48;
const busStopDataUrl = '/assets/data/seoul-bus-stops.json';
let busStopsPromise;

function getBusStops(fetchFn) {
  const load = async () => {
    const response = await fetchFn(busStopDataUrl);
    return response.ok ? (await response.json()).routes : null;
  };
  if (fetchFn !== globalThis.fetch) return load().catch(() => null);
  busStopsPromise ??= load().catch(() => null).then(routes => {
    if (!routes) busStopsPromise = null;
    return routes;
  });
  return busStopsPromise;
}

function location([longitude,latitude]) {
  return {longitude,latitude};
}

function railGeometry(step) {
  const line = step.vehicles?.[0]?.name;
  const stations = stationsByLine.get(line);
  if (!stations || !Number.isSafeInteger(step.railSegments) || step.railSegments < 1) return step;
  const path = railPath('100' + line[0],stationName(step.stops?.[0]?.name),
    stationName(step.stops?.at(-1)?.name),step.railSegments);
  if (!path) return step;
  const intermediate = path.slice(1,-1).map(name => stations.get(name));
  if (intermediate.some(point => !point)) return step;
  return {...step,knownStations:true,points:[step.points[0],...intermediate,step.points.at(-1)]};
}

function distanceBetween([x1,y1],[x2,y2]) {
  return 111_200 * Math.hypot((x2-x1)*Math.cos((y1+y2)*Math.PI/360),y2-y1);
}

async function walkingGeometry(step,signal,fetchFn) {
  if (step.distance < 45) return step;
  const [from,to] = step.points;
  const key = JSON.stringify(step.points);
  const nativeFetch = fetchFn === globalThis.fetch;
  let points = nativeFetch && walkingPaths.get(key);
  if (!points) {
    const maxDistance = Math.min(2500,step.distance*2.5+60);
    const result = await requestWalk(location(from),location(to),(url) => fetchFn(url,{signal}),maxDistance).catch(() => null);
    if (!result) return step;
    points = result.steps.flatMap(({points}) => points ?? []);
    if (points.length < 2 || points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) ||
        distanceBetween(points[0],from) > 60 || distanceBetween(points.at(-1),to) > 60) return step;
    if (nativeFetch && !signal.aborted) {
      if (walkingPaths.size >= maxWalkingPaths) walkingPaths.delete(walkingPaths.keys().next().value);
      walkingPaths.set(key,points);
    }
  }
  return {...step,points,approximate:false};
}

export function addRailGeometry(route) {
  if (!route?.steps?.some(step => step.approximate && step.type === 'SUBWAY')) return route;
  return {...route,steps:route.steps.map(step => step.approximate && step.type === 'SUBWAY' && step.points?.length === 2 ? railGeometry(step) : step)};
}

function busGeometry(step, routes) {
  const stops = routes?.[step.seoulBusRouteId];
  if (!stops?.length) return step;
  const [from, to] = step.points;
  const boarding = Number(step.seoulBusStopId);
  let start = -1;
  let end = -1;
  let nearest = 75;
  for (let index = 0; index < stops.length; index++) {
    const [id,lon,lat] = stops[index];
    const point = [lon,lat];
    if (start >= 0 && id !== boarding) {
      const distance = distanceBetween(point,to);
      if (distance < nearest) {
        nearest = distance;
        end = index;
      }
    }
    if (id === boarding && distanceBetween(point,from) <= 75) {
      if (end >= 0) break;
      start = index;
    }
  }
  if (start < 0 || end - start < 2) return step;
  const intermediate = stops.slice(start+1,end).map(([,lon,lat]) => [lon,lat]);
  return {...step,points:[from,...intermediate,to]};
}

export function mapStepPoints(step) {
  const points = step.points ?? [];
  if (step.approximate && !step.knownStations && (step.type === 'BUS' || step.type === 'SUBWAY') && points.length < 3) return [];
  return points;
}

export async function addStreetGeometry(route,signal,fetchFn = fetch) {
  const estimated = step => step.approximate && step.points?.length === 2;
  const busStops = route.steps.some(step => estimated(step) && step.type === 'BUS' && step.seoulBusRouteId)
    ? getBusStops(fetchFn) : null;
  const steps = await Promise.all(route.steps.map(async step => {
    if (!estimated(step)) return step;
    if (step.type === 'WALKING') return walkingGeometry(step,signal,fetchFn);
    if (step.type === 'BUS' && busStops) return busGeometry(step,await busStops);
    return step;
  }));
  return {...route,steps};
}
