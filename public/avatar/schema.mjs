export const LIMITS=Object.freeze({nodes:120,instances:400,details:40,surface:30000,bytes:400000});
const fail=m=>{throw Error(m);};
const fields=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o))fail('object required');for(const k of Object.keys(o))if(!allowed.includes(k))fail('unknown field '+k);};
const num=(n,min,max)=>{if(!Number.isFinite(n)||n<min||n>max)fail('number range');};
const vec=(v,positive=false)=>{if(!Array.isArray(v)||v.length!==3||!v.every(n=>Number.isFinite(n)&&Math.abs(n)<=8&&(!positive||n>0)))fail('invalid vector');};
const color=c=>{if(typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c))fail('invalid color');};
export function instances(node){const result=[],r=node.repeat;for(let i=0;i<(r?.count||1);i++){result.push({angle:r?i*r.angle/r.count:0,axis:r?.axis||'y',mirror:false});if(node.mirror)result.push({...result[result.length-1],mirror:true});}return result;}
export function validate(recipe){
 fields(recipe,['version','name','description','nodes','details']);if(![2,3].includes(recipe.version))fail('version');if(typeof recipe.name!=='string'||recipe.name.length>60)fail('name');if(recipe.description!==undefined&&(typeof recipe.description!=='string'||recipe.description.length>800))fail('description');
 if(!Array.isArray(recipe.nodes)||!recipe.nodes.length||recipe.nodes.length>LIMITS.nodes)fail('nodes budget');if(!Array.isArray(recipe.details)||recipe.details.length>LIMITS.details)fail('details budget');
 if(new TextEncoder().encode(JSON.stringify(recipe)).length>LIMITS.bytes)fail('bytes budget');
 const known=new Map();let total=0;
 for(const n of recipe.nodes){fields(n,['id','parent','shape','pos','size','rot','color','metal','rough','points','radii','mirror','repeat','roundness','gradient','pattern','emissive','opacity','clearcoat','sheen','iris','pupil','direction']);if(typeof n.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(n.id)||known.has(n.id))fail('id');if(n.parent!==null&&n.parent!==undefined&&!known.has(n.parent))fail('parent must precede child');
  if(!['ellipsoid','box','cone','torus','tube','capsule','lathe','superellipsoid','eye'].includes(n.shape))fail('shape');vec(n.pos);vec(n.size,true);if(n.rot)vec(n.rot);color(n.color);if(n.metal!==undefined)num(n.metal,0,1);if(n.rough!==undefined)num(n.rough,.2,1);if(n.mirror!==undefined&&typeof n.mirror!=='boolean')fail('mirror');
  if(recipe.version===2&&( ['capsule','lathe','superellipsoid','eye'].includes(n.shape)||['roundness','gradient','pattern','emissive','opacity','clearcoat','sheen','iris','pupil','direction'].some(k=>n[k]!==undefined)))fail('v3 feature requires version 3');
  if(n.shape==='lathe'){if(!Array.isArray(n.points)||n.points.length<3||n.points.length>16)fail('lathe points');let last=-Infinity;for(const p of n.points){if(!Array.isArray(p)||p.length!==2)fail('lathe point');num(p[0],0,2);num(p[1],-4,4);if(p[1]<=last)fail('lathe profile order');last=p[1];}if(!n.points.some(p=>p[0]>.002))fail('lathe radius');}
  if(n.shape==='superellipsoid')num(n.roundness??1,.15,2);
  for(const k of ['opacity','clearcoat','sheen'])if(n[k]!==undefined)num(n[k],k==='opacity'?.2:0,1);
  if(n.gradient!==undefined){fields(n.gradient,['axis','colors']);if(!['x','y','z'].includes(n.gradient.axis)||!Array.isArray(n.gradient.colors)||![2,3].includes(n.gradient.colors.length))fail('gradient');n.gradient.colors.forEach(color);}
  if(n.pattern!==undefined){fields(n.pattern,['type','colors','scale']);if(!['stripes','spots','checker'].includes(n.pattern.type)||!Array.isArray(n.pattern.colors)||n.pattern.colors.length!==2)fail('pattern');n.pattern.colors.forEach(color);num(n.pattern.scale,1,32);}
  if(n.emissive!==undefined){fields(n.emissive,['color','intensity']);color(n.emissive.color);num(n.emissive.intensity,0,2);}
  if(n.iris!==undefined)color(n.iris);if(n.pupil!==undefined)color(n.pupil);if(n.direction!==undefined){vec(n.direction);if(Math.hypot(...n.direction)<.001)fail('eye direction');}
  if(n.repeat){fields(n.repeat,['count','axis','angle']);if(!Number.isInteger(n.repeat.count)||n.repeat.count<2||n.repeat.count>12)fail('repeat count');if(!['x','y','z'].includes(n.repeat.axis))fail('repeat axis');num(n.repeat.angle,.1,Math.PI*2+.001);}
  if(n.shape==='tube'){if(!Array.isArray(n.points)||n.points.length<2||n.points.length>12||!Array.isArray(n.radii)||n.radii.length!==n.points.length)fail('tube points/radii');n.points.forEach(v=>vec(v));n.radii.forEach(r=>num(r,.002,2));if(n.points.slice(1).reduce((s,p,i)=>s+Math.hypot(...p.map((v,j)=>v-n.points[i][j])),0)<.01)fail('tube length');}
  const count=instances(n).length*(n.parent?known.get(n.parent):1);total+=count;if(total>LIMITS.instances)fail('instances budget');known.set(n.id,count);
 }
 let surface=0;for(const d of recipe.details){fields(d,['on','type','count','length','width','color','region','direction']);if(!known.has(d.on))fail('detail parent');if(!['fur','feathers','scales','bolts','suckers'].includes(d.type))fail('detail type');if(!Number.isInteger(d.count)||d.count<1||d.count>5000)fail('detail count budget');num(d.length,.001,.3);num(d.width,.001,.3);color(d.color);if(d.region&&!['all','front','back','top','bottom'].includes(d.region))fail('region');if(d.direction)vec(d.direction);surface+=d.count*known.get(d.on);if(surface>LIMITS.surface)fail('surface budget');}
 return {instances:total,surface};
}
