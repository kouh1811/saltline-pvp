import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

const DEFAULT_FEATURES={customization:true,generation:true,preview:true,equipment:true,inMatch:false};
const DEFAULT_LIMITS={perHour:6,cooldownMs:15000,timeoutMs:150000,concurrent:2};
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=message=>{throw Error(message);};
export function validateProvider(p){
 if(!p||!/^[a-zA-Z0-9_-]{1,40}$/.test(p.id)||typeof p.name!=='string'||p.name.trim().length<1||p.name.length>60)fail('接口编号或名称无效');
 let url;try{url=new URL(p.baseURL);}catch{fail('接口地址无效');}
 if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol))fail('接口地址应为不带凭据的 HTTPS 地址');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))fail('公网接口必须使用 HTTPS');
 if(!['responses','chat'].includes(p.protocol))fail('接口协议无效');
 if(typeof p.model!=='string'||!p.model.trim()||p.model.length>120)fail('模型名称无效');
}
export class ConfigStore{
 constructor({path,key=process.env.ADMIN_ENCRYPTION_KEY,env=process.env}={}){
  this.key=key?Buffer.from(key,'base64'):null;if(this.key&&this.key.length!==32)fail('ADMIN_ENCRYPTION_KEY 必须为32字节的Base64编码');
  this.env=env;if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY AUTOINCREMENT,document TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS auth(id INTEGER PRIMARY KEY CHECK(id=1),hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS verified(fingerprint TEXT PRIMARY KEY,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,document TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);`);
  if(!this.db.prepare('SELECT version FROM state WHERE id=1').get()){
   const providers=env.OPENAI_API_KEY?[{id:'environment',name:'服务器环境接口',baseURL:env.OPENAI_BASE_URL||'https://api.openai.com/v1',protocol:'responses',model:env.AVATAR_MODEL||'gpt-6.1-sol',keySource:'environment'}]:[];
   const initial={providers,activeProviderId:providers[0]?.id||null,features:DEFAULT_FEATURES,limits:{...DEFAULT_LIMITS,perHour:Number(env.AVATAR_REQUESTS_PER_HOUR)||6},retentionDays:30};
   const r=this.db.prepare('INSERT INTO versions(document,created) VALUES(?,?)').run(JSON.stringify(initial),Date.now());this.db.prepare('INSERT INTO state VALUES(1,?)').run(r.lastInsertRowid);
  }
  this.prune();
  // Aborted by a process restart, rather than remaining "running" forever.
  for(const row of this.db.prepare('SELECT id,document FROM jobs').all()){const j=JSON.parse(row.document);if(j.status==='running')this.recordJob({...j,status:'failed',error:'服务器重启，任务已结束',finishedAt:Date.now()});}
 }
 current(){const row=this.db.prepare('SELECT v.id,v.document FROM versions v JOIN state s ON s.version=v.id WHERE s.id=1').get();return{...JSON.parse(row.document),version:row.id};}
 secret(p){if(p.keySource==='environment')return this.env.OPENAI_API_KEY||'';if(!p.encryptedKey)return'';if(!this.key)fail('缺少配置加密主密钥');try{const [iv,tag,data]=p.encryptedKey.split('.').map(s=>Buffer.from(s,'base64'));const d=createDecipheriv('aes-256-gcm',this.key,iv);d.setAuthTag(tag);return Buffer.concat([d.update(data),d.final()]).toString();}catch{fail('配置密钥无法解密，请检查服务器主密钥');}}
 encrypt(value){if(!this.key)fail('请先配置服务器加密主密钥');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv),data=Buffer.concat([c.update(value,'utf8'),c.final()]);return[iv,c.getAuthTag(),data].map(b=>b.toString('base64')).join('.');}
 publicConfig(){const c=this.current();c.providers=c.providers.map(p=>({id:p.id,name:p.name,baseURL:p.baseURL,protocol:p.protocol,model:p.model,hasKey:!!(p.encryptedKey||p.keySource==='environment'&&this.env.OPENAI_API_KEY),keySource:p.keySource==='environment'?'environment':'stored'}));return c;}
 prepareProvider(input){validateProvider(input);const old=this.current().providers.find(p=>p.id===input.id);let apiKey=input.clearKey?'':typeof input.apiKey==='string'&&input.apiKey?input.apiKey:(old?this.secret(old):'');if(typeof apiKey!=='string'||apiKey.length>4000||/[\r\n]/.test(apiKey))fail('API Key 无效');return{id:input.id,name:input.name.trim(),baseURL:input.baseURL.replace(/\/+$/,''),protocol:input.protocol,model:input.model.trim(),apiKey};}
 fingerprint(p){return createHash('sha256').update(JSON.stringify([p.baseURL,p.protocol,p.model,p.apiKey])).digest('hex');}
 markTested(provider){this.db.prepare('INSERT OR REPLACE INTO verified VALUES(?,?)').run(this.fingerprint(provider),Date.now());}
 activeProvider(){const c=this.current(),p=c.providers.find(p=>p.id===c.activeProviderId);return p?{...p,apiKey:this.secret(p)}:null;}
 save(input,expectedVersion){
  const old=this.current();if(expectedVersion!==old.version)fail('配置版本已变化，请刷新后重试');
  if(!Array.isArray(input.providers)||input.providers.length>10||new Set(input.providers.map(p=>p.id)).size!==input.providers.length)fail('接口列表无效（最多10个，编号不可重复）');
  const prepared=input.providers.map(p=>this.prepareProvider(p));
  if(input.activeProviderId!==null&&!prepared.some(p=>p.id===input.activeProviderId))fail('请选择存在的当前接口');
  const active=prepared.find(p=>p.id===input.activeProviderId),previous=this.activeProvider();
  if(active&&(!active.apiKey||(!previous||this.fingerprint(previous)!==this.fingerprint(active))&&!this.db.prepare('SELECT 1 FROM verified WHERE fingerprint=?').get(this.fingerprint(active))))fail('请先成功测试角色生成，再启用这个接口');
  const features={};for(const name of Object.keys(DEFAULT_FEATURES)){if(typeof input.features?.[name]!=='boolean')fail('角色开关无效');features[name]=input.features[name];}
  const limits={};for(const [name,[min,max]]of Object.entries({perHour:[1,1000],cooldownMs:[0,3600000],timeoutMs:[5000,300000],concurrent:[1,10]})){const n=input.limits?.[name];if(!Number.isInteger(n)||n<min||n>max)fail('生成限制超出范围');limits[name]=n;}
  if(!Number.isInteger(input.retentionDays)||input.retentionDays<1||input.retentionDays>365)fail('记录保留天数应为1—365');
  const providers=prepared.map((p,i)=>{const source=input.providers[i],prev=old.providers.find(x=>x.id===p.id);const {apiKey,...rest}=p;if(!apiKey)return rest;if(!source.apiKey&&!source.clearKey&&prev?.keySource==='environment')return{...rest,keySource:'environment'};return{...rest,encryptedKey:this.encrypt(apiKey)};});
  const doc={providers,activeProviderId:input.activeProviderId,features,limits,retentionDays:input.retentionDays};this.commit(doc,'保存配置');this.prune();return this.publicConfig();
 }
 commit(doc,action){this.db.exec('BEGIN IMMEDIATE');try{const r=this.db.prepare('INSERT INTO versions(document,created) VALUES(?,?)').run(JSON.stringify(doc),Date.now());this.db.prepare('UPDATE state SET version=? WHERE id=1').run(r.lastInsertRowid);this.audit(action,'版本 '+r.lastInsertRowid);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 rollback(version,expectedVersion){if(this.current().version!==expectedVersion)fail('配置版本已变化，请刷新后重试');const row=this.db.prepare('SELECT document FROM versions WHERE id=?').get(version);if(!row)fail('找不到该配置版本');const doc=JSON.parse(row.document);for(const p of doc.providers)this.secret(p);this.commit(doc,'回退至版本 '+version);return this.publicConfig();}
 history(){return this.db.prepare('SELECT id AS version,created FROM versions ORDER BY id DESC LIMIT 30').all();}
 audit(action,detail=''){this.db.prepare('INSERT INTO audit(action,detail,created) VALUES(?,?,?)').run(action,detail,Date.now());}
 auditLog(){return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all();}
 passwordHash(){return this.db.prepare('SELECT hash FROM auth WHERE id=1').get()?.hash;}
 setPassword(hash){this.db.prepare('INSERT OR REPLACE INTO auth VALUES(1,?)').run(hash);}
 recordJob(j){const safe={id:j.id,prompt:j.prompt,status:j.status,startedAt:j.startedAt,finishedAt:j.finishedAt||null,asset:j.asset||null,error:j.error||null,provider:j.provider||'',model:j.model||'',test:!!j.test};this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?,?)').run(j.id,JSON.stringify(safe),j.startedAt);}
 job(id){const r=this.db.prepare('SELECT document FROM jobs WHERE id=?').get(id);return r?JSON.parse(r.document):null;}
 records(){return this.db.prepare('SELECT document FROM jobs ORDER BY created DESC LIMIT 100').all().map(r=>JSON.parse(r.document));}
 stats(){const jobs=this.db.prepare('SELECT document FROM jobs WHERE created>?').all(Date.now()-86400000).map(r=>JSON.parse(r.document)),complete=jobs.filter(j=>j.status!=='running'),ready=complete.filter(j=>j.status==='ready');return{total:jobs.length,completed:complete.length,success:ready.length,successRate:complete.length?Math.round(ready.length/complete.length*100):null,averageSeconds:ready.length?Math.round(ready.reduce((s,j)=>s+(j.finishedAt-j.startedAt)/1000,0)/ready.length*10)/10:null};}
 recordAsset(a){this.db.prepare('INSERT OR IGNORE INTO assets(id,name,description,created) VALUES(?,?,?,?)').run(a.id,a.name,a.description||'',Date.now());}
 isAssetDisabled(id){return !!this.db.prepare('SELECT disabled FROM assets WHERE id=?').get(id)?.disabled;}
 setAssetDisabled(id,disabled){const r=this.db.prepare('UPDATE assets SET disabled=? WHERE id=?').run(disabled?1:0,id);if(!r.changes)fail('找不到该角色');this.audit(disabled?'禁用角色':'启用角色',id);}
 assets(){return this.db.prepare('SELECT * FROM assets ORDER BY created DESC LIMIT 200').all();}
 prune(){const cutoff=Date.now()-this.current().retentionDays*86400000;this.db.prepare('DELETE FROM jobs WHERE created<?').run(cutoff);this.db.prepare('DELETE FROM audit WHERE created<?').run(cutoff);}
 close(){this.db.close();}
}
