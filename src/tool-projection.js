// Runtime validators mirror the RC2 first-party tool-card eligibility contract.
// deepseek-harness 639ed015, ui-tool/models/{diff,search,terminal}-card-model.
// Only persisted presentation fields are read; no Host-only value imports.
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positive=x=>Number.isInteger(x)&&x>=1;
const escalation=a=>(a.sandbox_permissions===undefined&&a.justification===undefined)||(['workspace-write','danger-full-access'].includes(a.sandbox_permissions)&&typeof a.justification==='string'&&a.justification.trim()!=='');
function searchRecovery(raw,tool,meta){
  if(typeof raw!=='string'||!raw.endsWith(')'))return null;
  const boundary=raw.lastIndexOf('\n\n(');
  if(boundary<0)return null;
  const footer=raw.slice(boundary+2);
  if(tool==='glob'){
    const shown=/^\(Showing (\d+) of (\d+) paths(?:[.,]|\s)/u.exec(footer);
    return shown&&Number(shown[2])===meta.total?footer:null;
  }
  return /^\((?:Full grep result stored at: |The complete result could not be saved;)/u.test(footer)?footer:null;
}
export const cardLabels={copy:'',copied:'',codeLabel:'',wrapLabel:'',unwrapLabel:'',expand:()=>'',expandAria:()=>'',collapse:'',collapseAria:'',window:()=>'',pathsSummary:()=>'',matchesSummary:()=>'',noResults:'',running:'',failed:'',done:'',exitCode:(code)=>String(code),signal:(signal)=>String(signal),noExitCode:'',noOutput:''};
function includeValid(s){if(typeof s!=='string'||!s.trim()||s.startsWith('!'))return false;let depth=0;for(const c of s){if(c==='{')depth++;else if(c==='}')depth=Math.max(0,depth-1);else if(c===','&&!depth)return false;}return true;}
export function toolPresentation(source){
  if(source.kind!=='tool-result')return null;
  let a;try{a=JSON.parse(source.callArguments);}catch{return null;}if(!record(a))return null;
  const n=source.toolName,m=source.meta,root=!source.isSubcall&&!source.parentCallId;
  if(root&&!source.isError&&['write','edit'].includes(n)){
    if(typeof a.file_path!=='string'||!a.file_path.trim()||!escalation(a))return null;
    let intended;
    if(n==='write'){if(typeof a.content!=='string')return null;intended={path:a.file_path,oldText:null,newText:a.content};}
    else {if(typeof a.old_string!=='string'||typeof a.new_string!=='string'||(a.replace_all!==undefined&&typeof a.replace_all!=='boolean'))return null;intended={path:a.file_path,oldText:a.old_string||null,newText:a.new_string};}
    let diffs=record(m)&&Array.isArray(m.diffs)&&m.diffs.every(d=>record(d)&&typeof d.path==='string'&&(d.oldText===null||typeof d.oldText==='string')&&typeof d.newText==='string')?m.diffs:null;
    if(!diffs?.length)diffs=n==='write'?[intended]:null;
    return diffs?{kind:'diff',props:{diffs},errors:[]}:null;
  }
  if(root&&!source.isError&&['grep','glob'].includes(n)){
    if(typeof a.pattern!=='string'||(n==='grep'?!a.pattern:!a.pattern.trim())||(a.path!==undefined&&(typeof a.path!=='string'||!a.path.trim()))||(n==='grep'&&a.include!==undefined&&!includeValid(a.include)))return null;
    if(!record(m)||typeof m.truncated!=='boolean'||!Number.isInteger(m.total)||m.total<0)return null;
    const common={truncated:m.truncated,total:m.total};
    let props;
    if(n==='grep'&&m.shape==='matches'&&Array.isArray(m.files)&&m.files.every(f=>record(f)&&typeof f.path==='string'&&Array.isArray(f.matches)&&f.matches.every(v=>record(v)&&positive(v.lineNumber)&&typeof v.line==='string')))props={kind:'matches',files:m.files,...common};
    if(n==='glob'&&m.shape==='paths'&&Array.isArray(m.paths)&&m.paths.every(p=>typeof p==='string'))props={kind:'paths',paths:m.paths,...common};
    const recovery=props&&m.truncated?searchRecovery(source.resultText??source.raw,n,m):null;
    return props?{kind:'search',props,errors:m.truncated?[{code:'truncated-tool-output',message:'The saved search result explicitly omits matches'}]:[],recovery}:null;
  }
  if(!source.isError&&source.contentCount===1&&['bash','pwsh','terminal_send'].includes(n)){
    if(a.run_in_background===true||/ Full formatted result stored at: /u.test(source.raw))return null;
    let command;
    if(n==='terminal_send'){
      if(typeof a.sessionId!=='string'||!a.sessionId||typeof a.text!=='string'||(a.submit!==undefined&&typeof a.submit!=='boolean')||(a.run_in_background!==undefined&&typeof a.run_in_background!=='boolean'))return null;
      command=a.text;
    }else{
      if(typeof a.command!=='string'||!a.command.trim()||typeof a.description!=='string'||!a.description.trim()||!escalation(a)||(a.workdir!==undefined&&typeof a.workdir!=='string')||(a.timeoutMs!==undefined&&(typeof a.timeoutMs!=='number'||!Number.isFinite(a.timeoutMs)||a.timeoutMs<=0))||(a.run_in_background!==undefined&&typeof a.run_in_background!=='boolean'))return null;
      command=a.command;
    }
    let output=source.raw,exitCode,signal;
    if(n!=='terminal_send'){
      const killed=/\n\[killed by signal: ([^\]\n]+)\]$/u.exec(output),exited=/\n\[exit code: (\d+)\]$/u.exec(output);
      if(killed){signal=killed[1];output=output.slice(0,killed.index);}
      else if(exited){exitCode=Number(exited[1]);output=output.slice(0,exited.index);}
      else exitCode=0;
    }
    return {kind:'terminal',props:{command,output,exitCode,signal,running:false},errors:[]};
  }
  return null;
}
