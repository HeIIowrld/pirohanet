// These coefficients are product heuristics expressed in extra minutes per minute aboard.
const BUS_WEIGHT = new Map([
  ['마을',0.17], ['지선',0.13], ['간선',0.10], ['광역',0.09], ['좌석',0.09], ['직행',0.09], ['순환',0.13],
]);
const BUS_CROWDING = {여유:-0.04, 보통:0, 혼잡:0.25, '매우 혼잡':0.40};
const RAIL_WEIGHT = 0.07;
const RAIL_STANDING_BALANCE = 34;
const RAIL_NEUTRAL = 65;

export function rideProfile(steps = []) {
  const total = {minutes:0, baseline:0, crowding:0, seats:0, knownMinutes:0, seatsKnown:0, mixedTransfers:0};
  let previous;
  for (const step of steps) {
    if (step.type !== 'BUS' && step.type !== 'SUBWAY') continue;
    const minutes = step.time / 60;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    if (previous && previous !== step.type) total.mixedTransfers++;
    previous = step.type;
    total.minutes += minutes;

    if (step.type === 'SUBWAY') {
      total.baseline += minutes * RAIL_WEIGHT;
      const measured = Math.min(minutes,step.railComfort?.knownMinutes ?? 0);
      const avg = step.railComfort?.average;
      if (measured > 0 && Number.isFinite(avg)) {
        total.knownMinutes += measured;
        total.crowding += measured * Math.max(-0.04, Math.min(0.52,
          (Math.max(RAIL_STANDING_BALANCE,avg) - RAIL_NEUTRAL) * 0.006));
      }
      continue;
    }
    const evidence = step.busComfort;
    const type = evidence?.type ?? step.vehicles?.[0]?.type;
    const basis = BUS_WEIGHT.get(type) ?? 0.11;
    total.baseline += minutes * basis;
    if (Object.hasOwn(BUS_CROWDING,evidence?.congestion)) {
      total.knownMinutes += minutes;
      total.crowding += minutes * BUS_CROWDING[evidence.congestion];
    }
    if (Number.isInteger(evidence?.remainingSeats) && evidence.remainingSeats >= 0) {
      total.seatsKnown++;
      const adjustment = evidence.remainingSeats === 0 ? 0.24 : Math.min(basis, evidence.remainingSeats > 3 ? 0.08 : 0.04);
      total.seats += minutes * (evidence.remainingSeats === 0 ? adjustment : -adjustment);
    }
  }
  return total;
}
