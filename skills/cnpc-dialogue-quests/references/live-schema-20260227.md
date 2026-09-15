# Native schema observed on the user's current server

Scope: Minecraft 1.20.1, installed `CustomNPCs-1.20.1-GBPort-Unofficial-1.20.1.20260227.jar`, sample `ModRev:18`. The coordinating agent inspected OVS server `1f14ac92` read-only after explicit user authorization. This reference records those observations; it does not claim decompiled implementation or a new import/runtime test.

## Native templates from exact records

| Use | Bundled template | Source |
|---|---|---|
| Branching dialogue, two responses | [branching-dialogue-11.native.json](../assets/native/branching-dialogue-11.native.json) | `/custom_world/customnpcs/dialogs/Act 1  Intro/11.json` |
| Quest-start page with a terminal response | [quest-start-dialogue-12.native.json](../assets/native/quest-start-dialogue-12.native.json) | `/custom_world/customnpcs/dialogs/Act 1  Intro/12.json` |
| Type 1 talk-to-NPC/dialogue objective quest | [talk-quest-1.native.json](../assets/native/talk-quest-1.native.json) | `/custom_world/customnpcs/quests/Act 1/1.json` |

The templates preserve all supplied keys, values, containers, and numeric suffixes; indentation was made readable. Their `.json` extension mirrors the native files, but `0b` and `...L` make them non-JSON typed NBT-style text. Source misspellings are intentionally retained.

These are copies of existing records with live IDs, not three new records ready to import together. They are safe local starting points for requested edits. Editing dialogue 11 means preserving ID 11; creating another dialogue requires a verified unused ID and deliberate reference updates. Do not copy them over live records or auto-deploy them. Dialogue targets 8, 10, and 13 are existing external references and are not all bundled.

Dialogue files 8-15 and `highest_index.json` were observed in the category directory. The highest-index contents and allocator rules have not been supplied. Do not allocate new IDs from this sample range, assume all larger IDs are unused, or invent the index format. Quest 1 has no `QuestId` property: its observed identity is the source filename `1.json`; do not add a synthetic ID field.

## Dialogue fields and nesting

Both dialogue templates contain the same full top-level key set. Preserve the complete records. In particular, both `DialogHideNPC` and `DialogHideNpc` exist with distinct casing; neither may be dropped as a duplicate.

| Field | Observed use / value |
|---|---|
| `DialogId` | Numeric dialogue ID matching the observed file number |
| `DialogTitle`, `DialogText` | Native title and body text |
| `DialogQuest` | `-1` in dialogue 11; `1` in dialogue 12 starts the existing quest 1 in this chain |
| `Options` | List of records wrapping `Option` plus `OptionSlot` |
| `OptionSlot` | Option position/slot, 0 and 1 observed in dialogue 11 |
| `Option.Title` | Response text |
| `Option.Dialog` | Linked dialogue ID for the observed link options; `-1` for the terminal option |
| `Option.OptionType` | 1 = link in these samples; 0 with target -1 = terminal/close in dialogue 12 |
| `Option.DialogColor` | Integer response color retained from each source option |
| `Option.DialogCommand` | Empty string in supplied options |
| `ModRev` | 18 in supplied records; preserve it |

Exact link nesting, excerpted from dialogue 11:

```snbt
"Options": [
  {"Option":{"Dialog":10,"DialogColor":4909776,"DialogCommand":"","OptionType":1,"Title":"Agressive (joke)"},"OptionSlot":0},
  {"Option":{"Dialog":8,"DialogColor":776486,"DialogCommand":"","OptionType":1,"Title":"Friendly"},"OptionSlot":1}
]
```

The terminal shape from dialogue 12 is `{"Option":{"Dialog":-1,"DialogColor":16777215,"DialogCommand":"","OptionType":0,"Title":"..."},"OptionSlot":0}`. `DialogQuest:1` is on the dialogue record, not on this option. Do not invent an option-level `startQuest` tag. These mappings were consistent across the eight current dialogue records; other option enum values remain unknown.

Dialogue 15 has `Options:[]`. That is an observed native shape, but empty options do not by themselves establish escape/close behavior. The supplied dialogue 11/12 templates have `DialogDisableEsc:1`, `DialogShowWheel:0`, and both NPC-hide fields set to 0; retain their exact numeric forms.

## Availability and other defaults remain opaque

Dialogue 11 has `AvailabilityDialog:2` paired with `AvailabilityDialogId:12`; dialogue 12 also has `AvailabilityDialog:2` but pairs it with `AvailabilityDialogId:-1`. Exact mode-2 semantics cannot be established from that alone. Do not label it read/unread, visible/hidden, or a particular condition.

