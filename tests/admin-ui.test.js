import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {validateProvider} from '../server/control/store.js';

// 执行真实后台脚本；仅模拟页面宿主，不依赖安全上下文或 WebGL。
async function fixture(crypto){
 const elements=new Map();
 const $=selector=>{if(!elements.has(selector))elements.set(selector,{value:'',checked:false,hidden:false,classList:{toggle(){}},addEventListener(){}});return elements.get(selector);};
 const context=vm.createContext({crypto,document:{querySelector:$,querySelectorAll:()=>[]},addEventListener(){},confirm:()=>true,setTimeout:()=>0,clearTimeout(){},fetch:async()=>({ok:true,json:async()=>({authenticated:false,configured:true})})});
 const source=await readFile(new URL('../public/admin/admin.js',import.meta.url),'utf8');
 await vm.runInContext('(async()=>{'+source+';globalThis.ui={providers,setConfig:c=>config=c};})()',context);
 context.ui.setConfig({providers:[],activeProviderId:null});
 return{ui:context.ui,$};
}
for(const [label,crypto]of [['仅 getRandomValues',{getRandomValues:array=>{for(let i=0;i<array.length;i++)array[i]=i+1;return array;}}],['无 crypto',undefined]]){
 test('HTTP 后台在'+label+'时可打开空接口表单并新增接口',async()=>{
  const {ui,$}=await fixture(crypto);
  await ui.providers();
  assert.match($('#content').innerHTML,/id="provider-form"/);
  for(const field of ['provider-name','provider-protocol','provider-url','provider-model','provider-key'])assert.ok($('#content').innerHTML.includes('id="'+field+'"'));
  const first=$('#content').innerHTML.match(/id="provider-id" value="([^"]+)"/)[1];
  $('#add-provider').onclick();
  const second=$('#content').innerHTML.match(/id="provider-id" value="([^"]+)"/)[1];
  assert.match(second,/^provider-[a-z0-9-]+$/i);assert.notEqual(first,second);
  for(const id of [first,second]){
   assert.ok(id.length<=40,'新建接口编号不得超过服务端40字符限制');
   assert.doesNotThrow(()=>validateProvider({id,name:'新接口',baseURL:'https://example.test/v1',protocol:'responses',model:'test-model'}));
  }
 });
}
