# Elder Posta: state-aware Act 1 entry

## Fix

`scripts/player/player_dialog_override.js` now selects Elder Posta's opening from the current player's persisted quest and dialogue history **before** storing the conversation or running opening side effects. A legacy NPC slot can remain an event entry; it is no longer the permanent story entry shown to the player.

This changes the existing HTML dialog-override path, not native NPC slot assignments. Other NPCs and dialogue IDs outside Posta's known Act 1 range are not rerouted. No shared `npc.setDialog()` changes are made, so players at different stages cannot overwrite each other's entry selection.

## Opening selection

Evaluate from the furthest quest stage backward. `finished` below means `IPlayer.hasFinishedQuest(id)`; objective counts and inventory contents are not used to assume completion.

| Player state | Opening dialogue |
| --- | --- |
| Quest 4 finished; acknowledgement not yet read | **34** — Six Cores Delivered |
| Quest 4 finished; dialogue 34 or 35 already read | **35** — A Place in Valemont |
| Quest 4 active | **33** — Bring Back Six Cores |
| Quest 3 finished; quest 4 not yet active/finished | **31** — The Hunt Is Finished |
| Quest 3 active | **30** — The Packwolf Hunt |
| Quest 2 finished; quest 3 not yet active/finished | **27** — A Safer Road |
| Quest 2 active | **26** — Goblins Still to Deal With |
| No active/finished task; briefing or task dialogue already read | **17** — Goblins on the Road |
| Meeting/dialogue 14 already read, or quest 1 finished; briefing unread | **15** — Welcome to Valemont |
| No meeting, briefing, task history, or quest progression | **13** — original meeting, external to this repository |

Declining or abandoning a task leaves a route back to its offer rather than repeating the first meeting. Quest progression takes precedence over missing old dialogue-read flags, including migrated saves. The existing offers, acceptance pages, advice, and progress branches remain intact.

## Availability and side effects

- Every selected opening must pass `IDialog.getAvailability().isAvailable(player)` before its side effects or GUI are processed.
- Posta's first meeting (13) and briefing (15) have additional per-player one-time guards, shared by opening checks, displayed linked options, and server-side navigation validation.
- Navigation must still follow a link on the current server-side dialogue and pass the target's current availability. A stale browser choice cannot replay a seen introduction.
- A redirected legacy opening does not mark the discarded dialogue read, start its quest, or execute its command.
- Quests 2–4 are not automatically finished or rewarded by routing. Their existing acceptance pages and quest turn-in mechanisms remain responsible for progression.
- Native dialogue and quest files, numeric availability modes, quest rewards, and NPC-global slots are unchanged. The skill does not establish availability enum meanings, so this fix uses documented player predicates and the native availability check instead of guessing enum values.

## Legacy IDs and boundaries

The bundled `skills/cnpc-dialogue-quests/assets/native/quest-start-dialogue-12.native.json` is the referral **to** Elder Posta and starts quest 1; it is not the original meeting. The existing player override treats dialogue **13** as the meeting and retains its existing quest-1 side effect. Neither a live Posta NPC export nor the original dialogue 13/14 records is stored under `dialogs/` here.

Posta openings in IDs 12–15 and 17–35 are rerouted; ID 16 and other IDs pass through. NPC matching uses the display name `Elder Posta`, ignoring standard formatting codes, case, and surrounding whitespace. This does not infer the identity of renamed NPCs.

If dialogue 13 is absent and quest 1 is not active, the first briefing (15) is the fallback. With quest 1 active, a missing meeting produces a diagnostic instead of silently skipping its objective. Missing or unavailable stage pages stop the open and report the problem; they never fall back to the old introduction.

The existing CNPC dialog event and CNPCExtended HTML bridge must still be active. This repository change does not deploy to the server or establish native-only routing when that override is disabled. Existing event/bridge behavior is retained, not newly runtime-verified.

## Validation

```sh
node --check scripts/player/player_dialog_override.js
node --test scripts/player/player_dialog_override.test.js
```

There are 33 offline regression tests. They cover first/repeat meetings, all 27 unstarted/active/finished combinations of quests 2–4, declined/abandoned tasks, old save history, concurrent players, script-context restarts, missing records, native availability rejection, stale and unlinked navigation, and acceptance without duplicate quest starts. Runtime code also passed an ES5 syntax parse during authoring.

The tests use API-shaped mocks and injected availability results. They do **not** prove native enum semantics, live NPC binding, HTML rendering, event order, objective tracking, or reward payout. No Minecraft server import or play-through was performed.

Live acceptance checklist: revisit Posta as a new and a returning player, decline and accept each offer, revisit while each quest is active, turn in through the existing quest system, and revisit after quest 4 finishes. Also verify the guard's quest-1 referral and two players at different quest stages.

## Reference basis

- `skills/cnpc-scripting/references/api-types.md`: `NpcAPI`, `IDialogHandler`, `IDialog`, `IDialogOption`, `IAvailability`, `IPlayer`, and `INPCDisplay` receiver declarations.
- `skills/cnpc-dialogue-quests/references/api-reference.md`: documented predicates and availability/event limitations.
- `skills/cnpc-dialogue-quests/references/live-schema-20260227.md`: quest-1 meeting reference and legacy dialogue 12.
- Existing `dialogs/Act 1  Intro/` records: current stage IDs, links, acceptance quests, and text.
