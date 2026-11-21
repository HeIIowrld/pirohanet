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
});
test('Kakao search is available when the Naver geocoder is unconfigured',async()=>{const {searchWithFallback}=await import('./services.js');const r=await searchWithFallback('광화문',async()=>{throw new Error('Geocoding 501')},async()=>({ok:true,json:async()=>({documents:[{place_name:'광화문',address_name:'서울',x:'126.9',y:'37.5'}]})}));assert.equal(r[0].longitude,126.9);assert.equal(r[0].name,'광화문')});
test('time wheel opens at the displayed hour without rolling minute 58 back to zero',async()=>{const {timeDraftFromInput}=await import('./services.js');assert.deepEqual(timeDraftFromInput('2026-11-21T18:58'),{ampm:'오후',hour:'6',minute:'55'})});
test('time wheel arrival crosses midnight and rejects arrival after appointment',async()=>{const {applyTimeDraft}=await import('./services.js');const draft={ampm:'오전',hour:'12',minute:'15'};assert.equal(applyTimeDraft({...form,arrival:''},'arrival',draft,null),'2026-11-22T00:15');assert.throws(()=>applyTimeDraft(form,'arrival',{ampm:'오전',hour:'1',minute:'00'},{start:{dateTime:'2026-11-22T00:30:00+09:00'}}))});
test('back navigation always has a destination',async()=>{const {backScreen}=await import('./services.js');assert.equal(backScreen('condition'),'confirm');assert.equal(backScreen('search','origin','confirm'),'confirm');assert.equal(backScreen('search','save','confirm'),'saved')});
test('saved preferences select known walking metrics without inventing congestion',async()=>{const {preferredDirect}=await import('./services.js');const routes=[{id:'fast',travelMinutes:35,walkMinutes:8},{id:'easy',travelMinutes:41,walkMinutes:5}];assert.equal(preferredDirect(routes,{priority:'walking'}).id,'easy');assert.equal(preferredDirect(routes,{priority:'crowding'}).id,'fast')});

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
