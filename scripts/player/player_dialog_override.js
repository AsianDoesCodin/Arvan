/**
 * Dialog Override — Player Script
 * 
 * Intercepts ALL NPC dialog opens and replaces the vanilla CNPC dialog UI
 * with a cinematic HTML GUI (via CNPCExtended).
 * 
 * Place this as a Player script. Works globally for every NPC that has dialogs.
 * 
 * Flow:
 *   1. Player right-clicks NPC → CNPC picks the dialog → fires dialog event
 *   2. We cancel the event (prevents vanilla UI) and open our HTML GUI
 *   3. HTML GUI shows dialog text with typewriter + NPC entity + options
 *   4. When player picks an option that links to another dialog, we send the
 *      next dialog ID to the server, read it via API, and push data to the browser
 *   5. We handle quest assignment, dialog-read marking, commands, and factions
 *      server-side — replicating what NoppesUtilServer.openDialog normally does
 */

var API = Java.type("noppes.npcs.api.NpcAPI").Instance()

// ── Track which NPC the player is talking to ──
// Key = player UUID, Value = { npcEntityId, npcName }
var activeConversations = {}

/** @param {ICustomNpc} npc @returns {boolean} */
function isElderPosta(npc) {
    if (!npc) return false
    var name = String(npc.getDisplay().getName())
    return name.replace(/\u00a7[0-9a-fk-or]/gi, "").replace(/^\s+|\s+$/g, "").toLowerCase() === "elder posta"
}

/** @param {IPlayer} player @returns {boolean} */
function hasPostaQuestProgress(player) {
    for (var id = 2; id <= 4; id++) {
        if (player.hasActiveQuest(id) || player.hasFinishedQuest(id)) return true
    }
    return false
}

/** @param {IPlayer} player @returns {boolean} */
function hasReadPostaTaskDialog(player) {
    if (player.hasReadDialog(17) || player.hasReadDialog(18)) return true
    for (var id = 23; id <= 35; id++) {
        if (player.hasReadDialog(id)) return true
    }
    return false
}

/**
 * Select an opening from persisted PLAYER state, never by changing NPC slots.
 * Use persisted finished state; never infer completion from objective counts.
 * @param {IPlayer} player
 * @returns {number}
 */
function getElderPostaEntryId(player) {
    // Check the furthest stage first, including migrated/partially reset saves.
    if (player.hasFinishedQuest(4)) {
        return player.hasReadDialog(34) || player.hasReadDialog(35) ? 35 : 34
    }
    if (player.hasActiveQuest(4)) return 33
    if (player.hasFinishedQuest(3)) return 31
    if (player.hasActiveQuest(3)) return 30
    if (player.hasFinishedQuest(2)) return 27
    if (player.hasActiveQuest(2)) return 26

    // Declining or abandoning a task must not replay the first meeting.
    if (player.hasReadDialog(15) || hasReadPostaTaskDialog(player)) return 17
    if (player.hasReadDialog(13) || player.hasReadDialog(14) || player.hasFinishedQuest(1)) return 15
    return 13
}

/**
 * Native gates remain authoritative; add one-time meeting/briefing guards.
 * Used for opening, displayed choices, and server-side navigation alike.
 * @param {IDialog} dlg
 * @param {ICustomNpc} npc
 * @param {IPlayer} player
 * @returns {boolean}
 */
function isConversationDialogAvailable(dlg, npc, player) {
    if (!dlg || !dlg.getAvailability().isAvailable(player)) return false
    if (!isElderPosta(npc)) return true
    var id = Number(dlg.getId())
    if (id === 13) return getElderPostaEntryId(player) === 13
    if (id === 15) {
        return !player.hasReadDialog(15) && !hasPostaQuestProgress(player) && !hasReadPostaTaskDialog(player)
    }
    return true
}

/**
 * Redirect only Posta's known Act 1 entries; other NPCs and future acts pass through.
 * ID 12 is the legacy referral, not Posta's meeting (13). Never restart its quest
 * merely because an old NPC slot still points to it.
 * @param {IPlayer} player
 * @param {ICustomNpc} npc
 * @param {IDialog} requested
 * @returns {IDialog}
 */
