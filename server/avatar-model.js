import {readFile}from'node:fs/promises';import {validate}from'../public/avatar/schema.mjs';
const instructions=await readFile(new URL('./avatar-prompt.txt',import.meta.url),'utf8');
function chatSpeedFields(model){
 const m=String(model||'').toLowerCase();
 if(/k2\.7/.test(m))return{};
 if(/k2\.6/.test(m)||/deepseek/.test(m))return{thinking:{type:'disabled'}};
 if(/kimi-k3|k3\.1/.test(m))return{reasoning_effort:'low'};
 return{thinking:{type:'disabled'},reasoning_effort:'low'};
}
function extractJson(text){
 const raw=String(text||'').trim();
 const fenced=raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
 const candidate=(fenced?fenced[1]:raw).trim();
 const start=candidate.indexOf('{');
 const end=candidate.lastIndexOf('}');
 return start>=0&&end>start?candidate.slice(start,end+1):candidate;
}
export function createModelGenerator({apiKey=process.env.OPENAI_API_KEY,baseURL=process.env.OPENAI_BASE_URL||'https://api.openai.com/v1',model=process.env.AVATAR_MODEL||'gpt-6.1-sol',protocol='responses',fetchImpl=fetch}={}){
 const outputTokens=16000;
 const messageText=value=>{
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(part=>typeof part==='string'?part:part?.text||'').join('');
  return '';
 };
 const post=async(path,body,signal)=>{
  const send=payload=>fetchImpl(baseURL.replace(/\/$/,'')+path,{method:'POST',signal,headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},body:JSON.stringify(payload)});
  let r=await send(body);
  if(path==='/chat/completions'&&r.status===400&&body.reasoning_effort){
   const {reasoning_effort,...rest}=body;body=rest;r=await send(body);
  }
  if(path==='/chat/completions'&&r.status===400&&body.thinking){
   const {thinking,...rest}=body;r=await send(rest);
  }
  return r;
 };
 return async(prompt,{signal}={})=>{
  if(!apiKey)throw Error('角色生成服务尚未配置');
  let input=prompt;
  for(let attempt=0;attempt<2;attempt++){
   const chat=protocol==='chat';
   const body=chat?{model,messages:[{role:'system',content:instructions},{role:'user',content:input}],max_tokens:outputTokens,...chatSpeedFields(model)}:{model,instructions,input,reasoning:{effort:'low'},max_output_tokens:outputTokens};
   const r=await post(chat?'/chat/completions':'/responses',body,signal);
   if(!r.ok)throw Error(r.status===429?'AI 服务繁忙，请稍后再试':'AI 服务暂时不可用，请稍后再试');
   const data=await r.json();let text;
   if(chat){
    const choice=data.choices?.[0];
    text=messageText(choice?.message?.content);
    if(choice?.finish_reason!=='stop'&&!(choice?.finish_reason==='length'&&text.trim()))throw Error('生成未完成，请重试');
   }
   else{if(data.status!=='completed')throw Error('生成未完成，请重试');text=(data.output||[]).flatMap(i=>i.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');}
   if(typeof text!=='string')throw Error('生成结果格式无效，请重试');
   try{const recipe=JSON.parse(extractJson(text));validate(recipe);if(Buffer.byteLength(text)>180000)throw Error('输出超限');return recipe;}catch(error){if(attempt===1)throw Error('生成结果未通过结构检查，请换一种描述重试');input=prompt+'\n上轮输出未通过通用结构检查：'+error.message+'。请重新生成，严格遵守 schema 和预算，所有 tube radii 至少0.002，parent 只引用先前节点，不添加额外字段。';}
  }
 };
}
