import test from 'node:test';
import assert from 'node:assert/strict';
import {availableStop} from './gap-timing.js';

test('waiting before leaving consumes dwell time and preserves the onward deadline',()=>{
  const departAt=new Date('2026-11-21T16:00:00+09:00');
  const at=minutes=>+departAt+minutes*60_000;
  const trip={departAt,arriveBy:new Date(at(60))};
  const stop={stayMinutes:25,stopArrivalAt:at(17),stopDepartureAt:at(42),arrivalAt:new Date(at(60)),
    place:{name:'카페'},steps:[{type:'BUS',boardingAt:at(1)},{guidance:'카페에서 25분 체류'},{type:'BUS',boardingAt:at(43)}]};
  assert.equal(availableStop(stop,trip,at(-1)),stop);
  const delayed=availableStop(stop,trip,at(3));
  assert.equal(delayed.stayMinutes,22);
  assert.equal(delayed.stopArrivalAt,at(20));
  assert.equal(delayed.stopDepartureAt,at(42));
  assert.equal(delayed.arrivalAt,stop.arrivalAt);
  assert.deepEqual(delayed.steps,[{type:'BUS',boardingAt:at(4)},{guidance:'카페에서 22분 체류'},{type:'BUS',boardingAt:at(43)}]);
  assert.equal(availableStop(stop,trip,at(20)).stayMinutes,5);
  assert.equal(availableStop(stop,trip,at(21)),null);
});
