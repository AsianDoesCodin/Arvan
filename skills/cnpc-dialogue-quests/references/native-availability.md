# Native availability and ordered NPC entries

## Evidence and version boundary

Added 2026-09-15 for the dialogue-only Elder Posta repair.

- The Arvan user states that the NPC scans assigned dialogue slots in order and opens the first whose availability passes; their setup has about 12 slots. This is the basis of this project's 12-entry plan, not a universal slot-limit claim.
- Original upstream CustomNPCs 1.18.2 API documentation explicitly lists the dialog and quest availability numbering: [IAvailability](https://www.kodevelopment.nl/customnpcs/api/1.18.2/noppes/npcs/api/handler/data/IAvailability.html), `setDialog` and `setQuest`. This is primary upstream documentation, not a claim to have executed or decompiled the user's 1.20.1 jar.
- The existing Arvan native records already use quest modes 1/2/3/4 for transition, offer, active, and acceptance pages. The repair preserves their numeric convention and extends it with explicit not-active and dialog-read guards.
- Earlier skill references correctly recorded that the bundled local declarations did not document enum meanings. The upstream documentation above is additional evidence for numbering, **not exact-build runtime validation**. No server import, GUI test, or turn-in/reward test was performed for this repair. Cross-build behavior and conjunctive slot evaluation are assumptions in the offline regression model; verify them on the installed GBPort build before treating the model as runtime proof.

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

Combine `Before` and `NotActive` on the same quest for a repeatable offer before acceptance or after abandonment. Do not turn that into an unread-dialog condition. Acknowledgements and greetings can be unread-only; offers must remain reachable after a refusal.

## Native field pairing

The four slots use the existing fields, without inventing a condition schema:

```text
AvailabilityQuest    + AvailabilityQuestId
AvailabilityQuest2   + AvailabilityQuest2Id
AvailabilityQuest3   + AvailabilityQuest3Id
AvailabilityQuest4   + AvailabilityQuest4Id
```

Dialogue-read restrictions use the corresponding `AvailabilityDialog*` pairs. In Arvan, unused slots retain mode 0 and ID -1. Preserve unrelated time, faction, scoreboard, and typed mail fields. The offline test models active requirements conjunctively; it is not a native engine emulator.

## Authoring and validation boundary

Actual edited records are under `dialogs/Act 1  Intro/`. `docs/elder-posta-entry-plan.json` is explicitly labeled an **offline entry plan**, not a native NPC export or an automatic loader. Assigning those IDs to the NPC remains necessary when the NPC's native configuration is absent.

`native-entry-availability.test.cjs` is a read-only Node content test in this skill, not a Minecraft runtime script. It parses native text using the existing lexical inventory helper without stripping `L` suffixes, then tests first-match selection under the documented model. It does not change the working player dialog override.
