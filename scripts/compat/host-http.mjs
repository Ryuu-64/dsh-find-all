// Real installed-host route acceptance. This is not browser/UI acceptance.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function exerciseHostHttp(url) {
  const origin = new URL(url).origin;
  const auth = await fetch(url, {redirect:'manual'});
  const cookies = auth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookies, 'official local-token exchange must establish cookie authentication');
  const endpoint = new URL('/api/dsh-find-all/search', origin);
  const catalog = ['a','b'].map(label => ({id:`find-all-synthetic-${label}`,title:`FIND_ALL_${label.toUpperCase()} synthetic compatibility`}));
  async function call(body, authenticated=true) {
    return fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',origin,...(authenticated?{cookie:cookies}:{})},body:JSON.stringify(body)});
  }
  const unauthenticated = await call({},false);
  assert.equal(unauthenticated.status,401,'plugin endpoint remains authenticated');
  const checks = [];
  for (const [query,mode,expected] of [['FIND_ALL_A_USER_001','title-body',['a']],['FIND_ALL_B_REPLY_001','title-body',['b']],['FIND_ALL_','title',['a','b']],['NOT_PRESENT_SYNTHETIC_NEEDLE','title-body',[]]]) {
    const requestId=randomUUID(), input={version:1,action:'start',requestId,query,mode,scope:'ordinary-unarchived',sessionIds:catalog.map(x=>x.id),catalog};
    const items=[]; let response=await call(input), result;
    for(let page=0;page<10;page++) {
      assert.equal(response.status,200,`search ${query}`); result=await response.json();
      assert.equal(result.failed,0); assert.equal(result.skipped,0); items.push(...result.items);
      if(result.complete) break;
      response=await call({...input,action:'next',cursor:result.cursor});
    }
    assert.equal(result.complete,true,'bounded fixture scan must complete');
    assert.deepEqual(items.map(item=>item.sessionId).sort(),expected.map(label=>`find-all-synthetic-${label}`).sort());
    if(mode==='title-body'&&items.length) {
      assert.equal(items[0].bodyMatch,true); assert.ok(items[0].snippet.includes(query));
      assert.ok(items[0].ranges.some(range=>items[0].snippet.slice(range.start,range.end)===query));
    }
    const cancelled=await call({version:1,action:'cancel',requestId});
    assert.equal(cancelled.status,200); assert.equal((await cancelled.json()).cancelled,true);
    checks.push({query,mode,matches:items.length,complete:true,failed:0,skipped:0});
  }
  return {status:'passed',authentication:'401 without cookie',checks,cancel:'passed',browser:'not-run'};
}
