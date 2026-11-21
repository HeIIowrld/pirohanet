import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTrip,routeResult,fromInput,localInput,suggestedLevel,finalLevel } from './services.js';
import { SAMPLE_EVENTS } from '../../src/calendar/sample.js';
const form={origin:'서울시청',destination:'광화문',departure:'2026-11-21T23:50',arrival:'2026-11-22T00:30'};
test('Korean times cross midnight regardless of machine timezone',()=>{assert.equal(fromInput(form.departure).toISOString(),'2026-11-21T14:50:00.000Z');assert.equal(localInput(fromInput(form.departure)),form.departure)});
test('five fatigue levels remain numeric and normalize without breaking old calendar API',()=>{for(let n=1;n<=5;n++){const t=makeTrip(form,null,n);assert.equal(t.preferences.fatigueLevel,n);assert.equal(t.preferences.normalizedFatigue,(n-1)/4)}assert.equal(makeTrip(form,null,null).preferences.normalizedFatigue,null)});
test('reject arrival after appointment and before departure',()=>{assert.throws(()=>makeTrip({...form,arrival:'2026-11-21T23:40'},null,2));assert.throws(()=>makeTrip(form,{start:{dateTime:'2026-11-22T00:20:00+09:00'}},2))});
test('detours count selected dwell and discard late options',()=>{
  const trip=makeTrip(form,null,3);
  const r=routeResult([{id:'fast',travelMinutes:16},{id:'stop',travelMinutes:24,viaStop:true,stayMinutes:20}],trip);
  assert.equal(r.stops.length,0);
  assert.equal(r.direct.length,1);
  assert.equal(r.all.length,2);
});
test('without target route comparison retains long dwell on explicit request',()=>{
  const trip=makeTrip({...form,arrival:''},null,null);
  const r=routeResult([{id:'fast',travelMinutes:16},{id:'stop',travelMinutes:20,viaStop:true,stayMinutes:60}],trip);
  assert.equal(trip.arriveBy,null);
  assert.equal(r.stops[0].stayMinutes,60);
});
test('the fastest route remains first even when another route has a better comfort score',()=>{
  const trip=makeTrip(form,null,5);
  const r=routeResult([
    {id:'fast',travelMinutes:15,walkMinutes:10,transfers:2},
    {id:'easy',travelMinutes:20,walkMinutes:3,transfers:0},
  ],trip);
  assert.deepEqual(r.direct.map(route=>route.id),['fast','easy']);
  assert.equal(r.secondLabel,'환승 적은 길');
  assert.equal(r.comfortReasons,undefined);
});
test('Kakao search is available when the Naver geocoder is unconfigured',async()=>{const {searchWithFallback}=await import('./services.js');const r=await searchWithFallback('광화문',async()=>{throw new Error('Geocoding 501')},async()=>({ok:true,json:async()=>({documents:[{place_name:'광화문',address_name:'서울',x:'126.9',y:'37.5'}]})}));assert.equal(r[0].longitude,126.9);assert.equal(r[0].name,'광화문')});
test('time wheel opens at the displayed hour without rolling minute 58 back to zero',async()=>{const {timeDraftFromInput}=await import('./services.js');assert.deepEqual(timeDraftFromInput('2026-11-21T18:58'),{ampm:'오후',hour:'6',minute:'55'})});
test('time wheel arrival crosses midnight and rejects arrival after appointment',async()=>{const {applyTimeDraft}=await import('./services.js');const draft={ampm:'오전',hour:'12',minute:'15'};assert.equal(applyTimeDraft({...form,arrival:''},'arrival',draft,null),'2026-11-22T00:15');assert.throws(()=>applyTimeDraft(form,'arrival',{ampm:'오전',hour:'1',minute:'00'},{start:{dateTime:'2026-11-22T00:30:00+09:00'}}))});

