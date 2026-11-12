import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {ConfigStore} from '../server/control/store.js';
const key=randomBytes(32).toString('base64');
const provider={id:'primary',name:'主接口',baseURL:'https://example.test/v1',protocol:'responses',model:'test-model',apiKey:'secret-never-public'};
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'saltline-control-'));try{fn(join(dir,'control.sqlite'));}finally{rmSync(dir,{recursive:true,force:true});}}
test('provider secrets are encrypted at rest and masked on read across restart',()=>fixture(path=>{
 let s=new ConfigStore({path,key,env:{}});const c=s.publicConfig();s.markTested(s.prepareProvider(provider));s.save({...c,providers:[provider],activeProviderId:'primary'},c.version);s.close();
 assert.ok(!readFileSync(path).includes(Buffer.from(provider.apiKey)));s=new ConfigStore({path,key,env:{}});assert.equal(s.activeProvider().apiKey,provider.apiKey);assert.ok(!JSON.stringify(s.publicConfig()).includes(provider.apiKey));s.close();
}));
test('untested active edits are rejected, version conflicts rejected and rollback creates a new version',()=>fixture(path=>{
 const s=new ConfigStore({path,key,env:{}}),initial=s.publicConfig();assert.throws(()=>s.save({...initial,providers:[provider],activeProviderId:'primary'},initial.version),/测试/);s.markTested(s.prepareProvider(provider));s.save({...initial,providers:[provider],activeProviderId:'primary'},initial.version);assert.throws(()=>s.save(initial,initial.version),/版本/);
 const latest=s.publicConfig();s.save({...latest,features:{...latest.features,preview:false}},latest.version);assert.equal(s.publicConfig().features.preview,false);s.rollback(latest.version,s.publicConfig().version);assert.equal(s.publicConfig().features.preview,true);assert.ok(s.publicConfig().version>latest.version);s.close();
}));
test('empty key preserves, explicit clear removes, retention and disabled assets persist',()=>fixture(path=>{
 const s=new ConfigStore({path,key,env:{}});s.markTested(s.prepareProvider(provider));s.save({...s.publicConfig(),providers:[provider],activeProviderId:'primary'},1);const c=s.publicConfig();s.save({...c,providers:c.providers.map(p=>({...p,apiKey:''}))},c.version);assert.equal(s.activeProvider().apiKey,provider.apiKey);s.recordAsset({id:'a'.repeat(32),name:'角色'});s.setAssetDisabled('a'.repeat(32),true);assert.equal(s.isAssetDisabled('a'.repeat(32)),true);s.close();
}));
test('explicit key clearing and retention prune preserve asset status',()=>fixture(path=>{
 const s=new ConfigStore({path,key,env:{}});s.markTested(s.prepareProvider(provider));s.save({...s.publicConfig(),providers:[provider],activeProviderId:'primary'},1);
 const c=s.publicConfig();s.save({...c,activeProviderId:null,providers:[{...c.providers[0],clearKey:true}],retentionDays:1},c.version);assert.equal(s.secret(s.current().providers[0]),'');
 s.recordJob({id:'old',prompt:'历史任务',status:'ready',startedAt:Date.now()-3*86400000});s.recordAsset({id:'b'.repeat(32),name:'保留角色'});s.setAssetDisabled('b'.repeat(32),true);s.prune();assert.equal(s.job('old'),null);s.close();
 const again=new ConfigStore({path,key,env:{}});assert.equal(again.publicConfig().retentionDays,1);assert.equal(again.isAssetDisabled('b'.repeat(32)),true);assert.equal(again.publicConfig().providers[0].hasKey,false);again.close();
}));
