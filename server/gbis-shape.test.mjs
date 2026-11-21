import assert from 'node:assert/strict';
import test from 'node:test';
import {createGbisShape,createSeoulBusShape} from './gbis-shape.mjs';

test('GBIS directions are converted from Web Mercator and share one cache entry', async () => {
  let calls = 0;
  const lookup = createGbisShape({fetchFn:(_url,options) => {
    calls++;
    assert.equal(options.body.get('routeId'),'229000273');
    return Response.json({success:true,result:{gg:{upLine:{list:[
      {lon:'14112818.221512',lat:'4547035.190736',type:'1'},
      {lon:'14113018.1234',lat:'4547015.1234',type:'1'},
    ]}}}});
  }});
  const [first,second] = await Promise.all([lookup('229000273'),lookup('229000273')]);
  assert.equal(calls,1);
  assert.equal(first,second);
  assert.deepEqual(first[0][0],[126.777603,37.770354]);
  assert.deepEqual(await lookup('165000381'),[]);
  assert.equal(calls,1);
});

test('TOPIS supplies ordered road points for requested Seoul routes', async () => {
  let calls = 0;
  const fetchShape = createSeoulBusShape({fetchFn:url => {
    calls++;
    const routeId = url.searchParams.get('routId');
    assert.equal(url.hostname,'topis.seoul.go.kr');
    return Response.json({rows:[[126.93,37.55],[126.93,37.55],[126.94,37.56]]
      .map(([posX,posY]) => ({routeId,posX,posY}))});
  }});
  const [first,second] = await Promise.all([fetchShape('100100450'),fetchShape('100100450')]);
  assert.equal(first,second);
  assert.deepEqual(first,[[[126.93,37.55],[126.94,37.56]]]);
  assert.deepEqual(await fetchShape('219000027'),first);
  assert.deepEqual(await fetchShape('165000381'),first);
  assert.deepEqual(await fetchShape('bad-route'),[]);
  assert.equal(calls,3);
});
