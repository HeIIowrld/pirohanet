import {stationName} from '../../src/routing/crowding.js';

const MINUTE = 60_000;
const isRide = step => step.type === 'BUS' || step.type === 'SUBWAY';
const coords = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

export function journeySteps(route) {
  return (route.steps ?? []).map(step => {
    const ride = isRide(step);
    const stop = step.stops?.at(-1)?.name;
    const to = stop && step.type === 'SUBWAY' ? stationName(stop) : stop;
    const vehicles = [...new Set((step.vehicles ?? []).map(vehicle => vehicle.name).filter(Boolean))];
    const line = ride ? vehicles.slice(0,3).join(' / ') : null;
    const end = step.points?.at(-1);
    const stay = !step.type && route.viaStop && route.stayMinutes;
    const duration = Number.isFinite(step.time) && step.time > 0 ? step.time * 1000 : stay ? stay * MINUTE : null;
    return {ride,to,line,stay:Boolean(stay),position:coords(end) ? end : null,duration,
      label:line || (step.type === 'WALKING' ? '도보 이동' : stay ? '경유지에서 쉬기' : '이동'),
      instruction:step.guidance || step.title};
  });
}

export function journeyNotice(step,nextRide,position,startsAt,now) {
  if (!step?.ride || now < startsAt) return null;
  const endAt = step.duration ? startsAt + step.duration : null;
  let near = false;
  if (step.position && position && now - position.at < 30_000 && position.accuracy <= 70) {
    const [longitude,latitude] = step.position;
    const dx = (longitude - position.longitude) * Math.cos(latitude * Math.PI / 180);
    near = Math.hypot(dx,latitude - position.latitude) * 111_200 + position.accuracy < 250;
  }
  const soon = endAt !== null && endAt-now <= 2*MINUTE && endAt-now >= -5*MINUTE;
  if (!near && !soon) return null;
  return {
    heading: nextRide ? '환승 준비' : '하차 준비',
    stop:step.to,
    next:nextRide?.line,
    basis:near ? '현재 위치 기준' : '예상 이동 시간 기준',
  };
}
