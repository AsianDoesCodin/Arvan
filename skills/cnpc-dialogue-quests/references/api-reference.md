# Documented API surface: CustomNPCs 1.20.1

Evidence is the local `cnpc-scripting/references/api-types.md` declarations, with handler names from `cnpc-scripting/SKILL.md`. These are declaration-verified, not installed-jar or Minecraft-runtime verified. See [evidence-and-gaps.md](evidence-and-gaps.md) for exact provenance and unknowns.

## Receivers and methods

Initialize API access as prescribed by the scripting skill:

```javascript
var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
```

| Receiver type | Documented calls relevant here |
|---|---|
| `NpcAPI` | `getDialogs(): IDialogHandler`, `getQuests(): IQuestHandler` |
| `IDialogHandler` | `categories(): java.util.List<IDialogCategory>`, `get(id): IDialog` |
| `IDialogCategory` | `getName()`, `dialogs(): java.util.List<IDialog>`, `create(): IDialog` |
| `IDialog` | `getId()`, `getName()`, `setName(name)`, `getText()`, `setText(text)`, `getQuest(): IQuest`, `setQuest(quest)`, `getCommand()`, `setCommand(command)`, `getOptions(): java.util.List<IDialogOption>`, `getOption(slot): IDialogOption`, `getAvailability(): IAvailability`, `getCategory(): IDialogCategory`, `save()` |
| `IDialogOption` | `getSlot()`, `getName()`, `getType()`, `isValid()`, `getDialog(): IDialog`, `hasDialog()`, `canClose()` |
| `IQuestHandler` | `categories(): java.util.List<IQuestCategory>`, `get(id): IQuest` |
| `IQuest` | `getId()`, `getName()`, `setName(name)`, `getType()`, `setType(type)`, `getLogText()`, `setLogText(text)`, `getCompleteText()`, `setCompleteText(text)`, `getNextQuest(): IQuest`, `setNextQuest(quest)`, `getObjectives(player): IQuestObjective`, `getCategory(): IQuestCategory`, `getRewards(): IContainer`, `save()`, `getIsRepeatable()` |
| `IPlayer` | `hasFinishedQuest(id)`, `hasActiveQuest(id)`, `canQuestBeAccepted(id)`, `startQuest(id)`, `finishQuest(id)`, `stopQuest(id)`, `removeQuest(id)`, `getActiveQuests(): IQuest[]`, `getFinishedQuests(): IQuest[]`, `hasReadDialog(id)`, `showDialog(id, name)`, `removeDialog(id)`, `addDialog(id)` |
| `ICustomNpc` | `setDialog(slot, dialog: IDialog)`, `getDialog(slot): IDialog` |
| `IContainer` | `getSize()`, `getSlot(slot): IItemStack`, `setSlot(slot, item: IItemStack)`, `getItems(): IItemStack[]` |
| `IItemStack` | `getName()`, `getStackSize()`, `isEmpty()` |
| `java.util.List<T>` | `size()`, `get(index)`, `isEmpty()`, `toArray()` |

Important boundaries: `IQuestCategory` and `IQuestObjective` appear as return types but their members are not declared. Do not invent `.quests()`, `.create()`, `.setProgress()`, `.setMaxProgress()`, or assume objectives are an array. `IDialogOption` has no documented setters. Category creation/deletion, dialogue deletion, quest creation/deletion, and repeatability setters are not established. A player's `removeDialog`/`removeQuest` must not be presented as global definition deletion.

Use Java-list `.size()` and `.get(i)` for dialogue categories/options. Player active/finished quest results are declared arrays and use `.length` and `[i]`. Preserve integer record IDs; option slot numbers, list indices, and dialogue IDs are different values.

## Quest types

The declarations explicitly define these constants:

| Meaning | Value |
|---|---:|
| Item | 0 |
| Dialog | 1 |
| Kill | 2 |
| Location | 3 |
| Area kill | 4 |
| Manual | 5 |

`setType` existing on the interface does not establish how to initialize the corresponding objective data. Do not change an existing quest type as a shortcut to constructing a working quest.

## Availability

`IDialog.getAvailability()` returns `IAvailability`, which declares:

```text
isAvailable(player: IPlayer): boolean
getDaytime(): Number
setDaytime(type: Number): void
getMinPlayerLevel(): Number
setMinPlayerLevel(level: Number): void
setDialog(i: Number, id: Number, type: Number): void
removeDialog(i: Number): void
setQuest(i: Number, id: Number, type: Number): void
removeQuest(i: Number): void
setFaction(i: Number, id: Number, type: Number, stance: Number): void
setScoreboard(i: Number, objective: String, type: Number, value: Number): void
```

The numeric meanings of `type`, `stance`, and legal index ranges are absent. Do not assign guessed enum values. `IQuest` does not declare `getAvailability()`; do not move the dialogue method onto quests.

## Events

Use the handler names explicitly documented in the scripting skill, rather than mechanically shortening these class names:

| Handler | JSDoc event type | Fields |
|---|---|---|
| `dialog` | `DialogEvent.OpenEvent` | `player: IPlayer`, `dialog: IDialog` |
| `dialogClose` | `DialogEvent.CloseEvent` | `player`, `dialog` |
| `dialogOption` | `DialogEvent.OptionEvent` | `player`, `dialog`, `option: IDialogOption` |
| `questStart` | `QuestEvent.QuestStartEvent` | `player: IPlayer`, `quest: IQuest` |
| `questCompleted` | `QuestEvent.QuestCompletedEvent` | `player`, `quest` |
| `questTurnIn` | `QuestEvent.QuestTurnedInEvent` | `player`, `quest`, `expReward: Number`, `itemRewards: IItemStack[]` |

The event declarations do not prove cancellation support, dispatch order, which script container receives them, or whether writing reward fields changes the actual payout. Do not pay the same reward in multiple hooks or assume a completion event is a turn-in event. The documented event classes do not expose `npc` on `DialogEvent` or `QuestEvent`.

Read-only event example, requiring the actual event container to be confirmed before use:

```javascript
var API = Java.type("noppes.npcs.api.NpcAPI").Instance()

/** @param {DialogEvent.OptionEvent} event */
function dialogOption(event) {
    log("Dialog " + event.dialog.getId() + ", option slot " + event.option.getSlot())
}

/** @param {QuestEvent.QuestTurnedInEvent} event */
function questTurnIn(event) {
    log("Quest turn-in " + event.quest.getId() + ", experience " + event.expReward)
}
```

## Supported text-only editing example

This is a function definition, not an automatic event hook. It only edits an existing record. Use the actual observed ID and expected current title; calling it mutates content and must be in the requested task scope.

```javascript
var API = Java.type("noppes.npcs.api.NpcAPI").Instance()

function updateDialogueText(id, expectedName, text) {
    var dialogue = API.getDialogs().get(id)
    if (!dialogue || String(dialogue.getName()) !== expectedName) {
        throw new Error("Dialogue identity does not match: " + id)
    }
    dialogue.setText(text)
    dialogue.save()
}
```

The analogous verified quest text setters are `setName`, `setLogText`, and `setCompleteText`, followed by `save()`. Linking requires an `IQuest` object from `API.getQuests().get(id)`, not a raw number: `dialogue.setQuest(quest)`. Null-clearing behavior and automatic quest acceptance timing are not documented.
