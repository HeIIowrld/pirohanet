import React from 'react';
import {Actions,Badge,Button,Sheet} from './design.jsx';
import {clock} from './services.js';
import {availableStop,gapDeparture} from './gap-timing.js';

const areas = [
  ['origin','출발지 근처'],
  ['enRoute','이동 중간'],
  ['destination','도착지 근처'],
];

export function StopTiming({stop}) {
  return stop.stopDepartureAt != null && <p className="waypoint-hint">
    {clock(stop.stopArrivalAt)} 경유지 도착 · <strong>{clock(stop.stopDepartureAt)} 경유지 출발</strong>
  </p>;
}

export function StopDepartureNotice({stop,trip,now}) {
  const lead=+trip.departAt > now ? `${clock(trip.departAt)}에 출발하면` : '지금 출발하면';
  if (stop && stop.stopDepartureAt == null) return null;
  return <div className={`gap-notice${stop?'':' gap-notice-expired'}`} role="status">
    <strong>{stop ? `${lead} ${stop.stayMinutes}분 머물 수 있어요` : '이곳에 들를 시간이 부족해졌어요'}</strong>
    <p>{stop ? `약속에 맞추려면 경유지에서 ${clock(stop.stopDepartureAt)}까지 출발하세요.`
      : '다른 장소를 고르거나 바로 가세요.'}</p>
  </div>;
}

export default function GapStops({result,trip,direct,demo,now,openStop,goDirect}) {
  const {stops,freeMinutes,stopLookupFailed}=result;
  const options=stops.map((stop,index) => ({stop:availableStop(stop,trip,now),index}));
  const groups=areas.flatMap(([area,label]) => {
    const option=options.find(({stop}) => stop && (stop.place.area ?? 'destination') === area);
    return option ? [{...option,label}] : [];
  });
  const departure=gapDeparture(trip,now);
  const remaining=freeMinutes == null ? null : Math.max(0,freeMinutes-(departure-trip.departAt)/60_000);
  const directLeave=trip.arriveBy && direct
    ? +trip.arriveBy-Math.ceil(direct.travelMinutes)*60_000 : null;
  const lead=+trip.departAt > now ? `${clock(trip.departAt)} 출발 시` : '지금 출발하면';
  const heading=groups.length ? (remaining == null ? '가는 길에 들를 곳' : '남는 시간을 어디서 보낼까요?')
    : stopLookupFailed && !stops.length ? '들를 곳을 확인하지 못했어요' : '지금은 바로 가는 게 좋겠어요';

  return <Sheet className="recommendation-sheet gap-sheet">
    <div className="sheet-body">
      <div className="heading-row"><h2>{heading}</h2>{demo && <Badge/>}</div>
      {remaining != null && <p>가장 빠른 길 기준 여유 {remaining}분 · {clock(trip.arriveBy)} 도착 목표</p>}
      <div className="gap-options">
        {groups.map(({label,index,stop}) => <button key={label} className="gap-option" onClick={()=>openStop(index)}>
          <small>{label}</small>
          <strong>{stop.place.name}</strong>
          <span>{stop.stopDepartureAt == null || !trip.arriveBy ? `${stop.stayMinutes}분 머물기`
            : `${lead} ${stop.stayMinutes}분 머물 수 있어요`}</span>
          {stop.stopDepartureAt != null && trip.arriveBy && <small>경유지에서 {clock(stop.stopDepartureAt)}까지 출발</small>}
        </button>)}
      </div>
      {groups.length>0 && <small className="gap-hours">체류 시간은 이동 기준 예상치예요. 영업시간은 장소에서 확인해 주세요.</small>}
      {!groups.length && <p>{stopLookupFailed && !stops.length ? '경유 경로를 조회하지 못했어요. 확인한 직행으로 이동할 수 있어요.'
        : '도착 목표에 맞춰 들를 곳을 찾지 못했어요.'}</p>}
      {directLeave != null && <p className="gap-direct">{departure>directLeave
        ? <strong>지금 직행해도 도착 목표를 넘길 수 있어요</strong>
        : <>직행으로 가려면 <strong>{clock(directLeave)}까지 출발</strong></>}</p>}
    </div>
    <Actions><Button kind={groups.length?'text':'primary'} onClick={goDirect}>바로 가기</Button></Actions>
  </Sheet>;
}
