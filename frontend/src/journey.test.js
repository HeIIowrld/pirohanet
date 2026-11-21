import assert from 'node:assert/strict';
import test from 'node:test';
import {journeyNotice,journeySteps} from './journey.js';
import {addRecentRoute} from './recent-routes.js';

const minute = 60_000;
const ride = {type:'SUBWAY',time:600,vehicles:[{name:'3호선'}],
  stops:[{name:'교대(법원.검찰청)'},{name:'종로3가(탑골공원)'}],points:[[127.01,37.49],[126.99,37.57]]};
const [step] = journeySteps({steps:[ride]});
const next = {line:'5호선'};

test('foreground location gives a transfer prompt only with a recent, accurate nearby fix', () => {
  const now = 2*minute;
  const position = {latitude:37.57,longitude:126.99,accuracy:20,at:now-1000};
  assert.deepEqual(journeyNotice(step,next,position,0,now),{
    heading:'환승 준비',stop:'종로3가',next:'5호선',basis:'현재 위치 기준',
  });
  assert.equal(journeyNotice(step,next,{...position,accuracy:95},0,now),null);
  assert.equal(journeyNotice(step,next,{...position,at:now-31_000},0,now),null);
  assert.equal(journeyNotice(step,next,position,now+minute,now),null);
});

test('estimated ride time is the fallback and the final ride prompts to get off', () => {
  assert.equal(journeyNotice(step,next,null,0,7*minute),null);
  assert.deepEqual(journeyNotice(step,null,null,0,9*minute),{
    heading:'하차 준비',stop:'종로3가',next:undefined,basis:'예상 이동 시간 기준',
  });
  assert.equal(journeyNotice(step,next,null,0,16*minute),null);
});

test('a selected waypoint is a timed break between travel legs', () => {
  const [,pause] = journeySteps({viaStop:true,stayMinutes:20,steps:[ride,{guidance:'공원에서 20분 체류'},ride]});
  assert.equal(pause.stay,true);
  assert.equal(pause.duration,20*minute);
  assert.equal(journeyNotice(pause,next,null,0,19*minute),null);
});

test('recent journeys are deduplicated by endpoints and restricted to five confirmed pairs', () => {
  const origin = {name:'강남역',longitude:127,latitude:37,privateField:'not kept'};
  const destination = {name:'광화문역',longitude:126,latitude:37};
  const first = addRecentRoute([],{origin,destination});
  assert.equal(first[0].origin.privateField,undefined);
  assert.equal(addRecentRoute(first,{origin}).length,1);
  const history = Array.from({length:6},(_,index)=>({...destination,latitude:37+index/10}))
    .reduce((items,point)=>addRecentRoute(items,{origin,destination:point}),first);
  assert.equal(history.length,5);
  assert.equal(addRecentRoute(history,{origin,destination})[0].destination.latitude,37);
});
