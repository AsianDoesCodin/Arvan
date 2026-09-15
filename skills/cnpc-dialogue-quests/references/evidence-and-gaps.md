# Evidence and limits

Created on 2026-09-13 from the allowed local reference set:

- `C:/Users/My PC/.codex/skills/cnpc-scripting/SKILL.md`: target versions, global API initialization, ES5 style, handler names, receiver verification, reference isolation, and GUI cautions.
- `C:/Users/My PC/.codex/skills/cnpc-scripting/references/api-types.md`: `NpcAPI` around lines 280-305; `IPlayer` around 461-517; `ICustomNpc` around 521-549; event classes around 1158-1160 and 1245-1253; dialogue/quest handlers and interfaces around 1284-1299; quest constants around 1344-1345.
- `C:/Users/My PC/.codex/skills/cnpc-scripting/references/onescript-pattern.md`: read completely as required for script work. Its full GUI framework is not needed for the read-only helper's explicitly invoked functions.

The user subsequently identified typed values such as `1b` and `2b` in actual CNPC data and explicitly authorized read-only inspection of current server data. The coordinating agent read OVS server `1f14ac92`, confirmed installed `CustomNPCs-1.20.1-GBPort-Unofficial-1.20.1.20260227.jar`, and supplied exact native dialogue 11, dialogue 12, and quest 1 records plus correlations across dialogues 8-15. These are captured in [live-schema-20260227.md](live-schema-20260227.md) and its linked native templates. Native authoring handles typed NBT/SNBT-style records, not the optional neutral JSON schema.

No installed CustomNPCs class was decompiled or executed to establish this skill. The installed build and the listed persisted records were inspected read-only; full reader/writer behavior, other native data variants, and runtime lifecycle were not tested. Keep source observations, cross-record correlations, API declarations, and runtime claims separate.

## Known gaps affecting native authoring

| Topic | What is established | What remains unknown |
|---|---|---|
| Native serialization | Exact native field sets/types for dialogues 11/12 and quest 1; observed category directories and `.json` filenames; typed bytes/longs; separate `.ydec` JSON-lines editor format | General reader/writer dialect, other record variants, highest-index contents, migrations, import/export/reload behavior |
| Dialogue creation | Existing `IDialogCategory.create()` returns `IDialog`; text setters and `save()` exist | Category creation, ID allocation timing, defaults, option mutation, persistence lifecycle |
| Dialogue options | In current samples, native `OptionType:1` links via `Dialog`; `OptionType:0` with `Dialog:-1` is terminal; exact `Options[].Option`/`OptionSlot` shape; slots 0/1 observed | Other option types, maximum slot range, per-choice availability, behavior across other builds |
| Quests | Exact Type 1 record with `QuestDialogs:[{Integer:13,Slot:0}]`, quest-start `DialogQuest:1`; lookup/read/text/type/next/rewards/save APIs | Other native objective schemas, completion/repeat enum meanings, nonempty reward inventories, creator/ID allocation behavior, event/reward lifecycle |
| Availability | Dialogue availability methods and player quest predicates | Enum numbers, legal requirement slots, combining rules, per-choice conditions |
| State and events | Player quest methods and named event fields | Side effects of `finishQuest`/`stopQuest`/`removeQuest`, repeat timing, event order, cancellation, reward payout semantics |
| NPC binding | `ICustomNpc.setDialog(slot, IDialog)` exists | Slot limits, ordering, native automatic selection behavior |

A runtime API snapshot produced by the bundled inspector can supply real IDs, titles, text, option slot values, target IDs, raw type values, quest types, and basic item rewards. It does not supply complete native storage, configuration defaults, NBT-rich item identities, undisclosed objectives, faction/scoreboard requirements, or export/reimport equivalence.

## Mixins and MCP

An MCP server is unnecessary for offline story generation and validation. A read-only script can use the documented public API to inspect much of the dialogue graph; no new runtime mixin is needed for that limited purpose.

A complete native authoring connector still needs native reader/writer and allocator behavior plus a controlled round-trip test. The bundled exact-build samples now support native text, ordinary choice links, quest-start pages, and the observed dialogue-objective shape. Sample-based edits can preserve unknown fields without decoding them. More extensive generation needs representative samples or minimal before/after diffs establishing the affected semantics. Do not claim the neutral draft is a native adapter or make guessed tags from its fields.

## Validation claims

The story helper validates only the optional skill-owned draft structure and graph relationships. The SNBT inventory helper checks its supported syntax subset and preserves typed scalar lexemes. Native sample tests check observed field shapes/types, option wrappers, and current cross-record references. The JavaScript API inspector can be syntax-checked and tested against API-shaped mocks locally. None of these local checks is a CNPC reimport/play-through test. No live server content is modified by local validation or inventory commands.
