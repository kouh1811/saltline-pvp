import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
// Execute the real adapter with a minimal DOM/transport; no WebGL or bundled game edits.
async function fixture(token=null){
 const elements=new Map(),storage=new Map(token?[['saltline.resume',token]]:[]),timers=new Map(),calls=[],sockets=[];let serial=0,now=10000;
 const element=()=>({hidden:false,disabled:false,value:'',textContent:'',children:[],append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},addEventListener(){},getContext:()=>({fillRect(){},fillText(){}})});
 const $=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const timer=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;};
 class Socket{
  static OPEN=1;
  constructor(){this.readyState=1;this.sent=[];this.listeners=[];sockets.push(this);}
  send(raw){this.sent.push(JSON.parse(raw));}
  close(code=1006){if(this.readyState===3)return;this.readyState=3;this.onclose?.({code});}
  addEventListener(type,fn){if(type==='message')this.listeners.push(fn);}
  removeEventListener(type,fn){this.listeners=this.listeners.filter(f=>f!==fn);}
  receive(data){const event={data:JSON.stringify(data)};this.onmessage?.(event);for(const fn of this.listeners)fn(event);}
 }
 const player={enabled:false,pos:new THREE.Vector3(),vel:new THREE.Vector3(),tuning:{},reset(options){if(options?.pos)this.pos.copy(options.pos);},addShake(){}};
 const G={THREE,player,input:{move:{x:0,y:0},setGameplay(){},exitLock(){},pressed:()=>false},weapon:{debug:{},state:'idle',setVisible(){},reset(){},ammo:30},game:null,enemies:{clear(){}},hud:{setMarkers(){},setObjective(){},setPrompt(){},show(){},reset(){}},camera:{position:new THREE.Vector3(),lookAt(){}},render:{post:{}},combat:{playerShot(){}},events:{on(){},emit(){}},renderer:{domElement:element()},scene:new THREE.Scene(),quality:{name:'low'}};
 const editor={connected:async()=>calls.push('connected'),disconnected:()=>calls.push('disconnected'),setPhase(){},updateConfig(){},isOpen:()=>false};
 const location={protocol:'http:',host:'localhost:18453',pathname:'/',href:'http://localhost:18453/'};
 const context={window:{},document:{querySelector:$,getElementById:$,createElement:element,head:element(),addEventListener(){}},location,history:{replaceState(){}},localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},navigator:{},URL,URLSearchParams,WebSocket:Socket,performance:{now:()=>now},Date:class extends Date{static now(){return now;}},setTimeout:timer,clearTimeout:id=>timers.delete(id),setInterval(){},addEventListener(){},__avatar:{createAvatar(){},disposeAvatar(){}},__editor:{mountAvatarEditor:()=>editor}};
 const source=(await readFile(new URL('../public/client.js',import.meta.url),'utf8')).replace("import('/avatar/renderer.mjs')","__avatar").replace("import('/avatar/editor.mjs')","__editor");vm.runInNewContext(source,context);await context.window.installPvp(G);
 const advance=ms=>{const end=now+ms;while(true){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;timers.delete(entry[0]);now=entry[1].at;entry[1].fn();}now=end;};
 const state=(phase='playing',pos=[0,0,0])=>({type:'state',code:'ABCDEF',host:'original',phase,round:1,now,endsAt:now+300000,players:[{id:'original',name:'A',pos,vel:[0,0,0],health:100,alive:true,kills:2,deaths:1,ammo:30,reloadAt:0,spawnSerial:1,crouching:false,connected:true,yaw:0}]});
 return{G,$,sockets,storage,calls,advance,state,location,pvp:context.window.__pvp};
}
test('client reconnects with stored identity, refreshes avatar credentials and resumes each phase',async()=>{
 for(const phase of ['waiting','playing','finished']){const f=await fixture(),a=f.sockets[0];a.receive({type:'hello',id:'original',avatarToken:'avatar-1'});a.receive({type:'joined',id:'original',code:'ABCDEF',resumeToken:'resume-1'});a.receive(f.state(phase));assert.equal(f.storage.get('saltline.resume'),'resume-1');a.close();assert.equal(f.G.player.enabled,false);f.advance(500);const b=f.sockets[1];b.receive({type:'hello',id:'temporary',avatarToken:'temporary-avatar'});assert.equal(b.sent[0].type,'resume');assert.equal(b.sent[0].token,'resume-1');assert.equal(f.calls.filter(c=>c==='connected').length,1);b.receive({type:'resumed',id:'original',code:'ABCDEF',resumeToken:'resume-1',avatarToken:'avatar-2'});b.receive(f.state(phase));assert.equal(f.calls.filter(c=>c==='connected').length,2);assert.equal(f.$('#lobby').hidden,phase!=='waiting');if(phase==='playing')assert.equal(f.G.player.enabled,true);if(phase==='finished')assert.equal(f.$('#scoreboard').hidden,false);}
});
test('client refresh resumes, expiry offers lobby, active replacement does not reconnect forever',async()=>{
 const f=await fixture('saved-token');f.sockets[0].receive({type:'hello',id:'temp'});assert.equal(f.sockets[0].sent[0].token,'saved-token');f.advance(45000);assert.equal(f.storage.has('saltline.resume'),false);assert.equal(f.$('#status').children.at(-1).textContent,'返回大厅');
 const g=await fixture();g.sockets[0].receive({type:'hello',id:'original'});g.sockets[0].receive({type:'joined',id:'original',code:'ABCDEF',resumeToken:'token'});g.sockets[0].close(4001);g.advance(50000);assert.equal(g.sockets.length,1);assert.equal(g.storage.size,0);
});
test('client smooths moderate corrections, snaps large errors and sends estimated shot time and RTT',async()=>{
 const f=await fixture(),ws=f.sockets[0];ws.receive({type:'hello',id:'original'});ws.receive({type:'joined',id:'original',code:'ABCDEF',resumeToken:'token'});ws.receive(f.state());f.G.player.pos.x=.8;ws.receive(f.state());assert.equal(f.G.player.pos.x,.8);f.G.game.update(.016);assert.ok(f.G.player.pos.x>0&&f.G.player.pos.x<.8);f.G.player.pos.x=2;ws.receive(f.state());assert.equal(f.G.player.pos.x,0);
 ws.receive({type:'pong',sent:9900,serverTime:10200});f.G.combat.playerShot(null,new THREE.Vector3(1,0,0));const shot=ws.sent.at(-1);assert.equal(shot.type,'fire');assert.equal(shot.rtt,100);assert.ok(shot.shotTime>10000&&shot.shotTime<10250);
 f.$('#leave-game').onclick();assert.equal(ws.sent.at(-1).type,'leave');assert.equal(f.storage.size,0);
});

