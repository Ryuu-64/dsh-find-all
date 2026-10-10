import { toolPresentation, cardLabels } from "./tool-projection.js";
// Project one durable source at a time with the Host's public text renderer.
// Nothing is mounted: template.content is inert (no effects, images or network).
const BLOCK = new Set('ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DETAILS DIALOG DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL'.split(' '));
const imageAltClasses = new Set();
const SKIP = 'script,style,noscript,svg,[data-code-block-banner],[data-clock],.sr-only,.katex-mathml,[data-find-projection-chrome]';
export function collectProjectedBlocks(root) {
  const blocks = []; let text = '', segments = [];
  const flush = () => { if (segments.length) blocks.push({text,segments}); text='';segments=[]; };
  function visit(node, code = false) {
    if (node.nodeType === 3) { if(node.data) { segments.push({node,start:text.length,end:text.length+node.data.length});text+=node.data; } return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if(node.nodeType===1&&(node.tagName==='IMG'||[...node.classList].some(name=>imageAltClasses.has(name)))){
      flush();const description=node.tagName==='IMG'?(node.getAttribute('alt')||''):node.textContent;
      if(description)blocks.push({text:description,segments:[],imageDescription:true});return;
    }
    if (node.nodeType === 1 && (node.matches(SKIP) || node.tagName === 'BR')) { flush(); return; }
    const codeRoot = node.nodeType === 1 && node.hasAttribute('data-code-block-content');
    const boundary = !code && (BLOCK.has(node.tagName) || node.nodeType === 11 || codeRoot);
    if (boundary) flush();
    for (const child of node.childNodes) visit(child, code || codeRoot);
    if (boundary) flush();
  }
  visit(root);flush();return blocks;
}
export function rangeForBlock(block, start, end) {
  const first=block.segments.find(s=>start>=s.start&&start<s.end), last=block.segments.find(s=>end>s.start&&end<=s.end);
  if(!first||!last) return null;
  const range=first.node.ownerDocument.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);return range;
}
const labels = {code:{copyLabel:'',copiedLabel:'',toolbarLabels:{codeLabel:'',wrapLabel:'',unwrapLabel:''}},footnotes:''};
function readCard(source) {
  if(source.kind!=='tool-result'||source.toolName!=='read'||source.isSubcall||source.parentCallId||source.isError||source.contentCount!==1) return null;
  let args;try{args=JSON.parse(source.callArguments);}catch{return null;}
  if(!args||typeof args.file_path!=='string'||!args.file_path.trim()||['offset','limit'].some(k=>args[k]!==undefined&&(!Number.isInteger(args[k])||args[k]<1)))return null;
  const m=source.meta;if(!m||typeof m.path!=='string'||!Number.isInteger(m.offset)||m.offset<1||!Number.isInteger(m.totalLines)||m.totalLines<0||!Array.isArray(m.lines)||(m.lang!==undefined&&typeof m.lang!=='string'))return null;
  let prev=m.offset-1;
  for(const line of m.lines){if(!line||!Number.isInteger(line.number)||line.number<=prev||line.number>m.totalLines||typeof line.text!=='string')return null;prev=line.number;}
  if(!/^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.test(source.raw))return null;
  return m;
}
export function createProjector(ui, react, document) {
  if(!ui.MarkdownText||typeof ui.projectUserText!=='function'||!/^18\./u.test(react.version||''))throw Error('Host text projection unavailable');
  // Lazy initialization keeps legacy loaded-only mode usable with older hosts.
  const {renderToStaticMarkup}=require('react-dom/server.browser');
  function render(element) { const template=document.createElement('template');template.innerHTML=renderToStaticMarkup(element);return template.content; }
  // Resolve the image-alt class from this exact Host renderer rather than
  // assuming one bundler's CSS-module naming or indexing failure-label chrome.
  const probeText='dsh-find-alt-projection',probe=render(react.createElement(ui.MarkdownText,{text:'!['+probeText+'](./dsh-find-inert-probe.png)',labels}));
  const altLeaves=[...probe.querySelectorAll('span')].filter(el=>el.textContent===probeText&&!el.children.length);
  if(altLeaves.length!==1||!altLeaves[0].classList.length)throw Error('Host image description projection unavailable');
  imageAltClasses.clear();for(const name of altLeaves[0].classList)imageAltClasses.add(name);
  return function project(source) {
    if(typeof source.raw!=='string')return {blocks:[],errors:['missing-source-text']};
    const read=readCard(source);
    if(read)return {blocks:read.lines.map((line,i)=>({text:line.text,index:i,lineNumber:line.number})),mapping:'read',errors:[]};
    const presentation=toolPresentation(source);
    if(presentation){
      if(source.firstTextSource===false)return {blocks:[],mapping:"tool-card",cardKind:presentation.kind,errors:[]};
      const component={diff:ui.DiffBlock,search:ui.SearchBlock,terminal:ui.TerminalBlock}[presentation.kind];
      if(typeof component!=='function')return {blocks:[],errors:[{code:'tool-renderer-unavailable',message:'Host tool renderer unavailable'}]};
      const fragment=render(react.createElement(component,{...presentation.props,labels:cardLabels,maxLines:Infinity}));
      const root=fragment.firstElementChild;
      const blocks=root?collectToolBlocks(root,presentation.kind,source).map((b,index)=>({text:b.text,index})):[];
      const bodyExpected=presentation.kind==='diff'?presentation.props.diffs.some(d=>d.path||d.oldText||d.newText):presentation.kind==='search'?(presentation.props.paths?.length||presentation.props.files?.length):presentation.props.command.split('\n').some(line=>line.length>0)||!!root&&[...root.querySelectorAll('div')].some(el=>hasClassEnd(el,'_output')&&el.textContent.length>0);
      const errors=[...presentation.errors];
      if(bodyExpected&&!blocks.some(b=>b.text.length))errors.push({code:'tool-projection-empty',message:'A nonempty native tool body could not be projected'});
      if(presentation.recovery)blocks.push({text:presentation.recovery,index:blocks.length,storedField:true});
      return {blocks,mapping:'tool-card',cardKind:presentation.kind,errors};
    }
    if(source.contextBlocks)return {blocks:source.contextBlocks,mapping:'context',errors:source.contextErrors||[]};
    if(source.format==='markdown') {
      // The same component/parser handles GFM, CJK strong text, footnotes and
      // settled versus streaming mathematics. No summary whitespace folding.
      const isReasoning=source.kind==='reasoning'||source.contentType==='reasoning';
      const fragment=render(react.createElement(ui.MarkdownText,{text:source.raw,streaming:!!source.streaming,labels,variant:isReasoning?'compact':'body'}));
      const root=fragment.firstElementChild;
      if(!root)throw Error('Host renderer returned no text root');
      const blocks=collectProjectedBlocks(root).map((b,index)=>({text:b.text,index,...(b.imageDescription?{imageDescription:true}:{})}));
      // Images contribute only authored alt text, in independent description
      // blocks. They are not OCR and never acquire a fabricated DOM Range.
      return {blocks,mapping:'markdown',rootClass:root.classList[0],errors:[]};
    }
    if(source.kind==='user'&&source.sourceKind==='user') {
      const fragment=render(react.createElement('div',null,ui.projectUserText(source.raw,source.referenceLabels||[],source.skillNames||[],'skill')));
      return {blocks:collectProjectedBlocks(fragment).map((b,index)=>({text:b.text,index,...(b.imageDescription?{imageDescription:true}:{})})),mapping:'user',errors:[]};
    }
    // Stored tool fields remain searchable even when a custom renderer does
    // not expose the original field in Chat. Such hits must not jump by text.
    let text=source.raw;
    if(source.kind==='tool-call'){try{text=JSON.stringify(JSON.parse(source.raw),null,2);}catch{}}
    const knownTools=new Set(['read','read_image','write','edit','apply_patch','str_replace_editor','grep','glob','bash','pwsh','terminal_send','terminal_create','terminal_read','terminal_kill','exec_command','write_stdin','run_code']);
    const errors=source.hasUnknownToolPresentation&&!knownTools.has(source.toolName)?[{code:'custom-tool-projection-unverified',message:'Custom tool presentation contains unsupported text fields'}]:[];
    return {blocks:[{text,index:0}],mapping:source.kind==='tool-result'?'tool-field':'stored',errors};
  };
}

