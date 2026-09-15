# Elder Posta — six starting dialogues, reply-linked trees

## Select these titles on the NPC, top to bottom

Replace the previous 12 assignments with these **six starting dialogues**, in this exact scan order. Leave the remaining starting slots empty. Import the revised native records first; dialogue 15 has been renamed from **Welcome to Valemont** to **Work and Questions**.

| Position | Exact title to select | ID (reference only) | Why this is a starting dialogue |
| --- | --- | --- | --- |
| 1 | **A Place in Valemont** | 35 | Quest 4 finished: repeatable post-Act-1 conversation |
| 2 | **Bring Back Six Cores** | 33 | Quest 4 active: core collection reminder |
| 3 | **The Packwolf Hunt** | 30 | Quest 3 active and quest 4 not finished: hunt reminder |
| 4 | **Goblins Still to Deal With** | 26 | Quest 2 active and quests 3/4 not finished: goblin reminder |
| 5 | **A New Face in Valemont** | 13 | Unread first meeting, no later quest progression |
| 6 | **Work and Questions** | 15 | Repeatable fallback and shared work/lore hub; always last |

These are alternatives chosen on right-click, **not six consecutive conversation pages**. The NPC stops at the first available entry. After that, player replies follow the linked tree. Every later right-click rechecks availability from the beginning.

Only these six pages belong in the starting list. **Goblins on the Road**, **The Packwolf Threat**, **Six Mana Cores**, the briefing, advice, acceptance pages, and acknowledgements are reply-linked children. They do not need extra NPC slots.

The NPC's native bindings/export are not present in the repository. `elder-posta-entry-plan.json` is a testable setup plan, **not a native NPC import**. This commit changes repository files, not the live NPC assignments or server installation.

## The reply trees

Arrows below are reply links; none means “advance to the next NPC starting slot.” Availability controls which task and acceptance replies are visible.

```text
A New Face in Valemont [first meeting]
  -> A Village Beside a Portal [repeatable world briefing]
       -> Work and Questions
  -> Work and Questions
  -> Questions for Elder Posta

Work and Questions [returning hub]
  -> Goblins on the Road [quest 2 not finished]
       -> First Blood [accept only when quest 2 is not active/finished]
       -> Goblins Still to Deal With [quest 2 active]
       -> Pick Your Battles [advice]
  -> The Packwolf Threat [quest 2 finished; quest 3 not finished]
       -> Thin the Pack [accept only when quest 3 is not active/finished]
       -> The Packwolf Hunt [quest 3 active]
       -> Keep Your Flanks Clear [advice]
       -> A Safer Road [optional, one-time acknowledgement]
  -> Six Mana Cores [quest 3 finished; quest 4 not finished]
       -> Gather the Cores [accept only when quest 4 is not active/finished]
       -> Bring Back Six Cores [quest 4 active]
       -> What a Mana Core Is [advice]
       -> The Hunt Is Finished [optional, one-time acknowledgement]
  -> Questions for Elder Posta
       -> village / mana / goblin advice
       -> Work and Questions [return without closing]

A Place in Valemont [quest 4 finished]
  -> Six Cores Delivered [optional, one-time acknowledgement]
       -> A Place in Valemont
  -> Questions for Elder Posta
```

All pages retain a close reply. Active task roots also lead to advice and general questions. From general questions the player can return to work, choose their current task, and return to its progress response in the same conversation. Acceptance still occurs only at First Blood (18), Thin the Pack (24), or Gather the Cores (29).

## What changed

- Reused the existing 21 dialogue IDs; no new IDs or index changes. The original dialogue-13 replacement from the earlier repair is retained, not claimed to be a recovered live export.
- Replaced the unread-only briefing root at 15 with **Work and Questions**, a state-neutral, repeatable hub. Preserved its world explanation in **A Village Beside a Portal** (20), reachable from the first greeting and lore tree.
- Added the missing lore-to-work reply. Returning after an early close, refusal, or abandonment no longer relies on assigning each continuation as another starting dialogue.
- Converted 17/23/28 into shared topic menus: they can be discussed while active, but the existing acceptance-page gates prevent duplicate quest starts. Their prose no longer assumes every visit is a new acceptance.
- Kept 27/31/34 as optional one-time acknowledgements inside those trees. Reading, skipping, or closing one cannot remove the next offer or the ending root.
- Kept task-specific opening text at 26/30/33. These pages conditionally direct ready players to the existing hand-in system, without claiming a live kill count or inventory total.
- Retained native option types, all unrelated fields, typed mail timestamps, existing quest attachments, and IDs. No page uses more than the five reply positions already observed in this project's records.

The working player/NPC scripts, HTML GUI, quest definitions, rewards, and quest completion behavior are **unchanged**. No runtime routing workaround is included.

## Availability and verification

The ordered-root scan is based on the user's current setup. Native mode numbering retains the project's existing convention, supported by the historical upstream API; see [native availability](../skills/cnpc-dialogue-quests/references/native-availability.md). Topic availability and acceptance availability are intentionally different: `Before` permits discussion during an active quest, while the acceptance page also needs `NotActive`. The fallback is unrestricted and must remain last.

```sh
node --test skills/cnpc-dialogue-quests/scripts/native-entry-availability.test.cjs
```

**28 offline tests passed.** They cover all 21 records, all 27 unstarted/active/finished quest combinations with four read-history variants, first-match selection, title/ID agreement, reply reachability, closure at reachable intermediate pages, refusal, abandonment, lore/advice detours, optional acknowledgements, readiness without hand-in, and two separate players. Original native files were verified against the repository blob hashes before editing; unrelated scalar tokens and containers were checked separately for preservation.

These are lexical and modeled-state checks, **not a Minecraft import or play-through**. Exact GBPort availability behavior, native NPC bindings, GUI rendering, and reward/turn-in behavior still require in-game verification. No readiness-specific enum, command, or reward automation was added.
