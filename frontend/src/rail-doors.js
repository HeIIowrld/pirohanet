import {stationName} from '../../src/routing/crowding.js';

let bundle;
export function loadRailDoorData() {
  const paths = [
    new URL('../../src/routing/seoul-transfer-doors.json',import.meta.url),
    new URL('../../src/routing/seoul-exit-doors.json',import.meta.url),
  ];
  bundle ??= Promise.all(paths.map(async path => {
    try {
      const response = await fetch(path);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  })).then(([transfers,exits]) => ({transfers,exits}));
  return bundle;
}

const lineName = step => step.vehicles?.[0]?.name?.replace(/^(\d+)호선$/, '$1');
const lineLabel = line => /^\d+$/.test(line) ? `${line}호선` : line;

function transferHint(step,next,source) {
  const station = stationName(step.stops?.at(-1)?.name);
  const from = lineName(step);
  const to = lineName(next);
  if (!from || !to || from === to || !step.nextSubwayStation) return null;
  const nextStation = stationName(next.stops?.[0]?.name);
  const outgoing = stationName(next.stops?.[1]?.name);
  if (!nextStation || !outgoing) return null;
  const matches = (source?.stations?.[station]?.[from] ?? []).filter(([direction,line,after,stop]) =>
    stationName(direction) === step.nextSubwayStation && line === to &&
    stationName(after) === outgoing && stationName(stop) === nextStation);
  const doors = new Set(matches.map(([, , , ,alight,board]) => `${alight}에서 내려 ${lineLabel(to)} ${board} 쪽으로 이동`));
  if (doors.size !== 1) return null;
  return {title:`빠른 환승 · ${station}`,instruction:[...doors][0]};
}

function exitHint(step,source) {
  const station = stationName(step.stops?.at(-1)?.name);
  const line = lineName(step);
  if (!station || !line || !step.nextSubwayStation) return null;
  const rows = (source?.stations?.[station]?.[line] ?? []).filter(([direction]) =>
    stationName(direction) === step.nextSubwayStation);
  const facilityOrder = ['엘리베이터','에스컬레이터','계단'];
  const facilities = facilityOrder.flatMap(facility => {
    const doors = [...new Set(rows.filter(row => row[2] === facility).map(row => row[1]))];
    return doors.length ? [`${facility} ${doors.slice(0,2).join(' / ')}`] : [];
  });
  if (!facilities.length) return null;
  return {
    title:`빠른 하차 · ${station} 승강장 설비`,
    instruction:facilities.join(' · '),
  };
}

export function railDoorHints(steps,data) {
  if (!data) return [];
  return steps.map((step,index) => {
    if (step.type !== 'SUBWAY') return null;
    let next = index+1;
    while (steps[next]?.type === 'WALKING') next++;
    const nextRide = steps[next];
    if (nextRide?.type === 'SUBWAY') return transferHint(step,nextRide,data.transfers);
    if (nextRide?.type) return null;
    return exitHint(step,data.exits);
  });
}
