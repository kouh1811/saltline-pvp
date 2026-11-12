# 方案：HTTPS、断线重连、延迟补偿

日期：2026-11-12  
基线分支：`optimize/compress-docs-screenshots`（commit `1f44877`）  
工作分支：`optimize/net-https-resume-lag`

本批只做联机质量，不改玩法数值、不改地图枪械、不重写 git 历史、不部署到云服务器、不强制绑定域名。本地 `http://localhost:18453` 必须继续可用。

## 现状

- 服务端只创建 `http.createServer`，默认监听 `0.0.0.0:18453`。客户端已按页面协议选择 `ws` / `wss`。`ADMIN_COOKIE_SECURE` 与 `TRUST_PROXY` 已存在，但 HTTPS 本身未接通。
- 每次 WebSocket 连接都分配新的 UUID。`ws.on('close')` 立即 `room.leave(id)`。对局中不允许中途加入。客户端断线后要求刷新，房间内身份丢失。
- 移动已有客户端预测，误差超过 0.65 才硬校正。远端角色做指数插值。射击用服务器“此刻”的位置做射线，没有位置历史，也没有按延迟回溯。海外 RTT 较高时容易打不准。
- `tests/network.test.js` 里“关闭 socket 后房间人数变为 1”依赖立即离房，实现重连后必须改这条断言。

## 1. HTTPS 就绪（不依赖域名即可完成）

1. 把请求处理函数抽出来，按配置创建 HTTP 或 HTTPS 服务器：
   - 环境变量 `TLS_CERT`、`TLS_KEY` 指向 PEM 文件时，用 `https.createServer`。
   - 未设置时保持现在的 HTTP，默认端口与启动方式不变。
   - `createGameServer(options)` 允许传入 `tls: {cert, key}`（字符串或 Buffer），供测试使用自签名证书。
2. 当本进程在 HTTPS 上，或 `TRUST_PROXY=1` 且请求 `X-Forwarded-Proto` 为 `https` 时，管理 Cookie 自动带 `Secure`。不要在纯本地 HTTP 上误加 `Secure`，以免后台登录失效。
3. 仅在实际 HTTPS 响应上可加短期 `Strict-Transport-Security`；HTTP 响应不要加。
4. 增加 `deploy/Caddyfile` 和简短的 `deploy/compose.yml` 示例：Caddy 自动申请证书，反代网页和 `/ws` 升级。用环境变量 `DOMAIN`，不要写死某个域名。不要在本批启动或登录任何云主机。
5. 更新 `.env.example` 与 README：说明本地仍用 HTTP；公网应把域名指到主机后用 Caddy/反向代理，或直接配置 `TLS_CERT`/`TLS_KEY`；代理后设置 `TRUST_PROXY=1`，并保证邀请链接用 https 地址。Let’s Encrypt 不能给纯 IP 签证书，没有域名就先不要在 VPS 上强行开公网 HTTPS。

测试：用临时自签名证书拉起 HTTPS，客户端以 `rejectUnauthorized: false` 连接 `wss`，完成 create/join；再确认无证书时仍是 HTTP，现有 `http` 测试全部通过。

## 2. 断线重连

服务端：

1. 玩家加入房间时生成高熵 `resumeToken`（例如 32 字节 hex），只发给该玩家（可放在 `joined` / `resumed` 里，不要广播）。
2. 普通断线（socket close/terminate、心跳失败）不要立刻 `leave`。将该玩家标为 `connected: false`，保留在房间里，开始宽限期（建议 45 秒，写成命名常量）。期间房主身份不变；快照里增加 `connected` 字段，供名单显示“掉线中”。
3. 新连接先照常 `hello`（临时 id + `avatarToken`）。若客户端立刻发送 `{type:'resume', token}`：
   - token 有效且未过期：把新 socket 绑定回原玩家 id，更新 `sockets`，为原 id 重新签发 `avatarToken` 并保持已装备外观，回复 `{type:'resumed', id, code, avatarToken}`，然后广播快照。若旧 socket 仍在，先关掉旧的。
   - token 无效或宽限已过：回复 error，玩家可走原来的 create/join。
4. 宽限到期仍未恢复：按现在的 `leave` 处理（房间空了就删除；房主离开则转移房主）。
5. 玩家主动退出（客户端先发 `{type:'leave'}`，或点击“退出”）：立即离房并作废 token，不要进入宽限。
6. 进行中的对局仍然禁止**新玩家**加入，但允许已在房间内的玩家在宽限内恢复。等待中、进行中、已结束都可以 resume，以便再来一局。
7. 服务端重启仍会丢房间（本批不做房间持久化）。

