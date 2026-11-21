import React from 'react';
import {Actions,Badge,Button,Sheet} from './design.jsx';
import {clock} from './services.js';

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

export default function GapStops({result,trip,direct,demo,openStop,goDirect}) {
  const {stops,freeMinutes,stopLookupFailed}=result;
  const groups=areas.map(([area,label]) => ({
    label,index:stops.findIndex(stop => (stop.place.area ?? 'destination') === area),
  })).filter(({index}) => index>=0);
  const directLeave=trip.arriveBy && direct
    ? +trip.arriveBy-Math.ceil(direct.travelMinutes)*60_000 : null;
  const heading=stops.length ? (freeMinutes == null ? '가는 길에 들를 곳' : '남는 시간을 어디서 보낼까요?')
    : stopLookupFailed ? '들를 곳을 확인하지 못했어요' : '지금은 바로 가는 게 좋겠어요';

  return <Sheet className="recommendation-sheet gap-sheet">
    <div className="sheet-body">
      <div className="heading-row"><h2>{heading}</h2>{demo && <Badge/>}</div>
      {freeMinutes != null && <p>가장 빠른 길 기준 여유 {freeMinutes}분 · {clock(trip.arriveBy)} 도착 목표</p>}
      <div className="gap-options">
        {groups.map(({label,index}) => {
          const stop=stops[index];
          return <button key={label} className="gap-option" onClick={()=>openStop(index)}>
            <small>{label}</small>
            <strong>{stop.place.name}</strong>
            <span>{stop.stayMinutes}분 머물기{stop.stopDepartureAt != null && ` · ${clock(stop.stopDepartureAt)} 경유지 출발`}</span>
          </button>;
        })}
      </div>
      {stops.length>0 && <small className="gap-hours">체류 시간은 이동 기준 예상치예요. 영업시간은 장소에서 확인해 주세요.</small>}
      {!stops.length && <p>{stopLookupFailed ? '경유 경로를 조회하지 못했어요. 확인한 직행으로 이동할 수 있어요.'
        : '도착 목표에 맞춰 들를 곳을 찾지 못했어요.'}</p>}
      {directLeave != null && <p className="gap-direct">직행으로 가려면 <strong>{clock(directLeave)}까지 출발</strong></p>}
    </div>
    <Actions><Button kind={stops.length?'text':'primary'} onClick={goDirect}>바로 가기</Button></Actions>
  </Sheet>;
}
