# Saltline Admin Implementation Plan

> Inline execution using superpowers:executing-plans; user approved implementation in this conversation.

**Goal:** 可用的管理后台，配置与开关可真实控制游戏。
**Architecture:** 现有 Node HTTP/WS 服务 + SQLite 配置与记录 + 原生模块后台；密钥加密，公共配置单独投影。
**Tech Stack:** Node >=22.13、node:sqlite、crypto、原生 DOM/CSS、Three 预览。
**Spec:** docs/superpowers/specs/2026-11-12-admin-console-design.md

## Global Constraints

不自动部署；仅服务端保存密钥；新任务读取最新配置，旧任务快照不变；不引入物种模板；任何装备都需确认；使用当前隔离工作区。

- [x] 1. SQLite 与模型适配。测试 ConfigStore 的加密、重开、版本冲突、回退和测试指纹；测试两种协议。运行失败测试，然后实现 server/control/store.js 与 avatar-model.js，运行通过。
- [x] 2. 管理登录与 HTTP。测试匿名拒绝、登录/CSRF/密码/过期限流、配置校验、密钥脱敏。实现 server/control/auth.js、admin.js 和 /api/admin 路由，验证测试。
- [x] 3. 游戏集成。真实双 WebSocket 测试开关同步、禁止直接装备、禁用资产、快照配置与任务记录。实现 AvatarService 动态配置、作业持久化、玩家工坊无预览模式；验证既有17项回归。
- [x] 4. 后台页面。实现 public/admin 的登录和五页、接口编辑/测试、配置回退、管理员预览、响应式布局。浏览器实际操作验证，无敏感内容截图。
- [x] 5. 实测交付。真实模型测试接口、两客户端开关验证、窄屏/登录回归；写配置说明和验收记录，运行完整测试与 diff 检查，保存截图。
