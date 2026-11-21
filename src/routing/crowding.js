const seoulTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export const stationName = (name = '') => name.replace(/\s*\([^)]*\)/g, '').replace(/(?<!서울)역$/, '').trim();

function timeSlot(at) {
  const parts = Object.fromEntries(seoulTime.formatToParts(at).map(({ type, value }) => [type, value]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = Number(parts.hour);
  // 자정부터 01:00까지는 전날 운행의 24시 구간이다.
  const weekday = (weekdays.indexOf(parts.weekday) + (hour === 0 ? 6 : 0)) % 7;
  return { day: weekday === 0 ? 2 : weekday === 6 ? 1 : 0, slot: (hour || 24) * 2 + Math.floor(Number(parts.minute) / 30) - 11 };
}

function lineStations(data, line) {
  const stations = data?.days[0]?.[line];
  if (!stations) return [];
  let codes = Object.keys(stations).map(Number);
  if (line === '1') codes = [150, 151, 152, 153, 154, 155, 159, 156, 157, 158];
  if (line === '2') codes = codes.filter((code) => code >= 201 && code <= 243);
  if (line === '5') codes = codes.filter((code) => code >= 2511 && code <= 2554 || code >= 2562 && code <= 2566);
  if (line === '6') codes = codes.filter((code) => code === 2611 || code >= 2617 && code <= 2649);
  if (line === '8') codes = [...codes.filter((code) => code <= 2821), 2828, ...codes.filter((code) => code >= 2822 && code < 2828)];
  return codes.map((code) => ({ code, name: stationName(stations[code]?.name) }));
}

export function subwayDirection(step, data) {
  const line = step.vehicles?.[0]?.name.match(/^([1-8])호선$/)?.[1];
  const stops = step.stops?.map((stop) => stationName(stop.name)) ?? [];
  if (step.type !== 'SUBWAY' || !line || stops.length < 2 || !data) return null;

  const stations = lineStations(data, line);
  const indices = stops.map((name) => stations.findIndex((station) => station.name === name));
  const first = indices[0];
  const stepIndex = (index, offset) => line === '2' ? (index + offset + stations.length) % stations.length : index + offset;
  const offset = [-1, 1].find((delta) => first >= 0 && indices[1] === stepIndex(first, delta));
  if (!offset || indices[1] < 0) return null;
  const increasing = offset === 1;
  const direction = line === '2'
    ? increasing ? '내선' : '외선'
    : increasing === (line === '1') ? '상선' : '하선';
  const last = indices.at(-1);
  const penultimate = indices.at(-2);
  // 강동은 도착 후 5호선 본선과 마천 지선이 갈라져 현재 경로만으로 다음 역을 확정할 수 없다.
  const next = last >= 0 && penultimate >= 0 && last === stepIndex(penultimate, offset) &&
      !(line === '5' && stops.at(-1) === '강동')
    ? stations[stepIndex(last, offset)]
    : undefined;
  return { line, direction, stations, stops, previous: stations[stepIndex(first, -offset)], next };
}

export function expectedCrowding(data, { line, direction, stations }, name, at) {
  const { day, slot } = timeSlot(at);
  const station = stations.find((entry) => entry.name === name);
  return data.days[day]?.[line]?.[station?.code]?.[direction]?.[slot] ?? null;
}
