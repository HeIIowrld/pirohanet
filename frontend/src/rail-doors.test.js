import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {railDoorHints} from './rail-doors.js';
import {subwayDirection} from '../../src/routing/crowding.js';

const dataFile = name => JSON.parse(readFileSync(new URL(`../../src/routing/${name}.json`,import.meta.url)));
const data = {transfers:dataFile('seoul-transfer-doors'),exits:dataFile('seoul-exit-doors')};
const crowding = dataFile('seoul-crowding');
const subway = (line,...stops) => ({
  type:'SUBWAY',vehicles:[{name:line}],stops:stops.map(name => ({name})),
});
const walk = {type:'WALKING'};

test('교대역은 강남에서 들어오는 2호선과 고속터미널 방면 3호선 조건의 칸·문을 안내한다', () => {
  const arriving = subway('2호선','강남','교대(법원.검찰청)');
  const direction = subwayDirection(arriving,crowding);
  assert.equal(direction.next.name,'서초');
  const departing = subway('3호선','교대','고속터미널');
  const steps = [{...arriving,nextSubwayStation:direction.next.name},walk,departing];
  assert.deepEqual(railDoorHints(steps,data)[0],{title:'빠른 환승 · 교대',instruction:'1-2에서 내려 3호선 7-4 쪽으로 이동'});
  assert.equal(railDoorHints([{...arriving,nextSubwayStation:'알 수 없는 방면'},walk,departing],data)[0],null);
});

test('광화문역 서대문 방면 하차는 같은 방면 설비의 문만 안내한다', () => {
  const arriving = subway('5호선','종로3가(탑골공원)','광화문(세종문화회관)');
  const direction = subwayDirection(arriving,crowding);
  const [hint] = railDoorHints([{...arriving,nextSubwayStation:direction.next.name},walk],data);
  assert.equal(direction.next.name,'서대문');
  assert.equal(hint.title,'빠른 하차 · 광화문 승강장 설비');
  assert.match(hint.instruction,/엘리베이터 1-1/);
  assert.equal(railDoorHints([arriving,walk],data)[0],null);
});
