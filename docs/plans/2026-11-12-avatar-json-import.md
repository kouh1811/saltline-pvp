# Avatar JSON Import Implementation Plan

**Goal:** 玩家可复制唯一提示词，用任意外部 AI 生成角色 JSON，再粘贴或选择文件导入。
**Architecture:** 扩展 AvatarService 的鉴权路由，复用 validate/save 与 preparation/onState 入场逻辑。编辑器提供 JSON 抽取、文件输入、HTTP 剪贴板回退和中文结构说明。
**Tech Stack:** Node.js HTTP、原生 ES modules、node:test。
**Spec:** 本次用户提供的服务端、客户端和测试设计。

## Constraints
- 当前 feature/admin-providers-match-prep 基于 e7da831；提交但不 push。
- 不改部署、Docker、.env；prompt 只读取 server/avatar-prompt.txt。
- import 请求体最多 200KB，其他保持 4096；资产最多 180000 bytes。
- customization/inMatch/入场规则共用；每局成功导入最多 5 次，rematch 重置，不占 AI 次数。
- preview off 自动装备 ready；preview on 确认装备后 ready。

## Steps
- [x] 服务端测试先行：prompt-kit 鉴权及唯一真源、示例 validate；导入成功、非法请求、具体校验错误、两级大小限制、5 次计数、reset、权限及 preview 状态。
- [x] server/avatar-example.json 添加小型 version 2 示例；server/avatars.js 增加 GET prompt-kit 与 POST import。保存前预留计数以防并发绕过，失败释放；保存后检查 epoch、权限和准备截止时间。成功取消旧生成任务，使用 generatedAsset 保持策略切换一致。
- [x] 客户端测试先行：首尾花括号抽取、非法 JSON、clipboard 成功/拒绝/不存在、execCommand 成功及失败选中。
- [x] public/avatar/editor.mjs 添加可独立测试工具、导入区、提示词和示例复制、文件大小检查；保持对话框打开，复用预览和本地库；样式保证窄屏滚动及输入宽度。
- [x] 添加 Match 联动测试：第一位导入进场、第二位继续准备、preview 确认、超时及 reset 竞态。
- [x] README 添加玩法；执行 npm test，必要时按授权在沙箱外重跑；自审 diff，记录 docs/verification-avatar-json-import.md，英文 commit。

执行方式：当前会话逐项实施；用户已明确授权设计、实现、测试和提交，无需额外审批。

## Result

78 tests passed outside sandbox; git diff --check passed. See docs/verification-avatar-json-import.md for evidence and remaining manual acceptance limits.