test('remote extrapolation is bounded and disconnected frames stay frozen',async()=>{
 const f=await fixture(),ws=f.sockets[0];ws.receive({type:'hello',id:'original'});const state=f.state();state.players.push({...state.players[0],id:'remote',name:'B',pos:[5,0,0],vel:[100,0,0]});ws.receive(state);const remote=f.pvp.remotes.get('remote');f.advance(1000);f.G.game.update(.016);assert.ok(remote.extrapolated.x<=5.6);assert.ok(remote.root.position.x>5);const before=remote.root.position.clone();ws.close();f.G.game.update(1);assert.deepEqual(remote.root.position,before);assert.equal(f.G.player.enabled,false);
});
test('real avatar editor clears disconnected status after receiving a new credential',async()=>{
 const elements=new Map(),node=()=>({textContent:'',setAttribute(){},append(){},replaceChildren(){},addEventListener(){},querySelectorAll:()=>[]});const dialog=node();dialog.querySelector=selector=>{if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);};let token='old-avatar';const seen=[];
 const context={document:{createElement:()=>dialog},localStorage:{getItem:()=>null},Option:class{},cancelAnimationFrame(){},clearTimeout(){},fetch:async(url,options)=>{seen.push(options.headers.authorization);return{ok:true,json:async()=>({enabled:true,customization:true,generation:true,preview:false,equipment:true,inMatch:false})};},createAvatar(){},disposeAvatar(){}};
 const source=(await readFile(new URL('../public/avatar/editor.mjs',import.meta.url),'utf8')).replace("import {createAvatar,disposeAvatar} from './renderer.mjs';",'').replace('export function mountAvatarEditor','function mountAvatarEditor');vm.runInNewContext(source,context);const editor=context.mountAvatarEditor({}, {container:node(),triggers:[],getToken:()=>token});editor.disconnected();assert.match(elements.get('#avatar-status').textContent,/连接已断开/);token='new-avatar';await editor.connected();assert.equal(seen.at(-1),'Bearer new-avatar');assert.doesNotMatch(elements.get('#avatar-status').textContent,/连接已断开/);
});
