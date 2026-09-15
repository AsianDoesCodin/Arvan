var API = Java.type("noppes.npcs.api.NpcAPI").Instance()

function snapshotDialogue(dialogue) {
    var quest = dialogue.getQuest()
    var availability = dialogue.getAvailability()
    var options = dialogue.getOptions()
    var result = {
        id: Number(dialogue.getId()),
        name: String(dialogue.getName()),
        text: String(dialogue.getText()),
        category: String(dialogue.getCategory().getName()),
        linkedQuestId: quest ? Number(quest.getId()) : null,
        command: String(dialogue.getCommand()),
        daytimeRaw: Number(availability.getDaytime()),
        minPlayerLevel: Number(availability.getMinPlayerLevel()),
        options: []
    }
    for (var i = 0; i < options.size(); i++) {
        var option = options.get(i)
        var target = option.hasDialog() ? option.getDialog() : null
        result.options.push({
            slot: Number(option.getSlot()),
            name: String(option.getName()),
            typeRaw: Number(option.getType()),
            valid: Boolean(option.isValid()),
            canClose: Boolean(option.canClose()),
            targetDialogueId: target ? Number(target.getId()) : null
        })
    }
    return result
}

function snapshotQuest(quest) {
    var next = quest.getNextQuest()
    var rewards = quest.getRewards()
    var result = {
        id: Number(quest.getId()),
        name: String(quest.getName()),
        typeRaw: Number(quest.getType()),
        logText: String(quest.getLogText()),
        completeText: String(quest.getCompleteText()),
        nextQuestId: next ? Number(next.getId()) : null,
        repeatable: Boolean(quest.getIsRepeatable()),
        itemRewards: []
    }
    for (var i = 0; i < rewards.getSize(); i++) {
        var item = rewards.getSlot(i)
        if (item && !item.isEmpty()) {
            result.itemRewards.push({ slot: i, item: String(item.getName()), count: Number(item.getStackSize()) })
        }
    }
    return result
}

function inspectDialogueCatalog() {
    var categories = API.getDialogs().categories()
    var count = 0
    for (var i = 0; i < categories.size(); i++) {
        var dialogues = categories.get(i).dialogs()
        for (var j = 0; j < dialogues.size(); j++) {
            print(JSON.stringify({ format: "cnpc-api-snapshot/v1", kind: "dialogue", value: snapshotDialogue(dialogues.get(j)) }))
            count++
        }
    }
    return count
}

function inspectQuestIds(ids) {
    for (var i = 0; i < ids.length; i++) {
        var id = Number(ids[i])
        if (!isFinite(id) || Math.floor(id) !== id || id < 0) {
            throw new Error("Invalid quest ID at index " + i)
        }
        var quest = API.getQuests().get(id)
        print(JSON.stringify({ format: "cnpc-api-snapshot/v1", kind: "quest", requestedId: id, value: quest ? snapshotQuest(quest) : null }))
    }
}

/** @param {IPlayer} player */
function inspectPlayerQuestIds(player) {
    var active = player.getActiveQuests()
    var finished = player.getFinishedQuests()
    var result = { activeQuestIds: [], finishedQuestIds: [] }
    for (var i = 0; i < active.length; i++) result.activeQuestIds.push(Number(active[i].getId()))
    for (var j = 0; j < finished.length; j++) result.finishedQuestIds.push(Number(finished[j].getId()))
    print(JSON.stringify({ format: "cnpc-api-snapshot/v1", kind: "player-quest-ids", value: result }))
    return result
}
