# Native availability, starting slots, and reply-linked trees

## Evidence and version boundary

Added 2026-09-15 for the dialogue-only Elder Posta repair; clarified the entry-slot versus reply-graph distinction after the user's correction the same day.

- The Arvan user states that, on NPC right-click, assigned starting dialogues are scanned in order and the first whose availability passes opens. Subsequent pages are reached by reply links, not by advancing through that assignment list. Their setup has about 12 starting slots: capacity, not a required number of roots or a cap on the graph's dialogue count.
- The user's historical [Noppes Dialog Setup page](https://www.kodevelopment.nl/minecraft/customnpcs/dialog), dated 2013-05-02 and read 2026-09-15, separates creation of global dialogues from NPC assignment. It also contains obsolete assignment/option limits. It is background only, not proof of the current ordered scan, slot count, numeric enums, or GBPort runtime behavior.
- Original upstream CustomNPCs 1.18.2 API documentation explicitly lists the dialog and quest availability numbering: [IAvailability](https://www.kodevelopment.nl/customnpcs/api/1.18.2/noppes/npcs/api/handler/data/IAvailability.html), `setDialog` and `setQuest`. This is primary upstream documentation, not a claim to have executed or decompiled the user's 1.20.1 jar.
- The existing Arvan native records already use quest modes 1/2/3/4 for transition, offer, active, and acceptance pages. The repair preserves their numeric convention and extends it with explicit not-active and dialog-read guards.
- Earlier skill references correctly recorded that the bundled local declarations did not document enum meanings. The upstream documentation above is additional evidence for numbering, **not exact-build runtime validation**. No server import, GUI test, or turn-in/reward test was performed for this repair. Cross-build behavior and conjunctive slot evaluation are assumptions in the offline regression model; verify them on the installed GBPort build before treating the model as runtime proof.

## Two independent selection layers

**Entry selection:** on right-click, evaluate the ordered list of assigned starting dialogues against the player's current state, open the first available root, and stop. Later entries are alternatives, not automatically queued pages. If the player returns later, evaluate the list again; do not treat its position as a conversation cursor. Behavior when no entry passes is not established here, so check coverage rather than assuming a fallback is supplied by the engine.

**Reply navigation:** inside the opened conversation, an ordinary link uses `Options[].Option.Dialog` to select the next record. Its `OptionSlot` is the reply position, not an NPC starting slot. A linked record need not be assigned to the NPC. One root can reach many nodes, branches, shared pages, and loops; the target's availability still needs checking along that route.

Choose the smallest useful set of entry roots, then build their reply graphs. Do not assign every continuation, offer, acceptance, or advice page merely because it exists. A descendant may also serve as a root only when a deliberate return/resume case needs that opening. Preserve recovery after closing mid-tree, refusing, or abandoning a task. A repeatable return hub with availability-gated replies can share downstream content; it must not replay a first-meeting greeting.

Test first-match selection and reply reachability separately. In user-facing assignment instructions, list exact **titles** of roots in scan order, with IDs optional; put descendants in a separate tree. The current Posta plan uses six roots and a reply-linked work hub, replacing the earlier 12-root implementation. This count is specific to the chosen opening text, not a requirement for other trees. Continuation and interruption paths are covered by the updated content tests.

## Modes used in this repair

| Native field family | Mode | Upstream name | Interpretation used by the offline model |
| --- | --- | --- | --- |
| `AvailabilityDialog*` | 0 | Always | No dialogue-read restriction |
| `AvailabilityDialog*` | 1 | After | Referenced dialogue has been read |
| `AvailabilityDialog*` | 2 | Before | Referenced dialogue has not been read |
| `AvailabilityQuest*` | 0 | Always | No quest restriction |
| `AvailabilityQuest*` | 1 | After | Referenced quest has been finished/turned in |
| `AvailabilityQuest*` | 2 | Before | Referenced quest has not been finished; it may be active |
| `AvailabilityQuest*` | 3 | Active | Referenced quest is active |
| `AvailabilityQuest*` | 4 | NotActive | Referenced quest is not active; it may already be finished |

The original API also lists quest mode 5 as `Completed`. It is deliberately **not used** here: the exact-build distinction between objective readiness and a completed/turned-in quest was not runtime-verified. Do not borrow availability enum mappings from another fork: numbering can differ even when names match.

Combine `Before` and `NotActive` on the same quest for an acceptance page available before acceptance or after abandonment. A shared topic menu may use `Before` without `NotActive` so active players can discuss that task; its acceptance reply must target the separately gated acceptance page. Do not turn that into an unread-dialog condition. Acknowledgements and greetings can be unread-only; offers must remain reachable after a refusal.

## Native field pairing

The four slots use the existing fields, without inventing a condition schema:

```text
AvailabilityQuest    + AvailabilityQuestId
AvailabilityQuest2   + AvailabilityQuest2Id
AvailabilityQuest3   + AvailabilityQuest3Id
AvailabilityQuest4   + AvailabilityQuest4Id
```

These are availability requirement slots within a record, not NPC starting assignments or reply positions. Dialogue-read restrictions use the corresponding `AvailabilityDialog*` pairs. In Arvan, unused slots retain mode 0 and ID -1. Preserve unrelated time, faction, scoreboard, and typed mail fields. The offline test models active requirements conjunctively; it is not a native engine emulator.

## Authoring and validation boundary

Actual edited records are under `dialogs/Act 1  Intro/`. `docs/elder-posta-entry-plan.json` is explicitly labeled an **offline entry plan**, not a native NPC export or an automatic loader. Assigning roots to the NPC remains necessary when the NPC's native configuration is absent; reply-only descendants need no assignment.

`native-entry-availability.test.cjs` is a read-only Node content test in this skill, not a Minecraft runtime script. It parses native text using the existing lexical inventory helper without stripping `L` suffixes, then tests first-match selection under the documented model. It does not change the working player dialog override. The six-root revision updates native reply links, availability, the entry plan, and offline tests together; it leaves all runtime scripts and quest definitions untouched.
