import React,{useEffect,useId,useState} from 'react';
import {Actions,Button,Icon} from './design.jsx';
import {clock,localInput} from './services.js';

function EventRows({events,selected,today,onSelect,later=false}){
 return events.map((event,index)=>{
  const start=event.start.dateTime;
  const date=localInput(start).slice(0,10);
  return <button type="button" className={`event-row ${event===selected?'selected':''} ${later?'later':''}`} key={event.id||index}
    disabled={!event.location} onClick={()=>onSelect(event)}>
   <span><small>{date===today?'오늘':date.slice(5).replace('-','/')}</small><strong>{clock(start)}</strong></span>
   <span><strong>{event.summary||'다음 약속'}</strong><small>{event.location||'장소가 없어요'}</small></span>
  </button>;
 });
}

export default function HomeEvents({expanded,nearEvents,laterEvents,event,now,onExpand,onCollapse,onSelect,onPreview}){
 const [laterOpen,setLaterOpen]=useState(false);
 const laterId=useId();
 useEffect(()=>{
  if(!expanded)setLaterOpen(false);
 },[expanded]);
 const preview=nearEvents.find(item=>item.location);
 const visibleEvents=expanded?nearEvents:preview?[preview]:[];
 const routeableEvents=laterOpen?[...nearEvents,...laterEvents]:nearEvents;
 const visibleDestination=routeableEvents.find(item=>item===event&&item.location)
  ??routeableEvents.find(item=>item.location);
 const canRouteLater=laterEvents.some(item=>item.location);
 const today=localInput(now).slice(0,10);

 function toggleLater(){
  if(!expanded)onExpand();
  setLaterOpen(open=>!open);
 }

 function findRoute(){
  if(!expanded)onExpand();
  else if(visibleDestination)onSelect(visibleDestination);
  else setLaterOpen(true);
 }

 return <>
  <div className="sheet-body">
   <div className="event-heading">
    <p className="subheading">다가오는 일정</p>
    {expanded&&<button type="button" onClick={onCollapse}>일정 접기</button>}
   </div>
   <EventRows events={visibleEvents} selected={event} today={today} onSelect={expanded?onSelect:onPreview}/>
   {laterEvents.length>0&&(expanded||!preview)&&<>
    <button type="button" className="event-fold" aria-expanded={laterOpen} aria-controls={expanded?laterId:undefined}
      onClick={toggleLater}>
     <span>24시간 이후 일정 {laterEvents.length}개</span><Icon name="chevronRight"/>
    </button>
    {expanded&&<div id={laterId} hidden={!laterOpen}>
     {laterOpen&&<EventRows events={laterEvents} selected={event} today={today} onSelect={onSelect} later/>}
    </div>}
   </>}
  </div>
  <Actions><Button disabled={!visibleDestination&&!canRouteLater} onClick={findRoute}>길 찾기</Button></Actions>
 </>;
}
