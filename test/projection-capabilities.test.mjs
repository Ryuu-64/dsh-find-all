import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { JSDOM } from 'jsdom';
import { createProjector } from '../src/projection.js';
// The production build bundles this server renderer, while React remains external.
globalThis.require = createRequire(import.meta.url);
const ui = { MarkdownText({text}) { return React.createElement('div', null,
  text.startsWith('![') ? React.createElement('span',{className:'host-alt'},text.slice(2,text.indexOf(']'))) : text); } };
const user = {kind:'user',sourceKind:'user',raw:'@"private/path.txt"'};
test('missing user projector does not disable Markdown projection or claim raw text matches', () => {
  const document = new JSDOM('').window.document;
  const project = createProjector(ui,React,document);
  const missing = project(user);
  assert.deepEqual(missing.blocks,[]);
  assert.equal(missing.errors[0].code,'user-projection-unavailable');
  assert.deepEqual(project({kind:'assistant',format:'markdown',raw:'hello'}).blocks.map(b=>b.text),['hello']);
});
test('legacy host user projection retains its display semantics', () => {
  const project = createProjector({...ui,projectUserText:()=>React.createElement('span',null,'path.txt')},React,new JSDOM('').window.document);
  assert.deepEqual(project(user).blocks.map(b=>b.text),['path.txt']);
});
test('explicit asynchronous user projection preserves its errors and does not replace source text', async () => {
  let observed;
  const result={blocks:[{text:'path.txt',index:0}],mapping:'user',errors:[]};
  const project=createProjector(ui,React,new JSDOM('').window.document,async source=>{observed=source;return result;});
  assert.equal(await project(user),result);
  assert.equal(observed,user);
});

test('UTF-16 cross-span mapping validates default masked display and rejects reveal', async()=>{
 const {mapProjectedDocument,rangeForBlock,collectProjectedBlocks}=await import('../src/projection.js');
 const document=new JSDOM('<article><div>甲😀 <span>file.js</span> <span class="mask">MASKED</span></div></article>').window.document;
 const row=document.querySelector('article'),text='甲😀 file.js MASKED';
 const source={kind:'user',mapping:'user',seq:1,raw:'stored',blocks:[{text}]},node={data:{seq:1}};
 let mapped=mapProjectedDocument(source,node,[row]);assert(mapped.blocks);
 const start=text.indexOf('😀'),end=text.indexOf(' MASKED');assert.equal(rangeForBlock(mapped.blocks[0],start,end).toString(),'😀 file.js');
 document.querySelector('.mask').textContent='FAKE_SECRET';assert.equal(mapProjectedDocument(source,node,[row]).blocks,undefined);
 document.querySelector('.mask').textContent='MASKED';assert(mapProjectedDocument(source,node,[row]).blocks);
 document.querySelector('div').innerHTML='first<br>second';assert.deepEqual(collectProjectedBlocks(document.querySelector('div')).map(b=>b.text),['first','second']);
});

test('official modern inline chip and secret SVG icons do not split searchable text', async()=>{
 const {mapProjectedDocument,rangeForBlock,collectProjectedBlocks}=await import('../src/projection.js');
 const document=new JSDOM('<article><div>甲😀 <span data-secret><span>MASKED</span><button><svg aria-hidden="true"><path/></svg></button></span> <button data-ref-chip="file"><svg aria-hidden="true"><path/></svg>file.js</button></div></article>').window.document;
 const row=document.querySelector('article'), text='甲😀 MASKED file.js';
 const source={kind:'user',mapping:'user',userTextSemantics:'official-inline',seq:1,raw:'stored',blocks:[{text}]},node={data:{seq:1}};
 const mapped=mapProjectedDocument(source,node,[row]);assert(mapped.blocks);
 assert.equal(rangeForBlock(mapped.blocks[0],text.indexOf('😀'),text.length).toString(),'😀 MASKED file.js');
 assert.equal(mapProjectedDocument({...source,userTextSemantics:undefined},node,[row]).blocks,undefined);
 document.querySelector('div').innerHTML='before<br>after';
 assert.deepEqual(collectProjectedBlocks(document.querySelector('div'),undefined,undefined,{officialUserInline:true}).map(b=>b.text),['before','after']);
 document.querySelector('div').innerHTML='before<svg aria-hidden="true"><path/></svg>after';
 assert.deepEqual(collectProjectedBlocks(document.querySelector('div'),undefined,undefined,{officialUserInline:true}).map(b=>b.text),['before','after']);
});
