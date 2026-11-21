import React, {useEffect, useRef, useState} from 'react';
import {addBusInformation} from '../../src/main/bus-information.js';
import {isDirect} from '../../src/routing/compare.js';
import {clock, routeCategory, hasLateNightBusLeg} from './services.js';
import {loadRailDoorData, railDoorHints} from './rail-doors.js';
import {Actions, Art, Badge, Button, Sheet, Summary} from './design.jsx';

const minutes = value => Math.ceil(value ?? 0);
const routeTime = {format: clock};

function crowding(route) {
  return route.knownRideMinutes > 0
    ? `지하철 예상 혼잡도 ${Math.round(100 * route.crowdMinutes / route.knownRideMinutes)}%`
    : '혼잡도 정보 없음';
}

function boardingLines(step) {
  return [...new Set((step.vehicles ?? []).map(vehicle => vehicle.name).filter(Boolean))]
    .sort((a,b) => Number(a.includes('(심야)')) - Number(b.includes('(심야)')))
    .map(name => step.type === 'BUS' && /^[0-9]+$/.test(name) ? name+'번' : name);
}

function summarizeBoarding(lines) {
  if (lines.length <= 1) return lines[0];
  return `${lines[0]} 외 ${lines.length-1}개 노선`;
}

function comfortReason(item,fastest) {
  if (item.transfers < fastest?.transfers) return '갈아타는 횟수가 적어요.';
  if (item.walkMinutes < fastest?.walkMinutes) return '걷는 시간이 짧아요.';
  const seats = item.steps?.find(step => step.busComfort?.remainingSeats > 0)?.busComfort;
  if (seats && item.rideLoad?.seats < fastest?.rideLoad?.seats) {
    return `${seats.name} · 조회 기준 잔여 ${seats.remainingSeats}석`;
  }
  if (item.rideLoad?.knownMinutes > 0 && item.rideLoad.crowding < fastest?.rideLoad?.crowding) {
    return '확인된 혼잡도를 반영한 탑승 부담이 낮아요.';
  }
  return '탑승 시간과 노선 유형을 반영한 이동 부담이 낮아요.';
}

function RideEvidence({step}) {
  if (step.type === 'SUBWAY') {
    const rail = step.railComfort;
    return <small className="ride-evidence">{step.vehicles?.[0]?.name || '지하철'} ·
      {rail ? ` 시간대 평균 혼잡도 ${Math.round(rail.average)}% (${Math.round(rail.knownMinutes)}분 자료)` : ' 시간대 혼잡 자료 없음'}</small>;
  }
  if (step.type !== 'BUS') return null;
  const observation = step.busComfort;
  const vehicle = observation ?? step.vehicles?.[0];
  const label = vehicle?.type ? `${vehicle.type}버스` : '버스';
  const facts = [
    [label,vehicle?.name].filter(Boolean).join(' '),
    observation?.congestion ? `${observation.congestionSource} 차내 혼잡 ${observation.congestion}` : '차내 혼잡 자료 없음',
    observation?.remainingSeats != null ? `조회 기준 잔여 ${observation.remainingSeats}석` : null,
    observation?.remainingSeats != null && Number.isFinite(observation.checkedAt) ? `${clock(observation.checkedAt)} 조회` : null,
  ].filter(Boolean);
  return <small className="ride-evidence">{facts.join(' · ')}</small>;
}

function RouteCard({item,label,reason,selected,onSelect}) {
  const category = routeCategory(item);
  const lines = (item.steps ?? []).flatMap(step => summarizeBoarding(boardingLines(step)) ?? []);
  return <button className={`route-card ${selected ? 'selected' : ''}`}
    aria-pressed={selected} onClick={onSelect}>
    <h3>{label}</h3>
    {category && category !== label && <span className="route-mode">{category}</span>}
    <div><strong>{minutes(item.travelMinutes)}분</strong><span>{clock(item.arrivalAt)} 도착</span></div>
    {!!lines.length && <div className="route-line-summary">{lines.join(' → ')}</div>}
    <p>도보 {minutes(item.walkMinutes)}분 · 환승 {item.transfers ?? 0}회 · {crowding(item)}</p>
    {reason && <small className="ride-evidence">{reason}</small>}
    {hasLateNightBusLeg(item) && <small className="status">심야 노선 포함 · 운행 시간 확인</small>}
  </button>;
}

