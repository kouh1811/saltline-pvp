import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import WebSocket from 'ws';
import {createGameServer} from '../server/index.js';
const password='Local-admin-password-42!',recipe={version:2,name:'后台测试角色',nodes:[{id:'body',parent:null,shape:'ellipsoid',pos:[0,1,0],size:[.6,1.6,.5],color:'#88aaff'}],details:[]};
async function fixture(run,options={}){const dir=await mkdtemp(join(tmpdir(),'saltline-admin-')),app=createGameServer({avatarDataDir:dir,controlKey:randomBytes(32).toString('base64'),adminPassword:password,avatarGenerate:async()=>recipe,modelFetch:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(recipe)}]}]})}) ,...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;try{await run(base,app);}finally{await app.close();await rm(dir,{recursive:true,force:true});}}
async function login(base){const r=await fetch(base+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});assert.equal(r.status,200);const {csrf}=await r.json();return{cookie:r.headers.get('set-cookie').split(';')[0],'x-csrf-token':csrf,'content-type':'application/json'};}
const api=(base,headers,path,body,method='POST')=>fetch(base+'/api/admin'+path,{method:body===undefined?'GET':method,headers,body:body===undefined?undefined:JSON.stringify(body)});
async function wsclient(base){const ws=new WebSocket(base.replace('http','ws')+'/ws'),messages=[];ws.on('message',v=>messages.push(JSON.parse(v)));await new Promise(r=>ws.once('open',r));const wait=async(type,predicate=()=>true)=>{for(let i=0;i<250;i++){const n=messages.findIndex(m=>m.type===type&&predicate(m));if(n>=0)return messages.splice(n,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+type);};return{ws,hello:await wait('hello'),wait,send:v=>ws.send(JSON.stringify(v))};}
async function playerApi(base,a,path,body){return fetch(base+'/api/avatars'+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+a.hello.avatarToken},body:JSON.stringify(body)});}
test('admin authentication, CSRF, masked config, password change and logout',()=>fixture(async base=>{
 assert.equal((await api(base,{},'/config')).status,401);const h=await login(base);const config=await(await api(base,h,'/config')).json();assert.equal(config.features.preview,true);
 assert.equal((await api(base,{cookie:h.cookie,'content-type':'application/json'},'/config',config,'PUT')).status,403);
 assert.equal((await api(base,{...h,origin:'https://evil.test'},'/config',config,'PUT')).status,403);
 assert.equal((await api(base,h,'/password',{currentPassword:password,newPassword:'New-password-123456!'})).status,200);assert.equal((await api(base,h,'/config')).status,401);
 const r=await fetch(base+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'New-password-123456!'})});assert.equal(r.status,200);
}));
test('runtime switches sync to two clients and asset disable forces default; restart-safe records',()=>fixture(async(base,app)=>{
 const h=await login(base),a=await wsclient(base),b=await wsclient(base);a.send({type:'create',name:'A'});const joined=await a.wait('joined');b.send({type:'join',name:'B',code:joined.code});await b.wait('joined');
 const {id}=await(await playerApi(base,a,'/generate',{prompt:'蓝色机器人'})).json();let record;for(let i=0;i<100;i++){record=(await(await api(base,h,'/records')).json()).records.find(x=>x.id===id);if(record?.status==='ready')break;await new Promise(r=>setTimeout(r,10));}assert.equal(record.status,'ready');const asset=record.asset.id;assert.equal((await playerApi(base,a,'/equip',{assetId:asset})).status,200);await b.wait('state',s=>s.players.some(p=>p.avatarId===asset));
 let c=await(await api(base,h,'/config')).json();c.features.preview=false;assert.equal((await api(base,h,'/config',c,'PUT')).status,200);await a.wait('avatarConfig',m=>m.config.preview===false);await b.wait('avatarConfig',m=>m.config.preview===false);
 assert.equal((await api(base,h,'/assets/'+asset,{disabled:true})).status,200);await b.wait('state',s=>s.players.every(p=>p.avatarId===null));assert.equal((await playerApi(base,a,'/equip',{assetId:asset})).status,404);
 c=await(await api(base,h,'/config')).json();c.features.customization=false;await api(base,h,'/config',c,'PUT');assert.equal((await playerApi(base,a,'/generate',{prompt:'新角色'})).status,403);assert.equal((await playerApi(base,a,'/equip',{assetId:asset})).status,403);assert.equal((await playerApi(base,a,'/equip',{assetId:null})).status,200);a.ws.close();b.ws.close();
}));
test('untested provider cannot activate; generation test authorizes activation without leaking keys',()=>fixture(async base=>{
 const h=await login(base),c=await(await api(base,h,'/config')).json(),p={id:'new-provider',name:'测试服务',baseURL:'https://example.test/v1',protocol:'responses',model:'model-test',apiKey:'private-admin-api-key'};c.providers.push(p);c.activeProviderId=p.id;assert.equal((await api(base,h,'/config',c,'PUT')).status,400);
 const r=await api(base,h,'/tests',{provider:p,mode:'generate',prompt:'机械角色'});assert.equal(r.status,202);const {id}=await r.json();let j;for(let i=0;i<100;i++){j=await(await api(base,h,'/tests/'+id)).json();if(j.status==='ready')break;await new Promise(r=>setTimeout(r,10));}assert.equal(j.status,'ready');const saved=await api(base,h,'/config',c,'PUT');assert.equal(saved.status,200);assert.ok(!(await saved.text()).includes(p.apiKey));const log=await(await api(base,h,'/records')).text();assert.ok(!log.includes(p.apiKey));
}));
test('in-match generation/equip blocked server-side; default is always allowed',()=>fixture(async base=>{
 const h=await login(base),a=await wsclient(base),b=await wsclient(base);a.send({type:'create',name:'A'});const joined=await a.wait('joined');b.send({type:'join',code:joined.code,name:'B'});await b.wait('joined');a.send({type:'start'});await a.wait('state',s=>s.phase==='preparing');await playerApi(base,a,'/equip',{assetId:null});await a.wait('state',s=>s.phase==='playing');assert.equal((await playerApi(base,a,'/generate',{prompt:'角色'})).status,403);assert.equal((await playerApi(base,a,'/equip',{assetId:'a'.repeat(32)})).status,403);assert.equal((await playerApi(base,a,'/equip',{assetId:null})).status,200);a.ws.close();b.ws.close();
}));
test('login rate limit and unconfigured admin fail closed',async()=>{
 await fixture(async base=>{for(let i=0;i<5;i++){const r=await api(base,{'content-type':'application/json'},'/login',{password:'wrong'});assert.equal(r.status,401,await r.text());}assert.equal((await api(base,{'content-type':'application/json'},'/login',{password})).status,429);});
 await fixture(async base=>{assert.equal((await(await api(base,{},'/session')).json()).configured,false);assert.equal((await api(base,{'content-type':'application/json'},'/login',{password})).status,503);},{controlKey:null});
});
test('running generation retains old provider while subsequent tasks use saved provider',async()=>{
 let release;const calls=[];const modelFetch=async(url,o)=>{const body=JSON.parse(o.body);calls.push({url,model:body.model});if(body.input==='老任务角色')await new Promise(r=>release=r);return{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(recipe)}]}]})};};
 await fixture(async base=>{
  const h=await login(base),a=await wsclient(base);const old=await(await playerApi(base,a,'/generate',{prompt:'老任务角色'})).json();
  const p={id:'next',name:'新接口',baseURL:'https://new.test/v1',protocol:'responses',model:'new-model',apiKey:'new-secret'};const {id}=await(await api(base,h,'/tests',{provider:p,mode:'generate',prompt:'测试新接口'})).json();for(let i=0;i<100;i++){if((await(await api(base,h,'/tests/'+id)).json()).status==='ready')break;await new Promise(r=>setTimeout(r,10));}
  const c=await(await api(base,h,'/config')).json();c.providers.push(p);c.activeProviderId='next';c.limits.cooldownMs=0;assert.equal((await api(base,h,'/config',c,'PUT')).status,200);release();
  for(let i=0;i<100;i++){const rows=(await(await api(base,h,'/records')).json()).records;const oldJob=rows.find(x=>x.id===old.id);if(oldJob?.status==='ready'){assert.equal(oldJob.model,'old-model');break;}if(i===99)assert.fail('old job did not finish');await new Promise(r=>setTimeout(r,10));}
  // 同一局成功后不能再次生成，改由另一位玩家验证新接口。
  const b=await wsclient(base);try{assert.equal((await playerApi(base,b,'/generate',{prompt:'新任务角色'})).status,202);assert.equal(calls[0].model,'old-model');assert.equal(calls.at(-1).url,'https://new.test/v1/responses');}finally{a.ws.close();b.ws.close();}
 },{avatarGenerate:undefined,controlEnv:{OPENAI_API_KEY:'old-secret',OPENAI_BASE_URL:'https://old.test/v1',AVATAR_MODEL:'old-model'},modelFetch});
});

