import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createGameServer} from '../server/index.js';
async function connect(url){const ws=new WebSocket(url),queue=[];let wake,hello;ws.on('message',r=>{const data=JSON.parse(r);if(data.type==='hello')hello=data;queue.push(data);wake?.();});await new Promise(r=>ws.on('open',r));return {ws,get hello(){return hello;},send:d=>ws.send(JSON.stringify(d)),async wait(type,predicate=()=>true){const until=Date.now()+4000;while(Date.now()<until){const i=queue.findIndex(x=>x.type===type&&predicate(x));if(i>=0)return queue.splice(i,1)[0];await new Promise(r=>{const timeout=setTimeout(r,100);wake=()=>{clearTimeout(timeout);r();};});}throw Error('timeout '+type);}};}

async function defaults(url,...clients){for(const c of clients){const r=await fetch(url.replace('ws:','http:').replace('/ws','/api/avatars/equip'),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.hello.avatarToken},body:JSON.stringify({assetId:null})});assert.equal(r.status,200);}await clients[0].wait('state',s=>s.phase==='playing'&&clients.every(c=>s.players.find(p=>p.id===c.hello.id)?.entered));}
test('real sockets: create, join, start, movement, room isolation and disconnect',async()=>{
 const app=createGameServer({controlDbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try{const a=await connect(url),b=await connect(url),c=await connect(url);a.send({type:'create',name:'Alice'});const joined=await a.wait('joined');b.send({type:'join',code:joined.code,name:'Bob'});await b.wait('joined');const state=await a.wait('state',s=>s.players.length===2);assert.equal(state.players.length,2);
 c.send({type:'create',name:'Other'});const other=await c.wait('joined');assert.notEqual(other.code,joined.code);
 a.send({type:'start'});await a.wait('state',s=>s.phase==='preparing');await defaults(url,a,b);const initial=await a.wait('state',s=>s.phase==='playing'&&s.players.every(p=>p.entered));assert.equal(initial.players.length,2);assert.equal((await c.wait('state')).players.length,1);
 const me=initial.players.find(p=>p.id===joined.id);a.send({type:'input',move:[1,0],yaw:0,pitch:0});const moved=await b.wait('state',s=>s.phase==='playing'&&Math.abs(s.players.find(p=>p.id===joined.id).pos[0]-me.pos[0])>.03);assert.ok(moved.players.every(p=>p.health===100));
 b.send({type:'leave'});await a.wait('state',s=>s.players.length===1);b.ws.close();a.ws.close();c.ws.close();
 }finally{await app.close();}
});
test('real sockets: authoritative kill, three-second respawn, expiry and rematch',async()=>{
 const app=createGameServer({controlDbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try{const a=await connect(url),b=await connect(url);a.send({type:'create',name:'A'});const joined=await a.wait('joined');b.send({type:'join',code:joined.code,name:'B'});const bj=await b.wait('joined');a.send({type:'start'});await a.wait('state',s=>s.phase==='preparing');await defaults(url,a,b);await a.wait('state',s=>s.phase==='playing'&&s.players.every(p=>p.entered));const room=app.rooms.get(joined.code);room.map.boxes=[];
 const pa=room.players.get(joined.id),pb=room.players.get(bj.id);pa.pos=[0,0,0];pb.pos=[5,0,0];pa.protectedUntil=pb.protectedUntil=0;
 for(let i=0;i<4;i++){pa.lastShot=-Infinity;a.send({type:'fire',dir:[1,0,0]});const shot=await b.wait('shot');assert.equal(shot.target,bj.id);assert.equal(shot.killed,i===3);}
 const killed=await b.wait('state',s=>s.players.find(p=>p.id===bj.id).entered&&!s.players.find(p=>p.id===bj.id).alive);assert.equal(killed.players.find(p=>p.id===joined.id).kills,1);
 const reborn=await b.wait('state',s=>s.players.find(p=>p.id===bj.id).alive&&s.players.find(p=>p.id===bj.id).spawnSerial>killed.players.find(p=>p.id===bj.id).spawnSerial);const p=reborn.players.find(p=>p.id===bj.id);assert.equal(p.health,100);assert.ok(p.protectedUntil>reborn.now);
 room.endsAt=Date.now()-1;await a.wait('state',s=>s.phase==='finished');a.send({type:'start'});await a.wait('state',s=>s.phase==='preparing');await defaults(url,a,b);const next=await b.wait('state',s=>s.phase==='playing'&&s.round===2&&s.players.every(p=>p.entered));assert.ok(next.players.every(p=>p.kills===0&&p.health===100));a.ws.close();b.ws.close();
 }finally{await app.close();}
});

test('resume preserves match identity, rejects forgery/new joins, replaces socket and rotates avatar token',async()=>{
 const app=createGameServer({controlDbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`,url=base.replace('http','ws')+'/ws';
 try{const a=await connect(url),b=await connect(url);const ah=await a.wait('hello');a.send({type:'create',name:'A'});const aj=await a.wait('joined');assert.match(aj.resumeToken,/^[a-f0-9]{64}$/);b.send({type:'join',code:aj.code,name:'B'});const bj=await b.wait('joined');assert.ok(!JSON.stringify(await b.wait('state')).includes(aj.resumeToken));a.send({type:'start'});await a.wait('state',s=>s.phase==='preparing');await defaults(url,a,b);await b.wait('state',s=>s.phase==='playing');const room=app.rooms.get(aj.code),p=room.players.get(aj.id);p.kills=2;p.input.move=[0,0];
 a.ws.terminate();const lost=await b.wait('state',s=>s.players.some(p=>p.id===aj.id&&p.connected===false));assert.equal(lost.host,aj.id);const pos=[...p.pos];
 const c=await connect(url);const ch=await c.wait('hello');c.send({type:'resume',token:'f'.repeat(64)});await c.wait('error');c.send({type:'join',code:aj.code,name:'C'});await c.wait('error');c.send({type:'resume',token:aj.resumeToken});const resumed=await c.wait('resumed');assert.equal(resumed.id,aj.id);assert.notEqual(resumed.avatarToken,ah.avatarToken);assert.equal((await c.wait('state',s=>s.players.some(p=>p.id===aj.id&&p.connected))).players.find(p=>p.id===aj.id).kills,2);assert.deepEqual(p.pos,pos);
 for(const token of [ah.avatarToken,ch.avatarToken])assert.equal((await fetch(base+'/api/avatars/config',{headers:{authorization:'Bearer '+token}})).status,401);assert.equal((await fetch(base+'/api/avatars/config',{headers:{authorization:'Bearer '+resumed.avatarToken}})).status,200);
 const d=await connect(url),closed=new Promise(r=>c.ws.once('close',r));d.send({type:'resume',token:aj.resumeToken});await d.wait('resumed');await closed;assert.equal(room.players.size,2);assert.equal(room.players.get(aj.id).connected,true);
 d.send({type:'ping',sent:123});const pong=await d.wait('pong');assert.equal(pong.sent,123);assert.ok(Math.abs(pong.serverTime-Date.now())<1000);
 d.send({type:'leave'});await b.wait('state',s=>s.players.length===1);assert.equal(room.host,bj.id);d.send({type:'resume',token:aj.resumeToken});await d.wait('error');d.ws.close();b.ws.close();
 }finally{await app.close();}
});
test('resume grace expires, invalidates token and deletes empty room',async()=>{
 const app=createGameServer({controlDbPath:':memory:',resumeGraceMs:80});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try{const a=await connect(url);a.send({type:'create'});const joined=await a.wait('joined');a.ws.terminate();await new Promise(r=>setTimeout(r,150));assert.equal(app.rooms.size,0);const b=await connect(url);b.send({type:'resume',token:joined.resumeToken});await b.wait('error');b.ws.close();}finally{await app.close();}
});
test('expired disconnected host is removed and host transfers to remaining player',async()=>{
 const app=createGameServer({controlDbPath:':memory:',resumeGraceMs:150});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try{const a=await connect(url),b=await connect(url);a.send({type:'create'});const joined=await a.wait('joined');b.send({type:'join',code:joined.code});const bj=await b.wait('joined');a.ws.terminate();const lost=await b.wait('state',s=>s.players.some(p=>p.id===joined.id&&!p.connected));assert.equal(lost.host,joined.id);const expired=await b.wait('state',s=>s.players.length===1);assert.equal(expired.host,bj.id);const c=await connect(url);c.send({type:'resume',token:joined.resumeToken});await c.wait('error');b.ws.close();c.ws.close();}finally{await app.close();}
});

test('preparing sockets retain identity, reject joins, cancel deadline jobs and reset next-round allowance',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{ConfigStore}=await import('../server/control/store.js');
 const dir=await mkdtemp(join(tmpdir(),'saltline-preparing-')),path=join(dir,'control.sqlite'),store=new ConfigStore({path,env:{}});const config=store.current();config.features.preview=false;store.commit(config,'测试准备阶段');store.close();let cancelled=false;
 const recipe={version:2,name:'准备角色',nodes:[{id:'body',parent:null,shape:'ellipsoid',pos:[0,1,0],size:[.6,1.6,.5],color:'#88aaff'}],details:[]};
 const app=createGameServer({controlDbPath:path,avatarDataDir:dir,avatarGenerate:async(prompt,{signal})=>{if(prompt==='超时角色')return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(Error('取消'));},{once:true}));return recipe;},avatarLimits:{cooldownMs:0}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`,url=base.replace('http','ws')+'/ws';
 const post=(token,path,body)=>fetch(base+'/api/avatars'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
 try{const a=await connect(url),b=await connect(url),ah=await a.wait('hello'),bh=await b.wait('hello');a.send({type:'create'});const aj=await a.wait('joined');b.send({type:'join',code:aj.code});await b.wait('joined');assert.equal((await post(ah.avatarToken,'/generate',{prompt:'完成角色'})).status,202);await a.wait('state',s=>s.players.some(p=>p.id===aj.id&&p.avatarPreparation==='ready'));a.send({type:'start'});const prep=await b.wait('state',s=>s.phase==='playing');assert.ok(prep.preparingEndsAt-prep.now<=120000);assert.equal(prep.players.find(p=>p.id===aj.id).avatarGenerated,true);
 const c=await connect(url);c.send({type:'join',code:aj.code});await c.wait('error');a.ws.terminate();await b.wait('state',s=>s.players.some(p=>p.id===aj.id&&!p.connected));c.send({type:'resume',token:aj.resumeToken});const resumed=await c.wait('resumed');assert.equal((await post(resumed.avatarToken,'/generate',{prompt:'第二个角色'})).status,403);assert.equal((await post(bh.avatarToken,'/generate',{prompt:'超时角色'})).status,202);const room=app.rooms.get(aj.code);room.preparingEndsAt=Date.now()-1;const playing=await b.wait('state',s=>s.phase==='playing'&&s.players.every(p=>p.entered));assert.equal(playing.players.find(p=>p.id!==aj.id).avatarPreparation,'default');assert.equal(cancelled,true);room.endsAt=Date.now()-1;await b.wait('state',s=>s.phase==='finished');c.send({type:'start'});await b.wait('state',s=>s.phase==='preparing'&&s.round===2&&s.players.every(p=>!p.avatarGenerated));assert.equal((await post(resumed.avatarToken,'/generate',{prompt:'新局角色'})).status,202);b.ws.close();c.ws.close();
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('preview confirmation admits a late player while generation remains allowed during playing; expired reconnect defaults',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'saltline-staggered-'));
 const recipe={version:2,name:'延迟角色',nodes:[{id:'body',parent:null,shape:'ellipsoid',pos:[0,1,0],size:[.6,1.6,.5],color:'#88aaff'}],details:[]};
 const app=createGameServer({avatarDataDir:dir,avatarGenerate:async()=>recipe});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`,url=base.replace('http','ws')+'/ws';
 const post=(client,path,body)=>fetch(base+'/api/avatars'+path,{method:'POST',headers:{authorization:'Bearer '+client.hello.avatarToken,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  const a=await connect(url),b=await connect(url),c=await connect(url);a.send({type:'create'});const aj=await a.wait('joined');let cj;for(const client of [b,c]){client.send({type:'join',code:aj.code});const joined=await client.wait('joined');if(client===c)cj=joined;}
  const room=app.rooms.get(aj.code);assert.equal(room.players.size,3);a.send({type:'start'});const prep=await b.wait('state',s=>s.phase==='preparing');assert.equal(prep.preparingEndsAt-prep.now,120000);
  await defaults(url,a);await b.wait('state',s=>s.phase==='playing');const pa=room.players.get(aj.id);pa.kills=4;pa.pos=[0,0,0];pa.input.move=[0,0];const serial=pa.spawnSerial,endsAt=room.endsAt;
  const late=await connect(url);late.send({type:'join',code:aj.code});await late.wait('error');late.ws.close();
  assert.equal((await post(b,'/generate',{prompt:'预览角色'})).status,202);const pending=await b.wait('state',s=>s.players.some(p=>p.id===b.hello.id&&p.avatarGenerated));const pb=pending.players.find(p=>p.id===b.hello.id);assert.equal(pb.entered,false);assert.equal(pb.avatarPreparation,'pending');assert.equal(pb.avatarId,null);
  const job=await(await fetch(base+'/api/avatars/jobs/'+pb.avatarJobId,{headers:{authorization:'Bearer '+b.hello.avatarToken}})).json();assert.equal(job.equipped,false);
  assert.equal((await post(b,'/equip',{assetId:job.asset.id})).status,200);await b.wait('state',s=>s.players.find(p=>p.id===b.hello.id).entered);assert.equal(pa.kills,4);assert.equal(pa.spawnSerial,serial);assert.deepEqual(pa.pos,[0,0,0]);assert.equal(room.endsAt,endsAt);assert.equal((await post(b,'/generate',{prompt:'入场后生成'})).status,403);
  // The third player is offline at the deadline, and resumes the original identity.
  c.ws.terminate();await b.wait('state',s=>s.players.some(p=>p.id===cj.id&&!p.connected));room.preparingEndsAt=Date.now()-1;await b.wait('state',s=>s.preparingEndsAt===0);assert.equal(room.players.get(cj.id).entered,false);
  const d=await connect(url);d.send({type:'resume',token:cj.resumeToken});const resumed=await d.wait('resumed');assert.equal(resumed.id,cj.id);const resumedState=await d.wait('state',s=>s.players.find(p=>p.id===cj.id).entered);assert.equal(resumedState.players.find(p=>p.id===cj.id).avatarPreparation,'default');assert.equal(pa.kills,4);assert.equal(room.endsAt,endsAt);d.ws.close();
  a.ws.close();b.ws.close();
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
