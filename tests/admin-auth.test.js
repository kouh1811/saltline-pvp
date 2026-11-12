import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {ConfigStore} from '../server/control/store.js';import {AdminAuth} from '../server/control/auth.js';
test('expired sessions and logout revoke access and secure cookies have required attributes',()=>{
 const s=new ConfigStore({path:':memory:',key:randomBytes(32).toString('base64'),env:{}}),a=new AdminAuth(s,{password:'test-strong-password',secure:true});const session=a.login('test-strong-password','127.0.0.1'),req={headers:{cookie:'saltline_admin='+session.token}};assert.ok(a.session(req));const cookie=a.cookie(session.token);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);a.sessions.get(session.token).expires=Date.now()-1;assert.equal(a.session(req),null);
 const next=a.login('test-strong-password','127.0.0.1');req.headers.cookie='saltline_admin='+next.token;a.logout(req);assert.equal(a.session(req),null);s.close();
});
