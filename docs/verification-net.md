# HTTPS、断线恢复与延迟补偿验收

日期：2026-11-12  
仓库：saltline-pvp  
分支：`optimize/net-https-resume-lag`  
环境：本机 Node.js v24.18.0；单进程内存房间；未连接或部署远程服务器。

## 变更

- `server/index.js`：抽出请求处理函数，支持 `TLS_CERT` / `TLS_KEY` PEM 路径及 `createGameServer({tls:{cert,key}})` 的字符串或 Buffer；没有证书继续 HTTP，默认端口 18453。只设置一个 TLS 路径时启动报错，避免误以为已启用 HTTPS。
- `server/control/admin.js`、`server/control/auth.js`：登录、退出、改密清 Cookie 都按请求检测 HTTPS；真实 TLS 或可信代理 `X-Forwarded-Proto=https` 自动 Secure。保留显式 `ADMIN_COOKIE_SECURE=1` 强制选项，默认 0 不影响本地 HTTP 登录。可选 `HSTS=1` 只在 HTTPS 响应发送 `max-age=86400`。
- `server/index.js`、`server/avatars.js`、`server/match.js`：加入后单独发送 32 字节随机 resumeToken；普通断线保留 45 秒，快照标记 connected=false、保留房主。恢复重新绑定原 id，轮换头像 token 并撤销原凭证和临时连接凭证，保留装备、任务归属及原 IP 额度；同凭证的新连接顶替旧连接，旧连接回调不能删除恢复后的身份。主动 leave 立即离房并撤销凭证；过期移除玩家、转移房主或删除空房。
- `public/client.js`、`public/avatar/editor.mjs`：sessionStorage 保存恢复凭证；断线暂停控制与画面更新，按 0.5/1/2/4/8 秒（上限 8 秒）退避重连，45 秒截止并提供返回大厅。刷新也可恢复等待、进行或结束阶段；头像编辑器使用恢复后的新凭证重新连接。退出与返回大厅先发 leave 并清除凭证。被其他连接顶替时停止重试，避免互相抢回身份。
- `server/match.js`：每 tick 保存约 300ms 的位置/蹲姿历史，复活清除旧历史。可选 shotTime 限制在服务器当前时间前 250ms 到当前时间，插值回溯射击者和目标，再使用现有射线与静态墙体检测；不临时修改权威位置。当前存活、保护、射速、弹药等校验保持原样；没有有效 shotTime 时走原来的当前位置检测。
- `public/client.js`、`server/index.js`：pong 附 serverTime；客户端平滑估计时钟偏移和 RTT，fire 携带 shotTime，input/fire 携带 RTT，服务器也从 WebSocket 心跳估算 RTT。很小本地误差忽略，中等误差逐帧平滑，大于 1.2 米对齐；远端速度外推最多 100ms、位移最多 0.6 米，掉线时不外推。
- `deploy/Caddyfile`、`deploy/compose.yml`：以 DOMAIN 配置 Caddy 自动证书及 WebSocket 反代，Node 端口仅容器网络暴露，数据使用命名卷；`.env.example`、README 更新本地 HTTP、直接 TLS、代理边界与恢复/回溯限制。

未修改 `public/index.html`、`package.json`、`package-lock.json`；没有新增依赖，没有修改伤害、射速、弹药、换弹、比赛时长或复活数值。未执行任何 Git 提交、推送、标签、历史改写或远程部署。

## 测试方法及结果

先运行新回归测试，确认未实现时回溯命中、resumeToken 与 HTTPS/WSS 测试失败；实现后通过。最初沙箱内真实网络测试遇到 `listen EPERM 127.0.0.1`，已终止该失败进程，并将网络测试及完整 `npm test` 改在沙箱外执行。

最终完整命令：

```sh
npm test
```

结果：**42 tests / 42 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**，最终运行约 3.60 秒。

覆盖：

- 临时目录用 OpenSSL 生成自签名证书（测试完成删除），HTTPS 管理登录及会话、自动 Secure、HSTS，两个真实 WSS 客户端 create/join。证书未写入仓库，测试连接使用 rejectUnauthorized=false，不改变应用客户端验证策略。
- HTTP 管理登录和会话继续可用；未信任代理时伪造 X-Forwarded-Proto 不能启用 Secure/HSTS；信任代理时仅 https 标记启用。
- 对局中普通断线后玩家仍在且掉线标记可见，恢复 id、击杀和位置不丢；伪造凭证被拒绝，新玩家仍不能中途加入；同凭证顶替、旧 socket 关闭不误删身份；主动 leave、过期凭证、空房删除、房主过期转移。
- 超时集成测试使用 createGameServer 的 resumeGraceMs 注入 80/150ms 加速执行；生产默认命名常量为 45000ms。客户端虚拟时钟覆盖完整 45 秒截止。
- 真实头像 API 验证装备保留、生成任务仍归原玩家、恢复后换装可用、旧头像 token 和临时 token 均失效；恢复连接换成另一个代理 IP 后，仍使用原 IP 的生成额度。
- 客户端测试在 Node VM 中执行真实 client.js，使用最小 DOM/transport 适配和已有 Three.js 数学/场景对象：覆盖三个阶段恢复、刷新恢复、头像重新 connected、45 秒截止、被顶替停止重试、主动 leave、真实头像编辑器恢复后清除断线提示、平滑校正、大误差对齐、估算射击时间、RTT、外推上限及断线冻结。
- Match 回溯测试覆盖射击者与目标同时回溯、位置不被篡改、旧时间和未来时间夹紧、不回放上一条生命；全部原有无 shotTime 的命中、墙挡、复活保护、弹药、换弹和对局规则测试通过。
- 原有后台鉴权、CSRF、配置、头像生成和存储测试全部通过。

所有修改/新增的 **12 个 JS/MJS 文件**均逐一运行 `node --check`，退出码 0；`git diff --check` 通过。

另在沙箱外临时创建内存数据库 HTTP 实例，监听 **127.0.0.1:18453**，实际请求 `/health`、`/`、`/admin`、`/vendor/three.js`：全部 **200**，没有 HSTS；随后关闭实例。

## 验收范围与剩余风险

- 已验证本机规则、HTTP/HTTPS/WSS 和客户端逻辑；未做真实浏览器 WebGL/鼠标锁定视觉验收，也未验证跨公网高 RTT、抖动、丢包的实际手感。
- Caddy/Compose 是部署示例，未实际启动容器、申请公网证书或操作 DNS。公网启用 TRUST_PROXY 前必须保证自有代理覆盖转发头且不可绕过代理直连 Node。
- 房间和恢复凭证只存在当前进程，服务重启不能恢复；无账号和持久化对局。普通断线期间角色仍可受伤及复活，不冻结服务器比赛。
- 回溯上限 250ms、外推上限 100ms/0.6 米不能消除所有高延迟误差；外推仅为表现层，并非额外碰撞仿真。客户端时间仍是受窗口限制的提示，不构成竞技级反作弊。
