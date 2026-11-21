import {busInformationParams} from '../routing/bus-observations.js';

export function addBusInformation(item, step, timeFormat) {
  const params = busInformationParams(step);
  if (!params) return null;
  const button = document.createElement('button');
  button.className = 'secondary';
  button.type = 'button';
  button.textContent = '버스 도착·혼잡 확인';
  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  const list = document.createElement('ul');
  item.append(button, status, list);

  async function load() {
    if (button.disabled || !item.isConnected) return;
    button.disabled = true;
    list.replaceChildren();
    status.textContent = '버스 도착 정보를 조회 중이에요.';
    try {
      const response = await fetch(`/api/bus-information?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Bus information unavailable');
      const { routes, showLive, checkedAt } = await response.json();
      for (const route of routes) {
        const lines = route.arrivals.map(({ at, seconds, congestion, remainingSeats }) =>
          `${seconds === 0 ? '곧 도착' : `${timeFormat.format(at)} 정류장 도착 예정`} · 차내 혼잡 ${congestion ?? '정보 없음'}${Number.isInteger(remainingSeats) ? ` · 조회 기준 잔여 ${remainingSeats}석` : ''}`);
        if (route.prediction) {
          lines.push(`탑승 시간대 예상 혼잡 ${route.prediction.congestion} · 최근 8주 중 관측 ${route.prediction.sampleDays}일`);
        }
        if (!lines.length) continue;
        const entry = document.createElement('li');
        entry.textContent = `${route.name}번 · ${lines.join(' / ')}`;
        list.append(entry);
      }
      const hasLive = routes.some((route) => route.arrivals.length);
      status.textContent = hasLive
        ? `${[...new Set(routes.filter(route=>route.arrivals.length).map(route=>route.source??'서울시 버스정보'))].join('·')} · ${timeFormat.format(checkedAt)} 조회`
        : showLive
          ? '현재 시각을 기준으로 확인할 수 있는 버스 도착 정보가 없어요.'
          : routes.length
            ? '실시간 도착은 탑승 30분 전부터 확인할 수 있어요.'
            : '서울시 버스 정보에서 이 탑승 구간을 확인하지 못했어요.';
      if (!list.childElementCount) status.textContent += ' 예상 혼잡을 계산할 관측 자료도 아직 부족해요.';
      button.textContent = '버스 정보 새로고침';
    } catch {
      status.textContent = '버스 정보를 불러오지 못했어요. 다시 시도해 주세요.';
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', load);
  return load;
}
