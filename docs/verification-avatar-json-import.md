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
