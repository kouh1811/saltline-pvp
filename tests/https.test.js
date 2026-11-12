import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {createGameServer} from '../server/index.js';
const password='local-test-password-123';
function request(app,path,{tls=false,headers={},body}={}){return new Promise((resolve,reject)=>{const req=(tls?https:http).request({hostname:'127.0.0.1',port:app.server.address().port,path,method:body?'POST':'GET',rejectUnauthorized:false,headers:{...headers,...(body?{'content-type':'application/json'}:{})}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
async function client(app){const ws=new WebSocket(`wss://127.0.0.1:${app.server.address().port}/ws`,{rejectUnauthorized:false});const queue=[];ws.on('message',r=>queue.push(JSON.parse(r)));await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});return{ws,send:d=>ws.send(JSON.stringify(d)),async wait(type){for(let i=0;i<200;i++){const n=queue.findIndex(d=>d.type===type);if(n>=0)return queue.splice(n,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+type);}};}
test('optional TLS supports HTTPS, WSS create/join and automatic Secure admin cookies',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'saltline-tls-'));let app;
 try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});app=createGameServer({controlDbPath:':memory:',controlKey:Buffer.alloc(32,7),adminPassword:password,tls:{key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'),'utf8')},hsts:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const r=await request(app,'/api/admin/login',{tls:true,body:{password}});assert.equal(r.status,200);assert.match(r.headers['set-cookie'][0],/; Secure/);assert.equal(r.headers['strict-transport-security'],'max-age=86400');const cookie=r.headers['set-cookie'][0].split(';')[0];assert.equal(JSON.parse((await request(app,'/api/admin/session',{tls:true,headers:{cookie}})).text).authenticated,true);
 const a=await client(app),b=await client(app);a.send({type:'create'});const joined=await a.wait('joined');b.send({type:'join',code:joined.code});assert.equal((await b.wait('joined')).code,joined.code);a.ws.close();b.ws.close();
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
test('HTTP stays usable; proxy HTTPS is trusted only with TRUST_PROXY and HSTS is optional',async()=>{
 for(const trustProxy of [false,true]){const app=createGameServer({controlDbPath:':memory:',controlKey:Buffer.alloc(32,7),adminPassword:password,trustProxy,hsts:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));try{
 for(const proto of [undefined,'http','https']){const r=await request(app,'/api/admin/login',{headers:proto?{'x-forwarded-proto':proto}:{},body:{password}});assert.equal(r.status,200);assert.equal(r.headers['set-cookie'][0].includes('; Secure'),trustProxy&&proto==='https');assert.equal(!!r.headers['strict-transport-security'],trustProxy&&proto==='https');const cookie=r.headers['set-cookie'][0].split(';')[0];assert.equal(JSON.parse((await request(app,'/api/admin/session',{headers:{cookie}})).text).authenticated,true);}
 }finally{await app.close();}}
});