function resolveConversationEntry(player, npc, requested) {
    if (!requested || !isElderPosta(npc)) return requested
    var requestedId = Number(requested.getId())
    if (!(requestedId >= 12 && requestedId <= 15) && !(requestedId >= 17 && requestedId <= 35)) return requested

    var id = getElderPostaEntryId(player)
    var entry = id === requestedId ? requested : API.getDialogs().get(id)
    // The original meeting is external to this repo. A standalone installation
    // can use the stored briefing, but must not silently skip an active talk quest.
    if (!entry && id === 13 && !player.hasActiveQuest(1)) entry = API.getDialogs().get(15)
    if (!entry) throw new Error("Elder Posta entry dialog " + id + " is missing")
    return entry
}

/**
 * Serialize a dialog into a plain object for the browser.
 * @param {IDialog} dlg
 * @param {ICustomNpc} npc
 * @param {IPlayer} player
 * @returns {object}
 */
function serializeDialog(dlg, npc, player) {
    var options = []
    var optList = dlg.getOptions()
    for (var i = 0; i < optList.size(); i++) {
        var opt = optList.get(i)
        if (!opt || !opt.getName() || opt.getName() === "") continue
        var type = opt.getType() // 0=QUIT, 1=DIALOG, 2=DISABLED, 3=ROLE, 4=COMMAND
        if (type === 1 && (!opt.hasDialog() || !isConversationDialogAvailable(opt.getDialog(), npc, player))) continue
        options.push({
            slot: opt.getSlot(),
            title: opt.getName(),
            type: type,
            hasDialog: opt.hasDialog(),
            dialogId: opt.hasDialog() ? opt.getDialog().getId() : -1,
            disabled: type === 2
        })
    }

    var questId = -1
    var questTitle = ""
    try {
        var quest = dlg.getQuest()
        if (quest) {
            questId = quest.getId()
            questTitle = quest.getName()
        }
    } catch (ex) { /* no quest */ }

    return {
        id: dlg.getId(),
        title: dlg.getName(),
        text: dlg.getText(),
        options: options,
        questId: questId,
        questTitle: questTitle,
        npcName: npc ? npc.getDisplay().getName() : "NPC",
        command: dlg.getCommand() || ""
    }
}

/**
 * Process side effects of opening a dialog (replicate NoppesUtilServer logic).
 * - Mark dialog as read
 * - Start attached quest
 * - Run attached command
 * @param {IPlayer} player
 * @param {IDialog} dlg
 */
function processDialogSideEffects(player, dlg) {
    if (!dlg.getAvailability().isAvailable(player)) return
    var dialogId = dlg.getId()

    // Mark dialog as read
    if (dialogId >= 0 && !player.hasReadDialog(dialogId)) {
        player.addDialog(dialogId)
    }
    if (dialogId === 13 && player.hasActiveQuest(1)) player.finishQuest(1)

    // Start attached quest
    try {
        var quest = dlg.getQuest()
        if (quest && !player.hasActiveQuest(quest.getId()) && !player.hasFinishedQuest(quest.getId())) {
            player.startQuest(quest.getId())
            player.message("§a[Quest Started] §f" + quest.getName())
        }
    } catch (ex) { /* no quest */ }

    // Run attached command (via NPC command context)
    var cmd = dlg.getCommand()
    if (cmd && cmd !== "") {
        var conv = activeConversations[player.getUUID()]
        if (conv && conv.npc) {
            try {
                conv.npc.executeCommand(cmd)
            } catch (ex) {
                player.message("§c[Dialog] Command failed: " + ex)
            }
        }
    }
}

// ════════════════════════════════════════════════════════════
// EVENT: dialog — fires when CNPC is about to show a dialog
// ════════════════════════════════════════════════════════════

/**
 * @param {DialogEvent.OpenEvent} e
 */
