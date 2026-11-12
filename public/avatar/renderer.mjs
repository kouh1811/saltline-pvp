import {validate,instances} from './schema.mjs';
export function createAvatar(T,recipe){
 const budget=validate(recipe),start=performance.now(),root=new T.Group(),nodes=new Map(),cache=new Map();let triangles=0;
 const material=(color,metal=0,rough=.8)=>{const key=[color,metal,rough].join();if(!cache.has(key))cache.set(key,new T.MeshStandardMaterial({color,metalness:metal,roughness:rough}));return cache.get(key);};
 const vector=a=>new T.Vector3(...a);
 function tube(n){
  const curve=new T.CatmullRomCurve3(n.points.map(vector),false,'centripetal'),steps=Math.max(24,n.points.length*10),sides=10,frames=curve.computeFrenetFrames(steps,false),positions=[],indices=[];
  for(let i=0;i<=steps;i++){const u=i/steps,pt=curve.getPointAt(u),v=u*(n.radii.length-1),k=Math.min(n.radii.length-2,Math.floor(v)),r=T.MathUtils.lerp(n.radii[k],n.radii[k+1],v-k);for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,q=pt.clone().addScaledVector(frames.normals[i],Math.cos(a)*r).addScaledVector(frames.binormals[i],Math.sin(a)*r);positions.push(...q.toArray());}}
  for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+sides+1;indices.push(a,b,a+1,b,b+1,a+1);}
  for(const end of [0,steps]){const center=positions.length/3;positions.push(...curve.getPointAt(end/steps).toArray());for(let j=0;j<sides;j++){const a=end*(sides+1)+j;indices.push(center,end===0?a+1:a,end===0?a:a+1);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();g.scale(...n.size);return g;
 }
 function geometry(n){const [x,y,z]=n.size;let g;if(n.shape==='tube')return tube(n);if(n.shape==='ellipsoid')g=new T.SphereGeometry(.5,28,20);if(n.shape==='cone')g=new T.ConeGeometry(.5,1,20);if(n.shape==='torus')g=new T.TorusGeometry(.4,.1,10,32);if(n.shape==='box'){
  const r=Math.min(.03,x*.1,y*.1,z*.1),s=new T.Shape(),a=x/2-r,b=y/2-r;s.moveTo(-a,-b);s.lineTo(a,-b);s.lineTo(a,b);s.lineTo(-a,b);s.closePath();g=new T.ExtrudeGeometry(s,{depth:z-2*r,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:r,bevelThickness:r});g.translate(0,0,-z/2+r);return g;
 }g.scale(x,y,z);return g;}
 try{
 for(const n of recipe.nodes){const parents=n.parent?nodes.get(n.parent):[{pivot:root}],copies=[],g=geometry(n),mat=material(n.color,n.metal,n.rough);triangles+=(g.index?g.index.count:g.attributes.position.count)/3;
  for(const parent of parents)for(const instance of instances(n)){const rotation=new T.Group();if(instance.mirror)rotation.scale.x=-1;rotation.rotation[instance.axis]=instance.angle;parent.pivot.add(rotation);const pivot=new T.Group();pivot.position.fromArray(n.pos);pivot.rotation.set(...(n.rot||[0,0,0]));rotation.add(pivot);const mesh=new T.Mesh(g,mat);mesh.castShadow=mesh.receiveShadow=true;pivot.add(mesh);copies.push({pivot,geometry:g});}nodes.set(n.id,copies);
 }
 let seed=1777;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(const d of recipe.details)for(const entry of nodes.get(d.on)){
  const g=entry.geometry,position=g.attributes.position,index=g.index,areas=[],faces=[];let sum=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3();
  for(let i=0;i<(index?index.count:position.count);i+=3){const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);normal.copy(b).sub(a).cross(c.clone().sub(a));const area=normal.length()/2;if(area<1e-10)continue;normal.normalize();if(d.region==='front'&&normal.z>-.15||d.region==='back'&&normal.z<.15||d.region==='top'&&normal.y<.15||d.region==='bottom'&&normal.y>-.15)continue;sum+=area;areas.push(sum);faces.push({ids,normal:normal.clone()});}
  if(!faces.length)throw Error('No surface for '+d.on+' '+d.region);
  let tuft;if(d.type==='fur')tuft=new T.ConeGeometry(.5,1,3);else if(d.type==='feathers'||d.type==='scales')tuft=new T.SphereGeometry(.5,6,4);else if(d.type==='suckers')tuft=new T.TorusGeometry(.35,.15,5,10);else tuft=new T.CylinderGeometry(.5,.5,1,6);
  const inst=new T.InstancedMesh(tuft,material(d.color,d.type==='bolts'?.7:0,d.type==='fur'?1:.8),d.count),matrix=new T.Matrix4(),quat=new T.Quaternion(),up=new T.Vector3(0,1,0),point=new T.Vector3(),scale=new T.Vector3(),col=new T.Color(d.color);inst.castShadow=d.type!=='fur';inst.receiveShadow=true;
  for(let i=0;i<d.count;i++){const r=random()*sum;let lo=0,hi=areas.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(areas[mid]<r)lo=mid+1;else hi=mid;}const f=faces[lo];a.fromBufferAttribute(position,f.ids[0]);b.fromBufferAttribute(position,f.ids[1]);c.fromBufferAttribute(position,f.ids[2]);const u=Math.sqrt(random()),v=random();point.copy(a).multiplyScalar(1-u).addScaledVector(b,u*(1-v)).addScaledVector(c,u*v);
   normal.copy(f.normal);if(d.type==='fur'){const flow=vector(d.direction||[0,-1,0]);if(flow.lengthSq()<.0001)flow.set(0,-1,0);flow.normalize();const tangent=flow.clone().addScaledVector(normal,-flow.dot(normal));if(tangent.lengthSq()>.005)normal.multiplyScalar(.28).addScaledVector(tangent.normalize(),.96).normalize();}else if(d.direction)normal.addScaledVector(vector(d.direction),.7).normalize();const length=d.length*(.65+random()*.7),width=d.width*(.8+random()*.4);point.addScaledVector(normal,length*.32);quat.setFromUnitVectors(d.type==='suckers'?new T.Vector3(0,0,1):up,normal);scale.set(width,length,d.type==='fur'?width:d.type==='feathers'?width*.18:width);if(d.type==='suckers')scale.set(width,width,length*.3);matrix.compose(point,quat,scale);inst.setMatrixAt(i,matrix);{const shade=.88+random()*.22;inst.setColorAt(i,new T.Color(shade,shade,shade));}}
  inst.instanceMatrix.needsUpdate=true;inst.computeBoundingSphere?.();entry.pivot.add(inst);
 }
 root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(root),height=bounds.max.y-bounds.min.y;if(!Number.isFinite(height)||height<.1||height>12)throw Error('Character height invalid');const result=new T.Group();root.position.y=-bounds.min.y;result.add(root);result.scale.setScalar(1.8/height);result.userData={name:recipe.name,parts:budget.instances,surface:budget.surface,triangles,buildMs:performance.now()-start,height:1.8,sourceHeight:height};return result;
 }catch(error){root.traverse(n=>n.geometry?.dispose());cache.forEach(m=>m.dispose());throw error;}
}

export function disposeAvatar(root){const geometries=new Set(),materials=new Set();root.traverse(n=>{if(n.geometry)geometries.add(n.geometry);if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])materials.add(m);if(n.isInstancedMesh)n.dispose?.();});geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});root.removeFromParent();}
