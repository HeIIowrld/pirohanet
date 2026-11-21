import {clipBusShape,distanceBetween,matchBusShape} from './bus-shape.js';
import {busRideRange} from '../../src/routing/bus-ride-range.js';
import {requestWalk} from '../../src/routing/transit.js';
import {railPath,stationName} from '../../packages/landmark-route-planner/lib/rail-directions.js';
import {railLineName} from './route-colors.js';
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
    const response = await fetchFn(url,{signal:AbortSignal.timeout(field ? 5000 : 8000)});
    if (!response.ok) return null;
    const data = await response.json();
    return field ? data[field] : data.lines?.length ? data : null;
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

function pathFromTracks(tracks,from,to,count) {
  if (!tracks || from === to) return null;
  const neighbors = new Map();
  const connect = (start,end) => {
    if (!neighbors.has(start)) neighbors.set(start,new Set());
    neighbors.get(start).add(end);
  };
  for (const key of Object.keys(tracks)) {
    const [start,end] = key.split('|');
    connect(start,end);
    connect(end,start);
  }
  const visited = new Map([[from,{length:0,ways:1}]]);
  const queue = [from];
  for (const station of queue) {
    if (station === to) break;
    const {length,ways} = visited.get(station);
    if (count && length >= count) continue;
    for (const next of neighbors.get(station) ?? []) {
      const seen = visited.get(next);
      if (!seen) {
        visited.set(next,{length:length+1,ways,previous:station});
        queue.push(next);
      } else if (seen.length === length+1) seen.ways += ways;
    }
  }
  const end = visited.get(to);
  if (!end || end.ways !== 1 || (count && end.length !== count)) return null;
  const path = [];
  for (let station = to; station !== undefined; station = visited.get(station).previous) path.push(station);
  return path.reverse();
}

function railGeometry(step,shapes) {
  const line = railLineName(step.vehicles?.[0]?.name ?? '');
  const number = line.match(/^([1-9])호선$/)?.[1];
  const count = Number.isSafeInteger(step.railSegments) && step.railSegments > 0 ? step.railSegments : undefined;
  const from = stationName(step.stops?.[0]?.name);
  const to = stationName(step.stops?.at(-1)?.name);
  const tracks = shapes?.[number ?? line];
  const knownPath = number && count ? railPath('100'+number,from,to,count) : null;
  const path = knownPath ?? pathFromTracks(tracks,from,to,count);
  if (!path) return step;
  const segments = path.slice(1).map((stop,index) => {
    const previous = path[index];
    const forward = tracks?.[`${previous}|${stop}`];
    const backward = tracks?.[`${stop}|${previous}`];
    return forward ?? backward?.slice().reverse();
  });
  const useTracks = segments.every(segment => segment?.length > 1);
  if (useTracks) {
    const points = segments.flat();
    if (knownPath || (distanceBetween(points[0],step.points[0]) <= 300 &&
        distanceBetween(points.at(-1),step.points.at(-1)) <= 300)) {
      return {...step,points,approximate:false,osmGeometry:true};
    }
  }
  const stations = stationsByLine.get(line);
  if (!knownPath || !stations) return step;
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
  return step.invalidBusRide ? [] : step.points ?? [];
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
    if (range === null) return {...step,invalidBusRide:true};
    const intermediate = range ? stops.slice(range.start+1,range.end)
      .map(([,lon,lat]) => [lon,lat]).filter(point => point.every(Number.isFinite)) : [];
    const withStops = {...step,points:[step.points[0],...intermediate,step.points.at(-1)]};

    if (stopDataUrl.endsWith('incheon-bus-stops.json')) {
      const official = await getGeometry('/assets/data/incheon-bus-shapes.json','lines',fetchFn);
      if (official?.[id]) {
        const line = official[id][range?.direction];
        const road = line && clipBusShape(withStops,[line],{forwardOnly:true});
        if (road) return {...step,points:road,approximate:false,incheonGeometry:true};
      }
    }
    if (/^\d{9}$/.test(id)) {
      const url = `/api/bus-information?shapeRouteId=${id}`;
      let shape = await getGeometry(url,null,fetchFn);
      let road = clipBusShape(withStops,shape?.lines,{forwardOnly:true});
      if (!road && shape && !stopDataUrl.endsWith('incheon-bus-stops.json')) {
        const alternate = shape.source === 'seoul' ? 'gbis' : 'seoul';
        shape = await getGeometry(`${url}&shapeSource=${alternate}`,null,fetchFn);
        road = clipBusShape(withStops,shape?.lines,{forwardOnly:true});
      }
      if (road) return {...step,points:road,approximate:false,
        ...(shape.source === 'seoul' ? {seoulGeometry:true} : {gbisGeometry:true})};
    }
    const busShapes = await getGeometry('/assets/data/osm-bus-shapes.json','lines',fetchFn);
    const points = matchBusShape(withStops,busShapes,{forwardOnly:!range});
    return points ? {...step,points,approximate:false,osmGeometry:true} : withStops;
  }));
  return {...route,steps};
}
