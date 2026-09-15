# One marker, objective and turn-in destinations

## Deployment blocker in the uploaded source

The original `scripts/player/ADMsLevelingSystem.js` at commit `86ee15385b18385c8f8ec2894b9e097775f70b1d` (blob `95cc7823f1310cb5a8926c357168466fa986a2f7`) contains invalid bytes and corrupted equipment/potion code at line 8559. `node --check` fails on both the original and marker-edited full file with the same diagnostic. The marker feature does NOT repair that unrelated corruption, and the uploaded full script is not ready to deploy. Recover a clean copy from the working server and reapply only the marker changes before a full-script/runtime test. Do not overwrite a working server script with this corrupt upload.

## Editor behavior

In `scripts/quest_map.html`, create or edit an objective marker, then check **Turn-in**. A second X/Y/Z and dimension section appears with its own **My Pos** button. The first My Pos changes only the objective destination; the second changes only the return destination. Save stores both under one marker ID. Turning the checkbox off keeps temporary draft values but removes the saved second destination when Save is pressed.

The player marker uses the objective location while objectives are unfinished and the return location when the existing `playerMenuQuest(...).ready` check reports readiness. Its ID, name, symbol, and map-edge setting remain the same. All destination coordinates and dimension metadata switch together. Readiness changes are per player; saved coordinates are not mutated. Existing active/tracked quest checks remain responsible for visibility, including hiding the marker after hand-in.

## Compatibility

Existing separate objective and turn-in-only entries keep their behavior. Nothing automatically merges or deletes them. A legacy turn-in-only entry displays a notice and keeps its existing single destination unless explicitly converted; its old flag is not mistaken for the new optional second destination. Always-visible points do not use quest return destinations.

Storage adds `turninDestination: {x, y, z, dimensionId, dimension, dimensionName}` or null to each marker. An older editor omitting the field preserves an existing second destination; the new editor sends explicit null to disable it. Missing/invalid return coordinates are rejected before saving. The runtime map bridge receives only the chosen destination; the admin editor receives both.

## Scope and validation

Runtime changes are limited to `scripts/quest_map.html` and marker-related functions in `scripts/player/ADMsLevelingSystem.js`. Dialogues, quest definitions, progression, rewards, and `player_dialog_override.js` are unchanged.

Run `node --test scripts/tests/quest-map.test.cjs` for the isolated marker suite. **45 automated tests passed** in GitHub Actions run 35024121325. These exercise the actual marker functions in API-shaped mocks and the editor JavaScript in a mocked DOM: storage round trips, legacy behavior, readiness switching, independent My Pos controls, stale responses, permissions, invalid input, and per-player state. They do not parse or execute the unrelated corrupted portions of the leveling script and do not establish Minecraft/Java bridge operation or real browser rendering. No live server deployment or in-game test was performed.

Source bytes outside the anchored marker edits were preserved, including pre-existing invalid bytes; no whole-file encoding conversion or unrelated repair was attempted. The temporary validation workflow and patch builder are not part of the feature commit.
