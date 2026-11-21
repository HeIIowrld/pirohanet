import { isDirect } from '../routing/compare.js';
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

export function renderRoutes(container, routes, timeFormat, priority, stopName) {
  const direct = routes.filter(isDirect);
  const fastest = direct.reduce((best, route) => !best || route.arrivalAt < best.arrivalAt ? route : best, null);
  const preferredDirect = priority ? direct.find((route) =>
    route !== fastest && improvements(route, fastest)[priority] > 0,
  ) : undefined;
  const recommended = preferredDirect ?? direct.find((route) =>
    route === fastest || Object.values(improvements(route, fastest)).some((gain) => gain > 0),
  );
  const via = routes.find((route) => route.viaStop);
  const reboard = routes.find((route) => route.reboard);
  const preferred = via ?? recommended ?? reboard;
  const cards = new Map();
  for (const [route, title] of [
    [fastest, '가장 빠른 경로'],
    [recommended, '편한 경로 추천'],
    [via, stopName ? `${stopName} 들르기` : '저장한 곳 들르기'],
    [reboard, '한 정거장 먼저 타기'],
  ]) {
    if (!route) continue;
    cards.set(route, cards.has(route) ? `${cards.get(route)} · ${title}` : title);
  }
  container.replaceChildren();
  if (priority === 'crowding' && fastest && !fastest.crowdingCompared) {
    appendText(container, 'p', '비교에 필요한 혼잡 정보가 부족해 이동·도보·환승 시간과 횟수로 추천했어요.').className = 'status';
  }
  let recommendation = null;
  for (const [route, title] of cards) {
    const card = document.createElement('article');
    card.className = 'route-card';
    appendText(card, 'h3', title);
    const extra = route.extraTravelMinutes > 0 ? ` · 가장 빠른 직행 대비 약 ${Math.ceil(route.extraTravelMinutes)}분 추가` : '';
    const stay = route.viaStop ? ` · 체류 ${route.stayMinutes}분` : '';
    appendText(card, 'p', `${modeNames[route.mode]} · 이동 약 ${Math.ceil(route.travelMinutes)}분${stay} · ${timeFormat.format(route.arrivalAt)} 도착${extra}`).className = 'status';
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
    if (route === preferred) {
      card.id = 'preferred-route';
      card.tabIndex = -1;
      if (route.viaStop) reason = `${stopName ?? '저장한 장소'}에 들러요.`;
      if (route.reboard) reason = crowd;
      recommendation = { route, reason, href: `#${card.id}` };
    }
    if (route.knownRideMinutes > 0) {
      const coverage = Math.min(100, Math.round(route.knownRideMinutes / route.subwayMinutes * 100));
      appendText(card, 'p',
        `예상 평균 혼잡도 ${Math.round(route.crowdMinutes / route.knownRideMinutes * 100)}% · 지하철 탑승 시간의 ${coverage}%에 정보 제공 · 서울교통공사 ${route.crowdingAsOf} 기준 30분 평균`).className = 'status';
    }
    const links = document.createElement('p');
    links.className = 'route-links';
    for (const link of route.links) {
      const anchor = appendText(links, 'a', link.label);
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    card.append(links);
    const details = document.createElement('details');
    appendText(details, 'summary', '이동 단계');
    const list = document.createElement('ol');
    const loadBusInformation = [];
    for (const step of route.steps) {
      const duration = Number.isFinite(step.time) ? ` · 약 ${Math.ceil(step.time / 60)}분` : '';
      const item = appendText(list, 'li', `${step.guidance || '도보 이동'}${duration}`);
      const load = addBusInformation(item, step, timeFormat);
      if (load) loadBusInformation.push(load);
    }
    if (loadBusInformation.length) {
      details.addEventListener('toggle', () => {
        if (details.open) for (const load of loadBusInformation) void load();
      }, { once: true });
    }
    details.append(list);
    card.append(details);
    container.append(card);
  }
  return recommendation;
}
