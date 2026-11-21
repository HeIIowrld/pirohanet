import React,{useEffect,useMemo,useState} from 'react';
import {Actions,Button,Sheet} from './design.jsx';
import {loadRailDoorData,railDoorHints} from './rail-doors.js';
import {clock} from './services.js';
import {journeyNotice,journeySteps} from './journey.js';

export default function Journey({route,trip,progress,advance,finish,openDetails,openDwell,position,setPosition,demo}) {
  const steps = useMemo(() => journeySteps(route),[route]);
  const [now,setNow] = useState(Date.now);
  const [gps,setGps] = useState('off');
  const [doors,setDoors] = useState([]);
  const {index,startsAt} = progress;
  const step = steps[index];
  const next = steps[index+1];
  const nextRide = steps.slice(index+1).find(item => item.ride || item.stay);
  const notice = journeyNotice(step,nextRide?.ride ? nextRide : null,position,startsAt,now);
  const stopDeparture=step?.stay && trip.arriveBy ? route.stopDepartureAt : null;
  const stepEnds=stopDeparture ?? (step?.duration ? startsAt+step.duration : null);
  const remaining=stepEnds == null ? null : Math.ceil((stepEnds-now)/60_000);
  const last = index >= steps.length - 1;
  const door = doors[index];

  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update,1000);
    document.addEventListener('visibilitychange',update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange',update);
    };
  }, []);

  useEffect(() => {
    if (demo || !route.steps?.some(step => step.type === 'SUBWAY')) return;
    let active = true;
    void loadRailDoorData().then(data => {
      if (active) setDoors(railDoorHints(route.steps,data));
    });
    return () => { active = false; };
  }, [route,demo]);

  useEffect(() => {
    if (gps !== 'on' || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(({coords,timestamp}) => {
      setPosition({latitude:coords.latitude,longitude:coords.longitude,accuracy:coords.accuracy,at:timestamp});
    }, error => {
      setPosition(null);
      if (error.code === 1) setGps('denied');
    }, {enableHighAccuracy:true,maximumAge:10_000,timeout:15_000});
    return () => {
      navigator.geolocation.clearWatch(watch);
      setPosition(null);
    };
  }, [gps,setPosition]);

  useEffect(() => {
    if (position && now - position.at >= 30_000) setPosition(null);
  }, [position,now,setPosition]);

  return <Sheet className="journey-sheet">
    <div className="sheet-body">
      <div className="heading-row">
        <h2>이동 중 안내</h2>
        {step && <small>{index+1} / {steps.length}단계</small>}
      </div>
      <p>{trip.destination} · 경로 조회 기준 {clock(route.arrivalAt)} 도착</p>
      {route.source === 'seoul' && <p className="route-source">서울시 환승경로</p>}
      {step && <div className="journey-current">
        <strong>{step.line && step.to ? `${step.line} · ${step.to} 하차` : step.label}</strong>
        {step.instruction && <p>{step.instruction}</p>}
        {stopDeparture != null ? <small aria-live="polite">{remaining > 0
          ? `${clock(stopDeparture)} 경유지 출발 · 체류 약 ${remaining}분 남음`
          : '약속 장소로 출발할 시간이에요.'}</small> : now < startsAt
          ? <small>{clock(startsAt)} 출발 예정</small>
          : remaining > 0 && <small>현재 단계 약 {remaining}분</small>}
      </div>}
      <div aria-live="polite" aria-atomic="true">
        {notice && <div className="journey-alert">
          <strong>{notice.heading}{notice.stop ? ` · ${notice.stop}` : ''}</strong>
          <p>{notice.next ? `다음 탑승 · ${notice.next}` : '내릴 준비를 해 주세요.'} <small>{notice.basis}</small></p>
        </div>}
      </div>
      {door && <p className="journey-door">{door.title} · {door.instruction}</p>}
      {next && <p className="journey-next">다음 · {next.line || next.label}{next.to ? ` · ${next.to}` : ''}</p>}
      <div className="journey-tools">
        <button onClick={openDetails}>전체 경로 보기</button>
        {openDwell && <button onClick={openDwell}>들를 곳 찾기</button>}
        {gps === 'off' && navigator.geolocation && !demo && <button onClick={()=>setGps('on')}>위치 켜기</button>}
        {gps === 'on' && <button onClick={()=>setGps('off')}>위치 끄기</button>}
        {gps === 'denied' && <small>위치는 브라우저 설정에서 허용할 수 있어요.</small>}
      </div>
    </div>
    <Actions>
      <Button kind="text" onClick={finish}>안내 종료</Button>
      <Button onClick={last ? finish : advance}>{last ? '도착했어요' : '다음 단계'}</Button>
    </Actions>
  </Sheet>;
}
