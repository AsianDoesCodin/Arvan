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

## Design gotcha: starting slots select a tree; replies navigate it

**Fix dialogue-design problems in native dialogue content and availability. Do not modify a working player/NPC script, GUI override, or shared NPC state to compensate unless the user explicitly requests a script change.**

The Arvan user clarified on 2026-09-15 that these are two separate layers:

| Layer | What it does | What belongs there |
| --- | --- | --- |
| NPC starting-dialogue assignments | On right-click, scan assignments in order; skip unavailable entries and open the first available one, then stop scanning | Only alternative entry points needed for different player states or deliberate resume points |
| Reply-linked dialogue graph | After opening, a selected reply links to another dialogue through `Options[].Option.Dialog` | Continuations, offers, acceptance, advice, lore, loops, shared pages, and exits |

One assigned starting dialogue can lead through a large branching graph. Reply targets do **not** need their own NPC starting slots merely to be reachable. An NPC assignment position, a reply's `OptionSlot`, and a dialogue ID are different things. The reported **about 12 starting slots are capacity, not a target to fill and not a limit on the total dialogue graph**; no universal slot limit is verified here.

```text
Right-click NPC: scan STARTING slots from the beginning
  Start A available? yes -> open A -> follow its reply-linked tree
                     no -> check Start B
  Start B available? yes -> open B -> follow its reply-linked tree
                     no -> check Start C ...

Inside A's tree (illustrative, not allocated IDs):
  Greeting -> explanation -> offer -> acceptance -> close
                   |           |
                   +-> lore    +-> advice -> back to offer
```

The next NPC starting slot is **not the next conversation page**. Reading/closing a page does not mean "open the next assigned slot". A later right-click performs entry selection again using the player's then-current state. Reply navigation selects its linked target, not the next NPC slot; verify that target's own availability as well.

### Choose roots before listing NPC assignments

Design the entry-state table separately from the full reply graph. Use only the starting roots needed for first meeting, returning conversation, active work, and post-completion states; split further only when different opening text or interruption recovery actually requires it. Offer, advice, acceptance, and acknowledgement pages can be descendants. A page may also be an assigned root when a later right-click genuinely needs to resume there, but this must be intentional, not automatic for every node or quest step. Different roots may share descendants.

For every proposed starting slot, explain **which player state needs to open there instead of an earlier root**. Do not pad the list to 12, put every dialogue title on the NPC, or infer a minimum number of roots from the number of quest stages. Put an unconditional fallback last, if one is used. Order matters only when more than one entry could pass; an always-available first root masks every later alternative. A repeatable hub is acceptable when its greeting fits returning players and its replies expose the correct available branches; a permanent "new traveler" root is not.

### Players can interrupt and return

Cover first meeting/briefing, offer, refusal and later reconsideration, acceptance, active/incomplete return, objectives-ready but not yet turned in, completed acknowledgement, next offer, and ordinary post-completion conversation. These are **coverage requirements, not one required NPC slot per state**. Players can close mid-tree, ask unrelated questions, reconnect, abandon a task, or revisit before completing it. A return root needs a valid reply route to any unfinished offer or briefing; do not rely on the player following a linear path in one sitting.

Give starting roots explicit availability, and check linked-page availability separately. Gate one-time greetings or acknowledgements appropriately, but keep declined offers reachable. An acceptance page must exclude both active and finished states; `Before` alone is not a safe synonym for never accepted. A shared quest-topic menu may stay available while its quest is active, provided its acceptance reply is unavailable and its progress/advice replies still work. Do not apply acceptance-only gates to the whole topic tree. Keep quest attachment on acceptance pages, not progress or greeting pages. Advice and lore must remain reachable while a task is active without restarting or finishing it.

Do not equate objective counts or possession of items with quest turn-in. When a separate ready-to-turn-in native condition is unverified, write the active response conditionally ("If all three are defeated, turn in the task with me") rather than claiming a missing count, paying a reward, or advancing the next quest. Keep native quest/reward definitions unchanged unless their modification is requested and supported.

Validate both **first-match root selection on a fresh right-click** and **reply reachability within the chosen tree**. Test closure at intermediate pages, declined/abandoned offers, repeated active visits, readiness without hand-in, hand-in, old read history, shared advice/lore, and two players at different stages. A connected graph alone does not prove the correct root opens; a passing entry scan alone does not prove the rest of the conversation is reachable.

### Handoff and reference boundaries

When asked what to select on the NPC, give **only the intended starting roots, by exact dialogue title, in scan order**; IDs may be secondary for troubleshooting. Show reply-linked children separately and do not list them as additional NPC assignments unless they are deliberate resume roots. A slot plan is not a native NPC export: when NPC bindings are absent, state that assignment is still required rather than claiming to have applied it on the server.

Read [native availability and entry design](references/native-availability.md) for evidence and exact-build limitations. [Elder Posta's current six-root plan](../../docs/elder-posta-native-dialogs.md) replaces the earlier 12-root implementation with a repeatable work hub and reply-only topic menus, briefing, and acknowledgements. Its three task-specific active roots preserve appropriate opening text; six is this design's choice, not a required count. Its tests cover entry selection and reply reachability after interruptions.

The user supplied the historical [Noppes Dialog Setup page](https://www.kodevelopment.nl/minecraft/customnpcs/dialog), dated 2013-05-02. It distinguishes creating global dialogues from assigning a starting dialogue to an NPC, but its old slot/option limits are not evidence for the current GBPort build. Use the user's current explanation for the ordered-entry model; do not copy obsolete UI limits or infer native enum values from that page.

## Delivery

For native work, return the edited native-format artifact and a concise account of changed fields, preserved types, and unresolved semantics. Report lexical checks separately from actual CNPC import/runtime tests. Use the bundled exact-build samples where applicable. When matching evidence for the requested native feature is unavailable, say what is missing instead of delivering neutral JSON as completion.

For optional neutral drafting, return the story files and draft validation result, clearly labeled non-native. Runtime execution, live data mutation, installation, or deployment requires a request that includes it.

The skill has no MCP dependency. It supports sample-based native editing, optional story drafting, and documented API assistance; it does not install a mixin or provide a native importer.
