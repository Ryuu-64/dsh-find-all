// Synthetic credential format mirrors official user-text-secret-mask.e2e.ts.
// No real credential, account, provider call or user history is used.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const projectionTitle = 'MODERN_PROJECTION synthetic compatibility';
export const fakeKey = ['sk', '-', '0123456789abcdef0123456789abcdef'].join('');
export async function seedModernProjection(runtimeRequire, home, workspace) {
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
  const {Session, SessionId, SESSION_FORMAT_VERSION} = await load('@deepseek-ai/dsh-session');
  const {createUserMessage,createAssistantMessage} = await load('@deepseek-ai/dsh-llm');
  const {Context} = await load('@deepseek-ai/cordis');
  const jsonl = await load('@deepseek-ai/dsh-session-persistence-jsonl');
  const ctx = new Context(), id = SessionId('find-all-modern-projection');
  fs.mkdirSync(workspace,{recursive:true});
  try {
    await ctx.plugin(jsonl.default ?? jsonl,{root:path.join(home,'.dsh','sessions')});
    const session = Session.create(id);
    for(let turn=1;turn<=2;turn++) {
      session.append('turn/start',{turn}); session.append('step/start',{turn,step:1});
      const user = session.append('user/message',createUserMessage({content:[{type:'text',text:`Projection ${turn}: @src/deep/compatibility-label.txt ${fakeKey} is the synthetic key.`}],source:{kind:'user'}}),{surfaceOp:'append'});
      if(turn===1)session.append('session/title',{title:projectionTitle,messageSeqs:[user.seq],source:{kind:'fallback'}});
      session.append('request/header',{header:{config:{provider:'deepseek-official',model:'deepseek-v4-flash'}},reason:turn===1?'initial':'change'});
      session.append('assistant/message',{stream:[],turn,step:1,message:createAssistantMessage({content:[{type:'text',text:`Projection reply ${turn}.`}],source:{provider:'deepseek-official',model:'deepseek-v4-flash'}}),usage:{inputTokens:1,outputTokens:1}},{surfaceOp:'append'});
      session.append('step/end',{turn,step:1}); session.append('turn/end',{turn,reason:{kind:'completed'}});
    }
    const handle=await ctx.sessionPersistence.create({version:SESSION_FORMAT_VERSION,id,createdAt:Date.now()-60_000,isSeeded:false,cwd:workspace,delegationDepth:0});
    await handle.append(session.snapshotEvents()); await handle.close();
    return {id,turns:2,synthetic:true};
  } finally {await ctx.fiber.dispose();}
}
