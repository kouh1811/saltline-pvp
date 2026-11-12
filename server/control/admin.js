import {AdminAuth} from './auth.js';
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw Error('请使用 JSON 请求');const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>40000)throw Error('配置内容过大');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw Error('请求格式无效');}}
export class AdminController{
 constructor({store,avatars,rooms,sockets,onConfig,password,secure,trustProxy=false,fetchImpl=fetch}){Object.assign(this,{store,avatars,rooms,sockets,onConfig,trustProxy,fetchImpl});this.auth=new AdminAuth(store,{password,secure});}
 async handle(req,res,url){
  const path=url.pathname.slice('/api/admin'.length),method=req.method;
  try{
   if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return reply(res,403,{error:'请求来源无效'});}if(origin.host!==req.headers.host)return reply(res,403,{error:'不允许跨站管理请求'});}
   if(path==='/session'&&method==='GET'){const s=this.auth.session(req);return reply(res,200,{configured:this.auth.enabled,authenticated:!!s,csrf:s?.csrf});}
   if(!this.auth.enabled)return reply(res,503,{error:'管理后台未初始化：请在服务器设置至少12位 ADMIN_PASSWORD 和 ADMIN_ENCRYPTION_KEY'});
   if(path==='/login'&&method==='POST'){
    const data=await body(req);const ip=this.trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;
    const s=this.auth.login(data.password,ip);res.setHeader('set-cookie',this.auth.cookie(s.token,false,req.isHttps));this.store.audit('管理员登录');return reply(res,200,{csrf:s.csrf});
   }
   const session=this.auth.session(req);if(!session)return reply(res,401,{error:'请先登录管理后台'});
   if(method!=='GET'&&(req.headers['x-csrf-token']!==session.csrf))return reply(res,403,{error:'登录校验已失效，请刷新页面'});
   if(path==='/logout'&&method==='POST'){this.auth.logout(req);res.setHeader('set-cookie',this.auth.cookie('',true,req.isHttps));return reply(res,200,{ok:true});}
   if(path==='/config'&&method==='GET')return reply(res,200,this.store.publicConfig());
   if(path==='/overview'&&method==='GET')return reply(res,200,{online:this.sockets.size,rooms:this.rooms.size,running:this.avatars.active,stats:this.store.stats(),currentProvider:this.store.activeProvider()?.name||'未配置',configVersion:this.store.current().version});
   if(path==='/history'&&method==='GET')return reply(res,200,{versions:this.store.history(),audit:this.store.auditLog()});
   if(path==='/records'&&method==='GET')return reply(res,200,{records:this.store.records()});
   if(path==='/assets'&&method==='GET'){await this.avatars.indexAssets();return reply(res,200,{assets:this.store.assets()});}
   if(/^\/assets\/[a-f0-9]{32}$/.test(path)&&method==='GET'){try{return reply(res,200,{recipe:await this.avatars.asset(path.slice(8),true)});}catch{return reply(res,404,{error:'找不到该角色'});}}
   if(path.startsWith('/tests/')&&method==='GET'){const j=this.avatars.jobs.get(path.slice(7));if(!j?.test)return reply(res,404,{error:'找不到这个测试任务'});return reply(res,200,this.avatars.publicJob(j));}
   if(!['POST','PUT'].includes(method))return reply(res,404,{error:'找不到这个管理功能'});
   const data=await body(req);
   if(path==='/config'&&method==='PUT'){const c=this.store.save(data,data.version);this.onConfig();return reply(res,200,c);}
   if(path==='/rollback'&&method==='POST'){const c=this.store.rollback(data.targetVersion,data.version);this.onConfig();return reply(res,200,c);}
   if(path==='/password'&&method==='POST'){this.auth.changePassword(data.currentPassword,data.newPassword);res.setHeader('set-cookie',this.auth.cookie('',true,req.isHttps));return reply(res,200,{ok:true});}
   if(/^\/assets\/[a-f0-9]{32}$/.test(path)&&method==='POST'){if(typeof data.disabled!=='boolean')throw Error('角色状态无效');this.store.setAssetDisabled(path.slice(8),data.disabled);this.avatars.applyPolicy();return reply(res,200,{ok:true});}
   if(path==='/tests'&&method==='POST'){
    const p=this.store.prepareProvider(data.provider);if(!p.apiKey)throw Error('请填写 API Key');
    if(data.mode==='connection'){
     let r;try{r=await this.fetchImpl(p.baseURL+'/models',{headers:{authorization:'Bearer '+p.apiKey},signal:AbortSignal.timeout(10000)});}catch{return reply(res,400,{error:'连接失败或超时，请检查接口地址和网络'});}
     if(!r.ok)return reply(res,400,{error:'连通性检查失败（HTTP '+r.status+'），部分服务不提供模型列表，可继续测试角色生成'});
     this.store.audit('测试接口连通性',p.id);return reply(res,200,{ok:true,message:'模型列表可访问；请继续测试角色生成，确认模型与协议可用。'});
    }
    if(data.mode!=='generate'||typeof data.prompt!=='string'||data.prompt.trim().length<2||data.prompt.length>300)throw Error('请输入2—300字的测试描述');
    const job=this.avatars.enqueue(data.prompt.trim(),{provider:p,test:true,onReady:()=>{this.store.markTested(p);this.store.audit('角色生成测试通过',p.id);}});this.store.audit('开始接口生成测试',p.id);return reply(res,202,{id:job.id});
   }
   return reply(res,404,{error:'找不到这个管理功能'});
  }catch(e){return reply(res,e.status||400,{error:e.message||'操作失败，请重试'});}
 }
}
