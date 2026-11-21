import {stationName} from './crowding.js';

// These coefficients are product heuristics expressed in extra minutes per minute aboard.
const BUS_WEIGHT = new Map([
  ['마을',0.17], ['지선',0.13], ['간선',0.10], ['광역',0.09], ['좌석',0.09], ['직행',0.09], ['순환',0.13],
]);
const BUS_CROWDING = {여유:-0.04, 보통:0, 혼잡:0.25, '매우 혼잡':0.40};
const RAIL_WEIGHT = 0.07;
const RAIL_STANDING_BALANCE = 34;
const RAIL_NEUTRAL = 65;

export function rideProfile(steps = []) {
  const total = {minutes:0, baseline:0, crowding:0, seats:0, knownMinutes:0, seatsKnown:0, mixedTransfers:0, observations:[]};
  let previous;
  for (const step of steps) {
    if (step.type !== 'BUS' && step.type !== 'SUBWAY') continue;
    const minutes = step.time / 60;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    if (previous && previous !== step.type) total.mixedTransfers++;
    previous = step.type;
    total.minutes += minutes;

    const add = (kind,value) => {
      total[kind] += value;
      total.observations.push({kind,value,step});
    };

    if (step.type === 'SUBWAY') {
      total.baseline += minutes * RAIL_WEIGHT;
      const measured = Math.min(minutes,step.railComfort?.knownMinutes ?? 0);
      const avg = step.railComfort?.average;
      if (measured > 0 && Number.isFinite(avg)) {
        total.knownMinutes += measured;
        add('crowding', measured * Math.max(-0.04, Math.min(0.52,
          (Math.max(RAIL_STANDING_BALANCE,avg) - RAIL_NEUTRAL) * 0.006)));
      }
      continue;
    }
    const evidence = step.busComfort;
    const type = evidence?.type ?? step.vehicles?.[0]?.type;
    const basis = BUS_WEIGHT.get(type) ?? 0.11;
    total.baseline += minutes * basis;
    if (Object.hasOwn(BUS_CROWDING,evidence?.congestion)) {
      total.knownMinutes += minutes;
      add('crowding', minutes * BUS_CROWDING[evidence.congestion]);
    }
    if (Number.isInteger(evidence?.remainingSeats) && evidence.remainingSeats >= 0) {
      total.seatsKnown++;
      const adjustment = evidence.remainingSeats === 0 ? 0.24 : Math.min(basis, evidence.remainingSeats > 3 ? 0.08 : 0.04);
      add('seats', minutes * (evidence.remainingSeats === 0 ? adjustment : -adjustment));
    }
  }
  return total;
}

function observedLegKey(step) {
  const stops = step.stops?.map(({name}) => step.type === 'SUBWAY' ? stationName(name) : name);
  const line = step.type === 'BUS'
    ? [...new Set((step.vehicles ?? []).map(vehicle => vehicle.name))].sort().join(',')
    : step.vehicles?.[0]?.name;
  return line && stops?.length > 1 ? JSON.stringify([step.type,line,stops]) : null;
}

function compareObservation(entry, otherRoute, scope) {
  const {kind,step,value} = entry;
  const key = observedLegKey(step);
  const other = key && otherRoute.rideLoad.observations.find(observation =>
    observation.kind === kind && observedLegKey(observation.step) === key);
  const sameLeg = key && otherRoute.steps?.some(otherStep => observedLegKey(otherStep) === key);

  // A missing measurement on a shared leg is not evidence of a difference.
  if (sameLeg && !other) return null;
  const gain = (value - (other?.value ?? 0)) * (scope === 'fastest' ? 1 : -1);
  return gain > 0 ? {kind,step,scope,gain} : null;
}

export function observedComfortReasons(route, fastest, weights) {
  const gains = {};
  for (const kind of ['crowding','seats']) {
    gains[kind] = (fastest.rideLoad[kind] - route.rideLoad[kind]) * weights[kind];
  }
  if (gains.crowding + gains.seats <= 0.01) return [];

  const differences = [
    ...fastest.rideLoad.observations.map(entry => compareObservation(entry,route,'fastest')),
    ...route.rideLoad.observations.map(entry => compareObservation(entry,fastest,'recommended')),
  ].filter(Boolean);

  return ['crowding','seats'].filter(kind => gains[kind] > 0.01)
    .sort((a,b) => gains[b] - gains[a])
    .flatMap(kind => {
      const best = differences.filter(entry => entry.kind === kind)
        .reduce((current,entry) => !current || entry.gain > current.gain ? entry : current,null);
      return best ? [best] : [];
    });
}
