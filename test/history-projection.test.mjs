import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryReader} from '../src/history.js';
import {createSearchContentService} from '../src/search-content.js';
const user=(text,source={kind:'user'})=>({type:'user/message',surfaceOp:'append',data:{id:'m'+text,role:'user',content:[{type:'text',text}],source}});
const end=()=>({type:'turn/end',data:{turn:1}});
function reader(events,project,onUpdate,cut=2){
 const records=events.map((event,seq)=>({type:'event',event:{...event,seq,time:seq}}));
 return createHistoryReader({sessionId:'s',project,onUpdate,remote:{session:{
  async *follow(){yield {type:'snapshot',header:{id:'s'},cursor:records.length-1,records:records.slice(cut),hasMore:cut>0};},
  async page(){return {ok:true,value:{records:records.slice(0,cut),hasMore:false}};}
 }}});
}
test('facts cross page boundary but not turn boundary',async()=>{
 const seen=[];const r=reader([user('first'),user('recall',{kind:'session-reference',references:[{label:'A'}]}),user('skill',{kind:'skill-invocation',name:'demo'}),end(),user('next'),end()],s=>{seen.push(s);return {blocks:[{text:s.raw}],errors:[]};});
 const snap=await r.start();assert.equal(snap.readComplete,true);const [a,b]=seen.filter(s=>s.kind==='user');assert.deepEqual(a.userTextFacts,{sessionLabels:['A'],skillNames:['demo']});assert.deepEqual(b.userTextFacts,{sessionLabels:[],skillNames:[]});
});
test('projection failure preserves unrelated results as partial',async()=>{
 for(const mode of ['throw','identity','invalid']){
  const r=reader([user('bad'),user('good'),end()],s=>{if(s.raw==='bad'){if(mode==='throw')throw Error('private payload');if(mode==='invalid')return null;return {source:{...s,seq:99},blocks:[{text:'wrong'}]};}return {blocks:[{text:s.raw}],errors:[]};});
  const snap=await r.start();assert.equal(snap.status,'partial');assert.equal(snap.documents.find(x=>x.raw==='good').blocks[0].text,'good');assert.deepEqual(snap.documents.find(x=>x.raw==='bad').blocks,[]);assert(!JSON.stringify(snap.errors).includes('private payload'));
 }
});
test('cancelled projection cannot publish late output',async()=>{
 let resolve,entered;const ready=new Promise(r=>entered=r),updates=[];const r=reader([user('one')],()=>{entered();return new Promise(r=>resolve=r);},s=>updates.push(s),0);const running=r.start();await ready;r.cancel();const count=updates.length;resolve({blocks:[{text:'late'}],errors:[]});await running;assert.equal(updates.length,count);assert(!r.snapshot().documents.some(d=>d.blocks.some(b=>b.text==='late')));
});
test('search rules isolate history runs and reject identity patches',async()=>{
 let changes=0;const service=createSearchContentService(()=>changes++);const dispose=service.register('rule',()=>{let n=0;return()=>({raw:String(++n)});});const project=s=>({blocks:[{text:s.raw}],errors:[]});const source={id:'x',seq:1,kind:'user',raw:'hello'};const a=service.createProjector(project),b=service.createProjector(project);assert.equal((await a(source)).blocks[0].text,'1');assert.equal((await a(source)).blocks[0].text,'2');assert.equal((await b(source)).blocks[0].text,'1');dispose();assert.equal(changes,2);service.register('broken',()=>()=>({id:'other'}));assert.equal((await service.createProjector(project)(source)).errors[0].code,'search-content-rule-failed');
});
test('malformed reference facts cannot silently become plausible empty facts',async()=>{
 let seen;const r=reader([user('first'),user('badfacts',{kind:'session-reference',references:[{label:42}]}),end()],s=>{if(s.kind==='user')seen=s;return {blocks:[],errors:[]};});await r.start();assert.equal(seen.userTextFacts,null);
});
