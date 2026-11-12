// Controlled visual QA only. No fixture commands are exposed by the game server.
import {createInterface} from 'node:readline';
import {createGameServer} from '../server/index.js';
import {rayBox} from '../server/physics.js';
const app=createGameServer();await new Promise(r=>app.server.listen(18454,'127.0.0.1',r));console.log('QA fixture http://127.0.0.1:18454');
createInterface({input:process.stdin}).on('line',line=>{try{
 const command=JSON.parse(line);const room=[...app.rooms.values()].find(r=>r.players.size===2);if(!room)throw Error('Need 2 players');const [a,b]=room.players.values();const now=Date.now();
 if(command.type==='pair'){
  let pair;
  for(const first of room.map.spawns){for(const second of room.map.spawns){const len=Math.hypot(first[0]-second[0],first[2]-second[2]);if(len<5||len>12)continue;const o=[first[0],1.5,first[2]],dir=[(second[0]-first[0])/len,0,(second[2]-first[2])/len];if(room.map.boxes.every(box=>box.playerOnly||rayBox(o,dir,box,len)===null)){pair=[first,second];break;}}if(pair)break;}
  if(!pair)throw Error('No clear pair');for(const [p,pos] of [[a,pair[0]],[b,pair[1]]]){p.pos=[...pos];p.vel=[0,0,0];p.protectedUntil=0;p.spawnSerial++;p.input.move=[0,0];}
  console.log(JSON.stringify({pair,ids:[a.id,b.id]}));
 }else if(command.type==='finish'){room.endsAt=now-1;console.log('round expiry scheduled');}
 else if(command.type==='dead'){b.health=0;b.alive=false;b.deaths++;b.respawnAt=now+3000;a.kills++;console.log('controlled death fixture');}
 }catch(e){console.log(e.message);}});
