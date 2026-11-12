import {randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validate} from '../public/avatar/schema.mjs';
import {createModelGenerator} from './avatar-model.js';
const ID=/^[a-f0-9]{32}$/;
const response=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
export class AvatarService{
 constructor({generate,dataDir=new URL('./data/avatars/',import.meta.url),limits={},onEquip=()=>{},store,modelFetch=fetch,isPlaying=()=>false}={}){
  this.generate=generate;this.store=store;this.modelFetch=modelFetch;this.dataDir=dataDir;this.onEquip=onEquip;this.isPlaying=isPlaying;this.limitOverrides=limits;this.sessions=new Map();this.tokens=new Map();this.jobs=new Map();this.usage=new Map();this.assets=new Map();this.active=0;this.running=new Set();
 }
 get limits(){return{perHour:6,cooldownMs:15000,timeoutMs:150000,concurrent:2,...this.store?.current().limits,...this.limitOverrides};}
 get enabled(){return !!this.generate||!!this.store?.activeProvider()?.apiKey||!this.store&&!!process.env.OPENAI_API_KEY;}
 config(){const f=this.store?.current().features||{customization:true,generation:true,preview:true,equipment:true,inMatch:false};return{...f,enabled:this.enabled&&f.customization&&f.generation,maxPromptLength:300};}
 register(id,ip){const token=randomBytes(24).toString('hex'),s={id,token,ip,equipped:null,job:null};this.sessions.set(id,s);this.tokens.set(token,s);return token;}
 rebind(id){const s=this.sessions.get(id);this.tokens.delete(s.token);s.token=randomBytes(24).toString('hex');this.tokens.set(s.token,s);return s.token;}
 unregister(id){const s=this.sessions.get(id);if(!s)return;this.tokens.delete(s.token);this.sessions.delete(id);for(const [id,job]of this.jobs)if(job.owner===s.id){job.controller.abort();this.jobs.delete(id);}}
 equipped(id){return this.sessions.get(id)?.equipped??null;}
 applyPolicy(){for(const s of this.sessions.values())if(s.equipped&&(!this.config().customization||this.store?.isAssetDisabled(s.equipped))){s.equipped=null;this.onEquip(s.id,null);}}
 file(id){return typeof this.dataDir==='string'?join(this.dataDir,id+'.json'):new URL(id+'.json',this.dataDir);}
 async indexAssets(){try{for(const name of await readdir(this.dataDir))if(/^[a-f0-9]{32}\.json$/.test(name)){const id=name.slice(0,-5);try{const recipe=await this.asset(id,true);this.store?.recordAsset({id,...recipe});}catch{}}}catch(e){if(e.code!=='ENOENT')throw e;}}
 async asset(id,admin=false){if(!ID.test(id)||!admin&&this.store?.isAssetDisabled(id))throw Error('角色不存在');if(this.assets.has(id))return this.assets.get(id);const path=this.file(id);if((await stat(path)).size>180000)throw Error('资产过大');const recipe=JSON.parse(await readFile(path,'utf8'));validate(recipe);if(createHash('sha256').update(JSON.stringify(recipe)).digest('hex').slice(0,32)!==id)throw Error('角色资产损坏');this.cache(id,recipe);return recipe;}
 cache(id,recipe){this.assets.set(id,recipe);if(this.assets.size>100)this.assets.delete(this.assets.keys().next().value);}
 async save(recipe){validate(recipe);const text=JSON.stringify(recipe);if(Buffer.byteLength(text)>180000)throw Error('结构超出大小限制');const id=createHash('sha256').update(text).digest('hex').slice(0,32);await mkdir(this.dataDir,{recursive:true});await writeFile(this.file(id),text,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});this.cache(id,recipe);const asset={id,name:recipe.name,description:recipe.description||''};this.store?.recordAsset(asset);return asset;}
 async readBody(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw Error('描述过长');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 async handle(req,res,url){
  const path=url.pathname.replace('/api/avatars','');
  if(path.startsWith('/assets/')&&req.method==='GET'){try{const recipe=await this.asset(path.slice(8));res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify({recipe}));}catch{response(res,404,{error:'角色不存在或已失效'});}return;}
  const session=this.tokens.get(req.headers.authorization?.replace(/^Bearer /,''));if(!session)return response(res,401,{error:'连接已失效，请刷新后重试'});
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return response(res,403,{error:'不允许跨站请求'});}catch{return response(res,403,{error:'不允许跨站请求'});}}
  if(path==='/config'&&req.method==='GET')return response(res,200,this.config());
  if(path.startsWith('/jobs/')&&req.method==='GET'){const job=this.jobs.get(path.slice(6));if(!job||job.owner!==session.id)return response(res,404,{error:'找不到本次生成任务'});return response(res,200,this.publicJob(job));}
  if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return response(res,405,{error:'请求方式无效'});
  let data;try{data=await this.readBody(req);if(!data||Array.isArray(data)||typeof data!=='object')throw Error();}catch{return response(res,400,{error:'输入格式无效或描述过长'});}
  const policy=this.config();
  if(path==='/equip'){
   if(Object.keys(data).some(k=>k!=='assetId')||!('assetId'in data)||data.assetId!==null&&(typeof data.assetId!=='string'||!ID.test(data.assetId)))return response(res,400,{error:'角色编号无效'});
   if(data.assetId!==null){if(!policy.customization||!policy.equipment||!policy.inMatch&&this.isPlaying(session.id))return response(res,403,{error:'当前不允许更换角色，请在大厅操作或联系管理员'});try{await this.asset(data.assetId);}catch{return response(res,404,{error:'角色不存在或已被禁用'});}}
   // Recheck after disk reads: a concurrent administrator change must win.
   if(data.assetId!==null&&(!this.config().customization||!this.config().equipment||!this.config().inMatch&&this.isPlaying(session.id)||this.store?.isAssetDisabled(data.assetId)))return response(res,403,{error:'角色设置已更新，请重新选择'});
   session.equipped=data.assetId;this.onEquip(session.id,data.assetId);return response(res,200,{assetId:data.assetId});
  }
  if(path!=='/generate')return response(res,404,{error:'找不到这个功能'});
  if(Object.keys(data).some(k=>k!=='prompt')||typeof data.prompt!=='string'||data.prompt.trim().length<2||data.prompt.trim().length>300)return response(res,400,{error:'请输入 2—300 字的角色描述；当前仅支持文字'});
  if(!policy.customization||!policy.generation||!policy.inMatch&&this.isPlaying(session.id))return response(res,403,{error:'当前不允许生成角色，请在大厅操作或联系管理员'});
  if(!this.enabled)return response(res,503,{error:'服务器尚未开启 AI 角色生成，请联系房主配置'});
  const now=Date.now();for(const [ip,times]of this.usage)if(now-times.at(-1)>3600000)this.usage.delete(ip);const usage=(this.usage.get(session.ip)||[]).filter(at=>now-at<3600000);this.usage.set(session.ip,usage);
  if(session.job&&this.jobs.get(session.job)?.status==='running'||this.active>=this.limits.concurrent||usage.length>=this.limits.perHour||usage.length&&now-usage.at(-1)<this.limits.cooldownMs)return response(res,429,{error:'生成请求较多，请稍后再试'});
  usage.push(now);const job=this.enqueue(data.prompt.trim(),{owner:session.id});session.job=job.id;response(res,202,{id:job.id});
 }
 publicJob(job){return{id:job.id,status:job.status,asset:job.asset,error:job.error,seconds:Math.round(((job.finishedAt||Date.now())-job.startedAt)/100)/10};}
 enqueue(prompt,{owner='admin',provider=this.store?.activeProvider(),test=false,onReady}={}){
  if(this.active>=this.limits.concurrent)throw Error('生成服务繁忙，请稍后再试');
  const generator=!test&&this.generate?this.generate:createModelGenerator({...provider,fetchImpl:this.modelFetch});
  const job={id:randomBytes(16).toString('hex'),owner,test,prompt,provider:provider?.name||'服务器接口',model:provider?.model||'',status:'running',startedAt:Date.now(),controller:new AbortController()};
  this.jobs.set(job.id,job);for(const [id,j]of this.jobs)if(j.status!=='running'&&Date.now()-j.startedAt>3600000)this.jobs.delete(id);
  this.active++;this.store?.recordJob(job);const run=this.run(job,generator,this.limits.timeoutMs,onReady);this.running.add(run);run.finally(()=>this.running.delete(run));return job;
 }
 async run(job,generator,timeoutMs,onReady){
  let timer;try{const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('生成超时，请稍后重试'));job.controller.abort();},timeoutMs);job.controller.signal.addEventListener('abort',()=>reject(Error('生成已取消')),{once:true});});
   const recipe=await Promise.race([generator(job.prompt,{signal:job.controller.signal}),timeout]);if(job.controller.signal.aborted||!job.test&&!this.sessions.has(job.owner))throw Error('生成已取消');
   validate(recipe);job.asset=await this.save(recipe);if(job.controller.signal.aborted||!job.test&&!this.sessions.has(job.owner))throw Error('生成已取消');job.status='ready';onReady?.();
  }catch(error){job.status='failed';job.error=/超时|暂|繁忙|检查|配置|取消|未完成/.test(error.message)?error.message:'生成结果未通过检查，请重试';}finally{clearTimeout(timer);job.finishedAt=Date.now();this.active--;this.store?.recordJob(job);}
 }
 async close(){for(const job of this.jobs.values())if(job.status==='running')job.controller.abort();this.sessions.clear();this.tokens.clear();await Promise.allSettled(this.running);}
}
