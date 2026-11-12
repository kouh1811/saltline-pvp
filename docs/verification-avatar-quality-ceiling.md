# Avatar quality ceiling verification

Date: 2026-11-12. Scope: local branch `feature/admin-providers-match-prep`; no deployment or remote push. Notion onboarding read and Saltline project search completed (no matching entry). No knowledge-base writes requested or performed.

## Delivered contract

Version 3 supports capsule (full XYZ dimensions, Y axis), lathe (3–16 strictly ascending [radius,y] profile points, radius 0–2, y -4–4), superellipsoid (roundness .15–2), and composite eye (sclera color, iris, pupil, nonzero direction; default front -Z). Existing parent-local transforms, mirror and repeat remain supported.

Materials: two/three-color axis gradient, stripes/spots/checker (two colors, scale 1–32), emissive color/intensity 0–2, opacity .2–1, clearcoat/sheen 0–1. MeshPhysicalMaterial and local-coordinate shader math need no texture download. Transparency uses depthWrite=false. Emissive is surface emission, not a light casting illumination/bloom onto surrounding objects.

Limits are 120 nodes, 400 expanded node instances, 40 rules, 30000 expanded surface instances and 400000 serialized UTF-8 bytes. Eye subparts are internal geometry, not additional recipe nodes. Import transport limit is 512000 bytes (500 KiB), including whitespace/wrapper; other POST requests retain their 4096-byte limit. Model output limit was already 16000 tokens and remains above the requested ~6000.

The shared quality configuration installs generated studio PMREM environment lighting, ACES and PCF soft shadows in editor, admin preview and multiplayer. Previews include a shadow receiver and capped 1.5 pixel ratio; existing match quality controls remain in place. New spheres use higher subdivisions. Surface details remain InstancedMesh; repeated v3 parts batch by geometry/material and reflection sign. Negative transforms are carried by batch roots, keeping instance matrices positive to avoid mirrored face-culling artifacts. PMREM targets are disposed with renderer lifecycle.

## Automated evidence

`npm test`: **88 tests passed, 0 failures** (Node v24.18.0, approximately 4.25 seconds).

Coverage includes new geometry finite positions, material ranges/procedural shader generation, eye orientation inputs, exact 120/400/40/30000/400000 boundaries and next-over-limit rejection, exact 500 KiB request and next byte rejection, new-feature version gating, import persistence, preparation/equipment policy, model adapter, network and admin regressions.

The v2 golden fixture was generated from pre-change `HEAD:public/avatar/renderer.mjs`, before committing this upgrade. Its SHA-256 fingerprint compares all five old geometries, indices/normals, world transforms, material properties, seeded detail matrices/colors, nested mirror and repeat. It matches the upgraded renderer exactly. This proves asset geometry/material/transform compatibility; shared scene lighting intentionally changes final illumination, so it is not a claim of identical framebuffer pixels.

Sandbox execution of network tests triggered a Node native async assertion; the unchanged command passed with approved local HTTP/WebSocket listening access. VM client tests mock GPU setup; real WebGL checks below cover the GPU path.

## WebGL and visual evidence

Ego Lite Chromium rendered the 32-node canonical explorer: 33 expanded parts, 18 procedural bolts, source height 2.37m normalized to 1.8m. Final 390x700 render surface: 41 draw calls including floor, 65154 rendered triangles, build approximately 16.6ms on this Mac. All stripes/spots/checker shader programs compiled without diagnostics reporting failure. Two- and three-color gradient source variants are tested automatically; the browser example uses both. Screenshot inspection verified both mirrored irises/pupils/highlights, striped belly, gradient body, rounded helmet/boots and ground shadow.

- [Desktop rendering](assets/avatar-quality/desktop.png)
- [Narrow rendering surface](assets/avatar-quality/narrow-canvas.png)

These are isolated static WebGL harness renders using the repository Three.js dependency and shared renderer/quality modules. The screenshot includes surrounding browser viewport area. They do not establish full editor UI, live eight-player GPU performance or physical mobile-device frame rate. Match/editor integration points are wired and their policy/network behavior is covered by automated tests; a live multiplayer visual and worst-case max-budget phone benchmark remain acceptance limits. CPU submission timing from a short desktop run is not GPU FPS evidence.

## Release boundaries

No `.env`, Dockerfile or compose.yml edits. No production data or provider calls used. Temporary local server and browser task were closed after QA. No push or deployment.
