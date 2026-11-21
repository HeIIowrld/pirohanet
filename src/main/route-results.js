import { isDirect, routeArrivalAt, routeKey } from '../routing/compare.js';
import { addBusInformation } from './bus-information.js';

const modeNames = { BUS: '버스', SUBWAY: '지하철', BUS_AND_SUBWAY: '버스·지하철', WALKING: '도보' };

function appendText(parent, tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.append(node);
  return node;
}

function improvements(route, fastest) {
  return {
    walking: fastest.walkMinutes - route.walkMinutes,
    transfers: fastest.transfers - route.transfers,
    crowding: route.crowdingCompared ? fastest.crowdingBurden - route.crowdingBurden : 0,
    traffic: fastest.context.trafficPenalty - route.context.trafficPenalty,
    avoidedLine: fastest.context.avoidedLineMinutes - route.context.avoidedLineMinutes,
  };
}

export function directRecommendations(routes, priority) {
  const direct = routes.filter(isDirect);
  const fastest = direct.reduce((best, route) => !best || route.arrivalAt < best.arrivalAt ? route : best, null);
  const applicablePriority = priority === 'crowding' && !fastest?.crowdingCompared ? null : priority;
  const recommended = direct.find((route) => {
    if (route === fastest) return true;
    const gains = improvements(route, fastest);
    return applicablePriority ? gains[applicablePriority] > 0 : Object.values(gains).some((gain) => gain > 0);
  });
  return { fastest, recommended };
}

function updateSteps(details, list, steps, timeFormat, timeShift = 0) {
  list.replaceChildren();
  const loadBusInformation = [];
  for (const step of steps) {
    const duration = Number.isFinite(step.time) ? ` · 약 ${Math.ceil(step.time / 60)}분` : '';
    const item = appendText(list, 'li', `${step.guidance || '도보 이동'}${duration}`);
    const timedStep = Number.isFinite(step.boardingAt) ? { ...step, boardingAt: step.boardingAt + timeShift } : step;
    const load = addBusInformation(item, timedStep, timeFormat);
    if (load) loadBusInformation.push(load);
  }
  function loadOnOpen() {
    if (!details.open) return;
    details.ontoggle = null;
    for (const load of loadBusInformation) void load();
  }
  details.ontoggle = loadBusInformation.length ? loadOnOpen : null;
  loadOnOpen();
}

