import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {ConfigStore} from './control/store.js';
import {AdminController} from './control/admin.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {Match} from './match.js';
import {AvatarService} from './avatars.js';
const root=new URL('../public/',import.meta.url);
const map=JSON.parse(await readFile(new URL('./map.json',import.meta.url),'utf8'));
export function createGameServer(options={}){
 const rooms=new Map();const sockets=new Map();
 const store=new ConfigStore({path:options.controlDbPath||(options.avatarDataDir?join(String(options.avatarDataDir),'control.sqlite'):fileURLToPath(new URL('./data/control.sqlite',import.meta.url))),key:options.controlKey,env:options.controlEnv||process.env});
 const avatars=new AvatarService({store,modelFetch:options.modelFetch,isPlaying:id=>[...rooms.values()].some(r=>r.phase==='playing'&&r.players.has(id)),generate:options.avatarGenerate,dataDir:options.avatarDataDir,limits:options.avatarLimits,onEquip:(id,assetId)=>{for(const room of rooms.values()){const p=room.players.get(id);if(p){p.avatarId=assetId;broadcast(room,room.snapshot(Date.now()));break;}}}});
 const onConfig=()=>{avatars.applyPolicy();for(const ws of sockets.values())send(ws,{type:'avatarConfig',config:avatars.config()});};
 const admin=new AdminController({store,avatars,rooms,sockets,onConfig,password:options.adminPassword,secure:options.adminSecure??process.env.ADMIN_COOKIE_SECURE==='1',trustProxy:process.env.TRUST_PROXY==='1',fetchImpl:options.modelFetch});
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/admin')){await admin.handle(req,res,url);return;}if(url.pathname.startsWith('/api/avatars')){await avatars.handle(req,res,url);return;}if(url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return;}
  const files={'/admin':'admin/index.html','/admin/':'admin/index.html','/admin/admin.js':'admin/admin.js','/admin/admin.css':'admin/admin.css','/admin/preview.js':'admin/preview.js','/vendor/three.js':'../node_modules/three/build/three.module.js','/avatar/schema.mjs':'avatar/schema.mjs','/avatar/renderer.mjs':'avatar/renderer.mjs','/avatar/editor.mjs':'avatar/editor.mjs','/avatar/avatar.css':'avatar/avatar.css','/':'index.html','/index.html':'index.html','/client.js':'client.js','/pvp.css':'pvp.css'};const file=files[url.pathname];if(!file){res.writeHead(404);res.end('Not found');return;}
  const body=await readFile(new URL(file,root));res.writeHead(200,{'content-type':/\.(js|mjs)$/.test(file)?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(body);
 }catch{res.writeHead(500);res.end('Server error');}});
 const wss=new WebSocketServer({server,path:'/ws',maxPayload:2048});
 const send=(ws,data)=>{if(ws.readyState===1&&ws.bufferedAmount<131072)ws.send(JSON.stringify(data));};
 const broadcast=(room,data)=>{for(const id of room.players.keys()){const ws=sockets.get(id);if(ws)send(ws,data);}};
 wss.on('connection',(ws,req)=>{
  const id=randomUUID();let room=null,count=0,windowAt=Date.now(),alive=true;sockets.set(id,ws);const avatarToken=avatars.register(id,process.env.TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress||'unknown');send(ws,{type:'hello',id,avatarToken});send(ws,{type:'avatarConfig',config:avatars.config()});
  ws.on('pong',()=>{alive=true;});ws.checkHeartbeat=()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();};
  ws.on('message',raw=>{const now=Date.now();if(now-windowAt>=1000){windowAt=now;count=0;}if(++count>120){ws.close(1008,'Rate limit');return;}
   try{const data=JSON.parse(raw);if(!data||typeof data!=='object')return;
    if(data.type==='ping'){send(ws,{type:'pong',sent:data.sent});return;}
    if(data.type==='create'||data.type==='join'){
     if(room)throw Error('已经在房间中');
     if(data.type==='create'){if(rooms.size>=100)throw Error('房间数量已达上限');let code;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));room=new Match(code,map);rooms.set(code,room);}
     else{room=rooms.get(String(data.code||'').trim().toUpperCase());if(!room)throw Error('找不到这个房间，请检查房间码');}
     try{room.join(id,data.name,now);room.players.get(id).avatarId=avatars.equipped(id);}catch(e){room=null;throw e;}
     send(ws,{type:'joined',id,code:room.code});broadcast(room,room.snapshot(now));return;
    }
    if(!room)return;
    if(data.type==='input')room.input(id,data,now);
    else if(data.type==='fire'){const event=room.fire(id,data.dir,now);if(event)broadcast(room,event);}
    else if(data.type==='reload')room.reload(id,now);
    else if(data.type==='start'){room.start(id,now);broadcast(room,room.snapshot(now));}
   }catch(e){send(ws,{type:'error',message:e instanceof SyntaxError?'无法识别的消息':e.message});}
  });
  ws.on('close',()=>{avatars.unregister(id);sockets.delete(id);if(room){room.leave(id);if(!room.players.size)rooms.delete(room.code);else broadcast(room,room.snapshot(Date.now()));}});
  ws.on('error',()=>{});
 });
 let last=performance.now(),frames=0;const timer=setInterval(()=>{const perf=performance.now(),dt=Math.min(.05,(perf-last)/1000);last=perf;const now=Date.now();frames++;for(const room of rooms.values()){room.tick(dt,now);if(frames%3===0)broadcast(room,room.snapshot(now));}},1000/60);
 const heartbeat=setInterval(()=>{for(const ws of wss.clients)ws.checkHeartbeat();},15000);
 const retentionTimer=setInterval(()=>store.prune(),300000);
 const close=async()=>{clearInterval(retentionTimer);await avatars.close();clearInterval(timer);clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));store.close();};
 return {server,rooms,close};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=createGameServer();const port=Number(process.env.PORT||18453);app.server.listen(port,'0.0.0.0',()=>console.log(`Saltline PVP: http://localhost:${port}`));for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.close().then(()=>process.exit(0)));}
