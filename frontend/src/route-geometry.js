import {clipBusShape,distanceBetween,matchBusShape} from './bus-shape.js';
import {busRideRange} from '../../src/routing/bus-ride-range.js';
import {requestWalk} from '../../src/routing/transit.js';
import {railPath,stationName} from '../../packages/landmark-route-planner/lib/rail-directions.js';
import stationPoints from '../../src/routing/seoul-station-points.json' with {type:'json'};

// 서울 열린데이터광장 역사마스터(OA-21232)의 호선별 역사 좌표.
const stationsByLine = new Map(Object.entries(stationPoints).map(([line,stations]) => [
  line,new Map(Object.entries(stations).map(([name,point]) => [stationName(name),point])),
]));

const walkingPaths = new Map();
const maxWalkingPaths = 48;
const geometryRequests = new Map();

function busStopDataUrl(routeId) {
  const region = /^(?:16[0-9]|170)\d{6}$/.test(routeId) ? 'incheon' : 'seoul';
  return `/assets/data/${region}-bus-stops.json`;
}

function getGeometry(url,field,fetchFn) {
  const load = async () => {
    const response = await fetchFn(url);
    return response.ok ? (await response.json())[field] : null;
  };
  if (fetchFn !== globalThis.fetch) return load().catch(() => null);
  if (!geometryRequests.has(url)) {
    geometryRequests.set(url,load().catch(() => null).then(data => {
      if (!data) geometryRequests.delete(url);
      return data;
    }));
  }
  return geometryRequests.get(url);
}

function location([longitude,latitude]) {
  return {longitude,latitude};
}

function railGeometry(step,shapes) {
  const line = step.vehicles?.[0]?.name;
  const stations = stationsByLine.get(line);
  if (!stations || !Number.isSafeInteger(step.railSegments) || step.railSegments < 1) return step;
  const path = railPath('100' + line[0],stationName(step.stops?.[0]?.name),
    stationName(step.stops?.at(-1)?.name),step.railSegments);
  if (!path) return step;
  const tracks = shapes?.[line[0]];
  const segments = path.slice(1).map((stop,index) => {
    const previous = path[index];
    const forward = tracks?.[`${previous}|${stop}`];
    const backward = tracks?.[`${stop}|${previous}`];
    return forward ?? backward?.slice().reverse();
  });
  const useTracks = segments.every(segment => segment?.length > 1);
  if (useTracks) {
    return {...step,points:segments.flat(),approximate:false,osmGeometry:true};
  }
  const intermediate = path.slice(1,-1).map(name => stations.get(name));
  if (intermediate.some(point => !point)) return step;
  return {...step,knownStops:true,points:[step.points[0],...intermediate,step.points.at(-1)]};
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

export function mapStepPoints(step) {
  const points = step.points ?? [];
  if (step.type === 'BUS' && step.approximate) return [];
  if (step.approximate && !step.knownStops && step.type === 'SUBWAY' && points.length < 3) return [];
  return points;
}

export async function addMapGeometry(route,signal,fetchFn = fetch) {
  const steps = await Promise.all(route.steps.map(async step => {
    if (!step.approximate || !step.points || step.points.length < 2) return step;
    if (step.type === 'SUBWAY') {
      return railGeometry(step,await getGeometry('/assets/data/osm-subway-shapes.json','lines',fetchFn));
    }
    if (step.type === 'WALKING') return walkingGeometry(step,signal,fetchFn);
    if (step.type !== 'BUS' || !step.seoulBusRouteId) return step;
    const id = step.seoulBusRouteId;
    const stopDataUrl = busStopDataUrl(id);
    const stopLists = await getGeometry(stopDataUrl,'routes',fetchFn);
    const stops = stopLists?.[id];
    const range = busRideRange(step,stops);
    if (range === null || (stops?.length && !range)) return step;
    const intermediate = range ? stops.slice(range.start+1,range.end).map(([,lon,lat]) => [lon,lat]) : [];
    if (intermediate.some(point => !point.every(Number.isFinite))) return step;
    const withStops = {...step,points:[step.points[0],...intermediate,step.points.at(-1)]};

    if (stopDataUrl.endsWith('incheon-bus-stops.json')) {
      const official = await getGeometry('/assets/data/incheon-bus-shapes.json','lines',fetchFn);
      if (official?.[id]) {
        const line = official[id][range?.direction];
        const road = line && clipBusShape(withStops,[line],{forwardOnly:true});
        return road ? {...step,points:road,approximate:false,incheonGeometry:true} : step;
      }
    }
    if (/^(?:1[0-2]\d|2\d{2})\d{6}$/.test(id)) {
      const lines = await getGeometry(`/api/bus-information?shapeRouteId=${id}`,'lines',fetchFn);
      const road = clipBusShape(withStops,lines ?? [],{forwardOnly:true});
      if (road) return {...step,points:road,approximate:false,gbisGeometry:true};
    }
    if (!range) return step;
    const busShapes = await getGeometry('/assets/data/osm-bus-shapes.json','lines',fetchFn);
    const points = matchBusShape(withStops,busShapes);
    return points ? {...step,points,approximate:false,osmGeometry:true} : step;
  }));
  return {...route,steps};
}
