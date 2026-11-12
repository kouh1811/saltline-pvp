import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createGameServer} from '../server/index.js';
async function connect(url){const ws=new WebSocket(url),queue=[];let wake;ws.on('message',r=>{queue.push(JSON.parse(r));wake?.();});await new Promise(r=>ws.on('open',r));return {ws,send:d=>ws.send(JSON.stringify(d)),async wait(type,predicate=()=>true){const until=Date.now()+4000;while(Date.now()<until){const i=queue.findIndex(x=>x.type===type&&predicate(x));if(i>=0)return queue.splice(i,1)[0];await new Promise(r=>{const timeout=setTimeout(r,100);wake=()=>{clearTimeout(timeout);r();};});}throw Error('timeout '+type);}};}
test('real sockets: create, join, start, movement, room isolation and disconnect',async()=>{
 const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try{const a=await connect(url),b=await connect(url),c=await connect(url);a.send({type:'create',name:'Alice'});const joined=await a.wait('joined');b.send({type:'join',code:joined.code,name:'Bob'});await b.wait('joined');const state=await a.wait('state',s=>s.players.length===2);assert.equal(state.players.length,2);
 c.send({type:'create',name:'Other'});const other=await c.wait('joined');assert.notEqual(other.code,joined.code);
 a.send({type:'start'});const initial=await a.wait('state',s=>s.phase==='playing');assert.equal(initial.players.length,2);assert.equal((await c.wait('state')).players.length,1);
 const me=initial.players.find(p=>p.id===joined.id);a.send({type:'input',move:[1,0],yaw:0,pitch:0});const moved=await b.wait('state',s=>s.phase==='playing'&&Math.abs(s.players.find(p=>p.id===joined.id).pos[0]-me.pos[0])>.03);assert.ok(moved.players.every(p=>p.health===100));
 b.ws.close();await a.wait('state',s=>s.players.length===1);a.ws.close();c.ws.close();
 }finally{await app.close();}
});
test('real sockets: authoritative kill, three-second respawn, expiry and rematch',async()=>{
 const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
 try{const a=await connect(url),b=await connect(url);a.send({type:'create',name:'A'});const joined=await a.wait('joined');b.send({type:'join',code:joined.code,name:'B'});const bj=await b.wait('joined');a.send({type:'start'});await a.wait('state',s=>s.phase==='playing');const room=app.rooms.get(joined.code);room.map.boxes=[];
 const pa=room.players.get(joined.id),pb=room.players.get(bj.id);pa.pos=[0,0,0];pb.pos=[5,0,0];pa.protectedUntil=pb.protectedUntil=0;
 for(let i=0;i<4;i++){pa.lastShot=-Infinity;a.send({type:'fire',dir:[1,0,0]});const shot=await b.wait('shot');assert.equal(shot.target,bj.id);assert.equal(shot.killed,i===3);}
 const killed=await b.wait('state',s=>!s.players.find(p=>p.id===bj.id).alive);assert.equal(killed.players.find(p=>p.id===joined.id).kills,1);
 const reborn=await b.wait('state',s=>s.players.find(p=>p.id===bj.id).alive&&s.players.find(p=>p.id===bj.id).spawnSerial>killed.players.find(p=>p.id===bj.id).spawnSerial);const p=reborn.players.find(p=>p.id===bj.id);assert.equal(p.health,100);assert.ok(p.protectedUntil>reborn.now);
 room.endsAt=Date.now()-1;await a.wait('state',s=>s.phase==='finished');a.send({type:'start'});const next=await b.wait('state',s=>s.phase==='playing'&&s.round===2);assert.ok(next.players.every(p=>p.kills===0&&p.health===100));a.ws.close();b.ws.close();
 }finally{await app.close();}
});
