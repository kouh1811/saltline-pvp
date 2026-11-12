import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModelGenerator} from '../server/avatar-model.js';
import {validate} from '../public/avatar/schema.mjs';
const recipe={version:2,name:'测试角色',nodes:[{id:'body',parent:null,shape:'ellipsoid',pos:[0,1,0],size:[.6,1.6,.5],color:'#88aaff'}],details:[]};
const result=text=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text}]}]})});
test('model adapter sends text only and repairs one invalid structure',async()=>{
 const requests=[];const generate=createModelGenerator({apiKey:'test-secret',baseURL:'https://example.test/v1/',fetchImpl:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return result(JSON.stringify(requests.length===1?{...recipe,nodes:[]}:recipe));}});
 assert.deepEqual(await generate('蓝色机械角色'),recipe);assert.equal(requests.length,2);assert.equal(requests[0].url,'https://example.test/v1/responses');assert.equal(requests[0].body.input,'蓝色机械角色');assert.match(requests[1].body.input,/上轮输出/);assert.ok(!JSON.stringify(requests).includes('test-secret'));
});
test('model API errors hide provider details and incomplete results are rejected',async()=>{
 const generate=createModelGenerator({apiKey:'test-secret',fetchImpl:async()=>({ok:false,status:500,json:async()=>({error:'test-secret'})})});await assert.rejects(generate('测试角色'),e=>!e.message.includes('test-secret')&&e.message.includes('暂时不可用'));
 await assert.rejects(createModelGenerator({apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete'})})})('角色'),/未完成/);
});
test('graph validator bounds repeated child and surface expansion and rejects executable fields',()=>{
 assert.deepEqual(validate(recipe),{instances:1,surface:0});
 assert.throws(()=>validate({...recipe,nodes:[{...recipe.nodes[0],code:'alert(1)'}]}),/unknown field/);
 const nodes=[{...recipe.nodes[0],repeat:{count:12,axis:'y',angle:6.28}},{...recipe.nodes[0],id:'child',parent:'body',repeat:{count:12,axis:'y',angle:6.28},mirror:true}];assert.throws(()=>validate({...recipe,nodes}),/instances budget/);
 assert.throws(()=>validate({...recipe,nodes:[{...recipe.nodes[0],repeat:{count:12,axis:'y',angle:6.28}}],details:[{on:'body',type:'fur',count:5000,length:.01,width:.01,color:'#ffffff'}]}),/surface budget/);
});
test('chat-completions compatibility validates the same declarative graph',async()=>{
 const requests=[];const gen=createModelGenerator({apiKey:'test',baseURL:'https://example.test/v1',protocol:'chat',model:'chat-model',fetchImpl:async(url,o)=>{requests.push({url,body:JSON.parse(o.body)});return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(recipe)}}]})};}});assert.deepEqual(await gen('测试机器人'),recipe);assert.match(requests[0].url,/chat\/completions$/);assert.equal(requests[0].body.messages[1].content,'测试机器人');
});
