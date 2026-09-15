// NPC script. Interact to identify; creative + sneak opens this NPC's cost settings.
var IDENTIFIER_API = Java.type("noppes.npcs.api.NpcAPI").Instance()
var IDENTIFIER_CONFIG_GUI = 114

function interact(e) {
    if (e.player.getGamemode() === 1 && e.player.isSneaking()) {
        openIdentifierSettings(e)
        return
    }
    var fee = JSON.parse(String(e.npc.getStoreddata().get("arvanIdentifierFee") || "null"))
    e.player.getTempdata().put("arvanRegistryIdentifyRequest", JSON.stringify({at: Date.now(), fee: fee}))
}

function openIdentifierSettings(e) {
    var fee = JSON.parse(String(e.npc.getStoreddata().get("arvanIdentifierFee") || "null"))
    var gui = IDENTIFIER_API.createCustomGui(IDENTIFIER_CONFIG_GUI, 340, 210, false, e.player)
    gui.addLabel(1, "§6§lIdentifier NPC", 12, 10, 300, 16)
    gui.addLabel(2, "§7Hold a payment item, then save. Payment uses hotbar slots only.", 12, 40, 315, 30)
    gui.addLabel(3, "§7Required count", 12, 84, 120, 12)
    gui.addTextField(4, 12, 100, 110, 20).setText(String(fee ? fee.count : 1))
    gui.addLabel(5, fee ? "§7Configured: " + fee.name + " ×" + fee.count : "§aCurrently free", 12, 135, 315, 22)
    gui.addButton(10, "Save held item cost", 12, 176, 145, 20)
    gui.addButton(11, "Make free", 165, 176, 90, 20)
    gui.addButton(12, "Close", 263, 176, 65, 20)
    e.player.showCustomGui(gui)
}

function customGuiButton(e) {
    if (e.gui.getID() !== IDENTIFIER_CONFIG_GUI || e.player.getGamemode() !== 1) return
    if (e.buttonId === 12) { e.player.closeGui(); return }
    if (e.buttonId === 11) {
        e.npc.getStoreddata().remove("arvanIdentifierFee")
        openIdentifierSettings(e)
        return
    }
    if (e.buttonId !== 10) return
    var stack = e.player.getMainhandItem()
    var count = Number(e.gui.getComponent(4).getText())
    if (!stack || stack.isEmpty() || !isFinite(count) || count < 1 || count > 9999 || count % 1) {
        e.player.message("§cHold a payment item and enter a whole count from 1 to 9999.")
        return
    }
    var copy = stack.copy()
    copy.setStackSize(1)
    e.npc.getStoreddata().put("arvanIdentifierFee", JSON.stringify({snbt: String(copy.getItemNbt().toJsonString()), name: String(copy.getDisplayName()), count: count}))
    openIdentifierSettings(e)
}