export function RouteComparison({result, route, trip, demo, select, choose, changeCondition, changeTrip, showLate}) {
  const alternatives = result?.alternatives ?? [];
  const [expanded,setExpanded] = useState(() => alternatives.some(item => item.id === route?.id));
  if (!result?.direct.length) {
    const fastest = result?.all.filter(isDirect).reduce((best, item) =>
      !best || item.arrivalAt < best.arrivalAt ? item : best, null);
    const late = fastest && trip.arriveBy ? minutes((fastest.arrivalAt - trip.arriveBy) / 60000) : null;
    return <Sheet className="route-error-sheet">
      <div className="sheet-body">
        <Art name="no-feasible"/>
        <h2>{late > 0 ? '도착 목표에 맞는 길이 없어요.' : '대중교통 경로를 찾지 못했어요.'}</h2>
        {late > 0 && <p>가장 빠른 길도 {clock(fastest.arrivalAt)} 도착으로 {late}분 늦어요.</p>}
      </div>
      <Actions>
        <Button onClick={changeTrip}>출발 조건 변경</Button>
        {fastest && <Button kind="text" onClick={() => showLate(fastest)}>가장 빠른 길 상세 보기</Button>}
      </Actions>
    </Sheet>;
  }
  return <Sheet className="comparison-sheet">
    <div className="sheet-body">
      <div className="heading-row"><h2>어떤 길로 갈까요?</h2>{demo && <Badge/>}</div>
      {result.direct.map((item,index) => <RouteCard key={item.id} item={item}
        label={index === 0 ? '빠른 길' : (result.secondLabel ?? '편한 길')}
        reason={index === 1 && result.secondLabel === '편한 길' ? comfortReason(item,result.direct[0]) : null}
        selected={route?.id === item.id} onSelect={() => select(item)}/>)}
      {alternatives.length > 0 && <>
        <button type="button" className="route-alternatives-toggle" aria-expanded={expanded}
          aria-controls="route-alternatives" onClick={() => setExpanded(!expanded)}>
          <strong>{expanded ? '다른 경로 접기' : '다른 경로 보기'}</strong>
          <small>{alternatives.map(routeCategory).join(' · ')}</small>
        </button>
        <div id="route-alternatives" hidden={!expanded}>
          {alternatives.map(item => <RouteCard key={item.id} item={item}
            label={routeCategory(item)} selected={route?.id === item.id} onSelect={() => select(item)}/>)}
        </div>
      </>}
    </div>
    <Actions>
      <Button kind="text" onClick={changeCondition}>컨디션 변경</Button>
      <Button disabled={!route} onClick={choose}>이 경로로 가기</Button>
    </Actions>
  </Sheet>;
}

function BusInformation({step}) {
  const host = useRef(null);
  useEffect(() => {
    const node = host.current;
    const load = addBusInformation(node, step, routeTime);
    if (load) void load();
    return () => node.replaceChildren();
  }, [step]);
  return <div className="bus-information" ref={host}/>;
}

export function RouteDetails({route, trip, demo, navigate, copyLink, openDwell}) {
  const late = trip.arriveBy && route.arrivalAt > trip.arriveBy;
  const [doorData,setDoorData] = useState(null);
  const hasSubway = route.steps?.some(step => step.type === 'SUBWAY');
  useEffect(() => {
    if (!hasSubway || demo) return;
    let active = true;
    void loadRailDoorData().then(data => {if (active) setDoorData(data)});
    return () => {active = false};
  }, [hasSubway,demo]);
  const doors = railDoorHints(route.steps ?? [],doorData);
  return <section className="page details-page">
    <Summary values={[
      ['출발', clock(trip.departAt)],
      ['이동', `${minutes(route.travelMinutes)}분`],
      ['도착', clock(route.arrivalAt)],
    ]}/>
    {late && <p className="field-error">도착 목표보다 {minutes((route.arrivalAt - trip.arriveBy) / 60000)}분 늦어요.</p>}
    {route.stayMinutes > 0 && <p>경유지에서 {route.stayMinutes}분 체류</p>}
    <div className="heading-row"><h2>이동 단계</h2>{demo && <Badge/>}</div>
    {!!route.knownRideMinutes && <p className="route-source">{crowding(route)} · 서울교통공사 30분 평균
      {route.crowdingAsOf ? ` (${route.crowdingAsOf} 기준)` : ''}</p>}
    <div className="steps">
      {route.steps?.map((step, index) => <div className={`step step-${step.type || 'place'}`} key={index}>
        <span className="step-rail"><i style={{background:
          {'2호선':'var(--line-2)','5호선':'var(--line-5)'}[step.vehicles?.[0]?.name] ??
          ({BUS:'var(--state-success)',SUBWAY:'var(--brand-sky-deep)',WALKING:'var(--walk)'})[step.type]}}/></span>
        <div><strong>{step.guidance || step.title}</strong>
          <small>{step.description || (Number.isFinite(step.time) ? `약 ${minutes(step.time / 60)}분` : '')}</small>
          {!demo && <RideEvidence step={step}/>}
          {step.type === 'BUS' && <>
            {boardingLines(step).length > 1 && <small>이 구간의 노선 후보 · {boardingLines(step).join(' / ')}</small>}
            <BusInformation step={step}/>
          </>}
          {doors[index] && <div className="rail-door-hint">
            <strong>{doors[index].title}</strong>
            <small>{doors[index].instruction}</small>
          </div>}
        </div>
      </div>)}
    </div>
    {doors.some(Boolean) && <p className="route-source">칸·문 위치 자료
      {' · '}<a href="https://data.seoul.go.kr/dataList/OA-22521/L/1/datasetView.do" target="_blank" rel="noreferrer">서울교통공사 환승정보</a>
      {' · '}<a href="https://data.seoul.go.kr/dataList/OA-22749/A/1/datasetView.do" target="_blank" rel="noreferrer">빠른하차정보</a></p>}
    <div className="route-navigation" aria-label="구간별 길안내">
      {route.links?.map((link, index) => <div key={link.url}>
        <Button kind={index === 0 ? 'primary' : 'sky'} onClick={() => navigate(link)}>{link.label}</Button>
        <a href={link.url} target="_blank" rel="noreferrer">직접 열기</a>
        <button className="copy-map-link" onClick={() => copyLink(link)}>링크 복사</button>
      </div>)}
    </div>
    {!trip.arriveBy && !route.viaStop && <Button kind="text" onClick={openDwell}>들를 곳 찾기</Button>}
  </section>;
}
