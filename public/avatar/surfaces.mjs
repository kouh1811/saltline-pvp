export function surfaceMaterial(T,n){
 const m=new T.MeshPhysicalMaterial({color:n.gradient||n.pattern?'#ffffff':n.color,metalness:n.metal??0,roughness:n.rough??.8,opacity:n.opacity??1,transparent:(n.opacity??1)<1,depthWrite:(n.opacity??1)===1,clearcoat:n.clearcoat??0,sheen:n.sheen??0,sheenColor:n.color,emissive:n.emissive?.color??'#000000',emissiveIntensity:n.emissive?.intensity??0});
 if(!n.gradient&&!n.pattern)return m;
 const colors=a=>a.map(c=>{const v=new T.Color(c);return `vec3(${v.r.toFixed(6)},${v.g.toFixed(6)},${v.b.toFixed(6)})`;});
 m.onBeforeCompile=shader=>{
 shader.vertexShader='varying vec3 avatarPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\navatarPoint = position;');
 let code='vec3 avatarColor = vec3(1.0);';
 if(n.gradient){const c=colors(n.gradient.colors),axis=n.gradient.axis,span=n.size['xyz'.indexOf(axis)];code+=`float avatarT=clamp(avatarPoint.${axis}/${span.toFixed(6)}+0.5,0.0,1.0);avatarColor=${c.length===2?`mix(${c[0]},${c[1]},avatarT)`:`mix(mix(${c[0]},${c[1]},min(avatarT*2.0,1.0)),${c[2]},max(avatarT*2.0-1.0,0.0))`};`;}
 if(n.pattern){const c=colors(n.pattern.colors),k=n.pattern.scale.toFixed(3);code+=`vec3 avatarP=avatarPoint*${k};float avatarMask=${n.pattern.type==='stripes'?'step(0.5,fract(avatarP.y))':n.pattern.type==='checker'?'mod(floor(avatarP.x)+floor(avatarP.y)+floor(avatarP.z),2.0)':'step(0.25,length(fract(avatarP)-0.5))'};avatarColor*=mix(${c[0]},${c[1]},avatarMask);`;}
 shader.fragmentShader='varying vec3 avatarPoint;\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+code+'\ndiffuseColor.rgb *= avatarColor;');
 };
 m.customProgramCacheKey=()=>JSON.stringify([n.gradient,n.pattern,n.size]);return m;
}
