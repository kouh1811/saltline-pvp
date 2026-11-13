import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {validate,LIMITS} from '../public/avatar/schema.mjs';
import {createAvatar,disposeAvatar} from '../public/avatar/renderer.mjs';
const node={id:'body',shape:'capsule',pos:[0,1,0],size:[1,2,1],color:'#4488cc'};
const recipe=n=>({version:3,name:'Quality',nodes:[{...node,...n}],details:[]});
test('v3 primitives render finite bounded geometry',()=>{for(const n of [{},{shape:'lathe',points:[[0,-.5],[.5,0],[0,.5]]},{shape:'superellipsoid',roundness:.4},{shape:'eye',iris:'#44bbcc',pupil:'#112233',direction:[0,0,-1]}]){validate(recipe(n));const root=createAvatar(T,recipe(n));root.traverse(o=>{if(o.geometry)assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});assert.ok(root.userData.triangles>0);disposeAvatar(root);}});
test('v3 bounded materials survive rendering',()=>{const r=recipe({gradient:{axis:'y',colors:['#112233','#abcdef','#ffffff']},pattern:{type:'spots',colors:['#ffffff','#000000'],scale:8},emissive:{color:'#00aaff',intensity:1},opacity:.7,clearcoat:.8,sheen:.4});validate(r);const root=createAvatar(T,r);let mat;root.traverse(o=>{if(o.isMesh)mat=o.material;});assert.equal(mat.opacity,.7);assert.equal(mat.clearcoat,.8);assert.equal(mat.emissiveIntensity,1);disposeAvatar(root);});
test('v3 rejects invalid shape and material parameters',()=>{for(const n of [{shape:'lathe',points:[[0,0],[1,1]]},{shape:'lathe',points:[[0,0],[-1,1],[0,2]]},{roundness:0,shape:'superellipsoid'},{opacity:.1},{emissive:{color:'#ffffff',intensity:9}},{pattern:{type:'noise',colors:['#ffffff','#000000'],scale:1}},{shape:'eye',direction:[0,0,0]},{gradient:{axis:'w',colors:['#ffffff','#000000']}}])assert.throws(()=>validate(recipe(n)));});
test('v3 budgets and v2 compatibility',()=>{assert.deepEqual(LIMITS,{nodes:120,instances:400,details:40,surface:30000,bytes:400000});const r=recipe({shape:'ellipsoid'});r.nodes=Array.from({length:120},(_,i)=>({...r.nodes[0],id:'n'+i}));validate(r);assert.throws(()=>validate({...r,nodes:[...r.nodes,{...node,id:'extra'}]}),/nodes budget/);const v2={...recipe({shape:'ellipsoid'}),version:2};assert.deepEqual(validate(v2),{instances:1,surface:0});const a=createAvatar(T,v2),b=createAvatar(T,v2);assert.deepEqual(a.toJSON().geometries.map(g=>g.type),b.toJSON().geometries.map(g=>g.type));disposeAvatar(a);disposeAvatar(b);});
test('exact expanded instance, detail rule, surface and UTF-8 byte edges',()=>{
 const r=recipe({shape:'ellipsoid'});r.nodes=Array.from({length:16},(_,i)=>({...r.nodes[0],id:'n'+i,repeat:{count:12,axis:'y',angle:6.28},mirror:true}));r.nodes.push({...node,id:'last',shape:'ellipsoid',repeat:{count:8,axis:'y',angle:6.28},mirror:true});assert.equal(validate(r).instances,400);r.nodes.push({...node,id:'over',shape:'ellipsoid'});assert.throws(()=>validate(r),/instances budget/);
 const d={on:'body',type:'fur',count:750,length:.01,width:.002,color:'#ffffff'};const a=recipe({shape:'ellipsoid'});a.details=Array.from({length:40},()=>({...d}));assert.equal(validate(a).surface,30000);a.details[0].count++;assert.throws(()=>validate(a),/surface budget/);a.details[0].count--;a.details.push(d);assert.throws(()=>validate(a),/details budget/);
 const big=recipe({shape:'tube',points:Array.from({length:12},(_,i)=>[i/4,1.1234567890123457,1.1234567890123457]),radii:Array(12).fill(.12345678901234567)});big.nodes=Array.from({length:120},(_,i)=>({...big.nodes[0],id:'n'+i,gradient:{axis:'y',colors:['#ffffff','#aaaaaa','#000000']},pattern:{type:'spots',colors:['#ffffff','#000000'],scale:32}}));validate(big);assert.ok(new TextEncoder().encode(JSON.stringify(big)).length>60000);
});
test('all pattern shaders and gradient variants inject stable procedural code',()=>{for(const type of ['stripes','spots','checker'])for(const colors of [['#112233','#ffffff'],['#112233','#aabbcc','#ffffff']]){const root=createAvatar(T,recipe({pattern:{type,colors:['#ffffff','#444444'],scale:12},gradient:{axis:'x',colors}}));root.traverse(o=>{if(o.isMesh){const shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};o.material.onBeforeCompile(shader);assert.match(shader.vertexShader,/avatarPoint = position/);assert.match(shader.fragmentShader,/diffuseColor.rgb \*= avatarColor/);assert.equal(shader.fragmentShader.includes('undefined'),false);}});disposeAvatar(root);}});
test('v2 geometry, world transforms, materials and seeded instanced details match pre-v3 baseline',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');const baseline=JSON.parse(await readFile(new URL('./avatar-v2-baseline.json',import.meta.url),'utf8')),root=createAvatar(T,baseline.recipe),hash=createHash('sha256');root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;hash.update(JSON.stringify({matrix:o.matrixWorld.elements,index:o.geometry.index?Array.from(o.geometry.index.array):null,attributes:Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,v])=>[k,Array.from(v.array)])),material:[o.material.type,o.material.color.getHex(),o.material.metalness,o.material.roughness],instance:o.instanceMatrix?Array.from(o.instanceMatrix.array):null,colors:o.instanceColor?Array.from(o.instanceColor.array):null}));});assert.equal(hash.digest('hex'),baseline.fingerprint);disposeAvatar(root);
});
test('v3 repeated parts and eyes batch without changing expanded budget',()=>{const r=recipe({shape:'eye',mirror:true,repeat:{count:4,axis:'y',angle:6.28}}),root=createAvatar(T,r);let batches=0,draws=0;root.traverse(o=>{if(o.isMesh){draws++;if(o.isInstancedMesh){batches++;assert.equal(o.count,4);const matrix=new T.Matrix4();for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);assert.ok(matrix.determinant()>0);};}}});assert.equal(root.userData.parts,8);assert.equal(batches,8);assert.equal(draws,8);disposeAvatar(root);});
test('serialized byte boundary counts UTF-8 bytes exactly, and v3 requires explicit version',()=>{const r={...recipe({shape:'box'}),version:2};r.nodes[0].points='';const size=new TextEncoder().encode(JSON.stringify(r)).length;r.nodes[0].points='x'.repeat(LIMITS.bytes-size);validate(r);r.nodes[0].points+='x';assert.throws(()=>validate(r),/bytes budget/);assert.throws(()=>validate({...recipe(),version:2}),/version 3/);});

import {createGameServer} from '../server/index.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('serves v3 quality and surface modules', async () => {
  const dir=await mkdtemp(join(tmpdir(),'saltline-static-'));
  const app=createGameServer({controlDbPath:':memory:',avatarDataDir:dir});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  try {
    for (const path of ['/avatar/quality.mjs','/avatar/surfaces.mjs','/avatar/schema.mjs','/avatar/renderer.mjs']) {
      const res=await fetch(base+path);
      assert.equal(res.status,200,path);
      assert.match(res.headers.get('content-type')||'',/javascript/);
      assert.ok((await res.text()).length>100,path);
    }
  } finally {
    await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});
