/* Multiplayer adapter. The bundled original remains responsible for rendering,
 * local movement prediction, weapon animation, procedural level and sound. */
window.installPvp=async function(G){
 const T=G.THREE,$=s=>document.querySelector(s);
 const [{createAvatar,disposeAvatar},{mountAvatarEditor}]=await Promise.all([import('/avatar/renderer.mjs'),import('/avatar/editor.mjs')]);
 const avatarCSS=document.createElement('link');avatarCSS.rel='stylesheet';avatarCSS.href='/avatar/avatar.css';document.head.append(avatarCSS);
 const ui=document.createElement('div');ui.id='pvp';ui.innerHTML=`
 <section id="lobby" class="pvp-panel" aria-label="自由混战大厅">
  <div class="eyebrow">BERTH 04 / MULTIPLAYER</div><h1>SALTLINE<span>自由混战</span></h1>
  <p class="intro">雨中的港口。最多八人。五分钟。</p>
  <div id="connect-form"><label for="nickname">呼号</label><input id="nickname" maxlength="16" placeholder="输入你的名字" value="">
  <div class="room-actions"><button id="create-room" class="primary">创建房间 ↗</button><span>或</span><label class="sr-only" for="room-code">房间码</label><input id="room-code" maxlength="6" placeholder="6 位房间码" autocomplete="off"><button id="join-room">加入</button></div></div>
  <div id="room-info" hidden><div class="room-label">房间码 · 发给你的朋友</div><div class="room-code"><strong id="code"></strong><button id="copy-room">复制邀请链接</button></div><div id="roster"></div><button id="start-game" class="primary">开始对局</button><p id="wait-hint"></p></div>
  <p id="status" role="status">正在连接港口服务器…</p><div class="rules">2—8 人 · 5 分钟 · 击杀计分 · 3 秒复活</div>
  <button id="open-avatar-lobby">自定义角色 ↗</button><details><summary>操作与画质</summary><p>WASD 移动 · 鼠标瞄准 · 左键射击 · 右键开镜<br>R 换弹 · 空格跳跃 · Shift 冲刺 · C 蹲下<br>Esc 释放鼠标，比赛继续；Tab 查看战绩。</p><label for="quality">画质</label><select id="quality"><option value="low">流畅</option><option value="medium">均衡</option><option value="high">高画质</option></select></details>
 </section>
 <div id="match-strip" hidden><span>FFA <b id="live-code"></b></span><strong id="clock">05:00</strong><span id="population"></span><button id="show-scores">战绩 [Tab]</button><button id="edit-avatar-match">角色外观</button><button id="leave-game">退出</button></div>
 <div id="live-score" hidden>0 击杀 / 0 阵亡</div><div id="net-status"></div>
 <div id="kill-feed" aria-live="polite"></div><div id="death-notice" hidden></div>
 <button id="resume-game" hidden>点击继续战斗</button>
 <section id="scoreboard" class="pvp-panel" hidden aria-label="战绩"><div class="eyebrow">SALTLINE / SCOREBOARD</div><h2 id="score-title">战场记录</h2><table><thead><tr><th>呼号</th><th>击杀</th><th>阵亡</th></tr></thead><tbody id="score-rows"></tbody></table><p id="winner"></p><button id="rematch" class="primary" hidden>再来一局</button><button id="return-lobby" hidden>返回大厅</button></section>`;
 document.getElementById('app').append(ui);
 let saved='';try{saved=localStorage.getItem('saltline.callsign')||'';}catch{}$('#nickname').value=saved;$('#room-code').value=new URLSearchParams(location.search).get('room')||'';
 let avatarEditor=null,avatarToken=null;
 let socket,id=null,state=null,own=null,spawnSerial=-1,round=-1,connected=false,sendAt=0,scoreOpen=false,offset=0,lastMessage=performance.now(),ping=0,joining=false;
 const RESUME_GRACE_MS=45000,RESUME_KEY='saltline.resume';let resumeToken=null,reconnectUntil=0,retryTimer,deadlineTimer,handshakeTimer,attempt=0,intentional=false,clockReady=false;
 try{resumeToken=sessionStorage.getItem(RESUME_KEY);}catch{}if(resumeToken)reconnectUntil=Date.now()+RESUME_GRACE_MS;
 const remotes=new Map(),correction=new T.Vector3();let lastLocalShot=-Infinity;
 function saveToken(token){resumeToken=token;try{if(token)sessionStorage.setItem(RESUME_KEY,token);else sessionStorage.removeItem(RESUME_KEY);}catch{}}
 function clockSample(sample,weight=.15){if(!Number.isFinite(sample))return;offset=clockReady?offset+(sample-offset)*weight:sample;clockReady=true;}
 const status=message=>{$('#status').textContent=message;};
 const send=data=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data));};
 const nameFor=pid=>state?.players.find(p=>p.id===pid)?.name||'玩家';
 function setControls(enabled){enabled=enabled&&connected&&!avatarEditor?.isOpen();G.player.enabled=enabled;G.input.setGameplay?.(enabled);G.weapon.debug.noFire=!enabled;}
 function unlock(){G.input.exitLock?.();}
 function capture(){if(avatarEditor?.isOpen()||!connected||state?.phase!=='playing'||!own?.alive)return;G.audio.resume?.();G.input.requestLock?.();setControls(true);$('#resume-game').hidden=true;}
 function preparationHint(){if(state?.phase==='preparing')$('#wait-hint').textContent=`角色准备中 · 最多还等 ${Math.max(0,Math.ceil((state.preparingEndsAt-Date.now()-offset)/1000))} 秒。请确认提示词生成角色，或选择使用默认外观；全部准备好后立即开局。`;}
 const game={state:'lobby',start(){},update(dt){
  preparationHint();
  const reserve=document.querySelector('.h-ammo-r');if(reserve)reserve.textContent='∞';
  if(connected&&state?.phase==='playing'){
   const now=Date.now()+offset;const remaining=Math.max(0,Math.ceil((state.endsAt-now)/1000));$('#clock').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
   if(own&&!own.alive){$('#death-notice').hidden=false;$('#death-notice').textContent=`信号中断 · ${Math.max(1,Math.ceil((own.respawnAt-now)/1000))} 秒后重返战场`;}
   if(performance.now()>sendAt){sendAt=performance.now()+33;sendInput();}
  }
  if(connected&&own?.alive&&state?.phase==='playing'&&correction.lengthSq()>0){const step=correction.clone().multiplyScalar(1-Math.exp(-10*dt));G.player.pos.add(step);correction.sub(step);}
  if(connected)for(const remote of remotes.values()){
   const seconds=remote.connected?Math.min(.1,Math.max(0,(performance.now()-remote.receivedAt)/1000)):0;const ahead=remote.velocity.clone().multiplyScalar(seconds).clampLength(0,.6);remote.extrapolated.copy(remote.target).add(ahead);
   remote.root.position.lerp(remote.extrapolated,1-Math.exp(-14*dt));const diff=Math.atan2(Math.sin(remote.yaw-remote.root.rotation.y),Math.cos(remote.yaw-remote.root.rotation.y));remote.root.rotation.y+=diff*(1-Math.exp(-16*dt));
   if(remote.avatarObject)remote.avatarObject.scale.y=remote.avatarObject.userData.baseScaleY*(remote.crouching?.63:1);
   remote.body.scale.y=remote.crouching?.63:1;remote.head.position.y=remote.crouching?1.02:1.56;remote.gun.position.y=remote.crouching?.8:1.15;
   remote.ring.visible=remote.protectedUntil>Date.now()+offset;
   const moving=remote.root.position.distanceTo(remote.previous)>.002;remote.phase+=dt*(moving?10:0);remote.legs[0].rotation.x=moving?Math.sin(remote.phase)*.45:0;remote.legs[1].rotation.x=-remote.legs[0].rotation.x;remote.previous.copy(remote.root.position);
  }
  $('#net-status').textContent=connected?(performance.now()-lastMessage>3000?'网络不稳定':`${ping} ms`):reconnectUntil?'正在重新连接…':'连接已断开';
  return connected&&state?.phase==='playing';
 }};G.game=game;
 G.enemies.clear();G.enemies.update=()=>{};G.enemies.raycast=()=>null;
 G.hud.setMarkers([]);G.hud.setObjective('');G.hud.setPrompt(null);G.hud.show(false);G.player.reset();G.player.enabled=false;G.weapon.setVisible(false);G.player.tuning.regenRate=0;
 // Damage and death come exclusively from authoritative snapshots.
 G.player.damage=()=>{};
 G.camera.position.set(-32,2.1,6);G.camera.lookAt(0,3,0);
 G.render.post.fade=0;
 const originalShot=G.combat.playerShot.bind(G.combat);
 G.combat.playerShot=(origin,dir,options)=>{sendInput();send({type:'fire',dir:dir.toArray(),shotTime:Date.now()+offset,rtt:ping});lastLocalShot=performance.now();return originalShot(origin,dir,options);};
 G.events.on('weapon:reload',event=>{if(event.phase==='start')send({type:'reload'});});
 function sendInput(){if(!connected||state?.phase!=='playing'||!own?.alive)return;const enabled=G.player.enabled&&!document.hidden;send({type:'input',rtt:ping,move:enabled?[G.input.move.x,G.input.move.y]:[0,0],yaw:G.player.yaw,pitch:G.player.pitch,jump:enabled&&G.input.pressed('jump'),sprint:enabled&&G.input.sprint,ads:enabled&&G.input.ads,crouch:enabled&&G.input.crouch});}
 // Jump presses can be shorter than the network cadence; latch them every frame.
 const baseUpdate=game.update;game.update=dt=>{if(G.player.enabled&&G.input.pressed('jump'))sendInput();return baseUpdate(dt);};
 function disposeRemote(remote){remote.disposed=true;G.scene.remove(remote.root);disposeAvatar(remote.root);}
 const avatarRecipes=new Map();
 async function updateAppearance(remote,assetId){
  remote.wantedAvatar=assetId;
  if(!assetId){if(remote.avatarObject)disposeAvatar(remote.avatarObject);remote.avatarObject=null;remote.avatarId=null;remote.defaultVisuals.forEach(o=>o.visible=true);return;}
  try{if(!avatarRecipes.has(assetId)){avatarRecipes.set(assetId,fetch("/api/avatars/assets/"+assetId).then(async r=>{if(!r.ok)throw Error("角色加载失败");return (await r.json()).recipe;}));if(avatarRecipes.size>50)avatarRecipes.delete(avatarRecipes.keys().next().value);}
   const recipe=await avatarRecipes.get(assetId);if(remote.disposed||remote.wantedAvatar!==assetId)return;const generated=createAvatar(T,recipe);if(remote.avatarObject)disposeAvatar(remote.avatarObject);generated.userData.baseScaleY=generated.scale.y;remote.avatarObject=generated;remote.avatarId=assetId;remote.root.add(generated);remote.defaultVisuals.forEach(o=>o.visible=false);
  }catch{avatarRecipes.delete(assetId);/* Keep the existing appearance if a load fails. */}
 }
 function makeRemote(p){
  const root=new T.Group();root.name=`pvp-${p.id}`;
  const armor=new T.MeshStandardMaterial({color:0x607c86,roughness:.65,metalness:.35});const dark=new T.MeshStandardMaterial({color:0x172329,roughness:.8});const glow=new T.MeshStandardMaterial({color:0xf1b66c,emissive:0xff9e42,emissiveIntensity:1.5});
  const add=(geo,material,pos)=>{const mesh=new T.Mesh(geo,material);mesh.position.set(...pos);mesh.castShadow=true;root.add(mesh);return mesh;};
  const body=add(new T.BoxGeometry(.58,.65,.32),armor,[0,1.04,0]);const head=add(new T.BoxGeometry(.35,.33,.34),dark,[0,1.56,0]);const visor=new T.Mesh(new T.BoxGeometry(.28,.07,.02),glow);visor.position.set(0,.025,-.18);head.add(visor);
  const legs=[add(new T.BoxGeometry(.19,.65,.21),dark,[-.16,.38,0]),add(new T.BoxGeometry(.19,.65,.21),dark,[.16,.38,0])];
  add(new T.BoxGeometry(.17,.52,.19),armor,[-.4,1.07,-.07]);add(new T.BoxGeometry(.17,.5,.19),armor,[.4,1.07,-.1]);
  const gun=add(new T.BoxGeometry(.12,.15,.68),dark,[.28,1.15,-.4]);
  const ring=add(new T.TorusGeometry(.55,.018,5,32),glow,[0,.06,0]);ring.rotation.x=Math.PI/2;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=48;const ctx=canvas.getContext('2d');ctx.fillStyle='#101c24cc';ctx.fillRect(0,0,256,48);ctx.fillStyle='#f0e9dd';ctx.font='22px sans-serif';ctx.textAlign='center';ctx.fillText(p.name,128,32);const sprite=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),depthTest:true}));sprite.scale.set(1.8,.34,1);sprite.position.y=2.1;root.add(sprite);
  root.position.fromArray(p.pos);G.scene.add(root);return {root,body,head,legs,gun,ring,defaultVisuals:root.children.filter(o=>o!==gun&&o!==ring&&o!==sprite),wantedAvatar:null,avatarId:null,avatarObject:null,target:new T.Vector3(...p.pos),extrapolated:new T.Vector3(...p.pos),velocity:new T.Vector3(),receivedAt:performance.now(),connected:p.connected,yaw:p.yaw,previous:root.position.clone(),phase:0};
 }
 function updateScoreboard(){const tbody=$('#score-rows');tbody.replaceChildren();for(const p of [...state.players].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths||a.name.localeCompare(b.name))){const row=document.createElement('tr');if(p.id===id)row.className='self';for(const value of [p.name+(p.id===id?' · 你':''),p.kills,p.deaths]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}tbody.append(row);}}
 function onState(next){
  const prev=state;state=next;avatarEditor?.setPhase(next.phase);clockSample(next.now+ping/2-Date.now(),.02);own=next.players.find(p=>p.id===id);if(!own)return;avatarEditor?.setPlayerState?.(own,next.round);
  $('#live-code').textContent=next.code;$('#population').textContent=`${next.players.filter(p=>p.connected).length}/8 在线`;$('#code').textContent=next.code;
  $('#roster').replaceChildren();for(const p of next.players){const row=document.createElement('div');row.className='roster-player';row.textContent=`${p.name}${p.id===id?' · 你':''}${p.id===next.host?' · 房主':''}${p.connected?'':' · 掉线中'}${next.phase==='preparing'?' · '+({pending:'待选择',default:'默认外观',generating:'生成中',ready:'已完成',failed:'失败，可重试或选默认'}[p.avatarPreparation]||'待选择'):''}`;$('#roster').append(row);}
  $('#start-game').hidden=id!==next.host;$('#start-game').disabled=next.players.length<2||next.phase==='preparing';$('#wait-hint').textContent=next.players.length<2?'等待朋友加入，至少 2 人才能开始。':id===next.host?'所有玩家已就位，由你开始。':'等待房主开始对局。';
  preparationHint();
  for(const p of next.players){if(p.id===id)continue;let remote=remotes.get(p.id);if(!remote){remote=makeRemote(p);remotes.set(p.id,remote);}if(remote.wantedAvatar!==(p.avatarId||null))void updateAppearance(remote,p.avatarId||null);if(remote.spawnSerial!==p.spawnSerial){remote.root.position.fromArray(p.pos);remote.spawnSerial=p.spawnSerial;}remote.target.fromArray(p.pos);remote.velocity.fromArray(p.vel);remote.connected=p.connected;remote.receivedAt=performance.now();remote.yaw=p.yaw;remote.crouching=p.crouching;remote.protectedUntil=p.protectedUntil;remote.root.visible=p.alive&&next.phase==='playing';}
  for(const [pid,remote] of remotes)if(!next.players.some(p=>p.id===pid)){disposeRemote(remote);remotes.delete(pid);}
  if(next.phase==='playing'){
   const newRound=round!==next.round;const respawn=spawnSerial!==own.spawnSerial;
   if(newRound||respawn){round=next.round;spawnSerial=own.spawnSerial;G.player.reset({pos:new T.Vector3(...own.pos),yaw:own.yaw});G.weapon.reset();G.weapon.reserve=9999;G.weapon.setVisible(true);G.hud.reset?.();G.hud.show(true);$('#death-notice').hidden=true;$('#scoreboard').hidden=true;scoreOpen=false;setControls(true);$('#resume-game').hidden=!!G.input.locked||G.input.touch;}
   // Ignore tiny drift, spread moderate correction across frames, snap only large errors.
   const authoritative=new T.Vector3(...own.pos),error=G.player.pos.distanceTo(authoritative);correction.set(0,0,0);if(own.alive){if(error>1.2){G.player.pos.copy(authoritative);G.player.vel.fromArray(own.vel);}else if(error>.08)correction.copy(authoritative).sub(G.player.pos);}
   if(own.health<G.player.health){G.player.addShake(.35);G.events.emit('player:hit',{amount:G.player.health-own.health,fromPos:null});}
   G.player.health=own.health;G.player.alive=own.alive;
   if(G.weapon.state==='idle'&&performance.now()-lastLocalShot>250&&!own.reloadAt)G.weapon.ammo=own.ammo;
   if(!own.alive){setControls(false);G.weapon.setVisible(false);}else{G.weapon.setVisible(true);if(!connected)setControls(false);}
   game.state='playing';$('#lobby').hidden=true;$('#match-strip').hidden=false;$('#live-score').hidden=false;$('#live-score').textContent=`${own.kills} 击杀 / ${own.deaths} 阵亡`;
   if(newRound){$('#score-title').textContent='战场记录';$('#winner').textContent='';$('#rematch').hidden=true;$('#return-lobby').hidden=true;setControls(true);$('#resume-game').hidden=!!G.input.locked||G.input.touch;}
  }else if(next.phase==='finished'){
   game.state='finished';$('#lobby').hidden=true;$('#match-strip').hidden=false;$('#clock').textContent='00:00';setControls(false);G.weapon.setVisible(false);unlock();$('#death-notice').hidden=true;$('#resume-game').hidden=true;$('#scoreboard').hidden=false;$('#score-title').textContent='本局结束';$('#rematch').hidden=id!==next.host;$('#return-lobby').hidden=false;$('#rematch').disabled=next.players.length<2;
   const max=Math.max(...next.players.map(p=>p.kills));const winners=next.players.filter(p=>p.kills===max).map(p=>p.name);$('#winner').textContent=`${winners.join('、')}${winners.length>1?' 并列第一':' 获胜'} · ${max} 击杀`;
  }else{game.state=next.phase==='preparing'?'preparing':'lobby';setControls(false);G.weapon.setVisible(false);G.hud.show(false);unlock();$('#match-strip').hidden=true;$('#live-score').hidden=true;$('#scoreboard').hidden=true;$('#resume-game').hidden=true;$('#lobby').hidden=false;$('#room-info').hidden=false;}
  updateScoreboard();
 }
 function feed(message){const line=document.createElement('div');line.textContent=message;$('#kill-feed').prepend(line);setTimeout(()=>line.remove(),5500);while($('#kill-feed').children.length>4)$('#kill-feed').lastChild.remove();}
 function onShot(event){if(event.id!==id){G.fx.tracer?.(new T.Vector3(...event.origin),new T.Vector3(...event.end));}else{if(event.target)G.hud.hitmarker?.(event.killed?'kill':'hit');}if(event.killed)feed(`${nameFor(event.id)}  ›  ${nameFor(event.target)}`);}
 function resumeFailed(message='房间已失效，请返回大厅。'){
  clearTimeout(retryTimer);clearTimeout(deadlineTimer);clearTimeout(handshakeTimer);reconnectUntil=0;intentional=true;saveToken(null);connected=false;setControls(false);unlock();avatarToken=null;avatarEditor?.disconnected();socket?.close();$('#lobby').hidden=false;$('#connect-form').hidden=true;$('#room-info').hidden=true;$('#scoreboard').hidden=true;status(message);const button=document.createElement('button');button.textContent='返回大厅';button.onclick=leave;$('#status').append(document.createElement('br'),button);
 }
 function scheduleReconnect(){
  if(intentional)return;if(!reconnectUntil){reconnectUntil=Date.now()+RESUME_GRACE_MS;deadlineTimer=setTimeout(()=>resumeFailed(),RESUME_GRACE_MS);}if(Date.now()>=reconnectUntil){resumeFailed();return;}
  status('正在重新连接…');retryTimer=setTimeout(connect,Math.min(8000,500*2**Math.min(attempt++,4),reconnectUntil-Date.now()));
 }
 function connect(){
  if(intentional)return;const ws=socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);window.__pvp={get socket(){return socket;},get state(){return state;},get id(){return id;},get remotes(){return remotes;}};
  $('#create-room').disabled=true;$('#join-room').disabled=true;
  clearTimeout(handshakeTimer);handshakeTimer=setTimeout(()=>ws.close(),4000);
  ws.onmessage=event=>{if(ws!==socket||intentional)return;lastMessage=performance.now();const data=JSON.parse(event.data);
   if(data.type==='hello'){
    if(resumeToken){send({type:'resume',token:resumeToken});return;}
    clearTimeout(handshakeTimer);id=data.id;avatarToken=data.avatarToken;connected=true;attempt=0;reconnectUntil=0;clearTimeout(deadlineTimer);status('服务器已连接 · 创建房间或输入房间码');$('#create-room').disabled=false;$('#join-room').disabled=false;void avatarEditor?.connected();
   }else if(data.type==='avatarConfig'){avatarEditor?.updateConfig(data.config);}
   else if(data.type==='joined'||data.type==='resumed'){
    clearTimeout(handshakeTimer);clearTimeout(deadlineTimer);clearTimeout(retryTimer);id=data.id;saveToken(data.resumeToken);connected=true;joining=false;attempt=0;reconnectUntil=0;
    if(data.type==='resumed'){avatarToken=data.avatarToken;spawnSerial=-1;void avatarEditor?.connected();}
    $('#connect-form').hidden=true;$('#room-info').hidden=false;status('分享邀请链接，让朋友进入同一个港口。');const url=new URL(location.href);url.searchParams.set('room',data.code);history.replaceState(null,'',url);
   }else if(data.type==='state')onState(data);else if(data.type==='shot')onShot(data);
   else if(data.type==='pong'){ping=Math.max(0,Math.round(performance.now()-data.sent));clockSample(data.serverTime+ping/2-Date.now());}
   else if(data.type==='error'){joining=false;if(resumeToken&&!connected)resumeFailed(data.message);else status(data.message);}
  };
  ws.onclose=event=>{if(ws!==socket||intentional)return;clearTimeout(handshakeTimer);avatarToken=null;avatarEditor?.disconnected();connected=false;joining=false;setControls(false);unlock();$('#resume-game').hidden=true;if(event.code===4001){resumeFailed('此玩家已在另一个连接恢复，请返回大厅。');return;}scheduleReconnect();};
  ws.onerror=()=>status('正在重新连接…');
 }
 function leave(){intentional=true;saveToken(null);clearTimeout(retryTimer);clearTimeout(deadlineTimer);clearTimeout(handshakeTimer);send({type:'leave'});connected=false;setControls(false);const done=()=>{location.href=location.pathname;};if(socket?.readyState===WebSocket.OPEN){const onLeft=event=>{if(JSON.parse(event.data).type==='left'){socket.removeEventListener('message',onLeft);done();}};socket.addEventListener('message',onLeft);setTimeout(done,300);}else done();}
 if(reconnectUntil)deadlineTimer=setTimeout(()=>resumeFailed(),RESUME_GRACE_MS);
 $('#create-room').onclick=()=>join('create');$('#join-room').onclick=()=>join('join');
 function join(type){if(!connected||joining)return;const name=$('#nickname').value.trim()||'无名干员';const code=$('#room-code').value.trim().toUpperCase();if(type==='join'&&!/^[A-F0-9]{6}$/.test(code)){status('请输入完整的 6 位房间码');return;}joining=true;try{localStorage.setItem('saltline.callsign',name);}catch{}send({type,name,code});}
 $('#start-game').onclick=()=>{G.audio.resume?.();send({type:'start'});};$('#rematch').onclick=()=>send({type:'start'});$('#return-lobby').onclick=leave;
 $('#copy-room').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);status('邀请链接已复制');}catch{status(`复制地址栏链接即可邀请 · 房间码 ${state.code}`);}};
 $('#resume-game').onclick=capture;G.renderer.domElement.addEventListener('click',()=>{if(own?.alive&&!scoreOpen)capture();});
 $('#leave-game').onclick=leave;
 $('#quality').value=G.quality.name;$('#quality').onchange=()=>{const url=new URL(location.href);url.searchParams.set('q',$('#quality').value);location.href=url.href;};
 $('#show-scores').onclick=()=>{scoreOpen=!scoreOpen;$('#scoreboard').hidden=!scoreOpen;if(scoreOpen){setControls(false);unlock();}};
 addEventListener('keydown',e=>{if(e.code==='Tab'&&state?.phase==='playing'&&!avatarEditor?.isOpen()){e.preventDefault();scoreOpen=true;$('#scoreboard').hidden=false;}if(e.code==='Escape'&&state?.phase==='playing'){setControls(false);$('#resume-game').hidden=!own?.alive;}});
 addEventListener('keyup',e=>{if(e.code==='Tab'&&state?.phase==='playing'&&!avatarEditor?.isOpen()){scoreOpen=false;$('#scoreboard').hidden=true;}});
 document.addEventListener('pointerlockchange',()=>{if(state?.phase==='playing'&&own?.alive){const locked=!!document.pointerLockElement;setControls(locked||G.input.touch);$('#resume-game').hidden=locked||G.input.touch;}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){setControls(false);sendInput();}});
 setInterval(()=>{if(connected)send({type:'ping',sent:performance.now()});},2000);
 avatarEditor=mountAvatarEditor(G,{container:ui,triggers:[$('#open-avatar-lobby'),$('#edit-avatar-match')],getToken:()=>avatarToken,onOpen:()=>{setControls(false);unlock();sendInput();},onClose:()=>{if(state?.phase==='playing'&&own?.alive)$('#resume-game').hidden=false;}});
 addEventListener('pagehide',()=>avatarEditor.dispose(),{once:true});
 connect();return game;
};
