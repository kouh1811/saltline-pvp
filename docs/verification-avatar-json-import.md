# Avatar JSON Import Verification

Date: 2026-11-12
Branch: feature/admin-providers-match-prep
Base: e7da831
Scope: local implementation and automated tests. No push, deployment, Docker or .env changes.

## Implemented

- Authenticated GET /api/avatars/prompt-kit returns the exact contents of server/avatar-prompt.txt, schemaVersion 2 and server/avatar-example.json. Example passes the shared validate().
- POST /api/avatars/import accepts only {recipe}, validates with concrete failure reasons, checks serialized recipe <=180000 bytes and uses the existing hash-addressed save(). Only this route accepts a request body up to 200*1024 bytes; all other avatar POST routes retain 4096 bytes.
- Imports use customization and inMatch/entered restrictions independently of AI provider/generation availability. Five successful imports per session per round, with concurrent reservations, failed-save release and rematch reset; AI generation allowance stays independent.
- Preview disabled: automatic equipment and ready state, then existing staggered admission. Preview enabled: pending until explicit equip. Epoch/session/policy/deadline checks after disk writes protect the next round and forced-default admission. Old AI jobs are cancelled after a successful import.
- Editor provides pasted JSON, .json file selection, first-to-last brace extraction, Chinese error feedback, prompt/example copy buttons, HTTP execCommand fallback and selected manual-copy text on failure. Collapsible Chinese documentation covers fields, shapes, detail types and budgets.
- Narrow screens keep the design/import column before the preview and use bounded full-width inputs with dialog scrolling. Existing automatic preparation dialog makes the import controls available during the 120-second window.

## Verification evidence

Final command: `npm test` (outside sandbox, as authorized).
Result: **78 tests passed, 0 failed, 0 skipped**; exit code 0.
Additional check: `git diff --check` passed.

13 new tests cover:

- Canonical prompt, valid example, schema version and token authentication.
- Import persistence/hash lookup, malformed JSON and specific validation errors.
- Request limits above 4096 bytes and over 200KB; client file limit over 180000 bytes.
- Five-import quota, concurrent reservations, failure release and reset invalidation.
- Customization/inMatch permissions, equipment switch, AI-independent allowance.
- Preview on/off readiness, Match staggered admission and preparation-deadline races.
- Real HTTP/WebSocket integration: pending confirmation, first-player entry while another remains pending, entered-player restriction, oversized request response and actual next-round reset.
- Client fenced/narrated extraction, parse/server validation failure without closing the dialog, imports without an AI provider, prompt suffix/example copy, file selection and HTTP clipboard fallback including selected manual-copy text.

The sandbox full-suite attempt hit native Node assertions in network-related suites. Outside-sandbox runs completed; one intermediate run hit the existing `resume grace expires, invalidates token and deletes empty room` timing assertion. The final complete run passed that test and all other tests.

## Acceptance limits

DOM interactions and clipboard branches are automated using the repository's VM-style client harness. Physical mobile portrait layout, OS clipboard permissions and real external-AI responses were not manually tested. No production or deployed-environment acceptance is claimed.

## 导入区界面整理

- 2026-11-12，本地分支 `feature/admin-providers-match-prep`：生成与外部导入分成两张工坊卡片，沿用蓝灰底、金色强调与既有字体；导入按三个编号步骤组织。结构说明默认收起，改为自定义箭头行和紧凑定义列表，保留字段、形状、细节类型与预算说明。
- 两个复制按钮成功后显示“已复制”，2 秒恢复；沿用 Clipboard API 与 HTTP textarea/execCommand 回退，失败保留选中文本供手动复制。销毁编辑器时清理反馈计时器。
- 文件读取和导入前解析成功后显示 2 空格 JSON；解析失败保留原文并报错。JSON 框使用等宽、不折行和横向滚动；导入状态紧跟按钮行，次数说明简化。≤660px 按钮纵向全宽、字段列表单列，整个对话框限制在 94dvh 内滚动。桌面预览高度固定，避免随导入文档拉长。
- 验证：`npm test` 沙箱外完整执行，78 passed / 0 failed。沙箱内服务测试出现 Node listen 相关原生断言退出；沙箱外正常。客户端测试覆盖复制反馈、格式化、无效文件原文保留以及既有 HTTP 复制回退。`git diff --check` 通过。
- 本地浏览器使用实际模板和 CSS 做隔离布局检查（非线上业务验收）：1280px 桌面、390px 手机，检查默认收起及展开结构；手机对话框高 793.36px（844×94%），clientWidth/scrollWidth 均 350px，无外层横向溢出，JSON 保持 pre/normal，结构单列。截图位于 `/tmp/avatar-desktop.png`、`/tmp/avatar-mobile.png`，临时预览不包含真实 3D 渲染和线上会话。
- 未修改后端 API、权限、额度、Docker 或 .env；未部署、未 push。
