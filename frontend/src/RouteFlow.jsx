import React, {useEffect, useRef} from 'react';
import {addBusInformation} from '../../src/main/bus-information.js';
import {isDirect} from '../../src/routing/compare.js';
import {clock} from './services.js';
import {Actions, Art, Badge, Button, Sheet, Summary} from './design.jsx';

const minutes = value => Math.ceil(value ?? 0);
const routeTime = {format: clock};

function crowding(route) {
  return route.knownRideMinutes > 0
    ? `지하철 예상 혼잡도 ${Math.round(100 * route.crowdMinutes / route.knownRideMinutes)}%`
    : '혼잡도 정보 없음';
}

export function RouteComparison({result, route, trip, demo, select, choose, changeCondition, changeTrip, showLate}) {
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
      {result.direct.map((item, index) => (
        <button key={item.id} className={`route-card ${route?.id === item.id ? 'selected' : ''}`}
          aria-pressed={route?.id === item.id} onClick={() => select(item)}>
          <h3>{index === 0 ? '빠른 길' : '편한 길'}</h3>
          <div><strong>{minutes(item.travelMinutes)}분</strong><span>{clock(item.arrivalAt)} 도착</span></div>
          <p>도보 {minutes(item.walkMinutes)}분 · 환승 {item.transfers ?? 0}회 · {crowding(item)}</p>
        </button>
      ))}
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
          {step.type === 'BUS' && <BusInformation step={step}/>}
        </div>
      </div>)}
    </div>
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