function hasClassEnd(element,suffix){
  // The official classic client uses hash_name; its Vite primitives use
  // _name_hash_line. The property is fixed here; no per-build hash is embedded.
  const vite=new RegExp('^'+suffix+'_[A-Za-z0-9]+_[0-9]+$','u');
  return [...element.classList].some(name=>name.endsWith(suffix)||vite.test(name));
}
function collectToolBlocks(root,kind,source){
  // Toolbar labels, state, prompts and counts are chrome. The first-party
  // cards have stable data-* roots; their body markup stays Host-owned.
  if(kind==='diff')return [...root.querySelectorAll('div')].filter(el=>hasClassEnd(el,'_line')).flatMap(el=>collectProjectedBlocks(el));
  if(kind==='terminal'){
    let authoredCommand=true;
    if(source?.toolName==='terminal_send'){try{authoredCommand=JSON.parse(source.callArguments).text!=='';}catch{}}
    return [...root.querySelectorAll('div,span')].filter(el=>authoredCommand&&el.tagName==='SPAN'&&hasClassEnd(el,'_command')||el.tagName==='DIV'&&hasClassEnd(el,'_line')).flatMap(el=>collectProjectedBlocks(el));
  }
  if(kind==='search'){
    const blocks=[];
    for(const element of root.querySelectorAll('div,span')){
      if(hasClassEnd(element,'_filePath'))blocks.push(...collectProjectedBlocks(element));
      else if(element.tagName==='DIV'&&hasClassEnd(element,'_line')){
        // Number prefixes remain part of the Host's independent result line.
        blocks.push(...collectProjectedBlocks(element));
      }
    }
    return blocks;
  }
  return [];
}