Both templates retain all four dialogue and quest requirement slots, faction fields, scoreboard fields, and mail fields. Dialogue 11's scoreboard values are 1 and faction point amounts are 100; dialogue 12's are 0. These are observed per-record settings, not universal defaults. When cloning a new story, do not silently apply dialogue 11's reference to dialogue 12 or claim an availability reset is safe without evidence for the relevant mode values.

Typed-value differences matter even where field names look alike:

- `DialogMail.BeenRead` is unsuffixed integer `0`; `QuestMail.BeenRead` is byte `0b`.
- Dialogue top-level `DecreaseFaction1Points`/`DecreaseFaction2Points` are integer `0`; quest `QuestFactionPoints` uses `0b`.
- Dialogue mail uses `TimePast:1669491043541L` and `Time:0L`. Quest mail uses `TimePast:1789300293017L` and `Time:0L`.

Preserve those raw values in sample-derived edits. Do not replace them with JSON booleans or refresh timestamps merely because they look old.

## Type 1 talk-to-NPC quest

The complete quest template contains:

- `Type:1`, `Title:"Elder Posta"`, and `Text:"Go inside the Village and talk to elder posta"`.
- `QuestDialogs:[{"Integer":13,"Slot":0}]`: the current quest's dialogue-objective reference uses the native `Integer`/`Slot` wrapper, targeting existing dialogue 13. Do not replace it with the neutral draft's `objectives` array or invent a `DialogId` field inside that wrapper.
- `CompleterNpc:"Elder Posta"`, `QuestCompletion:1`, `QuestRepeat:0`, and `NextQuestId:-1`.
- `RandomReward:0b`, `RewardExp:0`, `Rewards:{"NpcMiscInv":[]}`, `QuestCommand:""`, full `QuestFactionPoints`, full `QuestMail`, and `CompleteText:""`.

The existing API declarations also identify quest type 1 as Dialog. This supports the sample's talk/dialogue quest use. Preserve the observed completion/repeat fields; their complete enum mappings and exact NPC matching/turn-in semantics have not been established. Only an empty reward inventory is supplied, so do not invent item-stack reward entries or other objective-type schemas.

For a comparable native talk quest, start from the full template, change requested prose and evidence-backed dialogue references, and retain all remaining fields. New quest IDs, changed completion settings, item rewards, repeat rules, or additional objective types require matching evidence. Do not promise automatic payout or event order from these records.

## The `.ydec` file is a separate editor format

`/custom_world/customnpcs/dialogs/Act 1  Intro/Act 1 Intro.ydec` is newline-delimited strict JSON for a graph editor. It uses snake_case booleans and graph metadata. It is not the native typed `.json` record format.

Observed correlations in this project's files:

| Editor `.ydec` | Native dialogue data |
|---|---|
| response `option_type:0` | `OptionType:1` link |
| response `option_type:3` | `OptionType:0` terminal |
| `start_quest:1` | `DialogQuest:1` |

Do not copy numeric option types unchanged between the formats, feed the whole JSON-lines file to a single `JSON.parse`, or use the native SNBT helper as a `.ydec` validator. No complete `.ydec` schema or converter is supplied; preserve its graph metadata if a separate editor-file edit is requested.

## Live loader test

On 2026-09-13, after explicit user authorization, a new inert dialogue was generated as a minimal edit of the quest-start template and uploaded as `dialogs/Act 1  Intro/16.json`. The only semantic changes were `DialogId:16`, `DialogQuest:-1`, new title/body text, and terminal response title `Close`; the complete record, `ModRev:18`, option wrapper, and `L`-suffixed mail fields were retained. `highest_index.json` was advanced from `15` to `16`.

The live server command `/noppes dialog reload` reported `Loading Dialogs` followed by `Done loading Dialogs` without a parse error. A subsequent file read confirmed dialogue 16 and `highest_index:16` remained stored with the expected values. This verifies that this exact terminal-dialogue record shape is accepted by the loader on the named build. It does not verify NPC binding, on-screen rendering, alternate option types, quests, rewards, availability modes, or other native schemas. Do not generalize the result beyond those tested fields.

## Validation and delivery

```powershell
node "<skill-directory>/scripts/snbt-inventory.cjs" "<native-record.json>"
node --test "<skill-directory>/scripts/native-samples.test.cjs"
```

Inventory checks lexical structure and typed tokens only. Native sample tests verify the supplied template shapes/types and current reference correlations; they are not server import tests. Compare each requested edit against its source, list changed paths and any unresolved IDs, and leave live data untouched unless a separate scoped mutation is requested.