客户端：

1. 收到 `resumeToken` 后写入 `sessionStorage`（随本次标签页，刷新可恢复）。主动退出或回到大厅时清除。
2. 非主动退出的 `onclose`：不要立刻清空对局回大厅。显示“正在重新连接…”，在宽限内指数退避自动重连（约 0.5s、1s、2s、4s，上限 8s），连上后先 `resume`。重连期间暂停操作，保留最后一帧状态。
3. `resumed` 成功后沿用原玩家 id，用快照恢复大厅/对局/结算界面，不要要求手动刷新。
4. 宽限内仍失败：再提示房间已失效，提供回大厅按钮。
5. 头像编辑器在 resume 后要用新的 `avatarToken` 重新 `connected()`，不要一直停在“连接已断开”。

测试（扩展 `tests/network.test.js`，必要时新增文件）：

- 对局中断开 A 的 socket：B 的快照仍能看到 A，且 `connected===false`；A 新连接 resume 后 id、击杀、位置保留，`connected===true`。
- 伪造 token 不能恢复。
- 同一 token 被第二个连接使用时，旧连接被顶替，身份不复制。
- 超过宽限后 token 失效，房间人数减少。
- `{type:'leave'}` 立即离房。
- 对局中没有 resume token 的旁路新连接仍不能 join。
- 更新现有“disconnect 后人数变为 1”的测试，改为 leave 或过期后才离房。

注意：`server/avatars.js` 的注册、装备、IP 额度要跟回原玩家 id，避免恢复后外观丢失或留下幽灵 token。

## 3. 延迟补偿

射击回溯（权威仍在服务器）：

1. 在 `Match.tick` 里为每位活着的玩家记录短历史：`{t, pos, crouching}`。保留约 300ms，过期删除。
2. 改进 ping：`pong` 带上 `serverTime`。服务端为每位玩家维护 RTT（可由客户端在 `input`/`fire` 中带上最近 ping，或由服务端根据 ping 往返估算）。
3. `fire(id, dir, now, shotTime?)`：若提供 `shotTime`（客户端用 `Date.now()+offset` 估计的服务器时间），将其限制在 `[now-250ms, now]` 内，把**目标与射击者**回放到该时刻再做现有射线检测；地图障碍是静态的，不必回溯。未提供 `shotTime` 时行为必须与现在完全一致，保证 `tests/match.test.js` 全部通过。
4. 客户端 `fire` 带上估计的服务器时间。不要改伤害、射速、弹药、复活时间等数值。
5. 回溯窗口最大 250ms，防止过度“开枪偷看”。

表现层（只改 `public/client.js`，不要改 `public/index.html` 里打包的原游戏）：

1. 本地校正：误差很小时忽略；中等误差向服务器位置平滑靠拢（lerp / 指数），不要一超过 0.65 就瞬移；误差很大（建议 >1.2）再闪现对齐。
2. 远端角色：在现有插值上，用快照里的 `vel` 做短时外推，并限制外推时间，避免穿墙飞出。
3. 用更稳的时钟偏移（结合 `pong.serverTime` 与快照 `now`），倒计时不要明显跳动。

测试：

- 无 `shotTime` 的命中、墙挡、复活保护与现在一致。
- 构造历史：目标从射击者正前方移开后，用过去的 `shotTime` 开火仍能命中旧位置；用当前时间开火则不应再命中（或按实际几何断言清楚）。
- 超过 250ms 的 `shotTime` 被夹紧，不能无限回溯。
- 现有网络集成测试、规则测试、管理后台测试全部继续通过。

## 明确不做

- 不重写 git 历史，不 force-push，不提交、不推送（由我在测试通过后再提交）。
- 不改 `public/index.html` 打包游戏，不改伤害/弹匣/比赛时长。
- 不做账号系统、房间持久化、中途加入新玩家、反作弊升级。
- 不在本批登录或改云服务器；没有域名就不部署公网 HTTPS。
- 不把证书、私钥、真实域名、管理员密码提交进仓库。示例里只用占位变量。

## 交付

- 实现上述代码与测试。
- 更新 README（启动、部署 HTTPS、断线恢复、命中回溯的范围与限制）。
- 写 `docs/verification-net.md`：改了什么、怎么测、结果（含 `npm test` 项数）。
- `npm test` 必须全部通过。可再跑 `node --check` 检查改过的 JS。
