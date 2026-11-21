import {requestWalk} from '../../src/routing/transit.js';
import {railPath,stationName} from './modo/lib/rail-directions.js';
import stationPoints from './seoul-station-points.json' with {type:'json'};

// 서울 열린데이터광장 역사마스터(OA-21232)의 호선별 역사 좌표.
const stationsByLine = new Map(Object.entries(stationPoints).map(([line,stations]) => [
  line,new Map(Object.entries(stations).map(([name,point]) => [stationName(name),point])),
]));

const walkingPaths = new Map();
const maxWalkingPaths = 48;

function location([longitude,latitude]) {
  return {longitude,latitude};
}

function railGeometry(step) {
  const line = step.vehicles?.[0]?.name;
  const stations = stationsByLine.get(line);
  if (!stations || !Number.isSafeInteger(step.railSegments) || step.railSegments < 2) return step;
  const path = railPath('100' + line[0],stationName(step.stops?.[0]?.name),
    stationName(step.stops?.at(-1)?.name),step.railSegments);
  if (!path) return step;
  const intermediate = path.slice(1,-1).map(name => stations.get(name));
  if (intermediate.some(point => !point)) return step;
  return {...step,points:[step.points[0],...intermediate,step.points.at(-1)]};
}

function walkDistance([x1,y1],[x2,y2]) {
  return 111_200 * Math.hypot((x2-x1)*Math.cos((y1+y2)*Math.PI/360),y2-y1);
}

async function walkingGeometry(step,signal,fetchFn) {
  if (step.distance < 45) return step;
  const [from,to] = step.points;
  const key = JSON.stringify(step.points);
  const nativeFetch = fetchFn === globalThis.fetch;
  let points = nativeFetch && walkingPaths.get(key);
  if (!points) {
    const result = await requestWalk(location(from),location(to),(url) => fetchFn(url,{signal})).catch(() => null);
    if (!result || result.totalDistance > step.distance*2.5+60) return step;
    points = result.steps.flatMap(({points}) => points ?? []);
    if (points.length < 2 || points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) ||
        walkDistance(points[0],from) > 60 || walkDistance(points.at(-1),to) > 60) return step;
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

export async function addWalkingGeometry(route,signal,fetchFn = fetch) {
  const steps = await Promise.all(route.steps.map(step => step.approximate && step.type === 'WALKING' && step.points?.length === 2
    ? walkingGeometry(step,signal,fetchFn) : step));
  return {...route,steps};
}
