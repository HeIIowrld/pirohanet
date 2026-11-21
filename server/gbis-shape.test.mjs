import assert from 'node:assert/strict';
import test from 'node:test';
import {createGbisShape} from './gbis-shape.mjs';

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
