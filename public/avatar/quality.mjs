// Generated studio lighting: no external textures; one PMREM shared per renderer.
export function configureAvatarQuality(T,renderer,scene,{ground=false}={}){
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 if(ground){const floor=new T.Mesh(new T.PlaneGeometry(4,4),new T.ShadowMaterial({opacity:.22}));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;floor.receiveShadow=true;scene.add(floor);}
 const studio=new T.Scene();studio.background=new T.Color('#8596aa');
 const panels=[];
 for(const [color,intensity,pos,scale] of [['#fff0d9',4,[-3,4,-3],[3,4,1]],['#bddfff',2,[4,2,1],[2,3,1]]]){const m=new T.MeshBasicMaterial({color});m.color.multiplyScalar(intensity);const g=new T.PlaneGeometry(...scale.slice(0,2)),p=new T.Mesh(g,m);p.position.fromArray(pos);p.lookAt(0,1,0);studio.add(p);panels.push(p);}
 const pmrem=new T.PMREMGenerator(renderer),target=pmrem.fromScene(studio,.08,.1,30);scene.environment=target.texture;
 panels.forEach(p=>{p.geometry.dispose();p.material.dispose();});pmrem.dispose();
 scene.traverse(o=>{if(o.isDirectionalLight&&o.castShadow){o.shadow.mapSize.set(1024,1024);o.shadow.radius=3;o.shadow.normalBias=.025;}});
 return ()=>{if(scene.environment===target.texture)scene.environment=null;target.dispose();};
}
