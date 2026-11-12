import {randomBytes,createHash}from'node:crypto';import {mkdir,readFile,writeFile,stat}from'node:fs/promises';import {join}from'node:path';import {validate}from'../public/avatar/schema.mjs';import {createModelGenerator}from'./avatar-model.js';
const ID=/^[a-f0-9]{32}$/;
const response=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
export class AvatarService{
 constructor({generate,dataDir=new URL('./data/avatars/',import.meta.url),limits={},onEquip=()=>{}}={}){this.enabled=!!generate||!!process.env.OPENAI_API_KEY;this.generate=generate||createModelGenerator();this.dataDir=dataDir;this.onEquip=onEquip;this.limits={perHour:Number(process.env.AVATAR_REQUESTS_PER_HOUR)||6,cooldownMs:15000,timeoutMs:150000,concurrent:2,...limits};this.sessions=new Map();this.tokens=new Map();this.jobs=new Map();this.usage=new Map();this.assets=new Map();this.active=0;}
 register(id,ip){const token=randomBytes(24).toString('hex'),s={id,token,ip,equipped:null,job:null};this.sessions.set(id,s);this.tokens.set(token,s);return token;}
 unregister(id){const s=this.sessions.get(id);if(!s)return;this.tokens.delete(s.token);this.sessions.delete(id);for(const [id,job]of this.jobs)if(job.owner===s.id){job.controller.abort();this.jobs.delete(id);}}
 equipped(id){return this.sessions.get(id)?.equipped??null;}
 async asset(id){if(!ID.test(id))throw Error('角色不存在');if(this.assets.has(id))return this.assets.get(id);const path=typeof this.dataDir==='string'?join(this.dataDir,id+'.json'):new URL(id+'.json',this.dataDir);if((await stat(path)).size>180000)throw Error('资产过大');const recipe=JSON.parse(await readFile(path,'utf8'));validate(recipe);if(createHash('sha256').update(JSON.stringify(recipe)).digest('hex').slice(0,32)!==id)throw Error('角色资产损坏');this.assets.set(id,recipe);if(this.assets.size>100)this.assets.delete(this.assets.keys().next().value);return recipe;}
 async save(recipe){validate(recipe);const text=JSON.stringify(recipe);if(Buffer.byteLength(text)>180000)throw Error('结构超出大小限制');const id=createHash('sha256').update(text).digest('hex').slice(0,32);await mkdir(this.dataDir,{recursive:true});const path=typeof this.dataDir==='string'?join(this.dataDir,id+'.json'):new URL(id+'.json',this.dataDir);await writeFile(path,text,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});this.assets.set(id,recipe);if(this.assets.size>100)this.assets.delete(this.assets.keys().next().value);return{id,name:recipe.name,description:recipe.description||''};}
 async readBody(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw Error('描述过长');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 async handle(req,res,url){
  const path=url.pathname.replace('/api/avatars','');
  if(path.startsWith('/assets/')&&req.method==='GET'){try{const recipe=await this.asset(path.slice(8));res.setHeader('cache-control','public,max-age=31536000,immutable');res.writeHead(200,{'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});res.end(JSON.stringify({recipe}));}catch{response(res,404,{error:'角色不存在或已失效'});}return;}
  const session=this.tokens.get(req.headers.authorization?.replace(/^Bearer /,''));if(!session)return response(res,401,{error:'连接已失效，请刷新后重试'});
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return response(res,403,{error:'不允许跨站请求'});}catch{return response(res,403,{error:'不允许跨站请求'});}}
  if(path==='/config'&&req.method==='GET')return response(res,200,{enabled:this.enabled,maxPromptLength:300});
  if(path.startsWith('/jobs/')&&req.method==='GET'){const job=this.jobs.get(path.slice(6));if(!job||job.owner!==session.id)return response(res,404,{error:'找不到本次生成任务'});return response(res,200,{id:job.id,status:job.status,asset:job.asset,error:job.error,seconds:Math.round(((job.finishedAt||Date.now())-job.startedAt)/100)/10});}
  if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return response(res,405,{error:'请求方式无效'});
  let data;try{data=await this.readBody(req);if(!data||Array.isArray(data)||typeof data!=='object')throw Error();}catch{return response(res,400,{error:'输入格式无效或描述过长'});}
  if(path==='/equip'){
   if(Object.keys(data).some(k=>k!=='assetId')||!('assetId'in data)||data.assetId!==null&&(typeof data.assetId!=='string'||!ID.test(data.assetId)))return response(res,400,{error:'角色编号无效'});
   if(data.assetId!==null){try{await this.asset(data.assetId);}catch{return response(res,404,{error:'角色不存在，请重新生成'});}}
   session.equipped=data.assetId;this.onEquip(session.id,data.assetId);return response(res,200,{assetId:data.assetId});
  }
  if(path!=='/generate')return response(res,404,{error:'找不到这个功能'});
  if(Object.keys(data).some(k=>k!=='prompt')||typeof data.prompt!=='string'||data.prompt.trim().length<2||data.prompt.trim().length>300)return response(res,400,{error:'请输入 2—300 字的角色描述；当前仅支持文字'});
  if(!this.enabled)return response(res,503,{error:'服务器尚未开启 AI 角色生成，请联系房主配置'});
  const now=Date.now(),usage=(this.usage.get(session.ip)||[]).filter(at=>now-at<3600000);this.usage.set(session.ip,usage);
  if(session.job&&this.jobs.get(session.job)?.status==='running'||this.active>=this.limits.concurrent||usage.length>=this.limits.perHour||usage.length&&now-usage.at(-1)<this.limits.cooldownMs)return response(res,429,{error:'生成请求较多，请稍后再试'});
  usage.push(now);const id=randomBytes(16).toString('hex'),job={id,owner:session.id,status:'running',startedAt:now,controller:new AbortController()};this.jobs.set(id,job);session.job=id;this.active++;
  response(res,202,{id});void this.run(job,data.prompt.trim());
 }
 async run(job,prompt){
  let timer;try{const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('生成超时，请稍后重试'));job.controller.abort();},this.limits.timeoutMs);job.controller.signal.addEventListener('abort',()=>reject(Error('生成已取消')),{once:true});});
   const recipe=await Promise.race([this.generate(prompt,{signal:job.controller.signal}),timeout]);if(job.controller.signal.aborted||!this.sessions.has(job.owner))return;
   validate(recipe);job.asset=await this.save(recipe);if(job.controller.signal.aborted||!this.sessions.has(job.owner))return;job.status='ready';
  }catch(error){job.status='failed';job.error=/超时|暂|繁忙|检查|配置|取消/.test(error.message)?error.message:'生成结果未通过检查，请重试';}finally{clearTimeout(timer);job.finishedAt=Date.now();this.active--;}
 }
 close(){for(const job of this.jobs.values())if(job.status==='running')job.controller.abort();this.sessions.clear();this.tokens.clear();}
}