function sameBlocks(expected,actual) {return expected.length===actual.length&&expected.every((b,i)=>b.text===actual[i].text);}
function minimumCandidates(candidates) {return candidates.filter(x=>!candidates.some(y=>x!==y&&x.contains(y)));}
/** Resolve by durable node + content identity + whole renderer block sequence.
 * Query ordinals are never used to pick a different DOM text occurrence. */
export function mapProjectedDocument(source, node, rows) {
  if(source.transcriptVisible===false)return {reason:source.unavailableReason||'not-rendered'};
  if(source.mapping==='markdown') {
    const reasoning=source.kind==='reasoning'||source.contentType==='reasoning';
    const kind=reasoning?'reasoning':'text';
    const content=node.data?.blocks;
    if(!Array.isArray(content))return {reason:'node-content-unavailable'};
    const index=source.contentIndex;
    if(content[index]?.kind!==kind||content[index]?.text!==source.raw)return {reason:'source-changed'};
    const part=reasoning?'reasoning':'response';
    let scoped=rows.filter(row=>row.dataset.chatGroupPart===part);
    if(!scoped.length)scoped=rows.filter(row=>!row.dataset.chatGroupPart);
    const roots=[...new Set(scoped.flatMap(row=>[...row.getElementsByClassName(source.rootClass)]))];
    const expected=content.filter(b=>b.kind===kind);
    const ordinal=content.slice(0,index).filter(b=>b.kind===kind).length;
    if(roots.length!==expected.length)return {reason:'renderer-not-expanded'};
    const root=roots[ordinal],blocks=collectProjectedBlocks(root);
    const savedText=source.blocks.filter(b=>!b.imageDescription),actualText=blocks.filter(b=>!b.imageDescription);
    if(!sameBlocks(savedText,actualText))return {reason:'renderer-text-changed'};
    let position=0;return {blocks:source.blocks.map(b=>b.imageDescription?{text:b.text,segments:[]}:actualText[position++]),root};
  }
  if(source.mapping==='read') {
    const cards=[...new Set(rows.flatMap(row=>[...row.querySelectorAll('[data-read]')]))];
    if(cards.length!==1)return {reason:'read-card-unavailable'};
    const lines=[...cards[0].querySelectorAll('span[aria-hidden="true"]')].filter(e=>/^\d+$/u.test(e.textContent)&&e.nextElementSibling);
    if(lines.length!==source.blocks.length)return {reason:'read-lines-not-expanded'};
    const blocks=[];
    for(let i=0;i<lines.length;i++) {
      if(Number(lines[i].textContent)!==source.blocks[i].lineNumber)return {reason:'read-line-changed'};
      const actual=collectProjectedBlocks(lines[i].nextElementSibling);
      if(source.blocks[i].text===''&&actual.length===0){blocks.push({text:'',segments:[]});continue;}
      if(actual.length!==1||actual[0].text!==source.blocks[i].text)return {reason:'read-text-changed'};
      blocks.push(actual[0]);
    }
    return {blocks,root:cards[0]};
  }
  if(source.mapping==='context'){
    if(node.data?.seq!==source.seq||(source.isTurnTrigger&&node.kind!=='turn-trigger')||(!source.isTurnTrigger&&node.kind!=='context'))return {reason:'context-source-changed'};
    const mapped=[];
    for(const block of source.blocks){
      if(block.rendered===false){mapped.push({text:block.text,segments:[],unavailableReason:block.unavailableReason});continue;}
      const containers=[...new Set(rows.flatMap(row=>[...(row.matches?.(block.marker)?[row]:[]),...row.querySelectorAll(block.marker)]))];
      let element;
      if(block.marker==='[data-context-text]'||block.part==='tool-name'||block.part==='tool-names')element=containers[block.itemIndex];
      else if(block.marker==='[data-context-summary]'||block.marker==='[data-context-relay-sender]')element=containers.length===1?containers[0]:null;
      else if(containers.length===1){
        const item=containers[0].children[block.itemIndex];
        if(item){
          if(block.marker==='[data-context-sections]'||block.marker==='[data-context-fields]')element=item.querySelector(block.part==='name'||block.part==='key'?'dt':'dd');
          else if(block.marker==='[data-context-entries]')element=item.querySelector(block.part==='name'?'code':'span');
          else element=item.querySelector('span');
        }
      }
      if(!element)return {reason:'context-not-expanded'};
      const actual=collectProjectedBlocks(element);
      if(actual.length!==1){if(block.text===''&&!actual.length){mapped.push({text:'',segments:[]});continue;}return {reason:'context-field-changed'};}
      const visible=block.visibleChars===undefined?block.text.length:block.visibleChars;
      if(block.localized){
        const start=actual[0].text.indexOf(block.text);
        if(start<0||actual[0].text.indexOf(block.text,start+1)>=0)return {reason:'context-field-changed'};
        mapped.push({text:block.text,segments:actual[0].segments.map(s=>({...s,start:s.start-start,end:s.end-start}))});
      }else{
        const expected=block.text.slice(0,visible);
        if(visible===block.text.length?actual[0].text!==expected:!actual[0].text.startsWith(expected))return {reason:'context-field-changed'};
        mapped.push({...actual[0],text:block.text,visibleChars:visible});
      }
    }
    return {blocks:mapped};
  }
  if(source.mapping==='tool-card'){
    const roots=[...new Set(rows.flatMap(row=>[...row.querySelectorAll('[data-'+source.cardKind+']')]))];
    if(roots.length!==1)return {reason:'tool-card-not-expanded'};
    const actual=collectToolBlocks(roots[0],source.cardKind,source),expected=source.blocks.filter(b=>!b.storedField);
    if(!sameBlocks(expected,actual))return {reason:'tool-card-not-expanded'};
    return {blocks:source.blocks.map((b,i)=>b.storedField?{text:b.text,segments:[]}:actual[i]),root:roots[0]};
  }
  if(source.mapping==='tool-field'){
    // A generic first-party output is its explicit ioText field, not a text
    // occurrence selected anywhere inside a custom tool card.
    if(source.contentCount!==1||source.isSubcall)return {reason:'stored-field-not-rendered'};
    const candidates=[...new Set(rows.flatMap(row=>[...row.querySelectorAll('span')]))].filter(el=>hasClassEnd(el,'_ioText')&&el.textContent===source.raw);
    if(candidates.length!==1)return {reason:'tool-field-not-expanded'};
    const actual=collectProjectedBlocks(candidates[0]);
    return sameBlocks(source.blocks,actual)?{blocks:actual,root:candidates[0]}:{reason:'tool-field-changed'};
  }
  if(source.mapping==='user') {
    if(node.data?.seq!==source.seq)return {reason:'source-changed'};
    const candidates=minimumCandidates([...new Set(rows.flatMap(row=>[...row.querySelectorAll('div')]))].filter(el=>sameBlocks(source.blocks,collectProjectedBlocks(el))));
    if(candidates.length!==1)return {reason:'user-renderer-ambiguous'};
    return {blocks:collectProjectedBlocks(candidates[0]),root:candidates[0]};
  }
  return {reason:'stored-field-not-rendered'};
}
