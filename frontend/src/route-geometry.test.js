import test from 'node:test';
import assert from 'node:assert/strict';
import {addRailGeometry,addMapGeometry,mapStepPoints} from './route-geometry.js';

const rail = {
  type:'SUBWAY',approximate:true,railSegments:4,vehicles:[{name:'5호선'}],
  stops:[{name:'서대문역'},{name:'동대문역사문화공원역'}],
  points:[[126.966606,37.565706],[127.005796,37.564575]],
};
const walk = {
  type:'WALKING',approximate:true,distance:83,
  points:[[126.9368,37.5555],[126.9359,37.5553]],
};

test('Seoul subway lines pass through known intermediate stations and keep their approximation status', () => {
  const result = addRailGeometry({steps:[rail,{...rail,railSegments:3}]});
  const [known,unknown] = result.steps;
  assert.equal(known.points.length,5);
  assert.deepEqual(known.points[0],rail.points[0]);
  assert.deepEqual(known.points.at(-1),rail.points.at(-1));
  assert.equal(known.approximate,true);
  assert.deepEqual(unknown.points,rail.points);
});

test('the map uses actual walk coordinates for a nearby route and keeps the existing trip schedule', async () => {
  const route = {travelMinutes:27,steps:[walk,rail]};
  const points = [walk.points[0],[126.9364,37.5556],walk.points[1]];
  const fetchFn = async url => {
    if (url.endsWith('osm-subway-shapes.json')) return Response.json({lines:{}});
    assert.match(url,/\/api\/walk\?/);
    return Response.json({status:'OK',route:{
      properties:{totalDistance:118,totalTime:130},
      legs:[{steps:[{properties:{},path:{points}}]}],
    }});
  };
  const signal = new AbortController().signal;
  const result = await addMapGeometry(route,signal,fetchFn);
  assert.equal(result.travelMinutes,route.travelMinutes);
  assert.deepEqual(result.steps,[{...walk,points,approximate:false},addRailGeometry(route).steps[1]]);
  const outage = await addMapGeometry(route,signal,async () => new Response(null,{status:429}));
  assert.deepEqual(outage.steps,addRailGeometry(route).steps);
});

test('bus sketches use ordered stops and hide a two-point ride when stops cannot be matched', async () => {
  const step = {type:'BUS',approximate:true,seoulBusRouteId:'100100112',seoulBusStopId:'113000420',
    points:[[126.93588,37.55535],[126.96656,37.56553]]};
  const middle = [126.953,37.559];
  const routes = {'100100112':[
    [2,...step.points[1]],[113000420,...step.points[0]],[3,...middle],[4,...step.points[1]],
  ]};
  const route = {steps:[step,{...step,seoulBusRouteId:'unknown'}]};
  const signal = new AbortController().signal;
  const result = await addMapGeometry(route,signal,async () => Response.json({routes}));
  assert.deepEqual(mapStepPoints(result.steps[0]),[step.points[0],middle,step.points[1]]);
  assert.equal(result.steps[0].approximate,true);
  assert.deepEqual(mapStepPoints(result.steps[1]),[]);
  assert.deepEqual(mapStepPoints(rail),[]);
});

test('adjacent subway stations verified by the network remain visible on the map', () => {
  const step = {...rail,railSegments:1,vehicles:[{name:'2호선'}],
    stops:[{name:'홍대입구역'},{name:'합정역'}]};
  const [mapped] = addRailGeometry({steps:[step]}).steps;
  assert.deepEqual(mapStepPoints(mapped),step.points);
  assert.equal(mapped.approximate,true);
});

test('shown station access walks can exceed the short walking-only candidate limit', async () => {
  const step = {...walk,distance:1050};
  const walkPoints = [step.points[0],[126.9365,37.55555],step.points[1]];
  const fetchFn = async () => Response.json({status:'OK',route:{
    properties:{totalDistance:1210,totalTime:920},legs:[{steps:[{properties:{},path:{points:walkPoints}}]}],
  }});
  const [mapped] = (await addMapGeometry({steps:[step]},new AbortController().signal,fetchFn)).steps;
  assert.deepEqual(mapStepPoints(mapped),walkPoints);
  assert.equal(mapped.approximate,false);
});

test('a Seoul to Incheon bus transfer draws both the adjacent stop pair and the Incheon bus', async () => {
  const bus = (route,stop,points) => ({type:'BUS',approximate:true,seoulBusRouteId:route,seoulBusStopId:stop,points});
  const cityBus = bus('100100551','112000015',[[126.93891,37.56008],[126.93549,37.56011]]);
  const incheonBus = bus('165000381','112000031',[[126.9353,37.55977],[126.91384,37.54949]]);
  const missing = bus('165000399','112000031',incheonBus.points);
  const sources = {
    seoul:{'100100551':[[112000015,...cityBus.points[0]],[112000013,...cityBus.points[1]]]},
    incheon:{
      '165000381':[[112000031,...incheonBus.points[0]],[113000414,126.92432,37.55732],[113000412,...incheonBus.points[1]]],
      '165000399':[[112000031,...incheonBus.points[0]],[113000414,null,null],[113000412,...incheonBus.points[1]]],
    },
  };
  const result = await addMapGeometry({steps:[cityBus,incheonBus,missing]},new AbortController().signal,
    async url=>Response.json({routes:sources[url.includes('incheon')?'incheon':'seoul']}));
  assert.deepEqual(mapStepPoints(result.steps[0]),cityBus.points);
  assert.deepEqual(mapStepPoints(result.steps[1]),[incheonBus.points[0],[126.92432,37.55732],incheonBus.points[1]]);
  assert.deepEqual(mapStepPoints(result.steps[2]),[]);
});

test('the Sinchon to Hongik University rail segment has actual track points', async () => {
  const {readFile} = await import('node:fs/promises');
  const shapes = await readFile(new URL('../public/assets/data/osm-subway-shapes.json',import.meta.url));
  const rail = {type:'SUBWAY',approximate:true,railSegments:1,vehicles:[{name:'2호선'}],
    stops:[{name:'신촌역'},{name:'홍대입구역'}],points:[[126.93698,37.5552],[126.92378,37.55687]]};
  const signal = new AbortController().signal;
  const [step] = (await addMapGeometry({steps:[rail]},signal,async () => new Response(shapes))).steps;
  assert.ok(mapStepPoints(step).length > 4);
  assert.equal(step.approximate,false);
  assert.equal(step.osmGeometry,true);
});

test('roads supplied by GBIS are clipped to the selected bus boarding and alighting points', async () => {
  const from = [126.935,37.555];
  const middle = [126.9335,37.556];
  const to = [126.932,37.555];
  const road = [[126.936,37.555],from,middle,to,[126.931,37.555]];
  const bus = {type:'BUS',approximate:true,seoulBusRouteId:'229000273',seoulBusStopId:'113000420',
    vehicles:[{name:'7101파주'}],points:[from,to]};
  const signal = new AbortController().signal;
  const [step] = (await addMapGeometry({steps:[bus]},signal,async url =>
    Response.json(url.includes('shapeRouteId=229000273') ? {lines:[road]} : {}))).steps;
  assert.ok(mapStepPoints(step).some(([lon,lat]) => lon===middle[0] && lat===middle[1]));
  assert.ok(mapStepPoints(step).every(([lon]) => lon>=to[0] && lon<=from[0]));
  assert.equal(step.approximate,false);
  assert.equal(step.gbisGeometry,true);
});
