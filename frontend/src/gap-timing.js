import {MINIMUM_STOP_MINUTES} from '../../src/routing/transit.js';

const MINUTE=60_000;

export function gapDeparture(trip,now) {
  return Math.max(+trip.departAt,Math.floor(now/MINUTE)*MINUTE);
}

export function availableStop(stop,trip,now) {
  if (!stop || !trip.arriveBy || stop.stopDepartureAt == null) return stop;
  const departureAt=gapDeparture(trip,now);
  const delay=departureAt-trip.departAt;
  if (!delay) return stop;
  const stayMinutes=stop.stayMinutes-delay/MINUTE;
  if (stayMinutes<MINIMUM_STOP_MINUTES) return null;

  let beforeStop=true;
  const steps=stop.steps.map(step => {
    if (!step.type && beforeStop) {
      beforeStop=false;
      return {...step,guidance:`${stop.place.name}에서 ${stayMinutes}분 체류`};
    }
    return beforeStop && Number.isFinite(step.boardingAt)
      ? {...step,boardingAt:step.boardingAt+delay} : step;
  });
  // 체류를 줄인 만큼 첫 구간만 뒤로 미룬다. 경유지 출발과 최종 도착 시각은 그대로다.
  return {...stop,departureAt,stayMinutes,steps,stopArrivalAt:stop.stopArrivalAt+delay};
}
