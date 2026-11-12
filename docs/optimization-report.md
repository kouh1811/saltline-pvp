# Documentation screenshot optimization

Date: 2026-11-12. Scope: all 23 PNG screenshots under `docs/`, compressed in place with Python Pillow. File names, paths, PNG format, and pixel dimensions are unchanged.

## Method and visual checks

Used median-cut palette quantization with dithering disabled, `optimize=True`, and `compress_level=9`: 256 colors for smaller screenshots, 64 colors for most large gameplay screenshots, and 48 colors for death, final-match, movement, and player-equipped. Pillow palette PNGs have no JPEG-style quality setting.

Reviewed an overview of all screenshots and before/after crops at native resolution. UI text remains readable; palette reduction changes colors and introduces some banding in scene textures. Rejected 32-color trials for death and final-match and retained 48 colors to preserve more detail. These two files remain slightly above the approximate 200–500 KB target (553,862 and 621,236 bytes); the other originally 1 MB+ files are within that range.

## File sizes

| File | Before (bytes) | After (bytes) | Saved |
| --- | ---: | ---: | ---: |
| `docs/death.png` | 1,523,507 | 553,862 | 63.65% |
| `docs/final-match.png` | 1,425,267 | 621,236 | 56.41% |
| `docs/first-match.png` | 1,566,810 | 452,214 | 71.14% |
| `docs/lobby.png` | 1,515,286 | 384,342 | 74.64% |
| `docs/mobile-lobby.png` | 337,552 | 161,405 | 52.18% |
| `docs/movement.png` | 1,434,802 | 464,390 | 67.63% |
| `docs/opponent.png` | 1,560,713 | 470,537 | 69.85% |
| `docs/respawn.png` | 1,675,123 | 416,875 | 75.11% |
| `docs/results.png` | 1,446,004 | 433,877 | 69.99% |
| `docs/screenshots/admin/features.png` | 88,108 | 35,189 | 60.06% |
| `docs/screenshots/admin/login.png` | 47,705 | 17,969 | 62.33% |
| `docs/screenshots/admin/mobile.png` | 68,325 | 27,579 | 59.64% |
| `docs/screenshots/admin/overview.png` | 88,718 | 35,861 | 59.58% |
| `docs/screenshots/admin/player-disabled.png` | 1,754,803 | 489,794 | 72.09% |
| `docs/screenshots/admin/player-equipped.png` | 1,795,212 | 475,505 | 73.51% |
| `docs/screenshots/admin/player-preview-off.png` | 411,630 | 132,360 | 67.84% |
| `docs/screenshots/admin/providers.png` | 99,164 | 39,401 | 60.27% |
| `docs/screenshots/admin/records.png` | 152,941 | 60,625 | 60.36% |
| `docs/screenshots/admin/role-preview.png` | 137,781 | 67,807 | 50.79% |
| `docs/screenshots/admin/system.png` | 183,586 | 73,157 | 60.15% |
| `docs/screenshots/text-avatars/mobile.png` | 168,040 | 54,840 | 67.36% |
| `docs/screenshots/text-avatars/multiplayer.png` | 1,756,941 | 435,968 | 75.19% |
| `docs/screenshots/text-avatars/preview.png` | 451,725 | 144,691 | 67.97% |
| **Total** | **19,689,743** | **6,049,484** | **69.28%** |

Saved 13,640,259 bytes: 19.69 MB → 6.05 MB (decimal units).

## Validation

- All 23 PNGs decode successfully, retain their original dimensions, and are smaller than their originals.
- `npm test`: 29 passed, 0 failed, exit code 0 (Node.js v24.18.0). The initial sandboxed run encountered a native Node assertion and stalled; rerunning outside the sandbox allowed the local HTTP/WebSocket integration tests to pass.
- No changes to `public/`, `server/`, or `tests/`. No commits, pushes, or history rewrites.

## Screenshot contribution note

Compress screenshots before committing. Do not commit uncompressed PNGs larger than 1 MB; keep original dimensions and verify that UI text remains readable.
