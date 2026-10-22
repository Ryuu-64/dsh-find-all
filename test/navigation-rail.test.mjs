import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const code=readFileSync(new URL('../src/client.js',import.meta.url),'utf8');
const start=code.indexOf('function activateLoadedTurn('), end=code.indexOf('function domSignature(',start);
const activate=vm.runInNewContext(`(${code.slice(start,end).trim()})`,{visible:el=>el.getAttribute('data-visible')!=='false'});
function fixture(rail){
 const doc=new JSDOM(`<section><main><div><article><div data-chat-anchor-key="row" data-chat-node-key="row" data-chat-turn="1"></div></article></div></main>${rail}</section>`).window.document;
 return {doc,target:{root:doc.querySelector('article'),panel:doc.querySelector('section')},store:{get:key=>key==='row'}};
}
test('narrow official rail with no mounted marks allows existing exact absent-control fallback',()=>{
 const {target,store}=fixture('<nav aria-label="Turn navigation" data-visible="false"><div><div style="height:32px"></div></div></nav>');
 assert.equal(activate(target,store,'1',true),null);
 assert.equal(activate(target,store,'1',false),false);
});
test('hidden mounted control and unknown hidden button still block handoff',()=>{
 for(const button of ['<button data-index="0" aria-label="Jump to turn 1"></button>','<button>unknown</button>']){
  const {doc,target,store}=fixture(`<nav aria-label="Turn navigation" data-visible="false">${button}</nav>`);
  doc.querySelector('button').onclick=()=>assert.fail('hidden controls must never be invoked');
  assert.equal(activate(target,store,'1',true),false);
 }
});
test('usable exact loaded control is invoked, disabled and ambiguous rails are not',()=>{
 const {doc,target,store}=fixture('<nav aria-label="Turn navigation"><button data-index="0" aria-label="Jump to turn 1"></button></nav>');
 let clicks=0;const button=doc.querySelector('button');button.onclick=()=>clicks++;
 assert.equal(activate(target,store,'1',true),true);assert.equal(clicks,1);
 button.disabled=true;assert.equal(activate(target,store,'1',true),false);assert.equal(clicks,1);
 doc.querySelector('section').append(doc.querySelector('nav').cloneNode(true));
 assert.equal(activate(target,store,'1',true),false);assert.equal(clicks,1);
});
test('visible rail without exact mounted control retains absent-control fallback',()=>{
 const {target,store}=fixture('<nav aria-label="Turn navigation"><button data-index="1" aria-label="Jump to turn 2"></button></nav>');
 assert.equal(activate(target,store,'1',true),null);
});
