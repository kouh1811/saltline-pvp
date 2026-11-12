# Avatar quality ceiling implementation plan

Goal: introduce version 3 expressive procedural characters while preserving existing version 2 geometry, materials, transforms and deterministic surface distribution.

Architecture: the shared renderer handles editor, admin preview and multiplayer assets. Keep version 2 geometry/material branches intact. Add bounded geometry and physical materials, texture-free shader patterns, composite eyes and renderer-local generated PMREM lighting.

Constraints: no external texture downloads, no deployment/push, no environment or container configuration changes. Version 2 remains accepted. Limits: 120 nodes, 400 expanded node instances, 40 detail rules, 30000 expanded detail instances, 400000 serialized UTF-8 bytes; import request 500 KiB. Existing 16000 model token limit exceeds the requested ~6000 and is retained.

- [x] Read schema, renderer, editor, prompt, example, service, model adapter and related tests; check clean requested branch and Notion onboarding/project search.
- [x] Add failing primitive/material/version/budget tests and verify failure on version 3.
- [x] Extend validator with capsule, lathe profile, superellipsoid exponent, eye colors/direction and bounded optional material fields; update asset and request limits.
- [x] Implement new geometries, composite eyes and cached physical materials with local-coordinate procedural shader colors; preserve instanced surface details.
- [x] Share generated PMREM, ACES and soft shadows across editor, admin preview and match.
- [x] Replace canonical example with 30+ node explorer and update prompt/import explanation.
- [x] Verify exact budget edges, v2 baseline, shader compilation and representative desktop/mobile renders; document results and limitations.
- [x] Run full npm test, review diff, commit on feature/admin-providers-match-prep without push.
