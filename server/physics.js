// Collision uses the original level's exported, fixed-seed AABBs.
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function rayBox(origin,dir,box,max=300){
  let near=0,far=max;
  for(let i=0;i<3;i++){
    if(Math.abs(dir[i])<1e-8){if(origin[i]<box.min[i]||origin[i]>box.max[i])return null;continue;}
    let a=(box.min[i]-origin[i])/dir[i],b=(box.max[i]-origin[i])/dir[i];
    if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return null;
  }
  return near;
}
export function raySphere(origin,dir,center,radius){
 const d=origin.map((v,i)=>v-center[i]);const b=d.reduce((a,v,i)=>a+v*dir[i],0),c=d.reduce((a,v)=>a+v*v,0)-radius*radius;
 const disc=b*b-c;if(disc<0)return null;const t=-b-Math.sqrt(disc);return t>=0?t:null;
}
export function movePlayer(p,dt,map){
 const input=p.input, m=input.move, yaw=input.yaw, height=p.crouching?1.15:1.8,r=.32;
 let speed=p.crouching?1.9:input.sprint&&m[1]>.55&&Math.abs(m[0])<.6&&!input.ads?6.4:3.8;
 if(input.ads)speed=Math.min(speed,2.4);if(m[1]<0)speed*=1+.18*m[1];
 const desired=[(m[0]*Math.cos(yaw)-m[1]*Math.sin(yaw))*speed,(-m[0]*Math.sin(yaw)-m[1]*Math.cos(yaw))*speed];
 const diff=[desired[0]-p.vel[0],desired[1]-p.vel[2]],len=Math.hypot(...diff),acc=p.onGround?(Math.hypot(...m)>.1?34:26):9,step=Math.min(1,acc*dt/(len||1));
 p.vel[0]+=diff[0]*step;p.vel[2]+=diff[1]*step;
 if(input.jump&&p.onGround){p.vel[1]=Math.sqrt(42);p.onGround=false;}input.jump=false;
 p.vel[1]-=21*dt*.5;
 const count=Math.max(1,Math.ceil(Math.hypot(p.vel[0]*dt,p.vel[2]*dt)/(.32*.6)));
 for(let k=0;k<count;k++){
   p.pos[0]+=p.vel[0]*dt/count;p.pos[2]+=p.vel[2]*dt/count;
   for(let repeat=0;repeat<3;repeat++)for(const b of map.boxes){
     if(b.bulletOnly||b.max[1]<=p.pos[1]+(p.onGround?.34:.08)||b.min[1]>=p.pos[1]+height)continue;
     const x=clamp(p.pos[0],b.min[0],b.max[0]),z=clamp(p.pos[2],b.min[2],b.max[2]);let dx=p.pos[0]-x,dz=p.pos[2]-z,d=Math.hypot(dx,dz);
     if(d>=r)continue;
     if(d>1e-6){dx/=d;dz/=d;p.pos[0]+=dx*(r-d);p.pos[2]+=dz*(r-d);const dot=p.vel[0]*dx+p.vel[2]*dz;if(dot<0){p.vel[0]-=dx*dot;p.vel[2]-=dz*dot;}}
     else{const sides=[p.pos[0]-b.min[0],b.max[0]-p.pos[0],p.pos[2]-b.min[2],b.max[2]-p.pos[2]],side=sides.indexOf(Math.min(...sides));if(side<2){p.pos[0]=side===0?b.min[0]-r:b.max[0]+r;p.vel[0]=0;}else{p.pos[2]=side===2?b.min[2]-r:b.max[2]+r;p.vel[2]=0;}}
   }
 }
 let ground=p.pos[0]<=(map.quayX??30)+r*.7?0:-50,ceiling=Infinity;const oldY=p.pos[1];
 for(const b of map.boxes){if(b.bulletOnly||p.pos[0]+r*.7<b.min[0]||p.pos[0]-r*.7>b.max[0]||p.pos[2]+r*.7<b.min[2]||p.pos[2]-r*.7>b.max[2])continue;if(b.max[1]<=oldY+(p.onGround?.34:.08)+.0001)ground=Math.max(ground,b.max[1]);if(b.min[1]>=oldY+height-.05)ceiling=Math.min(ceiling,b.min[1]);}
 p.pos[1]+=p.vel[1]*dt;
 if(p.pos[1]+height>ceiling&&p.vel[1]>0){p.pos[1]=ceiling-height;p.vel[1]=0;}
 if(p.pos[1]<=ground||(p.onGround&&p.vel[1]<=0&&p.pos[1]-ground<.34)){p.pos[1]=ground;p.vel[1]=0;p.onGround=true;}else{p.vel[1]-=21*dt*.5;p.onGround=false;}
 if(p.onGround&&p.pos[0]<=(map.quayX??30)-1.2&&p.pos[1]>-.5)p.lastSafe=[...p.pos];
 if(p.pos[1]<(map.seaY??-1.6)-2.2){p.pos=[...(p.lastSafe||map.spawns[0])];p.vel=[0,0,0];p.onGround=true;}
 for(const i of [0,2])p.pos[i]=clamp(p.pos[i],map.bounds.min[i]+.4,map.bounds.max[i]-.4);
}