test('additional modes surface bus transfers and mixed routes without duplicating recommendations',()=>{
  const trip=makeTrip({...form,arrival:'2026-11-22T01:30'},null,4);
  const candidates=[
    {id:'rail',mode:'SUBWAY',travelMinutes:21,walkMinutes:4,transfers:1},
    {id:'bus-direct',mode:'BUS',travelMinutes:40,walkMinutes:4,transfers:0},
    {id:'bus-transfer-1',mode:'BUS',travelMinutes:47,walkMinutes:5,transfers:1},
    {id:'bus-transfer-2',mode:'BUS',travelMinutes:52,walkMinutes:7,transfers:1},
    {id:'mixed',mode:'BUS_AND_SUBWAY',travelMinutes:49,walkMinutes:6,transfers:1},
  ];
  const r=routeResult(candidates,trip);
  assert.deepEqual(r.direct.map(route=>route.id),['rail','bus-direct']);
  assert.deepEqual(r.alternatives.map(route=>route.id),['bus-transfer-1','mixed']);
  const strict=routeResult(candidates,{...trip,arriveBy:new Date(+trip.departAt+41*60000)});
  assert.equal(strict.alternatives.length,0);
});

test('calendar suggestion stays on the 1-5 scale and is accepted by makeTrip',()=>{
  const at=hhmm=>new Date(`2026-11-20T${hhmm}:00+09:00`);
  assert.equal(suggestedLevel(SAMPLE_EVENTS,at('08:00')),null);
  assert.equal(suggestedLevel(SAMPLE_EVENTS,at('18:00')),3);
  for(let minutes=0;minutes<24*60;minutes+=15){
    const level=suggestedLevel(SAMPLE_EVENTS,new Date(Date.parse('2026-11-20T00:00:00+09:00')+minutes*60000));
    assert.ok(level===null||[1,2,3,4,5].includes(level),`level ${level}`);
    if(level!==null)assert.doesNotThrow(()=>makeTrip(form,null,level));
  }
});

test('route search uses the chosen condition plus the remaining schedule, capped at 5',()=>{
  const at=hhmm=>new Date(`2026-11-20T${hhmm}:00+09:00`);
  assert.equal(finalLevel(SAMPLE_EVENTS,1,at('14:05')),3);
  assert.equal(finalLevel(SAMPLE_EVENTS,4,at('14:05')),5);
  assert.equal(finalLevel(SAMPLE_EVENTS,null,at('14:05')),3); // 건너뛰면 달력만으로
  assert.equal(finalLevel(SAMPLE_EVENTS,1,at('22:00')),1); // 남은 일정이 없으면 고른 값 그대로
  assert.equal(finalLevel([],2,at('14:05')),2);
  assert.equal(finalLevel([],null,at('14:05')),null);
  for(const level of [null,1,2,3,4,5])assert.doesNotThrow(()=>makeTrip(form,null,finalLevel(SAMPLE_EVENTS,level,at('14:05'))));
});

test('crowding evidence identifies the avoided rail leg when it tips the recommendation', () => {
  const rail = (line, stops, time, average) => ({
    type:'SUBWAY', time, vehicles:[{name:line}],
    stops:stops.map(name => ({name})), railComfort:{average,knownMinutes:time / 60},
  });
  const congested = rail('3호선',['교대(법원.검찰청)','종로3가'],1260,96);
  const fastest = {id:'fast',travelMinutes:30,walkMinutes:5,transfers:2,steps:[congested]};
  const calmer = {id:'calmer',travelMinutes:42,walkMinutes:3,transfers:1,
    steps:[rail('2호선',['강남','을지로4가'],2160,57)]};
  const trip = makeTrip({...form,arrival:''},null,5);
  const high = routeResult([fastest,calmer],trip);
  const low = routeResult([fastest,calmer],{...trip,preferences:{fatigueLevel:1}});
  assert.equal(high.secondLabel,'편한 길');
  assert.deepEqual(high.comfortReasons.map(({kind,scope,step}) => [kind,scope,step]),[
    ['crowding','fastest',congested],
  ]);
  assert.equal(low.secondLabel,'환승 적은 길');
  const withoutCrowding = {...fastest,steps:[{...congested,railComfort:undefined}]};
  assert.equal(routeResult([withoutCrowding,calmer],trip).secondLabel,'환승 적은 길');
});