function dialog(e) {
    var player = e.player
    var npc = e.npc
    var dlg = e.dialog

    // Cancel the vanilla dialog UI
    e.setCanceled(true)

    // Resolve before recording state or running the original opening's side effects.
    try {
        dlg = resolveConversationEntry(player, npc, dlg)
        if (!isConversationDialogAvailable(dlg, npc, player)) {
            throw new Error("Opening dialog is unavailable for this player")
        }
    } catch (ex) {
        delete activeConversations[player.getUUID()]
        player.message("§c[Dialog] " + ex)
        return
    }

    // Store conversation state
    activeConversations[player.getUUID()] = {
        npc: npc,
        dialog: dlg,
        npcName: npc.getDisplay().getName()
    }

    // Process side effects for this first dialog
    processDialogSideEffects(player, dlg)

    // Serialize dialog data
    var dialogData = serializeDialog(dlg, npc, player)

    // Build init data for the HTML GUI
    var initData = JSON.stringify({
        dialog: dialogData,
        playerName: player.getDisplayName(),
        npcName: npc.getDisplay().getName(),
        overlayEntities: [
            { slot: 0, entityId: cnpcext.entityId(npc) }
        ]
    })

    // Use player object (not event) since we canceled the dialog event.
    // This routes htmlGuiEvent back to this player script.
    cnpcext.openHtmlGui(player, "dialog_override.html", 0, 0, initData)
}

// ════════════════════════════════════════════════════════════
// EVENT: htmlGuiEvent — handles messages from the HTML GUI
// ════════════════════════════════════════════════════════════

/**
 * @param {CustomGuiEvent.HtmlGuiEvent} e
 */
function htmlGuiEvent(e) {
    var player = e.player
    var name = e.eventName
    var data = e.data
    if (typeof data === "string") data = JSON.parse(data)
    if (typeof data === "string") data = JSON.parse(data)

    if (name === "__guiClosed") {
        // Cleanup conversation state
        delete activeConversations[player.getUUID()]
        return
    }

    // ── Player clicked an option that leads to another dialog ──
    if (name === "navigate") {
        var nextDialogId = data.dialogId
        if (nextDialogId == null || nextDialogId < 0) return

        try {
            var nextDialog = API.getDialogs().get(nextDialogId)
            if (!nextDialog) {
                player.message("§c[Dialog] Dialog not found: " + nextDialogId)
                return
            }

            var conv = activeConversations[player.getUUID()]
            if (!conv || !isConversationDialogAvailable(nextDialog, conv.npc, player)) return
            var currentOptions = conv.dialog.getOptions()
            var linked = false
            for (var i = 0; i < currentOptions.size(); i++) {
                var option = currentOptions.get(i)
                if (option && option.getType() === 1 && option.hasDialog() && option.getDialog().getId() === nextDialogId) linked = true
            }
            if (!linked) return
            conv.dialog = nextDialog

            // Process side effects (mark read, start quest, run command)
            processDialogSideEffects(player, nextDialog)

            // Get the NPC from conversation state
            var conv = activeConversations[player.getUUID()]
            var npc = conv ? conv.npc : null

            // Serialize and push to browser
            var dialogData = serializeDialog(nextDialog, npc, player)
            var bridge = cnpcext.getClientBridge(player.getMCEntity())
            bridge.sendToBrowser("showDialog", JSON.stringify({ dialog: dialogData }))

        } catch (ex) {
            player.message("§c[Dialog] Error: " + ex)
        }
        return
    }

    // ── Player clicked a QUIT option (close dialog) ──
    if (name === "close") {
        delete activeConversations[player.getUUID()]
        return
    }

    // ── Player clicked a ROLE option (open role GUI — trader, bank, etc.) ──
    if (name === "openRole") {
        // Close HTML GUI, player can right-click the NPC again to access the role
        // (Role GUIs are internal to CNPC and can't be triggered from script easily)
        var conv = activeConversations[player.getUUID()]
        if (conv && conv.npc) {
            player.message("§eRight-click the NPC again to access their services.")
        }
        delete activeConversations[player.getUUID()]
        return
    }

    // ── Player clicked a COMMAND option ──
    if (name === "runCommand") {
        var conv = activeConversations[player.getUUID()]
        if (conv && conv.npc && data.command) {
            try {
                conv.npc.executeCommand(data.command)
            } catch (ex) {
                player.message("§c[Dialog] Command error: " + ex)
            }
        }
        return
    }
}
