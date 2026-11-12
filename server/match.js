import {clamp,rayBox,raySphere,movePlayer} from './physics.js';
const idle=()=>({move:[0,0],yaw:0,pitch:0,jump:false,sprint:false,ads:false,crouch:false});
export class Match{
 constructor(code,map){this.code=code;this.map=structuredClone(map);this.players=new Map();this.phase='waiting';this.endsAt=0;this.host=null;this.round=0;}
 join(id,name,now){if(this.players.size>=4)throw Error('房间已满（最多 4 人）');if(this.phase==='playing')throw Error('对局进行中，请等下一局');this.host??=id;const p={id,name:String(name||'玩家').replace(/[<>\x00-\x1f]/g,'').slice(0,16),kills:0,deaths:0,input:idle(),lastInput:now,lastShot:-Infinity,reloadAt:0,spawnSerial:0};this.players.set(id,p);this.spawn(p,now);return p;}
 leave(id){this.players.delete(id);if(this.host===id)this.host=this.players.keys().next().value??null;}
 spawn(p,now){const others=[...this.players.values()].filter(x=>x!==p&&x.alive);const ranked=this.map.spawns.map(pos=>({pos,score:others.length?Math.min(...others.map(o=>Math.hypot(pos[0]-o.pos[0],pos[2]-o.pos[2]))):Math.random()*10})).sort((a,b)=>b.score-a.score);Object.assign(p,{pos:[...ranked[0].pos],lastSafe:[...ranked[0].pos],vel:[0,0,0],health:100,alive:true,ammo:30,reloadAt:0,respawnAt:0,protectedUntil:now+2000,onGround:true,crouching:false,input:idle(),lastInput:now,lastShot:-Infinity,spawnSerial:p.spawnSerial+1});
  // Face a clear lane instead of starting with the camera against a container.
  let best=-1;
  for(let step=0;step<16;step++){const yaw=step*Math.PI/8,dir=[-Math.sin(yaw),0,-Math.cos(yaw)],origin=[p.pos[0],p.pos[1]+1.68,p.pos[2]];let distance=24;for(const b of this.map.boxes){if(b.playerOnly)continue;const hit=rayBox(origin,dir,b,distance);if(hit!==null)distance=hit;}if(distance>best){best=distance;p.input.yaw=yaw;}}
 }
 start(id,now){if(id!==this.host)throw Error('只有房主可以开始');if(this.players.size<2)throw Error('至少需要 2 位玩家');if(this.phase==='playing')throw Error('对局已经开始');this.phase='playing';this.endsAt=now+300000;this.round++;for(const p of this.players.values()){p.kills=p.deaths=0;this.spawn(p,now);}}
 input(id,data,now=Date.now()){
  const p=this.players.get(id);if(!p||!data)return;const m=Array.isArray(data.move)?data.move:[0,0];const clean=m.slice(0,2).map(v=>Number.isFinite(v)?clamp(v,-1,1):0);while(clean.length<2)clean.push(0);const l=Math.max(1,Math.hypot(...clean));
  p.input={move:clean.map(v=>v/l),yaw:Number.isFinite(data.yaw)?data.yaw:p.input.yaw,pitch:Number.isFinite(data.pitch)?clamp(data.pitch,-1.5,1.5):0,jump:p.input.jump||data.jump===true,sprint:data.sprint===true,ads:data.ads===true,crouch:data.crouch===true};p.lastInput=now;
 }
 reload(id,now){const p=this.players.get(id);if(this.phase!=='playing'||!p?.alive||p.reloadAt||p.ammo===30)return; p.reloadAt=now+(p.ammo===0?2720:2100);}
 fire(id,dir,now){
  const p=this.players.get(id);if(this.phase!=='playing'||now>=this.endsAt||!p?.alive||p.reloadAt||p.ammo<=0||now-p.lastShot<78||!Array.isArray(dir)||dir.length!==3||!dir.every(Number.isFinite))return null;
  const length=Math.hypot(...dir);if(length<.9||length>1.1)return null;dir=dir.map(v=>v/length);p.lastShot=now;p.ammo--;p.protectedUntil=0;
  const origin=[p.pos[0],p.pos[1]+(p.crouching?1.02:1.64),p.pos[2]];
  let distance=180,target=null;
  for(const b of this.map.boxes){if(b.playerOnly)continue;const t=rayBox(origin,dir,b,distance);if(t!==null)distance=t;}
  for(const other of this.players.values()){
   if(other===p||!other.alive||other.protectedUntil>now)continue;
   const h=other.crouching?1.15:1.8;
   for(let y=.32;y<=h-.15;y+=.25){const t=raySphere(origin,dir,[other.pos[0],other.pos[1]+y,other.pos[2]],.34);if(t!==null&&t<distance){distance=t;target=other;}}
  }
  let killed=false;
  if(target){target.health=Math.max(0,target.health-26);if(target.health===0){target.alive=false;target.deaths++;target.respawnAt=now+3000;p.kills++;killed=true;}}
  return {type:'shot',id,origin,dir,end:origin.map((v,i)=>v+dir[i]*distance),target:target?.id??null,killed,health:target?.health??null};
 }
 tick(dt,now){if(this.phase!=='playing')return;if(now>=this.endsAt){this.phase='finished';return;}
  for(const p of this.players.values()){
   if(!p.alive){if(now>=p.respawnAt)this.spawn(p,now);continue;}
   if(p.reloadAt&&now>=p.reloadAt){p.ammo=30;p.reloadAt=0;}
   if(now-p.lastInput>500){p.input.move=[0,0];p.input.jump=false;}
   // Prevent standing into a low ceiling.
   p.crouching=p.input.crouch||p.crouching&&this.map.boxes.some(b=>!b.bulletOnly&&p.pos[0]+.29>b.min[0]&&p.pos[0]-.29<b.max[0]&&p.pos[2]+.29>b.min[2]&&p.pos[2]-.29<b.max[2]&&b.min[1]<p.pos[1]+1.8&&b.max[1]>p.pos[1]+1.1);
   movePlayer(p,Math.min(dt,.05),this.map);
  }
 }
 snapshot(now){return {type:'state',code:this.code,host:this.host,phase:this.phase,round:this.round,now,endsAt:this.endsAt,players:[...this.players.values()].map(({id,name,pos,vel,health,alive,kills,deaths,ammo,reloadAt,respawnAt,protectedUntil,spawnSerial,crouching,input,avatarId=null})=>({id,name,pos,vel,health,alive,kills,deaths,ammo,reloadAt,respawnAt,protectedUntil,spawnSerial,crouching,avatarId,yaw:input.yaw,pitch:input.pitch}))};}
}