test('seat evidence points to the checked vehicle and is absent without a seating benefit', () => {
  const seat = {name:'9202',type:'광역',remainingSeats:35,checkedAt:Date.parse('2026-11-21T15:30:00+09:00')};
  const bus = {type:'BUS',time:1200,vehicles:[{name:'9202',type:'광역'}],busComfort:seat};
  const fastest = {id:'fast',travelMinutes:25,walkMinutes:3,transfers:1,
    steps:[{...bus,vehicles:[{name:'3030',type:'광역'}],busComfort:undefined}]};
  const seated = {id:'seated',travelMinutes:26,walkMinutes:3,transfers:1,steps:[bus]};
  const trip = makeTrip({...form,arrival:''},null,5);
  const result = routeResult([fastest,seated],trip);
  assert.equal(result.secondLabel,'편한 길');
  assert.deepEqual(result.comfortReasons.map(({kind,scope,step}) => [kind,scope,step.busComfort]), [
    ['seats','recommended',seat],
  ]);
  assert.equal(routeResult([fastest,{...seated,steps:[{...bus,busComfort:undefined}]}],trip).direct.length,1);
});

test('the highest-ranked short-walk route takes precedence over a weaker crowding recommendation', () => {
  const train = average => ({type:'SUBWAY',time:600,vehicles:[{name:'2호선'}],
    stops:[{name:'신촌'},{name:'합정'}],railComfort:{average,knownMinutes:10}});
  const fast = {id:'fast',travelMinutes:15,walkMinutes:8,transfers:1,steps:[train(90)]};
  const shortWalk = {...fast,id:'shortWalk',travelMinutes:17,walkMinutes:3};
  const calmer = {...fast,id:'calmer',travelMinutes:17,steps:[train(50)]};
  const high = makeTrip({...form,arrival:''},null,5);
  const result = routeResult([fast,shortWalk,calmer],high);
  assert.deepEqual(result.direct.map(route=>route.id),['fast','shortWalk']);
  assert.equal(result.secondLabel,'도보 적은 길');
  assert.equal(routeResult([fast,shortWalk,calmer],{...high,preferences:{fatigueLevel:1}}).eligible[0].id,'fast');
});

test('line avoidance can surface an equally walkable route as the preferred option', () => {
  const direct = {id:'direct',travelMinutes:30,walkMinutes:4,transfers:0,subwayLineMinutes:{2:20}};
  const avoids = {...direct,id:'avoids',travelMinutes:34,subwayLineMinutes:{5:20}};
  const trip = makeTrip({...form,arrival:'',preferences:{avoidLine:'2'}},null,3);
  const result = routeResult([direct,avoids],trip);
  assert.deepEqual(result.direct.map(route=>route.id),['direct','avoids']);
  assert.deepEqual(result.comfortReasons,[{kind:'avoidedLine',line:'2',entirely:true}]);
  assert.equal(routeResult([direct,avoids],{...trip,arriveBy:new Date(+trip.departAt+31*60000)}).direct.length,1);
});

test('the higher-scoring overall route appears without crowding or seat observations', () => {
  const fast = {id:'fast',mode:'BUS',travelMinutes:23,walkMinutes:3,transfers:0,
    steps:[{type:'BUS',time:1200,vehicles:[{name:'마포01',type:'마을'}]}]};
  const recommended = {id:'recommended',mode:'SUBWAY',travelMinutes:25,walkMinutes:3,transfers:0,
    steps:[{type:'SUBWAY',time:1320,vehicles:[{name:'2호선'}]}]};
  const trip = makeTrip({...form,arrival:''},null,5);
  const result = routeResult([fast,recommended],trip);
  assert.equal(result.eligible[0].id,'recommended');
  assert.deepEqual(result.direct.map(route=>route.id),['fast','recommended']);
  assert.equal(result.secondLabel,'종합 추천');
  assert.equal(result.comfortReasons,undefined);
  assert.equal(result.direct[1].rideLoad.knownMinutes,0);
  assert.equal(result.direct[1].rideLoad.seatsKnown,0);
  const lowFatigue = routeResult([fast,recommended],{...trip,preferences:{fatigueLevel:1}});
  assert.deepEqual(lowFatigue.direct.map(route=>route.id),['fast']);
  const strict = routeResult([fast,recommended],{...trip,arriveBy:new Date(+trip.departAt+24*60000)});
  assert.deepEqual(strict.direct.map(route=>route.id),['fast']);
});
