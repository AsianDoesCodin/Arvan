# Elder Posta — native dialogue-only repair

The working `scripts/player/player_dialog_override.js` is restored exactly to blob `241531e9c4672bccc24933c732626f1597b78c2d`. No new runtime routing, commands, quest rewards, or automatic quest completion were added. This repair belongs to native dialogue records and their availability.

## Required NPC slot assignment

Assign these dialogue IDs to Elder Posta **in this exact scan order**, using all 12 positions described by the user:

```text
34, 35, 33, 31, 28, 30, 27, 23, 26, 13, 15, 17
```

| Position | ID | Opens when |
| --- | --- | --- |
| 1 (slot 0) | 34 | Quest 4 finished; acknowledgement 34 unread |
| 2 (slot 1) | 35 | Quest 4 finished; acknowledgement 34 read |
| 3 (slot 2) | 33 | Quest 4 active, including waiting for hand-in |
| 4 (slot 3) | 31 | Quest 3 finished; quest 4 neither active nor finished; 31 unread |
| 5 (slot 4) | 28 | Quest 3 finished; quest 4 neither active nor finished; repeatable core offer |
| 6 (slot 5) | 30 | Quest 3 active, including waiting for hand-in |
| 7 (slot 6) | 27 | Quest 2 finished; quest 3 neither active nor finished; 27 unread |
| 8 (slot 7) | 23 | Quest 2 finished; quest 3 neither active nor finished; repeatable packwolf offer |
| 9 (slot 8) | 26 | Quest 2 active, including waiting for hand-in |
| 10 (slot 9) | 13 | Meeting 13 and briefing 15 unread; quest 2 neither active nor finished |
| 11 (slot 10) | 15 | Meeting 13 read, briefing 15 unread; quest 2 neither active nor finished |
| 12 (slot 11) | 17 | Briefing 15 read; quest 2 neither active nor finished; repeatable goblin offer |

**Do not retain an unconditional old introduction or general lore page ahead of these slots.** IDs 18, 24, and 29 are acceptance pages reached through choices, not NPC opening slots. IDs 19–22, 25, and 32 are linked advice/lore pages, not always-available opening roots.

The bundled source identifies **12 as the gate/referral quest page pointing to Elder Posta**, while quest 1 references **13** as its meeting objective. Keep 12 with the referral NPC; it is not part of Posta's entry list. The old live 13/14 records are not in this repository. The new `13.json` is an explicitly authored replacement for the already-known meeting ID 13, shaped from the verified `15.json` record; it is not a recovered copy of the original greeting. It links directly to 15 or lore, avoids depending on missing 14, retains the quest-1 dialogue objective ID, and does not allocate a new ID or change `highest_index`.

**The NPC's native export/bindings are absent from this repository.** The file `elder-posta-entry-plan.json` is an offline, testable plan, not a native NPC import. This commit therefore does not apply the slot assignment on the live NPC; importing dialogue records without assigning these slots is not the full deployment.

## What he says during active tasks

### 26 — goblins active

> Back from the road? Your task is still to deal with 3 goblins outside Valemont. Check your quest journal for your progress. If any remain, take your time and choose a fight you can survive. If all three are defeated, turn in the task with me. Until then, we will leave the packwolves for later. What do you need?

Choices: goblin advice (22), other questions (19), or leave.

### 30 — packwolves active

> How is the packwolf hunt going? The task calls for 3 packwolves. Your quest journal will tell you how far you have come. If the hunt is not finished, keep watching your flanks and do not let the pack surround you. If all three are down, turn in the hunt with me. The mana cores can wait until this work is settled.

Choices: packwolf advice (25), other questions (19), or leave.

### 33 — mana cores active

> Have you had any luck finding mana cores? I need 6 cores dropped by mana-born monsters. Keep them in your inventory for the hand-in; defeating the creatures without bringing back the cores is not enough. If you have all six, turn in the task with me. If you are still gathering them, there is no need to rush into a fight you cannot manage.

Choices: core explanation (32), other questions (19), or leave. Advice pages 25 and 32 now link back to the active task or the unaccepted offer, according to target availability.

No dialogue pretends to know a live kill count or inventory quantity. These active pages also make sense after objectives are ready but before the existing quest system has processed hand-in. They do not mark quests finished or grant rewards.

## Repeat visits and availability

```text
New meeting 13 -> briefing 15 -> goblin offer 17
  close/revisit: advance to the next unread intro page, then repeat offer
Accept 18 -> quest 2 active -> each return opens 26
Turn in quest 2 -> acknowledge 27 once -> repeat packwolf offer 23
Accept 24 -> quest 3 active -> each return opens 30
Turn in quest 3 -> acknowledge 31 once -> repeat core offer 28
Accept 29 -> quest 4 active -> each return opens 33
Turn in quest 4 -> acknowledge 34 once -> repeat conversation 35
```

Refusing or abandoning an uncompleted task leaves its offer available. Lore remains reachable while tasks are active and after the act is finished. `Before` plus `NotActive` excludes active and finished quests from offers; separate dialogue-read gates make greetings and acknowledgements one-time. See [availability evidence and limits](../skills/cnpc-dialogue-quests/references/native-availability.md).

## Validation

```sh
node --test skills/cnpc-dialogue-quests/scripts/native-entry-availability.test.cjs
```

19 offline content tests passed during authoring, covering all 21 dialogue records, first-match selection, all 27 quest-state combinations, repeat visits, early closure, refusal, abandonment, advice/lore detours, readiness without hand-in, and separate player histories. All 20 original records were matched to their GitHub blob hashes before editing. Unrelated native fields, long suffixes, quest attachments, and existing IDs were preserved; 13 is the documented replacement described above.

These are lexical and modeled-state checks, **not a Minecraft import/play-through**. Upstream enum documentation is for 1.18.2; installed GBPort 1.20.1 behavior and the live NPC slot list were not independently verified. Check first-time, active, ready-to-hand-in, and completed visits after applying the NPC assignments. The working runtime script is not part of this fix.
