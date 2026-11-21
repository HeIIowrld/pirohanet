import assert from 'node:assert/strict';
import test from 'node:test';
import {pickBusObservation} from './bus-observations.js';
import {compareRoutes} from './compare.js';

const departAt = new Date('2026-11-21T14:00:00+09:00');
const bus = (type,busComfort) => ({type:'BUS',time:1200,vehicles:[{name:'3030',type}],busComfort});
const rail = railComfort => ({type:'SUBWAY',time:900,vehicles:[{name:'2호선'}],railComfort});

test('the mode baseline differentiates village, feeder, regional buses and rail for the same duration', () => {
  const route = (...steps) => ({travelMinutes:25,walkMinutes:3,transfers:0,steps});
  const comfort = routes => compareRoutes(routes,{departAt,preferences:{fatigueLevel:5}}).map(item => item.id);
  assert.deepEqual(comfort([
    {id:'village',...route(bus('마을'))},{id:'feeder',...route(bus('지선'))},
    {id:'regional',...route(bus('광역'))},{id:'rail',...route({...rail(),time:1200})},
  ]),['rail','regional','feeder','village']);
});

test('a slightly slower seated mixed route can beat a crowded direct route without changing ETA', () => {
  const crowded = {id:'crowded',travelMinutes:34,walkMinutes:5,transfers:1,
    steps:[bus('마을',{congestion:'매우 혼잡'}),rail({knownMinutes:15,average:148})]};
  const candidate = {id:'candidate',travelMinutes:37,walkMinutes:5,transfers:1,
    steps:[bus('광역',{remainingSeats:8}),rail({knownMinutes:12,average:67})]};
  const unknown = {id:'unknown',travelMinutes:48,walkMinutes:5,transfers:1,steps:[bus('지선'),rail()]};
  const [best] = compareRoutes([crowded,candidate,unknown],{departAt,preferences:{fatigueLevel:5}});
  assert.equal(best.id,'candidate');
  assert.equal(best.rideLoad.seatsKnown,1);
  assert.equal(best.rideLoad.knownMinutes,12);
  assert.equal(+best.arrivalAt,+departAt+37*60_000);
});

test('uses the earliest boardable matched vehicle, keeps zero seats, and ignores stale or distant reports', () => {
  const now = +departAt;
  const step = {...bus('광역'),boardingAt:now+3*60_000};
  const aliases=['3030','3030안양'];
  const data = {checkedAt:now,showLive:true,routes:[
    {name:'3030안양',aliases,arrivals:[
      {at:now+2*60_000,remainingSeats:40},
      {at:now+4*60_000,remainingSeats:0},
      {at:now+5*60_000,remainingSeats:20},
    ],prediction:{congestion:'보통'}},
    {name:'9999',arrivals:[{at:now+3*60_000,remainingSeats:30}]},
  ]};
  assert.equal(pickBusObservation(step,data,now).remainingSeats,0);
  assert.equal(pickBusObservation(step,data,now).congestionSource,'시간대 관측');
  assert.equal(pickBusObservation(step,{...data,checkedAt:now-3*60_000},now).remainingSeats,null);
  assert.equal(pickBusObservation({...step,boardingAt:now+25*60_000},data,now).remainingSeats,null);
});
