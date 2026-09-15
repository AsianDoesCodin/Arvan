---
name: cnpc-dialogue-quests
description: Author CustomNPCs 1.20.1 dialogues and quests using verified native templates for GBPort 20260227, preserving NBT types and unknown tags. Covers branching dialogues, quest-start pages, and talk quests from live samples; other builds/features need matching exports. Neutral story drafts are optional.
---

# CustomNPCs dialogue and quest authoring

Turn the user's premise into dialogue and quest content in the format they actually need. Native templates from the user's live `CustomNPCs-1.20.1-GBPort-Unofficial-1.20.1.20260227.jar` installation are bundled. Native data with values such as `1b` and `2b` is typed NBT/SNBT-style text, not ordinary JSON. Preserve its observed dialect; a `.json` filename or an API named `toJsonString()` does not establish JSON syntax.

## Choose the deliverable

- For native dialogues/quests on the verified build, read [live-schema-20260227.md](references/live-schema-20260227.md) and [native-format.md](references/native-format.md). Use the bundled real native records linked there; do not ask the user to supply evidence already included. Matching exports are required for other builds or unsupported fields/features. Do not substitute neutral story JSON for a native request.
- Only when the user wants a narrative outline, planning interchange, or explicitly chooses neutral drafting, read [authoring-format.md](references/authoring-format.md) and adapt [supply-run.story.json](assets/supply-run.story.json). That optional JSON schema belongs to this skill; it is **not** native CNPC data or a substitute for a native-generation request.
- For scripting, API questions, or adapting existing dialogue IDs, read [api-reference.md](references/api-reference.md). Its receiver types and limits are taken from the local `cnpc-scripting` reference set. Read that skill's current `SKILL.md`, `references/api-types.md`, and `references/onescript-pattern.md` before writing additional CNPC calls.
- For inspecting existing content, [inspect-content.js](assets/inspect-content.js) contains read-only, explicitly invoked functions using those documented APIs. It produces an API snapshot, not a complete native export. Generating this script does not run it.
- For unverified field semantics, option enums, objective setters, or a mixin/MCP design, read [evidence-and-gaps.md](references/evidence-and-gaps.md). State the missing evidence instead of inventing keys, enum meanings, or runtime verification.

## Native data workflow

Use the known build from context, or confirm it if missing, and select the matching record kind. Preserve the original keys, scalar suffixes, nested structures, IDs, unknown tags, escaping, and dialect. Work by minimal diffs against the sample; infer a field's role only from supplied evidence, preferably two exports differing in one known in-game setting. Numeric types do not define field semantics: `1b` is byte 1, sometimes used as true by convention; `2b` is byte 2, not automatically true, false, or a particular option type.

Do not strip suffixes, run native text through `JSON.parse`/`JSON.stringify`, or rebuild unknown records from the neutral schema. Keep new IDs unresolved until their allocation/collision rules are established. A supported text edit can proceed while unrelated fields remain opaque; implementing unknown option wiring or objectives needs evidence for those fields.

The optional read-only helper inventories a supported SNBT syntax subset without interpreting field meanings:

```powershell
node "<skill-directory>/scripts/snbt-inventory.cjs" "<user-provided-native-sample>"
```

It prints paths and typed scalar tokens; it does not import, serialize, repair, or validate the CustomNPCs schema. An unsupported dialect is a limitation of the helper, not proof the user's export is invalid. See [native-format.md](references/native-format.md) before using its output.

## Authoring workflow

Use the user's premise, NPC names, tone, language, and reward economy. Make minor creative choices when missing; ask only if a missing decision materially changes the story. Keep the entry conversation, acceptance/refusal, in-progress response, objective completion/turn-in, and post-completion response coherent. A refusal must leave the player a route back to the offer.

For optional neutral drafts, use stable symbolic keys. Leave `nativeId` absent or `null` until actual IDs are supplied or observed; examples must never reserve real IDs. Choice conditions and actions in draft JSON remain plans until implemented through verified native settings or a requested script.

Validate completed neutral drafts with the bundled dependency-free Node helper:

```powershell
node "<skill-directory>/scripts/story-pack.cjs" validate "<draft.story.json>"
node "<skill-directory>/scripts/story-pack.cjs" render "<draft.story.json>"
```

Both commands read the draft and print to stdout; they never modify files or contact Minecraft. Use the editing tool to save the rendered blueprint when requested. Validation rejects malformed fields, duplicate keys/IDs, broken references, impossible prerequisite loops, and dialogue graphs with no possible exit. It reports unreachable nodes and narrative issues as warnings. Static validation cannot prove conditions are satisfiable or that native quest objectives/rewards work.

Review the story once as a player: acceptance must identify the objective, progress must describe what is missing, turn-in must require completion, and the reward must match the request. Keep generated commands out of the draft; record any required scripted behavior in the handoff and implement only through verified APIs when requested.

## Delivery

For native work, return the edited native-format artifact and a concise account of changed fields, preserved types, and unresolved semantics. Report lexical checks separately from actual CNPC import/runtime tests. Use the bundled exact-build samples where applicable. When matching evidence for the requested native feature is unavailable, say what is missing instead of delivering neutral JSON as completion.

For optional neutral drafting, return the story files and draft validation result, clearly labeled non-native. Runtime execution, live data mutation, installation, or deployment requires a request that includes it.

The skill has no MCP dependency. It supports sample-based native editing, optional story drafting, and documented API assistance; it does not install a mixin or provide a native importer.
