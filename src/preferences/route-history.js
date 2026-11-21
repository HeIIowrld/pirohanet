const KEY = 'modo-transit-mode-opens';
const MODES = ['BUS', 'SUBWAY', 'BUS_AND_SUBWAY'];

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

export function inferredMode() {
  const history = readHistory();
  const [first, second] = MODES.map((mode) => ({ mode, count: Number(history[mode]) || 0 }))
    .sort((a, b) => b.count - a.count);
  return first.count >= 3 && first.count - second.count >= 2 ? first.mode : null;
}

export function rememberRouteMode(mode) {
  if (!MODES.includes(mode)) return;
  try {
    const history = readHistory();
    history[mode] = Math.min(10, (Number(history[mode]) || 0) + 1);
    for (const other of MODES.filter((name) => name !== mode)) {
      history[other] = Math.max(0, (Number(history[other]) || 0) - .25);
    }
    localStorage.setItem(KEY, JSON.stringify(history));
  } catch {
    // 브라우저 저장소를 쓸 수 없어도 지도 열기는 계속한다.
  }
}