for(const protocol of ['responses','chat'])test('保存并启用自定义 '+protocol+' 接口后玩家生成采用保存参数且不回显密钥',()=>{
 const requests=[],secret='provider-test-only-secret';
 const modelFetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body),authorization:options.headers.authorization});return{ok:true,json:async()=>protocol==='chat'?{choices:[{finish_reason:'stop',message:{content:JSON.stringify(recipe)}}]}:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(recipe)}]}]}};};
 return fixture(async base=>{
  const h=await login(base),p={id:'custom-'+protocol,name:'自定义服务',baseURL:'https://custom.example.test/ai/v1',protocol,model:'saved-'+protocol+'-model',apiKey:secret};
  const started=await api(base,h,'/tests',{provider:p,mode:'generate',prompt:'测试机器人'});assert.equal(started.status,202);const {id}=await started.json();
  let job;for(let i=0;i<100;i++){job=await(await api(base,h,'/tests/'+id)).json();if(job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}assert.equal(job.status,'ready');
  const c=await(await api(base,h,'/config')).json();const saved=await api(base,h,'/config',{...c,providers:[p],activeProviderId:p.id},'PUT');assert.equal(saved.status,200);const publicConfig=await saved.text();assert.ok(!publicConfig.includes(secret));assert.ok(!publicConfig.includes('encryptedKey'));
  const a=await wsclient(base);try{
   a.send({type:'create',name:'参数验证玩家'});await a.wait('joined');
   const response=await playerApi(base,a,'/generate',{prompt:'玩家机器人'});assert.equal(response.status,202);const playerJob=await response.json();
   let record;for(let i=0;i<100;i++){record=(await(await api(base,h,'/records')).json()).records.find(x=>x.id===playerJob.id);if(record?.status!=='running')break;await new Promise(r=>setTimeout(r,10));}assert.equal(record.status,'ready');
   const request=requests.find(r=>protocol==='chat'?r.body.messages?.at(-1).content==='玩家机器人':r.body.input==='玩家机器人');
   assert.ok(request);assert.equal(request.url,p.baseURL+(protocol==='chat'?'/chat/completions':'/responses'));assert.equal(request.body.model,p.model);assert.equal(request.authorization,'Bearer '+secret);
   for(const path of ['/config','/records','/assets'])assert.ok(!(await(await api(base,h,path)).text()).includes(secret));
   const status=await fetch(base+'/api/avatars/jobs/'+playerJob.id,{headers:{authorization:'Bearer '+a.hello.avatarToken}});assert.ok(!(await status.text()).includes(secret));assert.ok(!JSON.stringify(a.hello).includes(secret));
  }finally{a.ws.close();}
 },{avatarGenerate:undefined,controlEnv:{},modelFetch});
});
