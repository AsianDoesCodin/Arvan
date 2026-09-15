// Copy this helper into an NPC, quest or reward script.
// Example: giveRegisteredItem(e.player, "ashfang", false) gives a native-drop-ready ???.
// Example: giveRegisteredItem(e.player, "ashfang", true) gives a newly rolled item.
// The player script delivers queued items when inventory space is available.
function giveRegisteredItem(player, registryId, identified) {
    var queue = JSON.parse(String(player.getStoreddata().get("arvanRegistryGiveQueue") || "[]"))
    if (queue.length >= 64) throw new Error("Registered item reward queue is full.")
    queue.push({id: String(registryId), identified: identified !== false})
    player.getStoreddata().put("arvanRegistryGiveQueue", JSON.stringify(queue))
}

// Match any roll/version of a template. Omit identified to accept either state.
function matchesRegisteredItem(stack, registryId, identified) {
    if (!stack || stack.isEmpty() || !stack.getNbt().has("arvanRegisteredItem")) return false
    try {
        var data = JSON.parse(String(stack.getNbt().getString("arvanRegisteredItem")))
        return data.schema === 1 && data.template === String(registryId) && (identified === undefined || data.identified === identified)
    } catch (error) { return false }
}
