# Optional neutral story draft format v1

Use this mode only for a requested narrative outline, planning interchange, or explicit neutral draft. It does not satisfy a request for native CustomNPCs dialogues, quests, or importable records. Native NBT/SNBT-style text requires [native-format.md](native-format.md) and a real export for the exact build.

This is a neutral authoring format owned by this skill. None of its property names, actions, conditions, or symbolic keys are claims about CustomNPCs storage. It is useful for planning and review. There is no native importer or automatic mapping to native records.

Use strict UTF-8 JSON: double quotes, no comments, no trailing commas, and escaped newlines inside strings. The validator rejects unknown properties to catch misspellings. All fields listed below are required unless marked optional. Empty arrays are valid when there is nothing to specify. Keys use lowercase letters, digits, `_`, or `-`, start with a letter, and are unique within their record type.

## Records

Top level:

| Field | Value |
|---|---|
| `format` | Exactly `cnpc-story-draft/v1` |
| `minecraft` | Exactly `1.20.1` |
| `title` | Nonempty story title |
| `npcs` | One or more NPC records |
| `dialogues` | One or more dialogue records |
| `quests` | Zero or more quest records |

NPC: `key`, `name`, `entryDialogue` (dialogue key).

Dialogue: `key`, optional `nativeId` (observed nonnegative integer or `null`), `category` (human organizational label), `title`, `speaker` (NPC key), `text`, `conditions` (array), `choices` (array). An empty choices array represents a terminal page in the draft; confirm its native close behavior during setup. Category labels do not assert native IDs or create categories.

Choice: `key` (unique in its dialogue), `text`, `next` (dialogue key or `null` for close), `conditions` (array), `actions` (array).

Conditions are all required together (logical AND). Each is `{ "quest": "quest-key", "state": "available" }`, where state is `available`, `active`, `objectives-complete`, or `finished`. These are authoring states, not native enum codes. `objectives-complete` means ready to turn in, not already rewarded. The API reference does not establish a general readiness predicate. Conditional choices may need multiple native dialogues or scripting because option condition setters are undocumented.

Actions are `{ "kind": "start-quest", "quest": "quest-key" }` or `{ "kind": "turn-in-quest", "quest": "quest-key" }`. They describe intent; the draft does not execute them. Do not blindly map turn-in to `finishQuest`, whose reward/event semantics are not established by the supplied declarations.

Quest fields:

| Field | Value |
|---|---|
| `key`, `category`, `title` | Nonempty identifiers/labels |
| `nativeId` | Optional observed nonnegative integer or `null` |
| `type` | `item`, `dialog`, `kill`, `location`, `area-kill`, or `manual` |
| `logText`, `completeText` | Nonempty journal and completion prose |
| `objectives` | One or more objective records |
| `prerequisites` | Quest keys that must be finished |
| `turnIn` | `{ "npc": "npc-key", "dialogue": "dialogue-key" }` |
| `repeatable` | Boolean narrative intention; not an API setter |
| `rewards` | `{ "experience": 0, "items": [] }` |
| `nextQuest` | Quest key or `null` |

Objective: `key` (unique in its quest), `description`, `target` (human-readable target or candidate registry ID), `count` (positive integer). Target encoding and objective type configuration must be verified during native setup. A location uses count `1` and describes its destination in `target`; this does not invent coordinate tags.

Reward item: `item` (namespaced registry identifier), `count` (positive integer). The validator checks syntax, not registry presence or stack limits. Experience is a nonnegative integer narrative reward amount; the native experience configuration is not documented here.

## Generating a story

Adapt the supplied example structurally, preserving user-specified text and world facts. Avoid hard-coding live record IDs. Build branches with meaningful choices; choices that all lead to the same page should still express distinct player intent. Add refusal, progress, ready-to-turn-in, and completed branches where the quest needs them. Do not use a visual close button as a substitute for defining whether a quest was accepted.

The readable blueprint contains all conditions and actions so a reviewer can see what remains to implement. Its API-dependent fields must be reviewed against the known receiver methods, and its unsupported fields stay as configuration requirements.

## Validation limits

The helper verifies the draft's structure and references. Dialogue reachability starts from every NPC entry point and follows `next` links, ignoring conditions; it cannot establish that those conditions are achievable. Exit analysis is also structural. Quest prerequisite cycles are rejected; `nextQuest` cycles are warned because a repeatable story might intentionally cycle. The helper does not apply defaults, allocate IDs, compile CNPC data, write scripts, or run server commands.