export function renderRoutes(container, routes, timeFormat, priority, stopName, { onSelect, selectedKey, lateDirect, departAt, arriveBy }) {
  const { fastest, recommended } = directRecommendations(routes, priority);
  const via = routes.find((route) => route.viaStop);
  const reboard = routes.find((route) => route.reboard);
  const preferred = via ?? recommended ?? reboard;
  const cards = new Map();
  for (const [route, title] of [
    [fastest, '가장 빠른 경로'],
    [recommended, '편한 경로 추천'],
    [via, stopName ? `${stopName} 들르기` : '저장한 곳 들르기'],
    [reboard, '한 정거장 먼저 타기'],
    [lateDirect, '가장 이른 직행 · 도착 목표 초과'],
  ]) {
    if (!route) continue;
    cards.set(route, cards.has(route) ? `${cards.get(route)} · ${title}` : title);
  }
  container.replaceChildren();
  if (priority === 'crowding' && fastest && !fastest.crowdingCompared) {
    appendText(container, 'p', '비교에 필요한 혼잡 정보가 부족해 이동·도보·환승 시간과 횟수로 추천했어요.').className = 'status';
  }
  let recommendation = null;
  let selected = null;
  let activeButton = null;
  for (const [route, title] of cards) {
    const card = document.createElement('article');
    card.className = 'route-card';
    card.id = route === preferred ? 'preferred-route' : `route-option-${container.childElementCount + 1}`;
    card.tabIndex = -1;
    appendText(card, 'h3', title);
    const extra = route.extraTravelMinutes > 0 ? ` · 가장 빠른 직행 대비 약 ${Math.ceil(route.extraTravelMinutes)}분 추가` : '';
    const stay = route.viaStop ? ` · 체류 ${route.stayMinutes}분` : '';
    const travelSummary = `${modeNames[route.mode]} · 이동 약 ${Math.ceil(route.travelMinutes)}분${stay}`;
    const timing = appendText(card, 'p', `${travelSummary} · ${timeFormat.format(route.arrivalAt)} 도착${extra}`);
    timing.className = 'status';
    const fare = route.fare === null ? '' : ` · ${route.reboard || route.viaStop ? '구간별 요금 합계 ' : '요금 '}${route.fare.toLocaleString('ko-KR')}원`;
    const effort = `도보 약 ${Math.ceil(route.walkMinutes)}분 · 환승 ${route.transfers}회`;
    appendText(card, 'p', `${effort}${fare}`).className = 'status';

    let reason = effort;
    if (route === recommended && route !== fastest) {
      const gains = improvements(route, fastest);
      const changes = new Map();
      if (gains.walking > 0) changes.set('walking', `도보 약 ${Math.max(.1, Math.round(gains.walking * 10) / 10)}분 감소`);
      if (gains.transfers > 0) changes.set('transfers', `환승 ${gains.transfers}회 감소`);
      if (gains.crowding > 0) changes.set('crowding', '혼잡도 100%를 넘는 구간의 탑승 부담 감소');
      if (gains.avoidedLine > 0) changes.set('avoidedLine', `${route.context.avoidLine}호선 탑승 약 ${Math.ceil(gains.avoidedLine)}분 감소`);
      if (changes.size) {
        appendText(card, 'p', `가장 빠른 경로보다 ${[...changes.values()].join(' · ')}`).className = 'status';
        reason = `추천 이유 · ${changes.get(priority) ?? changes.values().next().value}`;
      }
      if (gains.traffic > 0) {
        appendText(card, 'p', `${route.context.traffic}에는 버스 이동이 지연될 수 있어 탑승 부담을 비교에 반영했어요. 시간대 기준으로 판단했어요.`).className = 'status';
        if (!changes.size) reason = '추천 이유 · 도심 버스 지연 가능성 고려';
      }
    }
    const { reboard } = route;
    const boarding = route.boardings[0]?.boarding;
    const crowd = reboard
      ? `${reboard.from}에서 반대 방향으로 한 정거장 이동 후 ${reboard.at}에서 다시 탑승 · 예상 탑승 혼잡도 ${reboard.before}% → ${reboard.after}%`
      : boarding == null ? '첫 탑승 혼잡도 정보 없음' : `첫 탑승 예상 혼잡도 ${boarding}%`;
    appendText(card, 'p', crowd).className = 'status';
    if (route.viaStop) reason = `${stopName ?? '저장한 장소'}에 들러요.`;
    if (route.reboard) reason = crowd;
    if (route.knownRideMinutes > 0) {
      const coverage = Math.min(100, Math.round(route.knownRideMinutes / route.subwayMinutes * 100));
      appendText(card, 'p',
        `예상 평균 혼잡도 ${Math.round(route.crowdMinutes / route.knownRideMinutes * 100)}% · 지하철 탑승 시간의 ${coverage}%에 정보 제공 · 서울교통공사 ${route.crowdingAsOf} 기준 30분 평균`).className = 'status';
    }
    const details = document.createElement('details');
    appendText(details, 'summary', '이동 단계');
    const list = document.createElement('ol');
    updateSteps(details, list, route.steps, timeFormat);
    details.append(list);
    const guidanceBasis = appendText(card, 'p', '');
    guidanceBasis.className = 'status';
    guidanceBasis.hidden = true;
    const option = {
      route, reason, href: `#${card.id}`, key: routeKey(route),
      showDirections(now) {
        const arrivalAt = routeArrivalAt(route, now);
        const late = arriveBy && arrivalAt > arriveBy ? ` · 목표보다 ${Math.ceil((arrivalAt - arriveBy) / 60_000)}분 늦어요` : '';
        timing.textContent = `${travelSummary} · 지금 출발하면 ${timeFormat.format(arrivalAt)} 도착 예상${late}`;
        const crowdingBasis = route.knownRideMinutes > 0 ? ` 지하철 혼잡도는 ${timeFormat.format(departAt)} 출발 계획 기준이에요.` : '';
        guidanceBasis.textContent = `조회한 이동 시간으로 계산했어요.${crowdingBasis}`;
        guidanceBasis.hidden = false;
        details.open = false;
        updateSteps(details, list, route.steps, timeFormat, now - departAt);
        details.open = true;
      },
    };
    if (route === preferred) recommendation = option;

    const links = document.createElement('p');
    links.className = 'route-links';
    const selectButton = route !== lateDirect && appendText(links, 'button', '이 경로 선택');
    function markSelected() {
      if (!selectButton || activeButton === selectButton) return;
      if (activeButton) {
        activeButton.textContent = '이 경로 선택';
        activeButton.setAttribute('aria-pressed', 'false');
      }
      selectButton.textContent = '선택한 경로';
      selectButton.setAttribute('aria-pressed', 'true');
      activeButton = selectButton;
      return true;
    }
    function selectRoute() {
      if (markSelected()) onSelect(option);
    }
    if (selectButton) {
      selectButton.type = 'button';
      selectButton.className = 'secondary';
      selectButton.setAttribute('aria-pressed', 'false');
      selectButton.addEventListener('click', selectRoute);
      if (option.key === selectedKey && !selected) {
        markSelected();
        selected = option;
      }
    }
    for (const link of route.links) {
      const anchor = appendText(links, 'a', link.label);
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.addEventListener('click', selectRoute);
    }
    card.append(links);
    card.append(details);
    container.append(card);
  }
  return selected ?? recommendation;
}
