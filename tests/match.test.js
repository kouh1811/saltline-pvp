import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../server/match.js';
const map={bounds:{min:[-40,0,-30],max:[40,30,30]},boxes:[],spawns:[[-10,0,0],[10,0,0]]};
const setup=()=>{const m=new Match('ABCDEF',map);m.join('a','Alice',0);m.join('b','Bob',0);m.start('a',0);for(const [id,x] of [['a',0],['b',5]]){Object.assign(m.players.get(id),{pos:[x,0,0],protectedUntil:0});}return m;};
test('host starts with at least two players, room capacity is four',()=>{const m=new Match('ABCDEF',map);m.join('a','A',0);assert.throws(()=>m.start('a',0));m.join('b','B',0);assert.throws(()=>m.start('b',0));m.join('c','C',0);m.join('d','D',0);assert.throws(()=>m.join('e','E',0));});
test('server confirms damage, fire rate, death and respawn protection',()=>{const m=setup();assert.equal(m.fire('a',[1,0,0],1000).target,'b');assert.equal(m.players.get('b').health,74);assert.equal(m.fire('a',[1,0,0],1001),null);for(let n=1;n<4;n++)m.fire('a',[1,0,0],1000+n*100);assert.equal(m.players.get('a').kills,1);assert.equal(m.players.get('b').deaths,1);assert.equal(m.players.get('b').alive,false);m.tick(1/60,4400);assert.equal(m.players.get('b').alive,true);assert.ok(m.players.get('b').protectedUntil>4400);});
test('walls stop shots and spawn protection stops damage',()=>{const m=setup();m.map.boxes=[{min:[2,0,-1],max:[3,3,1]}];m.fire('a',[1,0,0],1000);assert.equal(m.players.get('b').health,100);m.map.boxes=[];m.players.get('b').protectedUntil=3000;m.fire('a',[1,0,0],2000);assert.equal(m.players.get('b').health,100);});
test('server ammo and reload cannot be bypassed by rapid requests',()=>{const m=setup();for(let i=0;i<30;i++)m.fire('a',[0,0,-1],1000+100*i);assert.equal(m.players.get('a').ammo,0);assert.equal(m.fire('a',[0,0,-1],5000),null);m.reload('a',5000);m.reload('a',5100);m.tick(.016,6000);assert.equal(m.players.get('a').ammo,0);m.tick(.016,7800);assert.equal(m.players.get('a').ammo,30);});
test('five minutes ends the round, freezes score and allows host rematch',()=>{const m=setup();m.tick(.016,300001);assert.equal(m.phase,'finished');assert.equal(m.fire('a',[1,0,0],300002),null);m.start('a',301000);assert.equal(m.phase,'playing');assert.equal(m.players.get('a').kills,0);});
test('movement is computed from input; forged positions and NaN are ignored',()=>{const m=setup();m.input('a',{move:[0,1],yaw:0,pitch:0,pos:[999,999,999]});m.tick(.05,1000);assert.ok(Math.abs(m.players.get('a').pos[2])<1);assert.equal(m.players.get('a').pos[0],0);m.input('a',{move:[NaN,Infinity],yaw:NaN});m.tick(.05,1100);assert.ok(m.players.get('a').pos.every(Number.isFinite));});
test('server movement cannot cross a solid wall',()=>{const m=setup();m.map.boxes=[{min:[-2,0,-2],max:[2,3,-1]}];m.input('a',{move:[0,1],yaw:0,pitch:0});for(let i=0;i<120;i++)m.tick(1/60,1000+i*16);assert.ok(m.players.get('a').pos[2]>-1);});
test('shotTime rewinds both players, without changing legacy fire or current protection',()=>{
 const m=setup(),a=m.players.get('a'),b=m.players.get('b');m.tick(0,1000);a.pos=[0,0,5];b.pos=[5,0,8];m.tick(0,1100);
 assert.equal(m.fire('a',[1,0,0],1100,1000).target,'b');assert.deepEqual(a.pos,[0,0,5]);assert.deepEqual(b.pos,[5,0,8]);
 a.lastShot=-Infinity;b.pos=[5,0,8];m.tick(0,1200);assert.equal(m.fire('a',[1,0,0],1200).target,null);
 a.lastShot=-Infinity;b.protectedUntil=1400;assert.equal(m.fire('a',[1,0,0],1300,1000).target,null);
});
test('shotTime clamps old and future timestamps and never rewinds a previous life',()=>{
 const m=setup(),a=m.players.get('a'),b=m.players.get('b');m.tick(0,1000);b.pos=[5,0,5];m.tick(0,1050);m.tick(0,1300);
 assert.equal(m.fire('a',[1,0,0],1300,0).target,null);a.lastShot=-Infinity;assert.equal(m.fire('a',[1,0,0],1300,9999).target,null);
 m.spawn(b,1310);b.pos=[5,0,5];b.protectedUntil=0;a.lastShot=-Infinity;assert.equal(m.fire('a',[1,0,0],1320,1000).target,null);
});
