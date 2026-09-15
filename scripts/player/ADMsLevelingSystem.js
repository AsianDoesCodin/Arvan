// ============================================
// ADM's LEVELING SYSTEM - Player Script
// ============================================
// Combined: Leveling + Attributes + Classes + Equipment
// Commands: /self / /attr (player GUI), /admin (admin panel)
// Admin Commands: /lvladd / /lvlset / /lvlinfo / /lvlreset, /class reset, /stat reset, /admin reset
// Version: 1.12.0
// ============================================

var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
var JAVA_STRING = Java.type("java.lang.String")
var JAVA_UTF8 = Java.type("java.nio.charset.StandardCharsets").UTF_8
var SERVER_CORE_SKILLS = Java.type("com.arvanworld.servercore.skills.ScriptSkillBridge")
var SERVER_CORE_MAP = Java.type("com.arvanworld.servercore.map.ScriptMapBridge")
var SERVER_CORE_MOB_LEVELS = Java.type("com.arvanworld.servercore.leveling.ScriptMobLevelBridge")
var SERVER_CORE_HUD = Java.type("com.arvanworld.servercore.hud.ScriptHudBridge")
var hudBridgeLastError = -1
var skillCatalogBatchSequence = 0
var skillHtmlBatchSequence = 0
var skillHtmlRequestParts = null
var SKILL_HTML_MAX_CHARS = 1048576
var SKILL_HTML_CHUNK_CHARS = 3000
var MOB_LEVEL_HTML_FILE = "mob_levels.html"
var MOB_LEVEL_TARGET_KEY = "admMobLevelTarget"
var mobLevelLastError = -1
var SERVER_CORE_SKILL_INIT_TIMER_ID = 913701
var QUEST_MINIMAP_TIMER_ID = 913702
var PLAYER_MENU_NAV_TIMER_ID = 913703
var ADM_SLASH_COMMANDS_REGISTERED = false
var ADM_COMMAND_OWNER_UUID = ""
var HTML_BRIDGE_SAFE_BYTES = 52000

// ===== CONFIGURATION =====
var CONFIG = {
    prefix: "/lvl",
    defaultExp: 0,
    defaultLevel: 1,
    baseExpPerLevel: 100,      // Base exp required for level 1->2
    maxLevel: 100,
    devItemName: "Item Dev",
    
    // HUD Display settings (persistent level/exp display)
    hudDisplayMethod: "actionbar",  // "overlay", "actionbar", "none"
    hudEnabled: true,               // Enable/disable HUD display
    
    // Level up effects
    levelUpSound: "minecraft:entity.player.levelup",
    levelUpParticle: "minecraft:totem_of_undying",  // Particle on level up
    levelUpChatMessage: true,        // Send chat message on level up
    
    // EXP Curve Tiers - configurable exponential rates by level range
    // expRate controls how steeply EXP requirements increase per level in that range
    // 1.0 = linear (same exp each level), 1.1 = 10% more each level, 1.2 = 20% more, etc.
    // Format: { minLevel, maxLevel, expRate }
    expCurveTiers: [
        { minLevel: 1, maxLevel: 100, expRate: 1.15 }    // Default: 15% more EXP per level
    ],

    // The ordinary-money contract is deliberately separate from Spirit.
    // storageKey is changed only by an explicit migration, never implicitly.
    currency: {
        storageKey: "gold",
        displayName: "Gold",
        symbol: "G",
        unitScale: 1,
        configRevision: 1,
        migrationHistory: []
    }
}

var CURRENCY_CONFIG_DEFAULT = {
    storageKey: "gold",
    displayName: "Gold",
    symbol: "G",
    unitScale: 1,
    configRevision: 1,
    migrationHistory: []
}
var CURRENCY_MAX_SAFE_INTEGER = 9007199254740991
var CURRENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/
var SPIRIT_STORAGE_KEY = "arvanSpirit"
var SPIRIT_RECEIPTS_KEY = "arvanSpiritReceipts"
var SPIRIT_MAX_SAFE_INTEGER = CURRENCY_MAX_SAFE_INTEGER
var spiritBridgeCache = undefined

function hasOwnValue(value, key) {
    return !!value && Object.prototype.hasOwnProperty.call(value, key)
}

function cloneJsonValue(value, fallback) {
    try { return JSON.parse(JSON.stringify(value)) } catch (error) { return fallback }
}

function normalizeWholeResource(value, fallback, maximum) {
    if (value === null || value === undefined || String(value).trim() === "") return fallback
    var number = Number(value)
    if (!isFinite(number) || number < 0 || number !== Math.floor(number) || number > maximum) return fallback
    return number
}

function getPlayerStoreddata(player) {
    if (!player || typeof player.getStoreddata !== "function") return null
    try { return player.getStoreddata() } catch (error) { return null }
}

function storeddataHas(stored, key) {
    return !!(stored && typeof stored.has === "function" && stored.has(key))
}

function storeddataGet(stored, key, fallback) {
    return storeddataHas(stored, key) && typeof stored.get === "function" ? stored.get(key) : fallback
}

function storeddataPut(stored, key, value) {
    if (!stored || typeof stored.put !== "function") return false
    try { stored.put(key, value); return true } catch (error) { return false }
}

function normalizeCurrencyConfig(value) {
    var source = value && typeof value === "object" ? value : {}
    var key = String(source.storageKey === undefined ? CURRENCY_CONFIG_DEFAULT.storageKey : source.storageKey).trim()
    if (!CURRENCY_KEY_PATTERN.test(key) || key === SPIRIT_STORAGE_KEY || key === SPIRIT_RECEIPTS_KEY || key.indexOf("arvan") === 0) {
        key = CURRENCY_CONFIG_DEFAULT.storageKey
    }
    var displayName = String(source.displayName === undefined ? CURRENCY_CONFIG_DEFAULT.displayName : source.displayName).trim()
    if (!displayName || displayName.length > 64) displayName = CURRENCY_CONFIG_DEFAULT.displayName
    var symbol = String(source.symbol === undefined ? CURRENCY_CONFIG_DEFAULT.symbol : source.symbol).trim()
    if (!symbol || symbol.length > 12) symbol = CURRENCY_CONFIG_DEFAULT.symbol
    var unitScale = normalizeWholeResource(source.unitScale, 1, 1000000)
    if (unitScale < 1) unitScale = 1
    var revision = normalizeWholeResource(source.configRevision, 1, CURRENCY_MAX_SAFE_INTEGER)
    if (revision < 1) revision = 1
    var history = Array.isArray(source.migrationHistory) ? source.migrationHistory.slice(0, 64) : []
    return {
        storageKey: key,
        displayName: displayName,
        symbol: symbol,
        unitScale: unitScale,
        configRevision: revision,
        migrationHistory: history
    }
}

function getCurrencyConfig(world) {
    if (world && typeof world.getStoreddata === "function") loadConfigFromWorld(world)
    CONFIG.currency = normalizeCurrencyConfig(CONFIG.currency)
    return cloneJsonValue(CONFIG.currency, cloneJsonValue(CURRENCY_CONFIG_DEFAULT, {}))
}

function updateCurrencyConfig(world, patch, allowMigration, player) {
    var current = getCurrencyConfig(world)
    var source = patch && typeof patch === "object" ? patch : {}
    if (player) {
        try {
            var bridge = getSpiritBridge(), handle = player.getMCEntity(), temp = player.getTempdata()
            if (!bridge || typeof bridge.updatePresentation !== "function") throw new Error("Server Core wallet update is required.")
            var nextKey = String(source.storageKey === undefined ? current.storageKey : source.storageKey).trim()
            if (nextKey !== current.storageKey) {
                var pending = temp.has("arvanCurrencyMigrationConfirm") ? JSON.parse(String(temp.get("arvanCurrencyMigrationConfirm"))) : null
                if (!pending || pending.to !== nextKey || pending.revision !== current.configRevision || pending.until < Date.now()) {
                    var migrationId = String(Java.type("java.util.UUID").randomUUID())
                    var preview = JSON.parse(String(bridge.planMigration(handle, nextKey, migrationId, current.configRevision)))
                    if (!preview.ok || preview.conflicts > 0) throw new Error(preview.message + (preview.conflicts ? " Conflicts: " + preview.conflicts : ""))
                    temp.put("arvanCurrencyMigrationConfirm", JSON.stringify({to: nextKey, revision: current.configRevision, id: migrationId, until: Date.now() + 30000}))
                    return {ok: false, message: "Migration preview: " + current.storageKey + " → " + nextKey + ". Online wallets: " + preview.entries.length + ". Offline wallets migrate on next access. Press Save again within 30 seconds to confirm."}
                }
                var migrated = JSON.parse(String(bridge.applyMigration(handle, nextKey, pending.id)))
                temp.remove("arvanCurrencyMigrationConfirm")
                if (!migrated.ok) throw new Error(migrated.message)
            }
            var updated = JSON.parse(String(bridge.updatePresentation(handle, String(source.displayName === undefined ? current.displayName : source.displayName), String(source.symbol === undefined ? current.symbol : source.symbol))))
            if (!updated.ok) throw new Error(updated.message)
            CONFIG.currency = updated.currency
            return {ok: true, config: updated.currency}
        } catch (error) { loadConfigFromWorld(world); return {ok: false, message: String(error)} }
    }
    var candidate = normalizeCurrencyConfig({
        storageKey: source.storageKey === undefined ? current.storageKey : source.storageKey,
        displayName: source.displayName === undefined ? current.displayName : source.displayName,
        symbol: source.symbol === undefined ? current.symbol : source.symbol,
        unitScale: source.unitScale === undefined ? current.unitScale : source.unitScale,
        configRevision: current.configRevision,
        migrationHistory: current.migrationHistory
    })
    if (String(source.storageKey === undefined ? current.storageKey : source.storageKey).trim() !== current.storageKey) {
        return { ok: false, message: "Money key changes require an explicit migration; no balances were moved or cleared.", current: current }
    }
    if (candidate.storageKey !== current.storageKey) {
        candidate.configRevision = current.configRevision + 1
        candidate.migrationHistory = current.migrationHistory.concat([{ from: current.storageKey, to: candidate.storageKey, revision: candidate.configRevision }]).slice(-64)
    } else {
        candidate.configRevision = current.configRevision
    }
    CONFIG.currency = candidate
    if (world) saveConfigToWorld(world)
    return { ok: true, config: cloneJsonValue(candidate, candidate) }
}

function getSpiritBridge() {
    if (spiritBridgeCache !== undefined) return spiritBridgeCache
    var candidates = []
    if (typeof SERVER_CORE_SKILLS !== "undefined") candidates.push(SERVER_CORE_SKILLS)
    try { candidates.push(Java.type("com.arvanworld.servercore.wallet.ScriptWalletBridge")) } catch (error) {}
    for (var i = 0; i < candidates.length; i++) {
        var bridge = candidates[i]
        if (!bridge) continue
        if (typeof bridge.getSpiritBalance === "function" || typeof bridge.spiritBalance === "function" ||
            typeof bridge.adjustSpirit === "function" || typeof bridge.setSpiritBalance === "function" ||
            typeof bridge.getNormalMoney === "function" || typeof bridge.getMoneyBalance === "function") {
            spiritBridgeCache = bridge
            return bridge
        }
    }
    spiritBridgeCache = null
    return null
}

function parseWalletResult(value) {
    var parsed = value
    try { if (typeof parsed === "string") parsed = JSON.parse(parsed) } catch (error) {}
    if (parsed && typeof parsed === "object") {
        if (parsed.ok === false) return null
        if (parsed.balance !== undefined) return normalizeWholeResource(parsed.balance, null, SPIRIT_MAX_SAFE_INTEGER)
        if (parsed.spiritBalance !== undefined) return normalizeWholeResource(parsed.spiritBalance, null, SPIRIT_MAX_SAFE_INTEGER)
        if (parsed.spirit !== undefined) return normalizeWholeResource(parsed.spirit, null, SPIRIT_MAX_SAFE_INTEGER)
        if (parsed.value !== undefined) return normalizeWholeResource(parsed.value, null, SPIRIT_MAX_SAFE_INTEGER)
    }
    return normalizeWholeResource(parsed, null, SPIRIT_MAX_SAFE_INTEGER)
}

function callSpiritBridge(names, argumentSets) {
    var bridge = getSpiritBridge()
    if (!bridge) return { supported: false, value: null }
    for (var i = 0; i < names.length; i++) {
        var method = bridge[names[i]]
        if (typeof method !== "function") continue
        for (var j = 0; j < argumentSets.length; j++) {
            try {
                var args = argumentSets[j], value
                if (args.length === 1) value = bridge[names[i]](args[0])
                else if (args.length === 2) value = bridge[names[i]](args[0], args[1])
                else if (args.length === 4) value = bridge[names[i]](args[0], args[1], args[2], args[3])
                else value = bridge[names[i]](args[0], args[1], args[2], args[3], args[4])
                try { value = JSON.parse(String(value)) } catch (parseError) {}
                return { supported: true, value: value, balance: parseWalletResult(value) }
            } catch (error) {}
        }
    }
    return { supported: true, value: null, balance: null }
}

function spiritPlayerHandle(player) {
    return player && typeof player.getMCEntity === "function" ? player.getMCEntity() : player
}

function getSpiritBalance(player) {
    if (!player) return 0
    var stored = getPlayerStoreddata(player)
    return normalizeWholeResource(storeddataGet(stored, SPIRIT_STORAGE_KEY, 0), 0, SPIRIT_MAX_SAFE_INTEGER)
}

function setSpiritBalance(player, amount, reason) {
    var value = normalizeWholeResource(amount, null, SPIRIT_MAX_SAFE_INTEGER)
    if (value === null || !player) return { ok: false, message: "Spirit must be a whole number from 0 to " + SPIRIT_MAX_SAFE_INTEGER + "." }
    if (!storeddataPut(getPlayerStoreddata(player), SPIRIT_STORAGE_KEY, value)) return { ok: false, message: "Could not save Spirit." }
    return { ok: true, balance: value }
}

function adjustSpiritBalance(player, delta, reason, receiptId) {
    return adjustStoredResource(player, SPIRIT_STORAGE_KEY, delta, receiptId, "spirit", "Spirit", "§b")
}

function getNormalMoneyBalance(player) {
    if (!player) return 0
    var config = getCurrencyConfig(player.getWorld())
    var stored = getPlayerStoreddata(player)
    return normalizeWholeResource(storeddataGet(stored, config.storageKey, 0), 0, CURRENCY_MAX_SAFE_INTEGER)
}

function setNormalMoneyBalance(player, amount, reason) {
    var value = normalizeWholeResource(amount, null, CURRENCY_MAX_SAFE_INTEGER)
    if (value === null || !player) return { ok: false, message: "Money must be a whole number from 0 to " + CURRENCY_MAX_SAFE_INTEGER + "." }
    var config = getCurrencyConfig(player.getWorld())
    if (!storeddataPut(getPlayerStoreddata(player), config.storageKey, value)) return { ok: false, message: "Could not save money." }
    return { ok: true, balance: value }
}

function adjustNormalMoneyBalance(player, delta, reason, receiptId) {
    if (!player) return { ok: false, message: "Player is required." }
    var config = getCurrencyConfig(player.getWorld())
    return adjustStoredResource(player, config.storageKey, delta, receiptId, "gold", config.displayName, "§6")
}

function adjustStoredResource(player, key, delta, receiptId, notificationKey, label, color) {
    var change = Number(delta)
    if (!player || !isFinite(change) || change !== Math.floor(change) || Math.abs(change) > CURRENCY_MAX_SAFE_INTEGER) return { ok: false, message: "A player and a whole-number change are required." }
    var stored = getPlayerStoreddata(player)
    var balance = normalizeWholeResource(storeddataGet(stored, key, 0), 0, CURRENCY_MAX_SAFE_INTEGER)
    var receipts = readResourceReceipts(player), receipt = key + ":" + String(receiptId || "")
    if (receiptId && hasOwnValue(receipts, receipt)) return { ok: true, balance: balance, replayed: true }
    var next = normalizeWholeResource(balance + change, null, CURRENCY_MAX_SAFE_INTEGER)
    if (next === null) return { ok: false, message: "Invalid or insufficient " + label + " balance." }
    if (!storeddataPut(stored, key, next)) return { ok: false, message: "Could not save " + label + "." }
    if (receiptId) {
        receipts[receipt] = true
        storeddataPut(stored, "admResourceReceipts", JSON.stringify(receipts))
    }
    notifyResourceGain(player, notificationKey, change, label, color)
    return { ok: true, balance: next, replayed: false }
}

function formatCurrency(value, world) {
    var config = getCurrencyConfig(world)
    var amount = normalizeWholeResource(value, 0, CURRENCY_MAX_SAFE_INTEGER)
    return String(config.symbol) + " " + amount + " " + String(config.displayName)
}

function readResourceReceipts(player) {
    if (!player) return {}
    var raw = storeddataGet(getPlayerStoreddata(player), "admResourceReceipts", "{}")
    try {
        var parsed = JSON.parse(String(raw || "{}"))
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch (error) { return {} }
}

function awardSpiritOnce(player, amount, reason, receiptId) {
    var reward = normalizeWholeResource(amount, 0, SPIRIT_MAX_SAFE_INTEGER)
    if (!player || reward <= 0) return { ok: true, awarded: 0, balance: getSpiritBalance(player) }
    var receipt = String(receiptId || "")
    if (!receipt) return { ok: false, awarded: 0, message: "Spirit rewards require a stable receipt." }
    var result = adjustSpiritBalance(player, reward, reason, receipt)
    if (!result.ok) return { ok: false, awarded: 0, message: result.message }
    return { ok: true, awarded: result.replayed ? 0 : reward, duplicate: !!result.replayed, balance: result.balance }
}

function normalizeSkillPermissionKey(value) {
    var key = String(value === undefined || value === null ? "" : value).trim().toLowerCase()
    return /^[a-z0-9_.-]{1,64}$/.test(key) ? key : ""
}

function normalizeSkillPermissionList(value) {
    var source = Array.isArray(value) ? value : value === undefined || value === null ? [] : String(value).split(",")
    var result = []
    for (var i = 0; i < source.length && result.length < 64; i++) {
        var key = normalizeSkillPermissionKey(source[i])
        if (key && result.indexOf(key) < 0) result.push(key)
    }
    return result
}

function nodeGrantedPermissions(node) {
    if (!node) return []
    return normalizeSkillPermissionList(node.grantedPermissions !== undefined ? node.grantedPermissions
        : node.permissionGrants !== undefined ? node.permissionGrants : node.grants)
}

function nodeRequiredPermissions(node) {
    if (!node) return []
    return normalizeSkillPermissionList(node.requiredPermissions !== undefined ? node.requiredPermissions
        : node.requiredPermissionKeys !== undefined ? node.requiredPermissionKeys : node.permissionRequirements)
}

function getPermissionCatalog(world) {
    var stored = world && world.getStoreddata ? world.getStoreddata() : null
    var raw = stored && stored.has("admPermissionCatalog") ? stored.get("admPermissionCatalog") : "{}"
    var parsed = {}
    try { parsed = JSON.parse(String(raw || "{}")) } catch (error) { parsed = {} }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {}
    return parsed
}

function friendlyPermissionLabel(world, key) {
    var normalized = normalizeSkillPermissionKey(key)
    if (!normalized) return "Unknown permission"
    var catalog = getPermissionCatalog(world)
    var entry = catalog[normalized]
    if (entry && typeof entry === "object" && entry.label) return String(entry.label)
    if (entry && typeof entry === "string") return entry
    return normalized.replace(/[_.:-]+/g, " ").replace(/(^|\s)([a-z])/g, function(all, gap, letter) { return gap + letter.toUpperCase() })
}

function setPermissionCatalog(world, catalog) {
    if (!world || !world.getStoreddata || !catalog || typeof catalog !== "object" || Array.isArray(catalog)) return false
    var clean = {}, keys = Object.keys(catalog)
    for (var i = 0; i < keys.length && i < 256; i++) {
        var key = normalizeSkillPermissionKey(keys[i])
        if (!key) continue
        var value = catalog[keys[i]]
        var label = value && typeof value === "object" ? value.label : value
        if (String(label || "").trim()) clean[key] = { label: String(label).trim().substring(0, 96) }
    }
    world.getStoreddata().put("admPermissionCatalog", JSON.stringify(clean))
    return true
}

function getEffectiveSkillPermissions(player, snapshot) {
    var result = []
    if (snapshot && Array.isArray(snapshot.effectivePermissions)) {
        return normalizeSkillPermissionList(snapshot.effectivePermissions)
    }
    if (snapshot && snapshot.effectivePermissionCounts && typeof snapshot.effectivePermissionCounts === "object") {
        result = normalizeSkillPermissionList(Object.keys(snapshot.effectivePermissionCounts))
        if (result.length) return result
    }
    var nodes = snapshot && snapshot.nodes ? snapshot.nodes : []
    for (var i = 0; i < nodes.length; i++) if (nodes[i].learned) {
        var grants = nodeGrantedPermissions(nodes[i])
        for (var j = 0; j < grants.length; j++) if (result.indexOf(grants[j]) < 0) result.push(grants[j])
    }
    return result
}

function skillNodePermissionCheck(player, node, snapshot) {
    var required = nodeRequiredPermissions(node)
    var granted = getEffectiveSkillPermissions(player, snapshot)
    var missing = []
    for (var i = 0; i < required.length; i++) if (granted.indexOf(required[i]) < 0) missing.push(required[i])
    return { required: required, granted: granted, missing: missing, passed: missing.length === 0 }
}

function nodeSpiritCost(node) {
    if (!node || node.prelearned === true || node.learnedWithNode) return 0
    return normalizeWholeResource(node.spiritCost !== undefined ? node.spiritCost : node.spirit,
        0, SPIRIT_MAX_SAFE_INTEGER)
}

function decorateSkillSnapshotEconomy(player, snapshot) {
    if (!snapshot || !snapshot.nodes) return snapshot
    var balance = getSpiritBalance(player)
    snapshot.spiritBalance = balance
    snapshot.spirit = balance
    snapshot.spiritDisplay = "Spirit"
    for (var i = 0; i < snapshot.nodes.length; i++) {
        var node = snapshot.nodes[i]
        var cost = nodeSpiritCost(node)
        var permissions = skillNodePermissionCheck(player, node, snapshot)
        node.spiritCost = cost
        node.requiredPermissions = permissions.required
        node.grantedPermissions = nodeGrantedPermissions(node)
        node.missingPermissions = permissions.missing
        node.permissionsReady = permissions.passed
        node.spiritReady = node.learned || cost <= balance
        if (!node.learned && node.learnable && (!node.spiritReady || !node.permissionsReady)) node.learnable = false
    }
    return snapshot
}

function learnSkillWithSpirit(player, classId, level, nodeId, node) {
    return callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.learn(player.getMCEntity(), classId, level, nodeId)
    })
}

// ===== GUI LAYER SYSTEM =====
// Lower IDs = background (rendered first)
// Higher IDs = foreground (rendered on top)
var LAYER = {
    // Background layers (1-49)
    BG_MAIN: 1,
    BG_HEADER: 2,
    BG_FOOTER: 3,
    BG_PANELS: 10,
    BG_ROW_BASE: 30,
    BG_ROW_ACCENT_BASE: 40,
    
    // Content layers (50-149)
    CONTENT_BASE: 50,
    CONTENT_LABELS: 100,
    
    // Scroll/Interactive layers (150+)
    SCROLL_LIST: 150,
    TEXT_FIELDS: 180,
    
    // Buttons (200+)
    BUTTONS: 200
}

// GUI texture references (consolidated) - GRAY/YELLOW/BLUE THEME
var TEXTURES = {
    // Base grays (background tiers)
    bgDark: "minecraft:textures/block/gray_concrete.png",
    bgMain: "minecraft:textures/block/light_gray_concrete.png",
    bgLight: "minecraft:textures/block/white_concrete.png",
    
    // Accent colors (yellow/blue theme)
    accentPrimary: "minecraft:textures/block/yellow_concrete.png",
    accentSecondary: "minecraft:textures/block/light_blue_concrete.png",
    accentHighlight: "minecraft:textures/block/gold_block.png",
    
    // Aliases for compatibility
    darkPanel: "minecraft:textures/block/gray_concrete.png",
    lightPanel: "minecraft:textures/block/light_gray_concrete.png",
    headerBg: "minecraft:textures/block/gray_concrete.png",
    accent: "minecraft:textures/block/yellow_concrete.png",
    
    // Stat row accents (themed: yellow, blue, cyan)
    strRow: "minecraft:textures/block/yellow_concrete.png",
    vitRow: "minecraft:textures/block/light_blue_concrete.png",
    dexRow: "minecraft:textures/block/cyan_concrete.png",
    buttonBg: "minecraft:textures/block/light_gray_concrete.png",
    
    // Equipment/Panel accents
    accentGold: "minecraft:textures/block/yellow_concrete.png",
    accentRed: "minecraft:textures/block/yellow_concrete.png",
    accentGreen: "minecraft:textures/block/light_blue_concrete.png",
    accentBlue: "minecraft:textures/block/cyan_concrete.png"
}

var RPG_UI = {
    frame: "minecraft:textures/block/deepslate_tiles.png",
    base: "minecraft:textures/block/black_concrete.png",
    chrome: "minecraft:textures/block/polished_blackstone_bricks.png",
    panel: "minecraft:textures/block/brown_terracotta.png",
    panelAlt: "minecraft:textures/block/blackstone.png",
    panelAlt2: "minecraft:textures/block/polished_blackstone.png",
    gold: "minecraft:textures/block/gold_block.png",
    cyan: "minecraft:textures/block/cyan_concrete.png",
    red: "minecraft:textures/block/red_concrete.png"
}

function addRpgFrame(gui, width, height, accentTexture) {
    var accent = accentTexture || RPG_UI.gold
    gui.addTexturedRect(LAYER.BG_MAIN, RPG_UI.frame, 0, 0, width, height)
    gui.addTexturedRect(LAYER.BG_HEADER, RPG_UI.base, 4, 4, width - 8, height - 8)
    gui.addTexturedRect(LAYER.BG_FOOTER, RPG_UI.chrome, 4, height - 34, width - 8, 30)
    gui.addTexturedRect(4, RPG_UI.chrome, 4, 4, width - 8, 28)
    gui.addTexturedRect(5, accent, 4, 4, width - 8, 2)
    gui.addTexturedRect(6, accent, 4, 30, width - 8, 2)
    gui.addTexturedRect(7, accent, 4, height - 34, width - 8, 2)
}

function addRpgPanel(gui, componentId, x, y, width, height, accentTexture) {
    gui.addTexturedRect(componentId, RPG_UI.panel, x, y, width, height)
    if (accentTexture) gui.addTexturedRect(componentId + 1, accentTexture, x, y, 4, height)
}

function addRpgSlotFrame(gui, componentId, x, y, accentTexture) {
    gui.addTexturedRect(componentId, accentTexture || RPG_UI.chrome, x - 1, y - 1, 20, 20)
}

function addRpgInventorySlotFrames(gui, componentId, x, y, accentTexture) {
    var nextId = componentId
    for (var row = 0; row < 3; row++) {
        for (var column = 0; column < 9; column++) {
            addRpgSlotFrame(gui, nextId++, x + column * 18, y + row * 18, accentTexture)
        }
    }
    for (var hotbarColumn = 0; hotbarColumn < 9; hotbarColumn++) {
        addRpgSlotFrame(gui, nextId++, x + hotbarColumn * 18, y + 58, accentTexture)
    }
    return nextId
}

function shortGuiText(value, maxLength) {
    var text = String(value || "")
    return text.length > maxLength ? text.substring(0, maxLength - 3) + "..." : text
}

var ADM_GUI_TRANSITION_KEY = "admInternalGuiTransitions"

function showManagedGui(player, gui) {
    var temp = player.getTempdata()
    if (temp.has(HTML_ACTIVE_SESSION_KEY) && String(temp.get(HTML_ACTIVE_SESSION_KEY)) === "CLASS") {
        temp.put(CLASS_SKILL_HTML_REBIND_KEY, player.getWorld().getTotalTime())
    }
    if (player.getCustomGui()) {
        var transitions = temp.has(ADM_GUI_TRANSITION_KEY)
            ? Number(temp.get(ADM_GUI_TRANSITION_KEY))
            : 0
        temp.put(ADM_GUI_TRANSITION_KEY, transitions + 1)
    }
    player.showCustomGui(gui)
}

function consumeManagedGuiTransition(player) {
    var temp = player.getTempdata()
    if (!temp.has(ADM_GUI_TRANSITION_KEY)) return false
    var transitions = Number(temp.get(ADM_GUI_TRANSITION_KEY))
    if (transitions > 1) {
        temp.put(ADM_GUI_TRANSITION_KEY, transitions - 1)
    } else {
        temp.remove(ADM_GUI_TRANSITION_KEY)
    }
    return true
}

// ===== GUI LAYOUT HELPER =====
var GUI_WIDTH = 380
var GUI_HEIGHT = 260

var GuiMath = {
    centerX: function(width) {
        return (GUI_WIDTH - width) / 2
    },
    centerY: function(height) {
        return (GUI_HEIGHT - height) / 2
    },
    anchor: function(anchorType, compWidth, compHeight, offsetX, offsetY) {
        var x = 0
        var y = 0
        switch(anchorType) {
            case "top-left":
                x = offsetX
                y = offsetY
                break
            case "top-right":
                x = GUI_WIDTH - compWidth + offsetX
                y = offsetY
                break
            case "bottom-left":
                x = offsetX
                y = GUI_HEIGHT - compHeight + offsetY
                break
            case "bottom-right":
                x = GUI_WIDTH - compWidth + offsetX
                y = GUI_HEIGHT - compHeight + offsetY
                break
            case "center":
                x = (GUI_WIDTH - compWidth) / 2 + offsetX
                y = (GUI_HEIGHT - compHeight) / 2 + offsetY
                break
        }
        return { x: x, y: y }
    },
    grid: function(col, row, cellWidth, cellHeight, padX, padY, originX, originY) {
        return {
            x: originX + col * (cellWidth + padX),
            y: originY + row * (cellHeight + padY)
        }
    },
    percent: function(xPercent, yPercent) {
        return {
            x: GUI_WIDTH * xPercent / 100,
            y: GUI_HEIGHT * yPercent / 100
        }
    }
}

// ===== LEVEL DATA FUNCTIONS =====

// Get the exponential rate for a specific level from curve tiers
function getExpRateForLevel(level) {
    var tiers = CONFIG.expCurveTiers
    for (var i = 0; i < tiers.length; i++) {
        var tier = tiers[i]
        if (level >= tier.minLevel && level <= tier.maxLevel) {
            return tier.expRate
        }
    }
    // Default to 1.15 if no tier matches
    return 1.15
}

// Calculate exp needed to go from 'level' to 'level+1'
// Uses the TARGET level's tier rate (the level you're going TO)
// This means entering a new tier uses that tier's rate immediately
function getExpForLevel(level) {
    // Level 1 = base exp
    if (level <= 1) {
        return CONFIG.baseExpPerLevel
    }
    
    // Build up exp by multiplying through each level
    // Use the rate of the TARGET level (level + 1) for each step
    var expNeeded = CONFIG.baseExpPerLevel
    
    for (var lvl = 1; lvl < level; lvl++) {
        // Get the rate for the level we're going TO (lvl + 1)
        var targetLevel = lvl + 1
        var rate = getExpRateForLevel(targetLevel)
        expNeeded = Math.floor(expNeeded * rate)
    }
    
    return expNeeded
}

// Get total exp needed from level 1 to reach target level
function getTotalExpForLevel(targetLevel) {
    var total = 0
    for (var i = 1; i < targetLevel; i++) {
        total += getExpForLevel(i)
    }
    return total
}

function formatCompactExp(value) {
    var amount = Math.max(0, Math.floor(Number(value) || 0))
    var suffixes = ["", "k", "m", "b", "t", "q"]
    var suffixIndex = 0
    var scaled = amount
    while (scaled >= 1000 && suffixIndex < suffixes.length - 1) {
        scaled /= 1000
        suffixIndex++
    }
    if (suffixIndex === 0) return String(amount)
    var decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
    var factor = Math.pow(10, decimals)
    var rounded = Math.round(scaled * factor) / factor
    if (rounded >= 1000 && suffixIndex < suffixes.length - 1) {
        rounded /= 1000
        suffixIndex++
        decimals = rounded >= 100 ? 0 : rounded >= 10 ? 1 : 2
    }
    return rounded.toFixed(decimals).replace(/\.0+$|(?:(\.\d*[1-9]))0+$/, "$1") + suffixes[suffixIndex]
}

function getPlayerData(player) {
    var stored = player.getStoreddata()
    return {
        level: stored.has("level") ? stored.get("level") : CONFIG.defaultLevel,
        exp: stored.has("exp") ? stored.get("exp") : CONFIG.defaultExp
    }
}

function logMobLevelError(error) {
    var now = Date.now()
    if (mobLevelLastError >= 0 && now - mobLevelLastError < 30000) return
    mobLevelLastError = now
    log("[Mob Levels] " + String(error))
}

function publishMobPlayerLevel(player) {
    if (!player.isAlive() || isArvanPersistenceFrozen(player)) return false
    try {
        var level = Number(getPlayerData(player).level)
        if (!isFinite(level) || level < 1 || level > 10000 || Math.floor(level) !== level) return false
        SERVER_CORE_MOB_LEVELS.publishPlayerLevel(player.getMCEntity(), level)
        return true
    } catch (error) {
        logMobLevelError(error)
        return false
    }
}

function awardMobLevelKillExp(player, entity, rawAmount) {
    var amount = Number(rawAmount)
    if (!player.isAlive() || isArvanPersistenceFrozen(player) || !isFinite(amount) || amount <= 0 || amount > 1000000000) return 0
    if (!publishMobPlayerLevel(player)) return 0
    var multiplier = Number(SERVER_CORE_MOB_LEVELS.xpMultiplier(player.getMCEntity(), entity.getMCEntity()))
    if (!isFinite(multiplier) || multiplier < 0 || multiplier > 100) throw new Error("Invalid XP multiplier")
    var awarded = Math.floor(amount * multiplier)
    if (awarded > 0) addPlayerExp(player, awarded)
    return awarded
}

function setPlayerLevel(player, level) {
    var stored = player.getStoreddata()
    level = Math.max(1, Math.min(level, CONFIG.maxLevel))
    stored.put("level", level)
    publishMobPlayerLevel(player)
    syncProgressionHud(player)
    var skillSync = syncPlayerSkills(player)
    if (!skillSync || skillSync.ok) applyAllAttributes(player)
}

function setPlayerExpRaw(player, exp) {
    // Sets exp WITHOUT checking level up (to avoid recursion)
    var stored = player.getStoreddata()
    exp = Math.max(0, exp)
    stored.put("exp", exp)
    syncProgressionHud(player)
}

function syncProgressionHud(player) {
    if (!player.isAlive() || isArvanPersistenceFrozen(player)) return
    try {
        var data = getPlayerData(player)
        var level = Number(data.level)
        var xp = Number(data.exp)
        var required = Number(getExpForLevel(level))
        if (!isFinite(level) || level < 1 || Math.floor(level) !== level || !isFinite(xp) || xp < 0 || !isFinite(required) || required <= 0) return
        var response = JSON.parse(String(SERVER_CORE_HUD.sync(player.getMCEntity(), level, xp, required)))
        if (!response || response.ok !== true) throw new Error(response && response.message ? String(response.message) : "HUD synchronization rejected")
    } catch (error) {
        var now = Date.now()
        if (hudBridgeLastError < 0 || now - hudBridgeLastError >= 30000) {
            hudBridgeLastError = now
            log("[HUD] " + String(error))
        }
    }
}

function setPlayerExp(player, exp) {
    var stored = player.getStoreddata()
    exp = Math.max(0, exp)
    stored.put("exp", exp)
    checkLevelUp(player)
}

function addPlayerExp(player, amount) {
    var data = getPlayerData(player)
    setPlayerExp(player, data.exp + amount)
    notifyResourceGain(player, "exp", amount, "EXP", "§a")
}

function checkLevelUp(player) {
    var data = getPlayerData(player)
    var expNeeded = getExpForLevel(data.level)
    var didLevelUp = false
    
    while (data.exp >= expNeeded && data.level < CONFIG.maxLevel) {
        // Subtract exp needed and carry over the excess
        data.exp -= expNeeded
        data.level++
        didLevelUp = true
        
        // Get new exp needed for next level
        expNeeded = getExpForLevel(data.level)
    }
    
    // Save final exp value (includes any overflow)
    setPlayerExpRaw(player, data.exp)
    
    // Play level up effects if leveled up
    if (didLevelUp) {
        setPlayerLevel(player, data.level)
        playLevelUpEffects(player, data.level)
    }
}

// Play level up sound, particles, and chat message
function playLevelUpEffects(player, newLevel) {
    var world = player.getWorld()
    var x = player.getX()
    var y = player.getY()
    var z = player.getZ()
    
    // Play sound
    if (CONFIG.levelUpSound) {
        player.playSound(CONFIG.levelUpSound, 1.0, 1.0)
    }
    
    // Spawn particles
    if (CONFIG.levelUpParticle) {
        world.spawnParticle(CONFIG.levelUpParticle, x, y + 1, z, 0.5, 0.5, 0.5, 0.1, 30)
    }
    
    // Chat message
    if (CONFIG.levelUpChatMessage && playerNotificationSettings(player).levelUp) {
        player.message("§a§lLEVEL UP! §rYou are now level §e§l" + newLevel)
    }
}

// ===== HUD DISPLAY SYSTEM =====
// Persistent level/exp display using overlay or actionbar

var HUD_OVERLAY_ID = 600

// Update the HUD display for a player
function updateHudDisplay(player) {
    if (!CONFIG.hudEnabled) return
    
    var data = getPlayerData(player)
    var expNeeded = getExpForLevel(data.level)
    
    // Improved design with symbols and color coding
    // Format: "★ Lv.5 ║ ◆ 69/420 EXP ◆"
    // Using unicode symbols that work in Minecraft:
    // ★ = star, ◆ = diamond, ║ = double bar, » = arrow
    var hudText = "\\u2605 §e§lLv.§6" + data.level + " §7\\u2551 §b" + formatCompactExp(data.exp) + "§7/§3" + formatCompactExp(expNeeded) + " §bEXP"
    
    if (CONFIG.hudDisplayMethod === "actionbar") {
        // Use /title actionbar command via NpcAPI.executeCommand
        var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
        try {
            API.executeCommand(player.getWorld(), "title " + player.getName() + " actionbar {\"text\":\"" + hudText + "\"}")
        } catch(err) {
            // Fallback - just skip if command fails
        }
    } else if (CONFIG.hudDisplayMethod === "overlay") {
        // Use IOverlay system
        showHudOverlay(player, data)
    }
}

// Show HUD using IOverlay
function showHudOverlay(player, data) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var overlay = API.createOverlay(HUD_OVERLAY_ID)
    
    var expNeeded = getExpForLevel(data.level)
    var expPercent = data.exp / expNeeded
    
    // Position at top-left
    overlay.setLinkSide(0) // 0 = top-left
    
    // Background panel (semi-dark)
    overlay.addTexturedRect(1, "minecraft:textures/block/gray_concrete.png", 3, 3, 95, 38)
    
    // Yellow accent strip on left
    overlay.addTexturedRect(2, "minecraft:textures/block/yellow_concrete.png", 3, 3, 3, 38)
    
    // Level display with star symbol
    overlay.addLabel(3, "§e★ §6§lLv." + data.level, 10, 8).setScale(1.0)
    
    // EXP bar background (dark gray)
    overlay.addTexturedRect(4, "minecraft:textures/block/black_concrete.png", 10, 22, 82, 6)
    
    // EXP bar filled (gradient: blue to cyan based on progress)
    var fillWidth = Math.floor(expPercent * 80)
    if (fillWidth > 0) {
        overlay.addTexturedRect(5, "minecraft:textures/block/light_blue_concrete.png", 11, 23, fillWidth, 4)
    }
    
    // EXP text with improved formatting
    overlay.addLabel(7, "§b" + formatCompactExp(data.exp) + "§7/§3" + formatCompactExp(expNeeded), 10, 30).setScale(0.7)
    
    player.showOverlay(overlay)
}

// Hide the HUD overlay
function hideHudOverlay(player) {
    player.hideOverlay(HUD_OVERLAY_ID)
}

// Tick handler for HUD updates
function _lvl_tick(e) {
    var player = e.player
    publishMobPlayerLevel(player)
    syncProgressionHud(player)
    
    if (!CONFIG.hudEnabled || CONFIG.hudDisplayMethod === "none") return
    
    // Update HUD every tick for both actionbar and overlay
    updateHudDisplay(player)
}

function resetPlayerLevel(player) {
    var stored = player.getStoreddata()
    stored.put("exp", CONFIG.defaultExp)
    removeDataKeysWithPrefix(stored, "stat_")
    clearPendingStatPoints(player)
    if (stored.has(ATTRIBUTE_RESTORE_PENDING_KEY)) stored.remove(ATTRIBUTE_RESTORE_PENDING_KEY)
    setPlayerLevel(player, CONFIG.defaultLevel)
}

// ===== LVL COMMAND HANDLER (ADMIN ONLY) =====
function _lvl_chat(e) {
    var player = e.player
    var msg = e.message
    var world = player.getWorld()
    
    if (msg.indexOf(CONFIG.prefix) !== 0) return false
    
    e.setCanceled(true)
    
    // All level-management commands are admin-only
    if (!isAdmin(player)) {
        player.message("§c[Level] Admin commands require Creative mode!")
        player.message("§7Use §e/self §7to view your stats.")
        return true
    }
    
    var args = msg.substring(CONFIG.prefix.length).trim().split(" ")
    var cmd = args[0] ? args[0].toLowerCase() : ""
    
    switch(cmd) {
        case "reset":
            handleReset(player, args, world)
            break
        case "add":
            handleAdd(player, args, world)
            break
        case "set":
            handleSet(player, args, world)
            break
        case "info":
            handleInfo(player, args, world)
            break
        default:
            showLvlAdminHelp(player)
    }
    return true
}

function showLvlAdminHelp(player) {
    player.message("§6=== Level Admin Commands ===")
    player.message("§e/lvlinfo <player> §7- View player level")
    player.message("§e/lvladd <player> <amount> §7- Add levels")
    player.message("§e/lvlset <player> <level> §7- Set level")
    player.message("§e/lvlreset <player> §7- Reset player")
    player.message("§7Use the §e/admin §7panel for the Dev Tool")
}

function handleReset(sender, args, world) {
    if (args.length < 2) {
        sender.message("§cUsage: /lvlreset <player>")
        return
    }
    var targetName = args[1]
    var target = world.getPlayer(targetName)
    
    if (!target) {
        sender.message("§cPlayer not found: " + targetName)
        return
    }
    if (rejectFrozenTargetMutation(sender, target)) return
    
    resetPlayerLevel(target)
    sender.message("§aReset level for §e" + targetName)
    target.message("§cYour level has been reset!")
}

function handleAdd(sender, args, world) {
    if (args.length < 2) {
        sender.message("§cUsage: /lvladd <player> <amount>")
        return
    }
    var targetName = args[1]
    var amount = args[2] ? parseInt(args[2]) : 1
    var target = world.getPlayer(targetName)
    
    if (!target) {
        sender.message("§cPlayer not found: " + targetName)
        return
    }
    if (rejectFrozenTargetMutation(sender, target)) return
    
    if (isNaN(amount)) {
        sender.message("§cInvalid amount!")
        return
    }
    
    var data = getPlayerData(target)
    setPlayerLevel(target, data.level + amount)
    var newData = getPlayerData(target)
    sender.message("§aAdded §e" + amount + "§a level(s) to §e" + targetName + "§a. Now level §e" + newData.level)
}

function handleSet(sender, args, world) {
    if (args.length < 3) {
        sender.message("§cUsage: /lvlset <player> <level>")
        return
    }
    var targetName = args[1]
    var level = parseInt(args[2])
    var target = world.getPlayer(targetName)
    
    if (!target) {
        sender.message("§cPlayer not found: " + targetName)
        return
    }
    if (rejectFrozenTargetMutation(sender, target)) return
    
    if (isNaN(level)) {
        sender.message("§cInvalid level!")
        return
    }
    
    setPlayerLevel(target, level)
    setPlayerExp(target, 0)
    sender.message("§aSet §e" + targetName + "§a's level to §e" + level)
    target.message("§aYour level has been set to §e" + level)
}

function handleDev(player) {
    var world = player.getWorld()
    var item = world.createItem("minecraft:blaze_rod", 1)
    item.setCustomName("§6§l" + CONFIG.devItemName)
    item.setLore(["§7Right-click an NPC", "§7to view/edit giveExp data", "§8[Dev Tool]"])
    
    // Store marker in item NBT using correct method name
    var nbt = item.getNbt()
    nbt.putString("devToolMarker", "LevelSystemDevTool")
    
    player.giveItem(item)
    player.message("§aYou received the §6Item Dev§a tool!")
    player.message("§7Tip: Right-click any NPC to configure their giveExp value")
}

function handleInfo(sender, args, world) {
    var targetName = args.length >= 2 ? args[1] : sender.getName()
    var target = world.getPlayer(targetName)
    
    if (!target) {
        sender.message("§cPlayer not found: " + targetName)
        return
    }
    
    var data = getPlayerData(target)
    var expNeeded = getExpForLevel(data.level)
    sender.message("§6=== " + targetName + "'s Level Info ===")
    sender.message("§eLevel: §f" + data.level)
    sender.message("§eEXP: §f" + data.exp + "/" + expNeeded)
}

// showHelp removed - use /self for the player GUI and /lvl for admin help

// ===== PLAYER LEVEL GUI =====
function showPlayerLevelGui(player) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var gui = API.createCustomGui(102, GUI_WIDTH, GUI_HEIGHT, false, player)
    var data = getPlayerData(player)
    var expNeeded = getExpForLevel(data.level)
    var expProgress = Math.max(0, Math.min(100, Math.floor((data.exp / expNeeded) * 100)))

    addRpgFrame(gui, GUI_WIDTH, GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 110, 180, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 128, 40, 242, 180, RPG_UI.cyan)

    var labelId = LAYER.CONTENT_BASE
    gui.addLabel(labelId++, "§6§lPLAYER PROGRESSION", 120, 9, 170, 12)
    gui.addLabel(labelId++, "§f" + player.getDisplayName(), 130, 21, 150, 10)
    gui.addLabel(labelId++, "§6§lLEVEL", 22, 50, 80, 12)
    gui.addLabel(labelId++, "§e§l" + data.level, 26, 72, 70, 28).setScale(2)
    gui.addLabel(labelId++, data.level >= CONFIG.maxLevel ? "§6§lMAXIMUM RANK" : "§7ADVENTURER RANK", 22, 112, 90, 20)
    gui.addLabel(labelId++, "§7Cap §f" + CONFIG.maxLevel, 22, 144, 80, 10)

    gui.addLabel(labelId++, "§b§lEXPERIENCE", 142, 50, 110, 12)
    gui.addLabel(labelId++, "§f" + data.exp + " §7/ §f" + expNeeded + " EXP", 142, 70, 200, 12)
    var filledBlocks = Math.floor(expProgress / 4)
    var emptyBlocks = 25 - filledBlocks
    var progressBar = "§e" + repeatChar("|", filledBlocks) + "§8" + repeatChar("|", emptyBlocks)
    gui.addLabel(labelId++, progressBar, 142, 92, 214, 12)
    gui.addLabel(labelId++, "§e§l" + expProgress + "%", 142, 112, 90, 12)
    var remainingExp = expNeeded - data.exp
    gui.addLabel(labelId++, data.level >= CONFIG.maxLevel ? "§6No further levels remain" : "§7Need §f" + remainingExp + " §7more EXP", 142, 136, 200, 12)
    gui.addLabel(labelId++, "§7EXP curve rate §f" + getExpRateForLevel(data.level).toFixed(2) + "x", 142, 164, 180, 10)
    gui.addLabel(labelId++, "§8Progress is saved automatically", 142, 184, 200, 10)

    gui.addButton(LAYER.BUTTONS, "§f§lCLOSE", 290, GUI_HEIGHT - 28, 78, 20)
    player.showCustomGui(gui)
}

// Helper function to repeat a character
function repeatChar(char, times) {
    var result = ""
    for (var i = 0; i < times; i++) {
        result += char
    }
    return result
}

// ===== DEV TOOL INTERACTION =====
function _lvl_interact(e) {
    var player = e.player
    var type = e.type
    
    // Check all hand slots for the item
    var mainHand = player.getMainhandItem()
    var offHand = player.getOffhandItem()
    var heldItem = player.getInventoryHeldItem()
    
    // Try mainhand first, then inventory held, then offhand
    var checkItem = null
    if (mainHand && !mainHand.isEmpty()) {
        checkItem = mainHand
    } else if (heldItem && !heldItem.isEmpty()) {
        checkItem = heldItem
    } else if (offHand && !offHand.isEmpty()) {
        checkItem = offHand
    }
    
    if (!checkItem) return
    if (!checkItem.hasCustomName()) return
    
    var displayName = checkItem.getDisplayName()
    if (displayName.indexOf(CONFIG.devItemName) === -1) return
    if (!isMobLevelAdmin(player)) {
        player.message("§cServer administrator access is required.")
        return
    }
    
    // This is the dev tool - get target
    var target = e.target
    
    if (target) {
        // Check if target is an NPC (type 2 = EntityType_NPC)
        if (target.getType() === 2) {
            e.setCanceled(true)
            showNpcDataGui(player, target)
            return
        } else {
            if (isMobLevelTarget(target)) {
                e.setCanceled(true)
                openMobLevelEditor(player, target)
            } else player.message("§cLook at a mob or NPC.")
        }
    } else {
        // Try raytracing as fallback
        try {
            var traced = player.rayTraceEntities(5, false, true)
            if (traced) {
                if (traced.getType) {
                    if (traced.getType() === 2) {
                        e.setCanceled(true)
                        showNpcDataGui(player, traced)
                        return
                    }
                    if (isMobLevelTarget(traced)) {
                        e.setCanceled(true)
                        openMobLevelEditor(player, traced)
                        return
                    }
                } else if (traced.length !== undefined) {
                    var tracedArray = traced
                    if (typeof Java !== 'undefined' && Java.from) {
                        try { tracedArray = Java.from(traced) } catch(ex) {}
                    }
                    for (var i = 0; i < tracedArray.length; i++) {
                        var ent = tracedArray[i]
                        if (ent && ent.getType() === 2) {
                            e.setCanceled(true)
                            showNpcDataGui(player, ent)
                            return
                        }
                    }
                }
            }
        } catch (rayError) {}
        
        player.message("§7No NPC found. Look at an NPC and right-click.")
    }
}

// ===== NPC DATA GUI =====
function showNpcDataGui(player, npc) {
    if (!isMobLevelAdmin(player)) return
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var gui = API.createCustomGui(100, GUI_WIDTH, GUI_HEIGHT, false, player)
    var stored = npc.getStoreddata()
    var stats = npc.getStats()
    player.getTempdata().put("inspectedNpcUUID", npc.getUUID())

    addRpgFrame(gui, GUI_WIDTH, GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 176, 116, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 194, 40, 176, 116, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 4, 10, 164, 176, 58, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 6, 194, 164, 176, 58, RPG_UI.cyan)

    var labelId = LAYER.CONTENT_BASE
    gui.addLabel(labelId++, "§6§lNPC DATA INSPECTOR", 120, 9, 170, 12)
    gui.addLabel(labelId++, "§bNPC §8• §f" + npc.getDisplay().getName(), 116, 21, 180, 10)
    gui.addLabel(labelId++, "§6§lCOMBAT STATS", 22, 48, 130, 10)
    gui.addLabel(labelId++, "§7Health §f" + Math.floor(npc.getHealth()) + " / " + stats.getMaxHealth(), 22, 66, 150, 10)
    gui.addLabel(labelId++, "§7Aggro Range §f" + stats.getAggroRange(), 22, 82, 150, 10)
    gui.addLabel(labelId++, "§7Melee Power §f" + stats.getMelee().getStrength(), 22, 98, 150, 10)
    gui.addLabel(labelId++, "§7Ranged Power §f" + stats.getRanged().getStrength(), 22, 114, 150, 10)
    var mobLevel = Number(SERVER_CORE_MOB_LEVELS.level(npc.getMCEntity()))
    gui.addLabel(labelId++, "§7Level §e" + (mobLevel > 0 ? mobLevel : "Unassigned"), 22, 132, 150, 10)

    gui.addLabel(labelId++, "§b§lSTORED DATA", 206, 48, 130, 10)
    var storedKeys = Java.from(stored.getKeys())
    var maxDisplay = 5
    for (var i = 0; i < storedKeys.length && i < maxDisplay; i++) {
        var key = storedKeys[i]
        var value = stored.get(key)
        var fullLine = String(key) + ": " + String(value)
        gui.addLabel(labelId++, "§7" + shortGuiText(fullLine, 25), 206, 66 + (i * 14), 154, 10).setHoverText("§f" + fullLine)
    }
    if (storedKeys.length === 0) {
        gui.addLabel(labelId++, "§8No stored values", 206, 66, 150, 10)
    }
    if (storedKeys.length > maxDisplay) {
        gui.addLabel(labelId++, "§7+" + (storedKeys.length - maxDisplay) + " more values", 206, 136, 150, 10)
    }

    var serviceConfig = getEquipmentServiceConfig(npc)
    gui.addLabel(labelId++, "§b§lEQUIPMENT SERVICE", 206, 172, 150, 10)
    gui.addLabel(labelId++, serviceConfig.shopKey ? "§6Shop: " + shortGuiText(serviceConfig.shopKey, 26) : "§7Hone " + (serviceConfig.honingEnabled ? "§aON" : "§cOFF") + " §7/ Reroll " + (serviceConfig.rerollEnabled ? "§aON" : "§cOFF") + " §7/ Identify " + (serviceConfig.identifyEnabled ? "§aON" : "§cOFF"), 206, 186, 154, 10).setScale(0.72)

    var giveExp = stored.has("giveExp") ? stored.get("giveExp") : "Not set"
    var giveSpirit = stored.has("giveSpirit") ? stored.get("giveSpirit") : 0
    var giveGold = stored.has("giveGold") ? stored.get("giveGold") : 0
    gui.addLabel(labelId++, "§6§lKILL REWARD", 22, 172, 120, 10)
    gui.addLabel(labelId++, "§7EXP §e§l" + giveExp, 22, 188, 154, 12)
    gui.addLabel(labelId++, "§7Spirit §b§l" + giveSpirit, 22, 200, 154, 10)
    gui.addLabel(labelId++, "§7" + getCurrencyConfig(player.getWorld()).displayName + " §6§l" + giveGold, 22, 212, 154, 10)

    gui.addButton(LAYER.BUTTONS, "§7§lCLOSE", 12, GUI_HEIGHT - 28, 72, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§e§lREFRESH", 88, GUI_HEIGHT - 28, 78, 20)
    gui.addButton(LAYER.BUTTONS + 3, "§e§lEDIT LEVEL", 170, GUI_HEIGHT - 28, 88, 20)
    gui.addButton(LAYER.BUTTONS + 2, "§b§lEDIT REWARD", 264, GUI_HEIGHT - 28, 104, 20)
    gui.addButton(LAYER.BUTTONS + 4, "§b§lSERVICE", 206, 202, 152, 18)
    player.showCustomGui(gui)
}

// ===== EXP EDIT GUI =====
function showExpEditGui(player) {
    if (!isMobLevelAdmin(player)) return
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var width = 360
    var height = 220
    var gui = API.createCustomGui(101, width, height, false, player)
    var npcUUID = player.getTempdata().get("inspectedNpcUUID")
    var npc = npcUUID ? player.getWorld().getEntity(String(npcUUID)) : null

    addRpgFrame(gui, width, height, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 42, 340, 132, RPG_UI.cyan)
    gui.addLabel(LAYER.CONTENT_BASE, "§b§lEDIT NPC REWARD", 105, 10, 170, 12)
    gui.addLabel(LAYER.CONTENT_BASE + 1, "§7EXP rewarded per kill", 24, 56, 150, 10)
    gui.addTextField(LAYER.TEXT_FIELDS, 24, 72, 148, 20).setText(npc && npc.getStoreddata().has("giveExp") ? String(npc.getStoreddata().get("giveExp")) : "0")
    gui.addLabel(LAYER.CONTENT_BASE + 2, "§7Spirit rewarded per kill", 188, 56, 150, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 1, 188, 72, 148, 20).setText(npc && npc.getStoreddata().has("giveSpirit") ? String(npc.getStoreddata().get("giveSpirit")) : "0")
    gui.addLabel(LAYER.CONTENT_BASE + 3, "§7" + getCurrencyConfig(player.getWorld()).displayName + " rewarded per kill", 24, 106, 150, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 2, 24, 122, 148, 20).setText(npc && npc.getStoreddata().has("giveGold") ? String(npc.getStoreddata().get("giveGold")) : "0")
    gui.addLabel(LAYER.CONTENT_BASE + 4, "§8Whole numbers. Zero disables that reward.", 24, 154, 310, 10)
    gui.addButton(LAYER.BUTTONS, "§b§lCONFIRM", 92, 188, 80, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§7§lCANCEL", 188, 188, 80, 20)
    player.showCustomGui(gui)
}

// ===== LVL GUI EVENT HANDLERS =====
function _lvl_customGuiButton(e) {
    var player = e.player
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    if ((guiId === 100 || guiId === 101) && !isMobLevelAdmin(player)) return
    
    if (guiId === 100) {
        // Main NPC inspector GUI
        // LAYER.BUTTONS = 200 (Close), 201 (Refresh), 202 (Edit Exp)
        if (buttonId === 200) {
            // Close
            player.closeGui()
        } else if (buttonId === 201) {
            // Refresh
            var npcUUID = player.getTempdata().get("inspectedNpcUUID")
            if (npcUUID) {
                var npc = player.getWorld().getEntity(npcUUID)
                if (npc && npc.getType() === 2) {
                    showNpcDataGui(player, npc)
                }
            }
        } else if (buttonId === 202) {
            // Edit Exp
            showExpEditGui(player)
        } else if (buttonId === 203) {
            var selectedNpcId = player.getTempdata().get("inspectedNpcUUID")
            var selectedNpc = selectedNpcId ? player.getWorld().getEntity(String(selectedNpcId)) : null
            openMobLevelEditor(player, selectedNpc)
        } else if (buttonId === 204) {
            var serviceNpcId = player.getTempdata().get("inspectedNpcUUID")
            var serviceNpc = serviceNpcId ? player.getWorld().getEntity(String(serviceNpcId)) : null
            showEquipmentServiceSettingsGui(player, serviceNpc)
        }
    } else if (guiId === 101) {
        // Exp edit GUI
        // LAYER.BUTTONS = 200 (Confirm), 201 (Cancel)
        if (buttonId === 201) {
            // Cancel - go back to inspector
            var npcUUID = player.getTempdata().get("inspectedNpcUUID")
            if (npcUUID) {
                var npc = player.getWorld().getEntity(npcUUID)
                if (npc && npc.getType() === 2) {
                    showNpcDataGui(player, npc)
                }
            }
        } else if (buttonId === 200) {
            // Confirm - get text field value
            // LAYER.TEXT_FIELDS = 180
            var textField = gui.getComponent(LAYER.TEXT_FIELDS)
            var spiritField = gui.getComponent(LAYER.TEXT_FIELDS + 1)
            var goldField = gui.getComponent(LAYER.TEXT_FIELDS + 2)
            if (textField) {
                var rawValue = String(textField.getText()).trim()
                var value = Number(rawValue)
                var rawSpirit = spiritField ? String(spiritField.getText()).trim() : "0"
                var spiritValue = Number(rawSpirit || 0)
                var goldValue = goldField ? Number(String(goldField.getText()).trim() || 0) : 0
                if (rawValue && isFinite(value) && value >= 0 && value <= 1000000000 && Math.floor(value) === value && isFinite(spiritValue) && spiritValue >= 0 && spiritValue <= SPIRIT_MAX_SAFE_INTEGER && Math.floor(spiritValue) === spiritValue && isFinite(goldValue) && goldValue >= 0 && goldValue <= CURRENCY_MAX_SAFE_INTEGER && Math.floor(goldValue) === goldValue) {
                    var npcUUID = player.getTempdata().get("inspectedNpcUUID")
                    if (npcUUID) {
                        var npc = player.getWorld().getEntity(npcUUID)
                        if (npc && npc.getType() === 2 && npc.isAlive() && isNearbyMobLevelTarget(player, npc)) {
                            npc.getStoreddata().put("giveExp", value)
                            npc.getStoreddata().put("giveSpirit", spiritValue)
                            npc.getStoreddata().put("giveGold", goldValue)
                            player.message("§aSet NPC reward to §e" + value + " EXP §7/ §b" + spiritValue + " Spirit §7/ §6" + goldValue + " " + getCurrencyConfig(player.getWorld()).displayName)
                            showNpcDataGui(player, npc)
                            return
                        }
                    }
                } else {
                    player.message("§cInvalid number!")
                }
            }
        }
    } else if (guiId === 102) {
        // Player level GUI
        // LAYER.BUTTONS = 200 (Close)
        if (buttonId === 200) {
            // Close
            player.closeGui()
        }
    }
}

function _lvl_customGuiClosed(e) {
    var player = e.player
    // Cleanup temp data when closing
    // player.getTempdata().remove("inspectedNpcUUID")
}

function isMobLevelAdmin(player) {
    return player.isAlive() && !isArvanPersistenceFrozen(player) && SERVER_CORE_MOB_LEVELS.canAdmin(player.getMCEntity())
}

function isMobLevelTarget(entity) {
    if (!entity) return false
    var type = Number(entity.getType())
    return type === 2 || type === 3 || type === 4 || type === 5 || type === 9
}

function isNearbyMobLevelTarget(player, entity) {
    if (!isMobLevelTarget(entity) || !entity.isAlive()) return false
    var current = player.getWorld().getEntity(String(entity.getUUID()))
    if (!current) return false
    var dx = player.getX() - current.getX()
    var dy = player.getY() - current.getY()
    var dz = player.getZ() - current.getZ()
    return dx * dx + dy * dy + dz * dz <= 64 * 64
}

function getMobLevelEditorTarget(player) {
    var temp = player.getTempdata()
    var entity = temp.has(MOB_LEVEL_TARGET_KEY) ? player.getWorld().getEntity(String(temp.get(MOB_LEVEL_TARGET_KEY))) : null
    return isNearbyMobLevelTarget(player, entity) ? entity : null
}

function selectMobLevelEditorTarget(player, entity) {
    player.getTempdata().remove(MOB_LEVEL_TARGET_KEY)
    if (!isNearbyMobLevelTarget(player, entity)) return { ok: false, message: "Look at a nearby living mob or NPC." }
    var result = JSON.parse(String(SERVER_CORE_MOB_LEVELS.inspect(player.getMCEntity(), entity.getMCEntity())))
    if (result.ok) player.getTempdata().put(MOB_LEVEL_TARGET_KEY, String(entity.getUUID()))
    return result
}

function buildMobLevelEditorState(player, result, action, requestId) {
    var state = JSON.parse(String(SERVER_CORE_MOB_LEVELS.config(player.getMCEntity())))
    state.admin = true
    state.mode = String(player.getTempdata().get(MOB_LEVEL_TARGET_KEY + ":mode") || "RULES")
    state.entity = null
    var entity = getMobLevelEditorTarget(player)
    if (entity) {
        var inspected = JSON.parse(String(SERVER_CORE_MOB_LEVELS.inspect(player.getMCEntity(), entity.getMCEntity())))
        if (inspected.ok) state.entity = inspected
    }
    if (result && (!result.ok || state.ok)) {
        state.ok = result.ok === true
        state.message = String(result.message || "")
    }
    state.action = String(action || "ready")
    state.actionRequestId = String(requestId || "")
    return state
}

function openMobLevelEditor(player, entity) {
    if (!isMobLevelAdmin(player)) {
        player.message("§cServer administrator access is required.")
        return
    }
    player.getTempdata().put(MOB_LEVEL_TARGET_KEY + ":mode", entity ? "ENTITY" : "RULES")
    var result = selectMobLevelEditorTarget(player, entity)
    if (!entity) result = null
    var state = buildMobLevelEditorState(player, result, "ready", "")
    if (player.getCustomGui()) {
        var temp = player.getTempdata()
        var transitions = temp.has(ADM_GUI_TRANSITION_KEY) ? Number(temp.get(ADM_GUI_TRANSITION_KEY)) : 0
        temp.put(ADM_GUI_TRANSITION_KEY, transitions + 1)
    }
    player.getTempdata().put(HTML_ACTIVE_SESSION_KEY, "MOB_LEVELS")
    cnpcext.openHtmlGui(player, MOB_LEVEL_HTML_FILE, 0, 0, JSON.stringify(state))
}

function handleMobLevelHtmlEvent(e) {
    var player = e.player
    var temp = player.getTempdata()
    if (!temp.has(HTML_ACTIVE_SESSION_KEY) || String(temp.get(HTML_ACTIVE_SESSION_KEY)) !== "MOB_LEVELS") return
    var data = parseClassSkillHtmlData(e.data)
    var action = String(data.action || "")
    if (["ready", "refresh", "save_config", "save_entity", "back"].indexOf(action) === -1) return
    var entityMode = String(temp.get(MOB_LEVEL_TARGET_KEY + ":mode")) === "ENTITY"
    if ((action === "save_config" && entityMode) || (action === "save_entity" && !entityMode)) return
    if (!isMobLevelAdmin(player)) {
        temp.remove(MOB_LEVEL_TARGET_KEY)
        temp.remove(HTML_ACTIVE_SESSION_KEY)
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("mob_levels_state", JSON.stringify({
            admin: false, ok: false, entity: null, message: "Administrator access is no longer available. Reopen the editor when ready.",
            action: action, actionRequestId: String(data.actionRequestId || "")
        }))
        return
    }
    if (action === "back") {
        var previousTarget = getMobLevelEditorTarget(player)
        temp.remove(MOB_LEVEL_TARGET_KEY)
        temp.remove(HTML_ACTIVE_SESSION_KEY)
        if (!entityMode) showAdminGui(player, "Mob Levels")
        else if (previousTarget && previousTarget.getType() === 2) showNpcDataGui(player, previousTarget)
        else cnpcext.getClientBridge(player.getMCEntity()).closeHtmlGui()
        return
    }
    var result = null
    try {
        if (action === "save_config") {
            var revision = Number(data.revision)
            if (typeof data.revision !== "number" || !isFinite(revision) || revision < 0 || Math.floor(revision) !== revision) {
                result = { ok: false, message: "Invalid rules revision. Refresh before saving." }
            } else {
                result = JSON.parse(String(SERVER_CORE_MOB_LEVELS.saveConfig(player.getMCEntity(), JSON.stringify(data.config || {}), revision)))
            }
        } else if (action === "save_entity") {
            var entity = getMobLevelEditorTarget(player)
            result = entity ? JSON.parse(String(SERVER_CORE_MOB_LEVELS.saveEntity(player.getMCEntity(), entity.getMCEntity(), JSON.stringify(data.entity || {}))))
                : { ok: false, message: "Selected mob is no longer nearby. Inspect it again." }
        }
        var state = buildMobLevelEditorState(player, result, action, data.actionRequestId)
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("mob_levels_state", JSON.stringify(state))
    } catch (error) {
        logMobLevelError(error)
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("mob_levels_state", JSON.stringify({
            admin: true, ok: false, message: "Mob-level operation failed. Check the server log.",
            action: action, actionRequestId: String(data.actionRequestId || "")
        }))
    }
}

// ===== PLAYER KILLED ENTITY - EXP REWARD =====
// This handles exp rewards when player kills entities
// Supports: NPCs (via storeddata), Mobs (via registry)
/**
 * @param {PlayerEvent.KilledEntityEvent} e
 */
function kill(e) {
    try {
        var player = e.player
        if (isArvanPersistenceFrozen(player)) return
        var entity = e.entity
        
        if (!entity) return
        
        // First, check if killed entity is an NPC (type 2) with an explicit reward.
        // Presence (including an explicit zero) claims precedence over generic mobs.
        if (entity.getType() === 2) {
            var npcStored = entity.getStoreddata()
            if (npcStored.has("giveExp") || npcStored.has("giveSpirit") || npcStored.has("giveGold")) {
                var expAmount = npcStored.has("giveExp") ? awardMobLevelKillExp(player, entity, npcStored.get("giveExp")) : 0
                var spiritAmount = npcStored.has("giveSpirit") ? normalizeWholeResource(npcStored.get("giveSpirit"), 0, SPIRIT_MAX_SAFE_INTEGER) : 0
                var spiritResult = awardSpiritOnce(player, spiritAmount, "NPC kill", "npc:" + String(entity.getUUID()) + ":" + String(player.getWorld().getTotalTime()))
                var goldAmount = npcStored.has("giveGold") ? normalizeWholeResource(npcStored.get("giveGold"), 0, CURRENCY_MAX_SAFE_INTEGER) : 0
                if (goldAmount > 0) adjustNormalMoneyBalance(player, goldAmount, "NPC kill", "npc-gold:" + String(entity.getUUID()) + ":" + String(player.getWorld().getTotalTime()))
                return
            }
        }
        
        // Then, check if this mob is in the mob rewards registry
        _mob_killedEntity(e)
        
    } catch (error) {
        logMobLevelError(error)
    }
}
// ============================================
// ATTRIBUTE SYSTEM ADDON - Player Script
// ============================================
// Optional addon for leveling-system.js
// Uses Minecraft 1.20.1 /attribute commands
// Persists attributes through death
// GUI-based interface with point allocation
// 
// STATS: STR (damage), VIT (health), DEX (speed)
// PASSIVE: +1 HP per level (before VIT bonus)
// FUTURE: Will be used for weapon/armor requirements
// ============================================

// ===== CLASS SYSTEM =====
var CLASS_CONFIG = {
    registryKey: "admClassRegistry",
    retiredIdsKey: "admClassRetiredIdsV1",
    enabledKey: "admClassesEnabled",
    lockedNodeVisibilityKey: "admSkillLockedNodeVisibility",
    playerClassKey: "admClassId",
    starterGrantKey: "admClassStarterClassId",
    completionProofKey: "admClassCompletionProof",
    completionSignalKey: "admClassCompletionSignaled",
    enforceIntervalTicks: 20,
    listPageSize: 25,
    chooserPageSize: 6,
    starterPageSize: 9,
    maxStarterItems: 45,
    defaultIconItemId: "minecraft:book"
}
var ARVAN_APPEARANCE_PENDING_TAG = "arvan_appearance_pending"
var ARVAN_CLASS_COMPLETION_PENDING_TAG = "arvan_class_complete_pending"
var ARVAN_CLASS_RESET_REQUEST_TAG = "arvan_class_reset_request"
var ARVAN_STAT_RESET_REQUEST_TAG = "arvan_stat_reset_request"
var ARVAN_FULL_RESET_REQUEST_TAG = "arvan_full_reset_request"
var ARVAN_RESET_EXECUTE_TAG = "arvan_reset_execute"
var ARVAN_RESET_APPLIED_TAG = "arvan_reset_applied"
var ARVAN_PERSISTENCE_FROZEN_TAG = "arvan_persistence_frozen", ARVAN_CLONE_TRANSFER_QUARANTINE_TAG = "arvan_clone_transfer_quarantine"
var PLAYER_RESET_REJECTED = 0
var PLAYER_RESET_DIRECT = 1
var PLAYER_RESET_GUARDED = 2

function isArvanPersistenceFrozen(player) {
    return !!player && (player.hasTag(ARVAN_PERSISTENCE_FROZEN_TAG) || player.hasTag(ARVAN_CLONE_TRANSFER_QUARANTINE_TAG))
}

function rejectFrozenTargetMutation(sender, target) {
    if (!isArvanPersistenceFrozen(target)) return false
    sender.message("§e[Characters] §f" + target.getName() +
        " §eis currently being saved. Try again in a moment.")
    return true
}

function rejectFrozenCustomGuiMutation(player) {
    if (!isArvanPersistenceFrozen(player)) return false
    var temp = player.getTempdata()
    var now = player.getWorld().getTotalTime()
    var last = temp.has("admFrozenGuiWarn") ? Number(temp.get("admFrozenGuiWarn")) : -1000
    if (now - last >= 20) {
        temp.put("admFrozenGuiWarn", now)
        player.message("§e[Characters] Saving your character. Try again in a moment.")
    }
    return true
}

var CLASS_LIST_GUI_ID = 650
var CLASS_EDIT_GUI_ID = 651
var CLASS_CHOOSER_GUI_ID = 652
var CLASS_SKILL_TREE_GUI_ID = 653
var CLASS_SKILL_NODE_GUI_ID = 654
var CLASS_SKILL_PREREQ_GUI_ID = 655
var CLASS_SKILL_ITEM_GUI_ID = 656
var CLASS_STAT_GUI_ID = 657
var CLASS_SKILL_EFFECT_GUI_ID = 658
var CLASS_GUI_WIDTH = 400
var CLASS_GUI_HEIGHT = 280
var CLASS_EDIT_GUI_WIDTH = 420
var CLASS_EDIT_GUI_HEIGHT = 310

var CLASS_IDS = {
    SCROLL_LIST: 150,
    ITEM_ROLE_BASE: 160,
    ITEM_STARTER_BASE: 170,
    FIELD_NAME: 180,
    FIELD_ICON: 181,
    ITEM_PREVIEW: 190,
    BTN_NEW: 200,
    BTN_EDIT: 201,
    BTN_DELETE: 202,
    BTN_BACK: 203,
    BTN_SAVE: 204,
    BTN_CANCEL: 205,
    BTN_ADD_ITEM: 206,
    BTN_SLOT_PREV: 207,
    BTN_SLOT_NEXT: 208,
    BTN_LIST_PREV: 209,
    BTN_LIST_NEXT: 210,
    BTN_CHOOSE: 211,
    BTN_SKILL_TREE: 212,
    BTN_ATTRIBUTES: 213,
    BTN_ROLE_BASE: 220,
    ROLE_PANEL_BASE: 20,
    DETAIL_PANEL: 40
}

var CLASS_STAT_IDS = {
    SCROLL_STATS: 150,
    FIELD_BASE: 180,
    FIELD_EFFECTIVENESS: 181,
    BTN_SAVE_STAT: 220,
    BTN_RESET_STAT: 221,
    BTN_BACK: 222
}

function parseSkillBridgeResult(encoded) {
    try {
        return JSON.parse(String(encoded || "{}"))
    } catch (error) {
        return { ok: false, message: "Invalid response from Arvan skill authority" }
    }
}

function callSkillBridge(player, operation) {
    try {
        return parseSkillBridgeResult(operation())
    } catch (error) {
        return { ok: false, message: String(error) }
    }
}

function syncPlayerSkills(player, forceRepair) {
    try {
        var classId = getPlayerClassId(player)
        if (!classId) return null
        var level = getPlayerData(player).level
        var result = parseSkillBridgeResult(SERVER_CORE_SKILLS.sync(player.getMCEntity(), classId, level))
        if (result.ok && forceRepair) result = parseSkillBridgeResult(SERVER_CORE_SKILLS.repair(player.getMCEntity()))
        if (result.ok) result = applyLearnedWithNodeGrants(player, classId, level, result)
        if (result.ok) result = decorateManagedUpgradeSnapshot(player, classId, result)
        if (result.ok) cachePlayerSkillSnapshot(player, result)
        return result
    } catch (error) {
        return { ok: false, message: String(error) }
    }
}

function applyLearnedWithNodeGrants(player, classId, level, snapshot) {
    var classData = getClassById(player.getWorld(), classId)
    var definitions = classData && Array.isArray(classData.skillNodes) ? classData.skillNodes : []
    var current = snapshot
    for (var pass = 0; pass < definitions.length; pass++) {
        var learned = {}
        var owned = {}
        for (var nodeIndex = 0; current.nodes && nodeIndex < current.nodes.length; nodeIndex++) {
            if (current.nodes[nodeIndex].learned === true || current.nodes[nodeIndex].replaced === true) owned[current.nodes[nodeIndex].id] = true
            if (current.nodes[nodeIndex].learned === true && current.nodes[nodeIndex].replaced !== true) learned[current.nodes[nodeIndex].id] = true
        }
        var granted = false
        for (var i = 0; i < definitions.length; i++) {
            var node = definitions[i]
            var sourceId = String(node.learnedWithNode || "")
            if (!sourceId || !learned[sourceId] || owned[node.id]) continue
            if (Number(node.requiredLevel || 1) > Number(level || 1)) continue
            var prerequisites = node.prerequisites || []
            var eligible = true
            for (var prerequisiteIndex = 0; prerequisiteIndex < prerequisites.length; prerequisiteIndex++) {
                if (!learned[prerequisites[prerequisiteIndex]]) eligible = false
            }
            var blocked = node.blockedNodes || []
            for (var blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
                if (learned[blocked[blockedIndex]]) eligible = false
            }
            for (var otherIndex = 0; otherIndex < definitions.length; otherIndex++) {
                if ((definitions[otherIndex].blockedNodes || []).indexOf(node.id) >= 0 && learned[definitions[otherIndex].id]) eligible = false
            }
            if (!eligible) continue
            var result = callSkillBridge(player, function() {
                return SERVER_CORE_SKILLS.learn(player.getMCEntity(), classId, level, node.id)
            })
            if (!result.ok) return result
            current = result
            granted = true
            break
        }
        if (!granted) return current
    }
    return current
}

function cachePlayerSkillSnapshot(player, snapshot) {
    if (snapshot && snapshot.ok) player.getTempdata().put("admCachedSkillSnapshot", JSON.stringify(snapshot))
}

function getCachedPlayerSkillSnapshot(player) {
    var temp = player.getTempdata()
    if (!temp.has("admCachedSkillSnapshot")) return null
    try {
        var parsed = JSON.parse(String(temp.get("admCachedSkillSnapshot")))
        return parsed && parsed.ok ? parsed : null
    } catch (error) {
        return null
    }
}

var CLASS_CHOOSER_LAYOUT = {
    sectionLabelY: 40,
    cardX: 11,
    cardY: 52,
    cardWidth: 58,
    cardHeight: 72,
    cardGap: 6,
    detailX: 22,
    detailY: 142,
    detailWidth: 356,
    detailHeight: 96,
    footerY: 252
}

var ClassGuiMath = {
    grid: function(column, row, cellWidth, cellHeight, padX, padY, originX, originY) {
        return {
            x: originX + column * (cellWidth + padX),
            y: originY + row * (cellHeight + padY)
        }
    }
}

function getClassSystemEnabled(world) {
    var stored = world.getStoreddata()
    if (!stored.has(CLASS_CONFIG.enabledKey)) return false
    var value = stored.get(CLASS_CONFIG.enabledKey)
    return Number(value) === 1 || String(value).toLowerCase() === "true"
}

function setClassSystemEnabled(world, enabled) {
    world.getStoreddata().put(CLASS_CONFIG.enabledKey, enabled ? 1 : 0)
}

function getLockedSkillVisibilityMode(world) {
    var stored = world.getStoreddata()
    if (!stored.has(CLASS_CONFIG.lockedNodeVisibilityKey)) return "OBFUSCATE"
    return String(stored.get(CLASS_CONFIG.lockedNodeVisibilityKey)).toUpperCase() === "HIDE"
        ? "HIDE" : "OBFUSCATE"
}

function setLockedSkillVisibilityMode(world, mode) {
    world.getStoreddata().put(
        CLASS_CONFIG.lockedNodeVisibilityKey,
        String(mode || "").toUpperCase() === "HIDE" ? "HIDE" : "OBFUSCATE"
    )
}

function getClassRegistry(world) {
    var stored = world.getStoreddata()
    if (!stored.has(CLASS_CONFIG.registryKey)) return {}
    try {
        var parsed = JSON.parse(stored.get(CLASS_CONFIG.registryKey))
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        var normalized = {}
        var ids = Object.keys(parsed)
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i]
            var entry = parsed[id]
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
            if (typeof entry.id !== "string" || entry.id !== id || !id) continue
            if (typeof entry.name !== "string" || !entry.name.trim()) continue
            if (typeof entry.iconItemId !== "string" || !entry.iconItemId.trim()) continue
            if (!Array.isArray(entry.startingItems)) continue
            var validItems = true
            for (var itemIndex = 0; itemIndex < entry.startingItems.length; itemIndex++) {
                if (typeof entry.startingItems[itemIndex] !== "string" ||
                    !entry.startingItems[itemIndex].trim()) {
                    validItems = false
                    break
                }
            }
            if (validItems) normalized[id] = entry
        }
        return normalized
    } catch (error) {
        return {}
    }
}

function saveClassRegistry(world, registry) {
    world.getStoreddata().put(CLASS_CONFIG.registryKey, JSON.stringify(registry))
}

function getRetiredClassIds(world) {
    var stored = world.getStoreddata()
    if (!stored.has(CLASS_CONFIG.retiredIdsKey)) return {}
    try {
        var parsed = JSON.parse(stored.get(CLASS_CONFIG.retiredIdsKey))
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        var normalized = {}
        var ids = Object.keys(parsed)
        for (var i = 0; i < ids.length; i++) {
            if (parsed[ids[i]] === true) normalized[ids[i]] = true
        }
        return normalized
    } catch (error) {
        return {}
    }
}

function saveRetiredClassIds(world, retired) {
    world.getStoreddata().put(CLASS_CONFIG.retiredIdsKey, JSON.stringify(retired))
}

function getClassById(world, classId) {
    if (!classId) return null
    var registry = getClassRegistry(world)
    return registry[classId] || null
}

function getSortedClassIds(world) {
    var registry = getClassRegistry(world)
    var ids = Object.keys(registry)
    ids.sort(function(left, right) {
        var leftName = registry[left].name || left
        var rightName = registry[right].name || right
        return leftName.toLowerCase().localeCompare(rightName.toLowerCase())
    })
    return ids
}

function getPlayerClassId(player) {
    var stored = player.getStoreddata()
    return stored.has(CLASS_CONFIG.playerClassKey) ? String(stored.get(CLASS_CONFIG.playerClassKey)) : ""
}

function grantClassStartingItems(player, classData) {
    var stored = player.getStoreddata()
    if (stored.has(CLASS_CONFIG.starterGrantKey) && String(stored.get(CLASS_CONFIG.starterGrantKey)) === classData.id) {
        return true
    }
    var startingItems = classData.startingItems || []
    var world = player.getWorld()
    for (var i = 0; i < startingItems.length; i++) {
        if (!startingItems[i]) continue
        try {
            var stack = world.createItemFromNbt(API.stringToNbt(startingItems[i]))
            if (!stack || stack.isEmpty()) throw new Error("starter stack is empty")
        } catch (error) {
            log("[Classes] Invalid starter item for " + classData.id + ": " + error)
            return false
        }
    }
    // Forge owns delivery. It grants every validated stack and writes the receipt into
    // the same vanilla player NBT snapshot as the inventory, eliminating cross-file
    // duplicate/loss windows between CustomNPC storeddata and playerdata.
    stored.put(CLASS_CONFIG.starterGrantKey, classData.id)
    return true
}

function clearClassCompletionSignal(player) {
    var stored = player.getStoreddata()
    var temp = player.getTempdata()
    if (stored.has(CLASS_CONFIG.completionProofKey)) stored.remove(CLASS_CONFIG.completionProofKey)
    if (temp.has(CLASS_CONFIG.completionSignalKey)) temp.remove(CLASS_CONFIG.completionSignalKey)
    if (player.hasTag(ARVAN_CLASS_COMPLETION_PENDING_TAG)) {
        player.removeTag(ARVAN_CLASS_COMPLETION_PENDING_TAG)
    }
}

function signalClassCompletion(player, proof) {
    player.getStoreddata().put(CLASS_CONFIG.completionProofKey, proof)
    player.addTag(ARVAN_CLASS_COMPLETION_PENDING_TAG)
    player.getTempdata().put(CLASS_CONFIG.completionSignalKey, true)
}

function refreshClassCompletionSignal(player) {
    var world = player.getWorld()
    if (!getClassSystemEnabled(world) || getSortedClassIds(world).length === 0) {
        clearClassCompletionSignal(player)
        return false
    }
    var classId = getPlayerClassId(player)
    var classData = getClassById(world, classId)
    if (!classData) {
        clearClassCompletionSignal(player)
        return false
    }
    if (!grantClassStartingItems(player, classData)) {
        clearClassCompletionSignal(player)
        return false
    }
    var starterId = player.getStoreddata().has(CLASS_CONFIG.starterGrantKey)
        ? String(player.getStoreddata().get(CLASS_CONFIG.starterGrantKey)) : ""
    if (starterId !== classId) {
        clearClassCompletionSignal(player)
        return false
    }
    signalClassCompletion(player, "class:" + classId)
    return true
}

function selectPlayerClass(player, classId) {
    var classData = getClassById(player.getWorld(), classId)
    if (!classData) return false
    var currentClassId = getPlayerClassId(player)
    if (currentClassId && currentClassId !== classId) {
        // Never overwrite a completed/deleted class in CustomNPC data while Java
        // still owns its account state and starter receipt. Reset it first.
        resetPlayerClass(player)
        return false
    }
    if (!grantClassStartingItems(player, classData)) {
        clearClassCompletionSignal(player)
        return false
    }
    player.getStoreddata().put(CLASS_CONFIG.playerClassKey, classId)
    var skillSync = syncPlayerSkills(player)
    if (skillSync && !skillSync.ok) player.message("§c[Skills] " + skillSync.message)
    if (!skillSync || skillSync.ok) applyAllAttributes(player)
    // The Forge side consumes this server-owned tag only after both CustomNPC
    // class data and vanilla starter inventory have been durably verified.
    signalClassCompletion(player, "class:" + classId)
    return true
}

function resetPlayerClassNow(player) {
    var resetResult = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.resetProfile(player.getMCEntity())
    })
    if (!resetResult || !resetResult.ok) {
        log("[Characters] Class reset rejected for " + player.getName() + ": " +
            (resetResult ? resetResult.message : "No response from skill authority"))
        return false
    }
    var stored = player.getStoreddata()
    if (stored.has(CLASS_CONFIG.playerClassKey)) stored.remove(CLASS_CONFIG.playerClassKey)
    if (stored.has(CLASS_CONFIG.starterGrantKey)) stored.remove(CLASS_CONFIG.starterGrantKey)
    if (player.getTempdata().has("admCachedSkillSnapshot")) player.getTempdata().remove("admCachedSkillSnapshot")
    clearClassCompletionSignal(player)
    applyAllAttributes(player)
    return true
}

function hasPlayerResetTransaction(player) {
    return player.hasTag(ARVAN_CLASS_RESET_REQUEST_TAG) ||
        player.hasTag(ARVAN_STAT_RESET_REQUEST_TAG) ||
        player.hasTag(ARVAN_FULL_RESET_REQUEST_TAG) ||
        player.hasTag(ARVAN_RESET_EXECUTE_TAG) ||
        player.hasTag(ARVAN_RESET_APPLIED_TAG)
}

function usesGuardedArvanCharacterReset(player) {
    try {
        var CharacterRuntime = Java.type("com.arvanworld.characters.server.CharacterRuntime")
        var identity = CharacterRuntime.identity(player.getMCEntity()).orElse(null)
        return identity !== null && String(identity.kind().name()) === "CUSTOM_CHARACTER"
    } catch (error) {
        return false
    }
}

function clearPlayerResetTransactionTags(player) {
    var tags = [
        ARVAN_CLASS_RESET_REQUEST_TAG,
        ARVAN_STAT_RESET_REQUEST_TAG,
        ARVAN_FULL_RESET_REQUEST_TAG,
        ARVAN_RESET_EXECUTE_TAG,
        ARVAN_RESET_APPLIED_TAG
    ]
    for (var i = 0; i < tags.length; i++) {
        if (player.hasTag(tags[i])) player.removeTag(tags[i])
    }
}

function applyDirectPlayerReset(player, requestTag) {
    clearPlayerResetTransactionTags(player)
    if (requestTag === ARVAN_FULL_RESET_REQUEST_TAG) {
        if (resetAllPlayerProgressNow(player) === false) return PLAYER_RESET_REJECTED
    } else if (requestTag === ARVAN_CLASS_RESET_REQUEST_TAG) {
        if (resetPlayerClassNow(player) === false) return PLAYER_RESET_REJECTED
    } else if (requestTag === ARVAN_STAT_RESET_REQUEST_TAG) {
        resetAllStatPoints(player)
    }
    return PLAYER_RESET_DIRECT
}

function requestPlayerReset(player, requestTag) {
    if (!usesGuardedArvanCharacterReset(player)) {
        return applyDirectPlayerReset(player, requestTag)
    }
    if (player.hasTag(requestTag)) return PLAYER_RESET_GUARDED
    if (hasPlayerResetTransaction(player)) return PLAYER_RESET_REJECTED
    player.addTag(requestTag)
    advanceArvanResetTransaction(player)
    return PLAYER_RESET_GUARDED
}

function advanceArvanResetTransaction(player) {
    try {
        var CharacterRuntime = Java.type("com.arvanworld.characters.server.CharacterRuntime")
        return !!CharacterRuntime.consumePlayerResetSignal(player.getMCEntity())
    } catch (error) {
        log("[Characters] Could not advance reset transaction for " + player.getName() + ": " + error)
        return false
    }
}

function resetPlayerClass(player) {
    return requestPlayerReset(player, ARVAN_CLASS_RESET_REQUEST_TAG)
}

function requestPlayerStatReset(player) {
    return requestPlayerReset(player, ARVAN_STAT_RESET_REQUEST_TAG)
}

function requestFullPlayerReset(player) {
    return requestPlayerReset(player, ARVAN_FULL_RESET_REQUEST_TAG)
}

function applyAuthorizedPlayerReset(player) {
    if (player.hasTag(ARVAN_CLONE_TRANSFER_QUARANTINE_TAG)) return false
    if (!player.hasTag(ARVAN_RESET_EXECUTE_TAG)) {
        return hasPlayerResetTransaction(player)
    }
    if (player.hasTag(ARVAN_RESET_APPLIED_TAG)) {
        player.removeTag(ARVAN_RESET_EXECUTE_TAG)
        return true
    }
    if (player.hasTag(ARVAN_FULL_RESET_REQUEST_TAG)) {
        if (resetAllPlayerProgressNow(player) === false) return true
    } else if (player.hasTag(ARVAN_CLASS_RESET_REQUEST_TAG)) {
        if (resetPlayerClassNow(player) === false) return true
    } else if (player.hasTag(ARVAN_STAT_RESET_REQUEST_TAG)) {
        resetAllStatPoints(player)
    } else {
        player.removeTag(ARVAN_RESET_EXECUTE_TAG)
        return true
    }
    player.removeTag(ARVAN_RESET_EXECUTE_TAG)
    player.addTag(ARVAN_RESET_APPLIED_TAG)
    return true
}

function playerNeedsClass(player) {
    if (player.getGamemode() === 1) return false
    var world = player.getWorld()
    if (!getClassSystemEnabled(world)) return false
    if (getSortedClassIds(world).length === 0) return false
    return getClassById(world, getPlayerClassId(player)) === null
}

function createUniqueClassId(world, name) {
    var baseId = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    if (!baseId) baseId = "class"
    var registry = getClassRegistry(world)
    var retired = getRetiredClassIds(world)
    var classId = baseId
    var suffix = 2
    while (registry[classId] || retired[classId]) {
        classId = baseId + "_" + suffix
        suffix++
    }
    return classId
}

function createClassIconStack(world, itemId) {
    if (!itemId) return null
    try {
        var stack = world.createItem(itemId, 1)
        return stack && !stack.isEmpty() ? stack : null
    } catch (error) {
        return null
    }
}

function createClassItemFromSnbt(world, snbt) {
    if (!snbt) return null
    try {
        return world.createItemFromNbt(API.stringToNbt(snbt))
    } catch (error) {
        return null
    }
}

function getClassDisplayName(world, classId) {
    if (!classId) return "Any Class"
    var classData = getClassById(world, classId)
    return classData ? classData.name : classId
}

function deleteClassDefinition(player, classId) {
    var world = player.getWorld()
    var registry = getClassRegistry(world)
    if (!registry[classId]) return false
    var retired = getRetiredClassIds(world)
    retired[classId] = true
    // Persist the tombstone first. A crash may leave the old definition visible,
    // but it can never make the durable ID available for another class.
    saveRetiredClassIds(world, retired)
    var result = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.deleteTree(player.getMCEntity(), classId)
    })
    if (!result.ok) {
        player.message("§c[Skills] " + result.message)
        return false
    }
    delete registry[classId]
    saveClassRegistry(world, registry)
    return true
}

function getClassDraft(player) {
    var temp = player.getTempdata()
    if (!temp.has("admClassDraft")) return null
    try {
        return JSON.parse(temp.get("admClassDraft"))
    } catch (error) {
        return null
    }
}

function saveClassDraft(player, draft) {
    player.getTempdata().put("admClassDraft", JSON.stringify(draft))
}

function refreshOnlinePlayersForClass(world, classId) {
    if (!classId) return
    var players = world.getAllPlayers()
    for (var i = 0; i < players.length; i++) {
        if (String(getPlayerClassId(players[i]) || "") !== String(classId)) continue
        var skillSync = syncPlayerSkills(players[i])
        if (!skillSync || skillSync.ok) applyAllAttributes(players[i])
    }
}

function persistClassStatDraft(player, draft) {
    if (!draft || !draft.id) return false
    var registry = getClassRegistry(player.getWorld())
    if (!registry[draft.id]) return false
    registry[draft.id].baseStats = JSON.parse(JSON.stringify(draft.baseStats || {}))
    registry[draft.id].statMultipliers = JSON.parse(JSON.stringify(draft.statMultipliers || {}))
    saveClassRegistry(player.getWorld(), registry)
    refreshOnlinePlayersForClass(player.getWorld(), draft.id)
    return true
}

function persistClassSkillDraft(player) {
    var draft = getClassDraft(player)
    if (!draft) return { ok: false, persisted: false, message: "The class draft is no longer available. Reopen the class editor." }
    var learnedWithError = validateLearnedWithNodeLinks(draft.skillNodes || [])
    if (learnedWithError) return { ok: false, persisted: false, message: learnedWithError }
    var scheduleError = validateClassSkillUpgradeSchedules(player, draft.skillNodes || [])
    if (scheduleError) return { ok: false, persisted: false, message: scheduleError }
    if (!draft.id) return { ok: true, persisted: false, message: "This new class will save its tree when you save the class." }
    var registry = getClassRegistry(player.getWorld())
    if (!registry[draft.id]) return { ok: true, persisted: false, message: "This new class will save its tree when you save the class." }
    var runtimeNodes = buildClassSkillRuntimeNodes(draft.skillNodes || [])
    var skillResult = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.saveTree(player.getMCEntity(), draft.id, JSON.stringify({ nodes: runtimeNodes, choiceGroups: draft.choiceGroups || [] }))
    })
    if (!skillResult.ok) return { ok: false, persisted: false, message: skillResult.message }
    saveClassDraft(player, draft)
    registry[draft.id].skillNodes = JSON.parse(JSON.stringify(draft.skillNodes || []))
    registry[draft.id].choiceGroups = JSON.parse(JSON.stringify(draft.choiceGroups || []))
    registry[draft.id].editorFolders = (draft.editorFolders || []).slice()
    registry[draft.id].editorOrder = JSON.parse(JSON.stringify(draft.editorOrder || {}))
    saveClassRegistry(player.getWorld(), registry)
    refreshOnlinePlayersForClass(player.getWorld(), draft.id)
    return { ok: true, persisted: true, message: "Skill tree autosaved." }
}

function persistClassSkillLayout(player) {
    var draft = getClassDraft(player)
    if (!draft) return { ok: false, persisted: false, message: "The class draft is no longer available. Reopen the class editor." }
    if (!draft.id) return { ok: true, persisted: false, message: "This new class will save its layout when you save the class." }
    var registry = getClassRegistry(player.getWorld())
    if (!registry[draft.id]) return { ok: true, persisted: false, message: "This new class will save its layout when you save the class." }
    registry[draft.id].skillNodes = JSON.parse(JSON.stringify(draft.skillNodes || []))
    saveClassRegistry(player.getWorld(), registry)
    return { ok: true, persisted: true, message: "Layout autosaved." }
}

function clearClassDraft(player) {
    var temp = player.getTempdata()
    if (temp.has("admClassDraft")) temp.remove("admClassDraft")
}

function startClassDraft(player, classId) {
    var classData = getClassById(player.getWorld(), classId)
    var items = classData && classData.startingItems ? classData.startingItems.slice() : []
    var skillNodes = classData && classData.skillNodes ? classData.skillNodes.slice() : []
    var choiceGroups = classData && classData.choiceGroups ? JSON.parse(JSON.stringify(classData.choiceGroups)) : []
    if (classData && !classData.skillNodes) {
        var treeResult = callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.tree(player.getMCEntity(), classId)
        })
        if (treeResult.ok && treeResult.nodes) {
            skillNodes = treeResult.nodes
            choiceGroups = treeResult.choiceGroups || []
        }
    }
    var draft = {
        id: classData ? classData.id : "",
        name: classData ? classData.name : "",
        iconItemId: classData ? classData.iconItemId : CLASS_CONFIG.defaultIconItemId,
        startingItems: items,
        skillNodes: skillNodes,
        choiceGroups: choiceGroups,
        editorFolders: classData && Array.isArray(classData.editorFolders) ? classData.editorFolders.slice() : [],
        editorOrder: classData && classData.editorOrder ? JSON.parse(JSON.stringify(classData.editorOrder)) : {},
        baseStats: classData && classData.baseStats ? JSON.parse(JSON.stringify(classData.baseStats)) : {},
        statMultipliers: classData && classData.statMultipliers ? JSON.parse(JSON.stringify(classData.statMultipliers)) : {},
        slotCount: items.length,
        page: 0
    }
    saveClassDraft(player, draft)
    return draft
}

function captureClassEditorPage(player, gui) {
    var draft = getClassDraft(player)
    if (!draft) return null
    var nameField = gui.getComponent(CLASS_IDS.FIELD_NAME)
    var iconField = gui.getComponent(CLASS_IDS.FIELD_ICON)
    if (nameField) draft.name = String(nameField.getText())
    if (iconField) draft.iconItemId = String(iconField.getText())
    while (draft.startingItems.length < draft.slotCount) draft.startingItems.push(null)
    var pageStart = draft.page * CLASS_CONFIG.starterPageSize
    var visibleCount = Math.min(CLASS_CONFIG.starterPageSize, draft.slotCount - pageStart)
    var slots = gui.getSlots()
    for (var i = 0; i < visibleCount && i < slots.size(); i++) {
        var slot = slots.get(i)
        if (slot.hasStack() && slot.getStack() && !slot.getStack().isEmpty()) {
            draft.startingItems[pageStart + i] = slot.getStack().getItemNbt().toJsonString()
        } else {
            draft.startingItems[pageStart + i] = null
        }
    }
    saveClassDraft(player, draft)
    return draft
}

function getClassListPage(player) {
    var temp = player.getTempdata()
    return temp.has("admClassListPage") ? Number(temp.get("admClassListPage")) : 0
}

function showClassListGui(player, page) {
    var world = player.getWorld()
    var ids = getSortedClassIds(world)
    var maxPage = Math.max(0, Math.ceil(ids.length / CLASS_CONFIG.listPageSize) - 1)
    page = page === undefined || page === null ? getClassListPage(player) : page
    page = Math.max(0, Math.min(page, maxPage))
    player.getTempdata().put("admClassListPage", page)
    var pageStart = page * CLASS_CONFIG.listPageSize
    var pageIds = ids.slice(pageStart, pageStart + CLASS_CONFIG.listPageSize)
    player.getTempdata().put("admClassListIds", JSON.stringify(pageIds))
    var selectedId = player.getTempdata().has("admSelectedClassId") ? String(player.getTempdata().get("admSelectedClassId")) : ""
    if (pageIds.indexOf(selectedId) === -1) selectedId = pageIds.length > 0 ? pageIds[0] : ""
    if (selectedId) player.getTempdata().put("admSelectedClassId", selectedId)

    var gui = API.createCustomGui(CLASS_LIST_GUI_ID, CLASS_GUI_WIDTH, CLASS_GUI_HEIGHT, false, player)
    addRpgFrame(gui, CLASS_GUI_WIDTH, CLASS_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 250, 198, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 268, 40, 122, 198, RPG_UI.cyan)
    gui.addLabel(LAYER.CONTENT_LABELS, "§6§lCLASS REGISTRY", 130, 10, 160, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7" + ids.length + " classes", 14, 26, 90, 10)
    if (maxPage > 0) gui.addLabel(LAYER.CONTENT_LABELS + 2, "§7Page §f" + (page + 1) + "§7/§f" + (maxPage + 1), 320, 26, 70, 10)

    var names = []
    for (var i = 0; i < pageIds.length; i++) names.push(getClassById(world, pageIds[i]).name)
    if (names.length === 0) names.push("(No classes created)")
    var scroll = gui.addScroll(CLASS_IDS.SCROLL_LIST, 16, 56, 238, 176, names)
    if (selectedId && pageIds.indexOf(selectedId) >= 0) scroll.setDefaultSelection(pageIds.indexOf(selectedId))

    var selected = getClassById(world, selectedId)
    gui.addLabel(LAYER.CONTENT_LABELS + 3, "§b§lSELECTED CLASS", 278, 48, 106, 10)
    if (selected) {
        gui.addLabel(LAYER.CONTENT_LABELS + 4, "§f" + shortGuiText(selected.name, 18), 278, 66, 104, 20).setHoverText("§f" + selected.name)
        gui.addLabel(LAYER.CONTENT_LABELS + 5, "§7ID", 278, 92, 100, 10)
        gui.addLabel(LAYER.CONTENT_LABELS + 6, "§f" + shortGuiText(selected.id, 18), 278, 106, 104, 18).setHoverText("§f" + selected.id)
        gui.addLabel(LAYER.CONTENT_LABELS + 7, "§7Starter Items §f" + (selected.startingItems || []).length, 278, 132, 104, 10)
        var icon = createClassIconStack(world, selected.iconItemId)
        if (icon) gui.addItemRenderer(CLASS_IDS.ITEM_PREVIEW, 312, 154, 32, 32, icon)
        gui.addLabel(LAYER.CONTENT_LABELS + 8, "§8Double-click a class", 278, 202, 104, 10)
        gui.addLabel(LAYER.CONTENT_LABELS + 9, "§8to edit it", 278, 214, 104, 10)
    } else {
        gui.addLabel(LAYER.CONTENT_LABELS + 4, "§7Select a class", 278, 68, 104, 10)
        gui.addLabel(LAYER.CONTENT_LABELS + 5, "§7or create a new one", 278, 82, 104, 10)
    }

    if (maxPage > 0) gui.addButton(CLASS_IDS.BTN_LIST_PREV, "§7<", 12, 252, 26, 20).setEnabled(page > 0)
    var classActionX = maxPage > 0 ? 44 : 12
    gui.addButton(CLASS_IDS.BTN_NEW, "§a§lNEW", classActionX, 252, 54, 20)
    gui.addButton(CLASS_IDS.BTN_EDIT, "§e§lEDIT", classActionX + 60, 252, 54, 20).setEnabled(!!selected)
    gui.addButton(CLASS_IDS.BTN_DELETE, "§c§lDEL", classActionX + 120, 252, 46, 20).setEnabled(!!selected)
    if (maxPage > 0) gui.addButton(CLASS_IDS.BTN_LIST_NEXT, "§7>", 216, 252, 26, 20).setEnabled(page < maxPage)
    gui.addButton(CLASS_IDS.BTN_BACK, "§f§lBACK", 326, 252, 62, 20)
    player.showCustomGui(gui)
}

function showClassEditorGui(player) {
    var draft = getClassDraft(player)
    if (!draft) draft = startClassDraft(player, "")
    var maxPage = Math.max(0, Math.ceil(draft.slotCount / CLASS_CONFIG.starterPageSize) - 1)
    draft.page = Math.max(0, Math.min(draft.page, maxPage))
    saveClassDraft(player, draft)
    var world = player.getWorld()
    var gui = API.createCustomGui(CLASS_EDIT_GUI_ID, CLASS_EDIT_GUI_WIDTH, CLASS_EDIT_GUI_HEIGHT, false, player)
    addRpgFrame(gui, CLASS_EDIT_GUI_WIDTH, CLASS_EDIT_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, CLASS_EDIT_GUI_WIDTH - 20, 126, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, draft.id ? "§e§lEDIT CLASS" : "§a§lCREATE CLASS", 145, 10, 150, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7Class Name", 20, 48, 80, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§7Icon Item ID", 20, 76, 100, 10)
    gui.addTextArea(CLASS_IDS.FIELD_NAME, 110, 44, 228, 20).setText(draft.name)
    gui.addTextField(CLASS_IDS.FIELD_ICON, 110, 72, 228, 20).setText(draft.iconItemId)
    var icon = createClassIconStack(world, draft.iconItemId)
    if (icon) gui.addItemRenderer(CLASS_IDS.ITEM_PREVIEW, 362, 48, 32, 32, icon)

    var pageStart = draft.page * CLASS_CONFIG.starterPageSize
    var pageEnd = Math.min(draft.slotCount, pageStart + CLASS_CONFIG.starterPageSize)
    gui.addLabel(LAYER.CONTENT_LABELS + 3, "§6§lSTARTER ITEMS §7" + draft.slotCount + "/" + CLASS_CONFIG.maxStarterItems, 20, 104, 190, 10)
    if (maxPage > 0) gui.addLabel(LAYER.CONTENT_LABELS + 4, "§7Slot Page §f" + (draft.page + 1) + "§7/§f" + (maxPage + 1), 288, 104, 104, 10)
    for (var frameIndex = 0; frameIndex < CLASS_CONFIG.starterPageSize; frameIndex++) {
        var framePosition = ClassGuiMath.grid(frameIndex, 0, 18, 18, 2, 0, 20, 122)
        var frameTexture = pageStart + frameIndex < draft.slotCount ? RPG_UI.gold : RPG_UI.chrome
        addRpgSlotFrame(gui, LAYER.CONTENT_BASE + frameIndex, framePosition.x, framePosition.y, frameTexture)
    }
    for (var i = pageStart; i < pageEnd; i++) {
        var position = ClassGuiMath.grid(i - pageStart, 0, 18, 18, 2, 0, 20, 122)
        var stack = createClassItemFromSnbt(world, draft.startingItems[i])
        if (stack) {
            gui.addItemSlot(position.x, position.y, stack)
        } else {
            gui.addItemSlot(position.x, position.y)
        }
    }
    gui.addButton(CLASS_IDS.BTN_ADD_ITEM, "§a+ ADD ITEM", 226, 120, 82, 20).setEnabled(draft.slotCount < CLASS_CONFIG.maxStarterItems)
    if (maxPage > 0) {
        gui.addButton(CLASS_IDS.BTN_SLOT_PREV, "§7<", 316, 120, 28, 20).setEnabled(draft.page > 0)
        gui.addButton(CLASS_IDS.BTN_SLOT_NEXT, "§7>", 350, 120, 28, 20).setEnabled(draft.page < maxPage)
    }
    gui.addLabel(LAYER.CONTENT_LABELS + 5, "§7Move items between the starter slots and your inventory, then save.", 20, 148, 370, 10)
    addRpgInventorySlotFrames(gui, LAYER.CONTENT_BASE + 10, 120, 178, RPG_UI.chrome)
    gui.showPlayerInventory(120, 178)
    gui.addButton(CLASS_IDS.BTN_SKILL_TREE, "§b§lSKILL TREE §8[§f" + (draft.skillNodes || []).length + "§8]", 12, 282, 112, 20)
    gui.addButton(CLASS_IDS.BTN_ATTRIBUTES, "§d§lCLASS STATS", 130, 282, 104, 20)
    gui.addButton(CLASS_IDS.BTN_SAVE, "§a§lSAVE", 242, 282, 78, 20)
    gui.addButton(CLASS_IDS.BTN_CANCEL, "§c§lCANCEL", 328, 282, 78, 20)
    player.showCustomGui(gui)
}

function ensureClassStatDraft(draft) {
    if (!draft) return null
    if (!draft.baseStats || typeof draft.baseStats !== "object") draft.baseStats = {}
    if (!draft.statMultipliers || typeof draft.statMultipliers !== "object") draft.statMultipliers = {}
    return draft
}

function getSelectedClassStatKey(player) {
    refreshStatKeys()
    var temp = player.getTempdata()
    var selected = temp.has("admClassStatSelected") ? normalizeStatKey(temp.get("admClassStatSelected")) : ""
    if (STAT_KEYS.indexOf(selected) < 0) selected = STAT_KEYS.length > 0 ? STAT_KEYS[0] : ""
    if (selected) temp.put("admClassStatSelected", selected)
    return selected
}

function captureClassStatEditor(player, gui) {
    var draft = getClassDraft(player)
    var statKey = getSelectedClassStatKey(player)
    if (!draft || !statKey) return draft
    ensureClassStatDraft(draft)
    var baseField = gui.getComponent(CLASS_STAT_IDS.FIELD_BASE)
    var effectivenessField = gui.getComponent(CLASS_STAT_IDS.FIELD_EFFECTIVENESS)
    var base = baseField ? Math.round(Number(baseField.getText())) : Number(draft.baseStats[statKey] || 0)
    var percent = effectivenessField ? Number(effectivenessField.getText()) : Number(draft.statMultipliers[statKey] || 1) * 100
    if (isNaN(base)) base = 0
    if (isNaN(percent)) percent = 100
    base = Math.max(-10000, Math.min(10000, base))
    percent = Math.max(0, Math.min(1000, percent))
    if (base === 0) delete draft.baseStats[statKey]
    else draft.baseStats[statKey] = base
    if (Math.abs(percent - 100) < 0.0001) delete draft.statMultipliers[statKey]
    else draft.statMultipliers[statKey] = percent / 100
    saveClassDraft(player, draft)
    return draft
}

function showClassStatEditorGui(player) {
    var draft = ensureClassStatDraft(getClassDraft(player))
    if (!draft) {
        showClassListGui(player)
        return
    }
    refreshStatKeys()
    var selectedKey = getSelectedClassStatKey(player)
    var labels = []
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var key = STAT_KEYS[i]
        var stat = ATTR_CONFIG.stats[key]
        var base = Number(draft.baseStats[key] || 0)
        var multiplier = draft.statMultipliers.hasOwnProperty(key) ? Number(draft.statMultipliers[key]) : 1
        labels.push((stat.color || "§f") + stat.name + " §8• §f" + base + " base §8• §f" + Math.round(multiplier * 100) + "%%")
    }
    if (labels.length === 0) labels.push("(No attributes configured)")
    var selected = selectedKey ? ATTR_CONFIG.stats[selectedKey] : null
    var gui = API.createCustomGui(CLASS_STAT_GUI_ID, CLASS_EDIT_GUI_WIDTH, CLASS_EDIT_GUI_HEIGHT, false, player)
    addRpgFrame(gui, CLASS_EDIT_GUI_WIDTH, CLASS_EDIT_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 192, 230, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 210, 40, 200, 230, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, "§d§lCLASS ATTRIBUTE PROFILE", 126, 10, 200, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7Starting points and per-point effectiveness; both are class-specific.", 52, 26, 330, 10)
    var scroll = gui.addScroll(CLASS_STAT_IDS.SCROLL_STATS, 18, 54, 176, 204, labels)
    if (selectedKey) scroll.setDefaultSelection(STAT_KEYS.indexOf(selectedKey))
    if (selected) {
        var baseValue = Number(draft.baseStats[selectedKey] || 0)
        var multiplierValue = draft.statMultipliers.hasOwnProperty(selectedKey) ? Number(draft.statMultipliers[selectedKey]) : 1
        gui.addLabel(LAYER.CONTENT_LABELS + 2, (selected.color || "§f") + "§l" + selected.name, 224, 54, 172, 14)
        gui.addLabel(LAYER.CONTENT_LABELS + 3, "§7Starting attribute points", 224, 86, 166, 10)
        gui.addTextField(CLASS_STAT_IDS.FIELD_BASE, 224, 100, 166, 20).setText("" + baseValue)
        gui.addLabel(LAYER.CONTENT_LABELS + 4, "§7Effectiveness per point (%)", 224, 132, 166, 10)
        gui.addTextField(CLASS_STAT_IDS.FIELD_EFFECTIVENESS, 224, 146, 166, 20).setText("" + Math.round(multiplierValue * 10000) / 100)
        gui.addLabel(LAYER.CONTENT_LABELS + 5, "§8Example: 50 means each point grants half of its configured Minecraft attribute effect.", 224, 178, 166, 44)
        gui.addButton(CLASS_STAT_IDS.BTN_SAVE_STAT, "§a§lSAVE STAT", 224, 232, 78, 22)
        gui.addButton(CLASS_STAT_IDS.BTN_RESET_STAT, "§cRESET", 310, 232, 80, 22)
    }
    gui.addButton(CLASS_STAT_IDS.BTN_BACK, "§f§lBACK TO CLASS", 142, 282, 136, 20)
    showManagedGui(player, gui)
}

function saveClassEditor(player, gui) {
    var draft = captureClassEditorPage(player, gui)
    if (!draft) return false
    draft.name = draft.name.trim()
    draft.iconItemId = draft.iconItemId.trim()
    if (!draft.name) {
        player.message("§c[Classes] Class name is required!")
        return false
    }
    if (!createClassIconStack(player.getWorld(), draft.iconItemId)) {
        player.message("§c[Classes] Invalid icon item ID: §e" + draft.iconItemId)
        return false
    }
    if (!draft.id) draft.id = createUniqueClassId(player.getWorld(), draft.name)
    var scheduleError = validateClassSkillUpgradeSchedules(player, draft.skillNodes || [])
    if (scheduleError) {
        player.message("§c[Skills] " + scheduleError)
        return false
    }
    var runtimeNodes = buildClassSkillRuntimeNodes(draft.skillNodes || [])
    var items = []
    for (var i = 0; i < draft.slotCount; i++) {
        if (draft.startingItems[i]) items.push(draft.startingItems[i])
    }
    var registry = getClassRegistry(player.getWorld())
    var skillResult = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.saveTree(player.getMCEntity(), draft.id, JSON.stringify({ nodes: runtimeNodes, choiceGroups: draft.choiceGroups || [] }))
    })
    if (!skillResult.ok) {
        player.message("§c[Skills] " + skillResult.message)
        return false
    }
    registry[draft.id] = {
        id: draft.id,
        name: draft.name,
        iconItemId: draft.iconItemId,
        startingItems: items,
        skillNodes: draft.skillNodes || [],
        choiceGroups: draft.choiceGroups || [],
        editorFolders: draft.editorFolders || [],
        editorOrder: draft.editorOrder || {},
        baseStats: draft.baseStats || {},
        statMultipliers: draft.statMultipliers || {}
    }
    saveClassRegistry(player.getWorld(), registry)
    refreshOnlinePlayersForClass(player.getWorld(), draft.id)
    player.getTempdata().put("admSelectedClassId", draft.id)
    clearClassDraft(player)
    player.message("§a[Classes] Saved class §e" + draft.name)
    return true
}

function getClassChooserPageIds(player) {
    var temp = player.getTempdata()
    if (!temp.has("admClassChooserIds")) return []
    try {
        var ids = JSON.parse(temp.get("admClassChooserIds"))
        return Array.isArray(ids) ? ids : []
    } catch (error) {
        return []
    }
}

function _class_customGuiButton(e) {
    var player = e.player
    if (rejectFrozenCustomGuiMutation(player)) return
    var guiId = e.gui.getID()
    var buttonId = e.buttonId
    if (guiId === CLASS_CHOOSER_GUI_ID) {
        var chooserPage = player.getTempdata().has("admClassChooserPage") ? Number(player.getTempdata().get("admClassChooserPage")) : 0
        var roleIndex = buttonId - CLASS_IDS.BTN_ROLE_BASE
        if (roleIndex >= 0 && roleIndex < CLASS_CONFIG.chooserPageSize) {
            var chooserIds = getClassChooserPageIds(player)
            if (roleIndex < chooserIds.length) {
                player.getTempdata().put("admSelectedChooserClassId", chooserIds[roleIndex])
                showClassChooserGui(player, chooserPage)
            }
        } else if (buttonId === CLASS_IDS.BTN_LIST_PREV) {
            showClassChooserGui(player, chooserPage - 1)
        } else if (buttonId === CLASS_IDS.BTN_LIST_NEXT) {
            showClassChooserGui(player, chooserPage + 1)
        } else if (buttonId === CLASS_IDS.BTN_CHOOSE) {
            var selectedClassId = player.getTempdata().has("admSelectedChooserClassId") ? String(player.getTempdata().get("admSelectedChooserClassId")) : ""
            var selectedClass = getClassById(player.getWorld(), selectedClassId)
            if (selectedClass && selectPlayerClass(player, selectedClassId)) {
                player.message("§a[Classes] You chose §e" + selectedClass.name + "§a!")
                player.closeGui()
            } else {
                player.message("§c[Classes] That class is no longer available.")
                showClassChooserGui(player, chooserPage)
            }
        }
        return
    }
    if (guiId === CLASS_LIST_GUI_ID) {
        var page = getClassListPage(player)
        var selectedId = player.getTempdata().has("admSelectedClassId") ? String(player.getTempdata().get("admSelectedClassId")) : ""
        if (buttonId === CLASS_IDS.BTN_NEW) {
            startClassDraft(player, "")
            showClassEditorGui(player)
        } else if (buttonId === CLASS_IDS.BTN_EDIT && getClassById(player.getWorld(), selectedId)) {
            startClassDraft(player, selectedId)
            showClassEditorGui(player)
        } else if (buttonId === CLASS_IDS.BTN_DELETE && deleteClassDefinition(player, selectedId)) {
            player.getTempdata().remove("admSelectedClassId")
            player.message("§c[Classes] Deleted class §e" + selectedId)
            showClassListGui(player, page)
        } else if (buttonId === CLASS_IDS.BTN_LIST_PREV) {
            showClassListGui(player, page - 1)
        } else if (buttonId === CLASS_IDS.BTN_LIST_NEXT) {
            showClassListGui(player, page + 1)
        } else if (buttonId === CLASS_IDS.BTN_BACK) {
            showAdminGui(player, "Classes")
        }
        return
    }
    if (guiId === CLASS_STAT_GUI_ID) {
        if (buttonId === CLASS_STAT_IDS.BTN_SAVE_STAT) {
            var savedStatDraft = captureClassStatEditor(player, e.gui)
            if (persistClassStatDraft(player, savedStatDraft)) {
                player.message("§a[Classes] Class attribute profile saved to world data.")
            } else {
                player.message("§e[Classes] This new class will save its attributes when you save the class.")
            }
            showClassStatEditorGui(player)
        } else if (buttonId === CLASS_STAT_IDS.BTN_RESET_STAT) {
            var statDraft = ensureClassStatDraft(getClassDraft(player))
            var statKey = getSelectedClassStatKey(player)
            if (statDraft && statKey) {
                delete statDraft.baseStats[statKey]
                delete statDraft.statMultipliers[statKey]
                saveClassDraft(player, statDraft)
                persistClassStatDraft(player, statDraft)
            }
            showClassStatEditorGui(player)
        } else if (buttonId === CLASS_STAT_IDS.BTN_BACK) {
            captureClassStatEditor(player, e.gui)
            showClassEditorGui(player)
        }
        return
    }
    if (guiId !== CLASS_EDIT_GUI_ID) return
    if (buttonId === CLASS_IDS.BTN_CANCEL) {
        clearClassDraft(player)
        showClassListGui(player)
        return
    }
    var draft = captureClassEditorPage(player, e.gui)
    if (!draft) return
    if (buttonId === CLASS_IDS.BTN_SKILL_TREE) {
        saveClassDraft(player, draft)
        showClassSkillTreeGui(player)
        return
    }
    if (buttonId === CLASS_IDS.BTN_ATTRIBUTES) {
        saveClassDraft(player, draft)
        showClassStatEditorGui(player)
        return
    }
    if (buttonId === CLASS_IDS.BTN_ADD_ITEM) {
        if (draft.slotCount < CLASS_CONFIG.maxStarterItems) {
            draft.startingItems[draft.slotCount] = null
            draft.slotCount++
            draft.page = Math.floor((draft.slotCount - 1) / CLASS_CONFIG.starterPageSize)
            saveClassDraft(player, draft)
        }
        showClassEditorGui(player)
    } else if (buttonId === CLASS_IDS.BTN_SLOT_PREV) {
        draft.page--
        saveClassDraft(player, draft)
        showClassEditorGui(player)
    } else if (buttonId === CLASS_IDS.BTN_SLOT_NEXT) {
        draft.page++
        saveClassDraft(player, draft)
        showClassEditorGui(player)
    } else if (buttonId === CLASS_IDS.BTN_SAVE) {
        if (saveClassEditor(player, e.gui)) showClassListGui(player)
    }
}

var CLASS_SKILL_GUI_WIDTH = 480
var CLASS_SKILL_GUI_HEIGHT = 320
var CLASS_SKILL_HTML_FILE = "class_skill_tree.html"
var CLASS_SKILL_HTML_SESSION_KEY = "admClassSkillHtmlOpen"
var CLASS_SKILL_HTML_EDITOR_KEY = "admClassSkillHtmlEditorOpen"
var CLASS_SKILL_HTML_REBIND_KEY = "admClassSkillHtmlRebinding"
var HTML_ACTIVE_SESSION_KEY = "admActiveHtmlGui"
var EQUIPMENT_SERVICE_HTML_FILE = "equipment_service.html"
var ITEM_IDENTIFIER_HTML_FILE = "item_identify.html"
var ITEM_REGISTRY_HTML_FILE = "item_registry.html"
var EQUIPMENT_SERVICE_SESSION_KEY = "arvanEquipmentServiceSessionV1"
var EQUIPMENT_SERVICE_PENDING_KEY = "arvanEquipmentServicePendingV1"
var EQUIPMENT_SERVICE_OPERATION_KEY = "arvanEquipmentServiceOperationV1"
var EQUIPMENT_SERVICE_SETTINGS_DRAFT_KEY = "arvanEquipmentServiceSettingsDraftV1"
var EQUIPMENT_SERVICE_GUI_ID = 104
var EQUIPMENT_SERVICE_SESSION_TTL = 1800000
var EQUIPMENT_SERVICE_DEFAULT_RANGE = 8
var CLASS_STAT_NODE_MAX_RANK = 100
var PASSIVE_ICON_NAMES = [
    "Strength", "Vitality", "Dexterity", "Intelligence", "Fury", "Endurance", "Agility", "Wisdom", "Resolve", "Focus",
    "Swordsmanship", "Archery", "Guard", "Evasion", "Critical Strike", "Precision", "Parry", "Counterattack", "Berserker", "Fortitude",
    "Fire", "Ice", "Lightning", "Earth", "Wind", "Water", "Shadow", "Light", "Arcane", "Poison",
    "Regeneration", "Mana", "Stamina", "Life Steal", "Spell Power", "Armor", "Resistance", "Recovery", "Haste", "Luck",
    "Leadership", "Guardian", "Hunter", "Assassin", "Mage", "Warrior", "Monk", "Alchemist", "Necromancer", "Dragonheart"
]

function normalizeStatIconIndex(value) {
    var index = Math.floor(Number(value))
    if (isNaN(index)) index = 0
    return Math.max(0, Math.min(PASSIVE_ICON_NAMES.length - 1, index))
}

function isClassStatNode(node) {
    return !!(node && node.type === "MILESTONE" && node.statNode === true)
}

function supportsClassSkillUpgradeSchedule(node) {
    return !!(node && (node.type === "IRON_SPELL" || isClassStatNode(node)))
}

function getEpicSkillIconDataUri(registryId) {
    var id = String(registryId || "")
    if (!id) return ""
    try {
        var icon = String(SERVER_CORE_SKILLS.epicIcon(id) || "")
        return icon.length <= 100000 ? icon : ""
    } catch (error) {
        return ""
    }
}

function getEpicSkillIconMap(nodes) {
    var icons = {}
    for (var i = 0; nodes && i < nodes.length; i++) {
        var node = nodes[i]
        if (!node || node.type !== "EPIC_FIGHT") continue
        var registryId = String(node.registryId || "")
        if (registryId && !icons[registryId]) icons[registryId] = getEpicSkillIconDataUri(registryId)
    }
    return icons
}
var CLASS_SKILL_IDS = {
    SCROLL_NODES: 160,
    SCROLL_CATALOG: 161,
    SCROLL_PREREQ_AVAILABLE: 162,
    SCROLL_PREREQ_SELECTED: 163,
    FIELD_TITLE: 181,
    FIELD_REGISTRY: 182,
    FIELD_LEVEL: 183,
    FIELD_RANK: 184,
    BTN_NEW: 220,
    BTN_EDIT: 221,
    BTN_DELETE: 222,
    BTN_BACK: 223,
    BTN_IRON: 224,
    BTN_EPIC_SLOT: 225,
    BTN_PREREQUISITES: 227,
    BTN_SAVE: 229,
    BTN_CANCEL: 230,
    BTN_EPIC: 231,
    BTN_PREREQ_ADD: 232,
    BTN_PREREQ_REMOVE: 233,
    BTN_PREREQ_DONE: 234,
    BTN_PREREQ_CANCEL: 235,
    BTN_MILESTONE: 236,
    BTN_PRELEARNED: 237,
    BTN_UPGRADE: 238,
    BTN_BLOCKED: 239,
    BTN_ITEM_COST: 240,
    BTN_EFFECTS: 241,
    BTN_ITEM_SAVE: 242,
    BTN_ITEM_CLEAR: 243,
    BTN_ITEM_CANCEL: 244,
    BTN_CAN_UNLEARN: 245,
    BTN_UNLEARN_COST: 246,
    BTN_REPLACE_UPGRADE: 247,
    BTN_ITEM_CONSUME: 248
}

var CLASS_SKILL_EFFECT_IDS = {
    SCROLL_STATS: 170,
    FIELD_BONUS: 190,
    FIELD_EFFECTIVENESS: 191,
    BTN_SAVE_STAT: 250,
    BTN_RESET_STAT: 251,
    BTN_BACK: 252,
    BTN_TOGGLE_OVERRIDE: 253
}

function getClassSkillNodes(player) {
    var draft = getClassDraft(player)
    if (!draft) return []
    if (!draft.skillNodes) draft.skillNodes = []
    return draft.skillNodes
}

function findClassSkillNode(player, nodeId) {
    var nodes = getClassSkillNodes(player)
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === nodeId) return nodes[i]
    }
    return null
}

function findClassSkillNodeInDraft(classDraft, nodeId) {
    var nodes = classDraft && Array.isArray(classDraft.skillNodes) ? classDraft.skillNodes : []
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === nodeId) return nodes[i]
    }
    return null
}

function createUniqueClassSkillNodeId(player, title, originalId) {
    var base = String(title || "node").toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "_")
        .replace(/^[_\-.]+|[_\-.]+$/g, "")
    if (!base) base = "node"
    if (base.length > 56) base = base.substring(0, 56)
    var candidate = base
    var suffix = 2
    while (findClassSkillNode(player, candidate) && candidate !== originalId) {
        candidate = base.substring(0, 56 - String(suffix).length) + "_" + suffix
        suffix++
    }
    return candidate
}

function sortedClassSkillNodes(player) {
    var nodes = getClassSkillNodes(player).slice()
    nodes = nodes.filter(function(node) { return !isManagedUpgradeRuntimeNode(node) })
    nodes.sort(function(left, right) {
        var levelDifference = Number(left.requiredLevel || 1) - Number(right.requiredLevel || 1)
        if (levelDifference !== 0) return levelDifference
        return String(left.title || left.id).toLowerCase().localeCompare(String(right.title || right.id).toLowerCase())
    })
    return nodes
}

function isClassSkillTreeCoordinate(value) {
    var number = Number(value)
    return !isNaN(number) && isFinite(number)
}

function resolveClassSkillTreePositions(nodes) {
    var source = Array.isArray(nodes) ? nodes : []
    var byId = {}
    var positions = {}
    var sorted = source.slice().sort(function(left, right) {
        var level = Number(left.requiredLevel || 1) - Number(right.requiredLevel || 1)
        if (level !== 0) return level
        return String(left.title || left.id).localeCompare(String(right.title || right.id))
    })
    var levels = []
    for (var i = 0; i < sorted.length; i++) {
        byId[String(sorted[i].id || "")] = sorted[i]
        levels.push(Number(sorted[i].requiredLevel || 1))
    }
    levels.sort(function(a, b) { return a - b })
    levels = levels.filter(function(value, index) { return index === 0 || value !== levels[index - 1] })
    var levelIndex = {}
    for (var levelPosition = 0; levelPosition < levels.length; levelPosition++) levelIndex[String(levels[levelPosition])] = levelPosition
    var ranks = {}
    function rankOf(node, active) {
        if (ranks[node.id] !== undefined) return ranks[node.id]
        if (active[node.id]) return Number(levelIndex[String(Number(node.requiredLevel || 1))] || 0)
        active[node.id] = true
        var rank = Number(levelIndex[String(Number(node.requiredLevel || 1))] || 0)
        var prerequisites = node.prerequisites || []
        for (var prerequisiteIndex = 0; prerequisiteIndex < prerequisites.length; prerequisiteIndex++) {
            var prerequisite = byId[prerequisites[prerequisiteIndex]]
            if (prerequisite) rank = Math.max(rank, rankOf(prerequisite, active) + 1)
        }
        delete active[node.id]
        ranks[node.id] = rank
        return rank
    }
    var groups = {}
    var rows = []
    for (var sortedIndex = 0; sortedIndex < sorted.length; sortedIndex++) {
        var rank = rankOf(sorted[sortedIndex], {})
        if (!groups[String(rank)]) {
            groups[String(rank)] = []
            rows.push(rank)
        }
        groups[String(rank)].push(sorted[sortedIndex])
    }
    rows.sort(function(a, b) { return a - b })
    var widest = 1
    for (var rowWidthIndex = 0; rowWidthIndex < rows.length; rowWidthIndex++) widest = Math.max(widest, groups[String(rows[rowWidthIndex])].length)
    var center = Math.max(760, widest * 244 + 160) / 2
    for (var row = 0; row < rows.length; row++) {
        var rowNodes = groups[String(rows[row])]
        rowNodes.sort(function(left, right) {
            function parentCenter(node) {
                var total = 0
                var count = 0
                var prerequisites = node.prerequisites || []
                for (var parentIndex = 0; parentIndex < prerequisites.length; parentIndex++) {
                    var parentPosition = positions[prerequisites[parentIndex]]
                    if (parentPosition) {
                        total += parentPosition.x + 99
                        count++
                    }
                }
                return count > 0 ? total / count : center
            }
            var parentDifference = parentCenter(left) - parentCenter(right)
            if (Math.abs(parentDifference) > 1) return parentDifference
            return String(left.title || left.id).localeCompare(String(right.title || right.id))
        })
        var rowWidth = (rowNodes.length - 1) * 244
        for (var column = 0; column < rowNodes.length; column++) {
            var node = rowNodes[column]
            if (isClassSkillTreeCoordinate(node.treeX) && isClassSkillTreeCoordinate(node.treeY)) {
                positions[node.id] = { x: Number(node.treeX), y: Number(node.treeY) }
            } else {
                positions[node.id] = {
                    x: Math.round(center - rowWidth / 2 + column * 244 - 99),
                    y: 82 + row * 176
                }
            }
        }
    }
    return positions
}

function normalizeSkillVisibility(value, fallback) {
    var normalized = String(value || "").toUpperCase()
    return ["SHOW", "OBFUSCATE", "HIDE"].indexOf(normalized) >= 0 ? normalized : fallback
}

function normalizeSkillVisibilityRules(value) {
    var source = Array.isArray(value) ? value : []
    var rules = []
    for (var i = 0; i < source.length && rules.length < 64; i++) {
        var entry = source[i] && typeof source[i] === "object" ? source[i] : {}
        var condition = String(entry.condition || "").toUpperCase()
        var nodeId = String(entry.nodeId || "").trim()
        var mode = normalizeSkillVisibility(entry.mode, "")
        if (["HAS_NODE", "NOT_HAS_NODE"].indexOf(condition) < 0 || !nodeId || !mode) continue
        rules.push({ condition: condition, nodeId: nodeId, mode: mode })
    }
    return rules
}

function normalizeClassSkillUpgradeSchedule(value) {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new Error("Upgrade schedule must be an array.")
    if (value.length > 32) throw new Error("A skill may have at most 32 scheduled upgrades.")
    var rows = []
    for (var i = 0; i < value.length; i++) {
        var source = value[i]
        if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Each scheduled upgrade must be an object.")
        var row = {
            id: String(source.id || source.nodeId || "").trim().toLowerCase(),
            rank: Number(source.rank),
            requiredLevel: Number(source.requiredLevel),
            requiredItemSnbt: String(source.requiredItemSnbt || source.itemSnbt || ""),
            spiritCost: normalizeWholeResource(source.spiritCost !== undefined ? source.spiritCost : source.spirit, 0, SPIRIT_MAX_SAFE_INTEGER),
            grantedPermissions: normalizeSkillPermissionList(source.grantedPermissions || source.permissionGrants || source.grants),
            consumeLearnItem: source.consumeLearnItem !== false
        }
        if (source.consume !== undefined) row.consumeLearnItem = source.consume !== false
        if (Object.prototype.hasOwnProperty.call(source, "statBonuses")) {
            row.statBonuses = classSkillHtmlNumberMap(source.statBonuses, false)
        }
        if (Object.prototype.hasOwnProperty.call(source, "statMultiplierBonuses")) {
            row.statMultiplierBonuses = classSkillHtmlNumberMap(source.statMultiplierBonuses, true)
        }
        rows.push(row)
    }
    return rows
}

function classSkillUpgradeSchedule(node) {
    if (!supportsClassSkillUpgradeSchedule(node)) return []
    try {
        return normalizeClassSkillUpgradeSchedule(node.upgradeSchedule)
    } catch (error) {
        return []
    }
}

function isManagedUpgradeRuntimeNode(node) {
    return !!(node && (node.managedUpgradeBaseId || node.managedUpgradeNode === true))
}

function classSkillUpgradeUiSeriesId(node) {
    var schedule = classSkillUpgradeSchedule(node)
    return schedule.length > 0 ? String(node.id || "") : String(node && node.rankSeriesId || "")
}

function managedUpgradeId(baseId, rank, used) {
    var prefix = String(baseId || "skill").toLowerCase().replace(/[^a-z0-9_.-]+/g, "_")
    var base = (prefix + "_upgrade_" + String(rank)).substring(0, 56)
    var candidate = base
    var suffix = 2
    while (used[candidate]) {
        candidate = base.substring(0, Math.max(1, 56 - String(suffix).length)) + "_" + suffix
        suffix++
    }
    return candidate
}

function prepareClassSkillUpgradeIds(nodes) {
    var used = {}
    var i
    for (i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].id) used[String(nodes[i].id)] = true
    }
    for (i = 0; i < nodes.length; i++) {
        var schedule = classSkillUpgradeSchedule(nodes[i])
        for (var rowIndex = 0; rowIndex < schedule.length; rowIndex++) {
            var row = nodes[i].upgradeSchedule[rowIndex]
            var id = String(row.id || "").trim().toLowerCase()
            if (!id.match(/^[a-z0-9_.-]{1,64}$/) || used[id]) id = managedUpgradeId(nodes[i].id, row.rank, used)
            row.id = id
            used[id] = true
        }
    }
}

function validateClassSkillUpgradeSchedules(player, nodes) {
    var catalogById = {}
    var catalogLoaded = false
    var nodeById = {}
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        if (!node || !node.id) continue
        nodeById[String(node.id)] = node
    }
    var usedIds = {}
    for (i = 0; i < nodes.length; i++) {
        var base = nodes[i]
        var schedule
        try {
            var requiredRanks = normalizePrerequisiteRanks(base.prerequisiteRanks, base.prerequisites)
            Object.keys(requiredRanks).forEach(function(requiredId) {
                resolvePrerequisiteRank(nodes, requiredId, requiredRanks[requiredId])
            })
            schedule = normalizeClassSkillUpgradeSchedule(base.upgradeSchedule)
        } catch (scheduleError) {
            return String(scheduleError.message || scheduleError)
        }
        if (!schedule.length) continue
        if (!supportsClassSkillUpgradeSchedule(base)) return "Upgrade schedules are only available for Iron spells and stat passives."
        if (base.type === "IRON_SPELL" && !base.registryId) return "An upgrade schedule needs a selected Iron spell."
        if (Number(base.rank || 0) !== 1) return "Managed upgrade schedules must start at rank 1."
        if (base.upgradeFrom) return "A managed upgrade schedule must be attached to a root spell."
        var maxRank = CLASS_STAT_NODE_MAX_RANK
        if (base.type === "IRON_SPELL") {
            if (!catalogLoaded) {
                var catalog = getSkillCatalog(player, { type: "IRON_SPELL" })
                if (!catalog || !catalog.ok) return String(catalog && catalog.message || "The Iron spell catalog is unavailable.")
                for (var catalogIndex = 0; catalogIndex < (catalog.entries || []).length; catalogIndex++) {
                    catalogById[String(catalog.entries[catalogIndex].registryId)] = catalog.entries[catalogIndex]
                }
                catalogLoaded = true
            }
            var entry = catalogById[String(base.registryId)]
            if (!entry) return "The selected Iron spell is no longer in the catalog."
            maxRank = Math.max(1, Number(entry.maxRank || 1))
        }
        var previousRank = Number(base.rank || 1)
        var previousLevel = Number(base.requiredLevel || 1)
        for (var rowIndex = 0; rowIndex < schedule.length; rowIndex++) {
            var row = schedule[rowIndex]
            if (!isFinite(row.rank) || row.rank !== Math.floor(row.rank) || row.rank <= previousRank || row.rank > maxRank) {
                return "Upgrade ranks must increase by whole numbers and stay within the supported max rank (" + maxRank + ")."
            }
            if (!isFinite(row.requiredLevel) || row.requiredLevel !== Math.floor(row.requiredLevel) || row.requiredLevel < Number(base.requiredLevel || 1) || row.requiredLevel < previousLevel) {
                return "Upgrade levels must be whole numbers at least the base level and monotonic."
            }
            if (row.id) {
                if (usedIds[row.id] && usedIds[row.id] !== String(base.id) + ":" + rowIndex) return "Scheduled upgrade node IDs must be unique."
                usedIds[row.id] = String(base.id) + ":" + rowIndex
            }
            previousRank = row.rank
            previousLevel = row.requiredLevel
        }
    }
    return ""
}

function normalizePrerequisiteRanks(value, prerequisites, remap) {
    var result = {}
    if (value === undefined || value === null) return result
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid requirement ranks.")
    Object.keys(value).forEach(function(key) {
        var id = remap && remap["$" + key] || key
        if ((prerequisites || []).indexOf(id) < 0) return
        var rank = Number(value[key])
        if (!isFinite(rank) || rank < 1 || rank !== Math.floor(rank)) throw new Error("Required spell rank must be a positive whole number.")
        result[id] = rank
    })
    return result
}

function resolvePrerequisiteRank(nodes, id, rank) {
    for (var i = 0; i < nodes.length; i++) {
        var target = nodes[i]
        if (String(target.id) !== id) continue
        if (Number(target.rank || 1) === rank) return target
        var rows = classSkillUpgradeSchedule(target)
        for (var j = 0; j < rows.length; j++) if (rows[j].rank === rank) return rows[j]
        throw new Error(String(target.title || id) + " has no configured rank " + rank + ". Add that upgrade to the skill first.")
    }
    throw new Error("A required skill no longer exists. Select it again.")
}

function buildClassSkillRuntimeNodes(nodes) {
    prepareClassSkillUpgradeIds(nodes)
    var runtime = []
    for (var i = 0; i < nodes.length; i++) {
        var source = nodes[i]
        var base = JSON.parse(JSON.stringify(source))
        var schedule = classSkillUpgradeSchedule(source)
        delete base.upgradeSchedule
        if (schedule.length) {
            base.rankSeriesId = ""
            base.upgradeFrom = ""
            base.removeUpgradeSource = false
        }
        runtime.push(base)
        var previousId = base.id
        for (var rowIndex = 0; rowIndex < schedule.length; rowIndex++) {
            var row = schedule[rowIndex]
            var generated = JSON.parse(JSON.stringify(base))
            generated.id = row.id
            generated.title = String(source.title || source.registryId || "Spell") + " · Rank " + row.rank
            generated.requiredLevel = row.requiredLevel
            generated.rank = row.rank
            generated.prerequisites = [previousId]
            generated.prerequisiteMode = "ALL"
            generated.prelearned = false
            generated.learnedWithNode = ""
            generated.choiceGroupId = ""
            generated.rankSeriesId = ""
            generated.requiredItemSnbt = row.requiredItemSnbt
            generated.spiritCost = row.spiritCost
            generated.grantedPermissions = row.grantedPermissions.slice()
            generated.consumeLearnItem = row.consumeLearnItem !== false
            generated.upgradeFrom = previousId
            generated.removeUpgradeSource = false
            generated.blockedNodes = []
            generated.statNode = isClassStatNode(source)
            generated.statIconIndex = normalizeStatIconIndex(source.statIconIndex)
            if (generated.statNode) {
                generated.statBonuses = row.statBonuses === undefined
                    ? JSON.parse(JSON.stringify(source.statBonuses || {}))
                    : JSON.parse(JSON.stringify(row.statBonuses || {}))
                generated.statMultiplierBonuses = row.statMultiplierBonuses === undefined
                    ? JSON.parse(JSON.stringify(source.statMultiplierBonuses || {}))
                    : JSON.parse(JSON.stringify(row.statMultiplierBonuses || {}))
                generated.statMultiplierOverrides = JSON.parse(JSON.stringify(source.statMultiplierOverrides || {}))
            } else {
                generated.statBonuses = {}
                generated.statMultiplierBonuses = {}
                generated.statMultiplierOverrides = {}
            }
            generated.canUnlearn = true
            generated.unlearnItemSnbt = ""
            generated.consumeUnlearnItem = false
            generated.managedUpgradeBaseId = String(source.id || "")
            generated.managedUpgradeNode = true
            generated.managedUpgradeRank = row.rank
            generated.resetNodeId = schedule[0].id
            runtime.push(generated)
            previousId = generated.id
        }
    }
    for (var runtimeIndex = 0; runtimeIndex < runtime.length; runtimeIndex++) {
        var compiled = runtime[runtimeIndex]
        var ranks = normalizePrerequisiteRanks(compiled.prerequisiteRanks, compiled.prerequisites)
        compiled.prerequisites = (compiled.prerequisites || []).map(function(id) {
            return ranks[id] ? String(resolvePrerequisiteRank(nodes, id, ranks[id]).id) : id
        })
        delete compiled.prerequisiteRanks
    }
    return runtime
}

function classSkillTreeHtmlNode(node, position) {
    var hasManagedScheduleMarker = !!(node && Object.prototype.hasOwnProperty.call(node, "managedUpgradeSchedule"))
    var managedSchedule = !!(node && (node.managedUpgradeSchedule === true
        || (!hasManagedScheduleMarker && Object.prototype.hasOwnProperty.call(node, "upgradeSchedule"))))
    var encoded = {
        id: String(node.id || ""),
        title: String(node.title || node.id || "Untitled"),
        description: String(node.description || ""),
        type: String(node.type || "MILESTONE"),
        statNode: isClassStatNode(node),
        statIconIndex: normalizeStatIconIndex(node.statIconIndex),
        icon: String(node.icon || ""),
        registryId: String(node.registryId || ""),
        requiredLevel: Number(node.requiredLevel || 1),
        rank: Number(node.rank || 1),
        prerequisites: (node.prerequisites || []).slice(),
        prerequisiteRanks: normalizePrerequisiteRanks(node.prerequisiteRanks, node.prerequisites),
        epicSlot: String(node.epicSlot || ""),
        prelearned: node.prelearned === true,
        learnedWithNode: String(node.learnedWithNode || ""),
        choiceGroupId: String(node.choiceGroupId || ""),
        editorGroup: String(node.editorGroup || "Core"),
        rankSeriesId: classSkillUpgradeUiSeriesId(node),
        upgradeSchedule: classSkillUpgradeSchedule(node),
        managedUpgradeSchedule: managedSchedule,
        prerequisiteMode: String(node.prerequisiteMode || "ALL").toUpperCase() === "ANY" ? "ANY" : "ALL",
        requiredItemSnbt: String(node.requiredItemSnbt || ""),
        hasItemCost: !!node.requiredItemSnbt,
        spiritCost: nodeSpiritCost(node),
        grantedPermissions: nodeGrantedPermissions(node),
        consumeLearnItem: node.consumeLearnItem !== false,
        upgradeFrom: String(node.upgradeFrom || ""),
        removeUpgradeSource: node.removeUpgradeSource === true,
        blockedNodes: (node.blockedNodes || []).slice(),
        canUnlearn: node.canUnlearn === true,
        unlearnItemSnbt: String(node.unlearnItemSnbt || ""),
        hasUnlearnCost: !!node.unlearnItemSnbt,
        consumeUnlearnItem: node.consumeUnlearnItem !== false,
        visibilityBeforeRequirements: normalizeSkillVisibility(node.visibilityBeforeRequirements, "OBFUSCATE"),
        visibilityWhenReady: normalizeSkillVisibility(node.visibilityWhenReady, "SHOW"),
        visibilityWhenLearned: normalizeSkillVisibility(node.visibilityWhenLearned, "SHOW"),
        visibilityRules: normalizeSkillVisibilityRules(node.visibilityRules),
        statBonuses: JSON.parse(JSON.stringify(node.statBonuses || {})),
        statMultiplierBonuses: JSON.parse(JSON.stringify(node.statMultiplierBonuses || {})),
        statMultiplierOverrides: JSON.parse(JSON.stringify(node.statMultiplierOverrides || {})),
        effectCount: countClassSkillNodeEffects(node)
    }
    if (position && isClassSkillTreeCoordinate(position.x) && isClassSkillTreeCoordinate(position.y)) {
        encoded.treeX = Number(position.x)
        encoded.treeY = Number(position.y)
    } else if (isClassSkillTreeCoordinate(node.treeX) && isClassSkillTreeCoordinate(node.treeY)) {
        encoded.treeX = Number(node.treeX)
        encoded.treeY = Number(node.treeY)
    }
    return encoded
}

function classSkillHtmlCatalog(player, type) {
    var result = getSkillCatalog(player, { type: type })
    var entries = []
    if (result && result.ok && result.entries) {
        for (var i = 0; i < result.entries.length; i++) {
            var entry = result.entries[i]
            var encoded = {
                registryId: String(entry.registryId || ""),
                displayName: String(entry.displayName || entry.registryId || "Unnamed"),
                category: String(entry.category || ""),
                maxRank: Math.max(1, Number(entry.maxRank || 1))
            }
            if (type === "EPIC_FIGHT") {
                copyEpicSkillMetadata(entry, encoded)
                encoded.icon = getEpicSkillIconDataUri(encoded.registryId)
            }
            else {
                encoded.sourceMod = String(entry.registryId || "").split(":")[0]
                try {
                    var spellIcon = String(Java.type("com.arvanworld.servercore.skills.SkillRuntime").ironIconDataUri(encoded.registryId) || "")
                    if (spellIcon.length <= 16000) encoded.icon = spellIcon
                } catch (iconError) {}
            }
            entries.push(encoded)
        }
    }
    return {
        ok: !!(result && result.ok),
        message: result ? String(result.message || "") : "Integration unavailable",
        entries: entries
    }
}

function copyEpicSkillMetadata(source, target) {
    target.sourceMod = String(source.sourceMod || String(source.registryId || "").split(":")[0])
    target.category = String(source.category || "UNKNOWN")
    target.compatibleSlots = (source.compatibleSlots || []).slice()
    target.assignable = source.assignable === true
    target.unavailableReason = String(source.unavailableReason || (target.assignable ? "" : "This skill is not available for manual assignment."))
    target.ownership = String(source.ownership || "UNSUPPORTED")
    return target
}

function findEpicCatalogEntry(player, registryId) {
    var catalog = getSkillCatalog(player, { type: "EPIC_FIGHT" })
    if (!catalog.ok) return null
    for (var i = 0; catalog.entries && i < catalog.entries.length; i++) {
        if (String(catalog.entries[i].registryId) === String(registryId)) return catalog.entries[i]
    }
    return null
}

function defaultEpicSlotForCatalogEntry(entry) {
    return entry && entry.assignable === true && entry.compatibleSlots && entry.compatibleSlots.length
        ? String(entry.compatibleSlots[0]) : ""
}

function hasOwnStatValue(source, statKey) {
    return !!source && Object.prototype.hasOwnProperty.call(source, normalizeStatKey(statKey))
}

function getClassDraftStatMultiplier(player, statKey) {
    var normalized = normalizeStatKey(statKey)
    var draft = getClassDraft(player)
    var source = draft && draft.statMultipliers ? draft.statMultipliers : {}
    var value = hasOwnStatValue(source, normalized) ? Number(source[normalized]) : 1
    if (isNaN(value)) value = 1
    return Math.max(0, Math.min(10, value))
}

function getClassSkillDraftStatMultiplier(player, draft, statKey) {
    var normalized = normalizeStatKey(statKey)
    var classMultiplier = getClassDraftStatMultiplier(player, normalized)
    if (draft && hasOwnStatValue(draft.statMultiplierOverrides, normalized)) {
        var override = Number(draft.statMultiplierOverrides[normalized])
        return isNaN(override) ? classMultiplier : Math.max(0, Math.min(10, override))
    }
    if (draft && hasOwnStatValue(draft.statMultiplierBonuses, normalized)) {
        var legacyDelta = Number(draft.statMultiplierBonuses[normalized])
        if (!isNaN(legacyDelta)) return Math.max(0, Math.min(10, classMultiplier + legacyDelta))
    }
    return classMultiplier
}

function countClassSkillNodeEffects(node) {
    var multiplierStats = {}
    var legacy = node && node.statMultiplierBonuses ? node.statMultiplierBonuses : {}
    var overrides = node && node.statMultiplierOverrides ? node.statMultiplierOverrides : {}
    var key
    for (key in legacy) if (legacy.hasOwnProperty(key)) multiplierStats[key] = true
    for (key in overrides) if (overrides.hasOwnProperty(key)) multiplierStats[key] = true
    return Object.keys(node && node.statBonuses ? node.statBonuses : {}).length
        + Object.keys(multiplierStats).length
}

function classSkillHtmlStatOptions(player) {
    refreshStatKeys()
    var options = []
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var key = STAT_KEYS[i]
        var stat = ATTR_CONFIG.stats[key]
        options.push({
            id: key,
            name: String(stat && stat.name ? stat.name : key),
            classMultiplier: getClassDraftStatMultiplier(player, key)
        })
    }
    return options
}

function getAdminSpellIconMap(nodes) {
    var icons = {}
    var bytes = 0
    var runtime = Java.type("com.arvanworld.servercore.skills.SkillRuntime")
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        var registryId = String(node.registryId || "")
        if (node.type !== "IRON_SPELL" || !registryId || icons[registryId]) continue
        try {
            var icon = String(runtime.ironIconDataUri(registryId) || "")
            if (!icon || icon.length > 100000 || bytes + icon.length > 700000) continue
            icons[registryId] = icon
            bytes += icon.length
        } catch (iconError) {}
    }
    return icons
}

function buildClassSkillTreeHtmlPayload(player, message, ok) {
    var classDraft = getClassDraft(player)
    var temp = player.getTempdata()
    var nodes = sortedClassSkillNodes(player)
    var positions = resolveClassSkillTreePositions(nodes)
    var encoded = []
    var epicIcons = getEpicSkillIconMap(nodes)
    for (var i = 0; i < nodes.length; i++) {
        var encodedNode = classSkillTreeHtmlNode(nodes[i], positions[nodes[i].id])
        if (encodedNode.type === "EPIC_FIGHT") encodedNode.icon = epicIcons[encodedNode.registryId] || ""
        encoded.push(encodedNode)
    }
    var selectedId = temp.has("admSelectedClassSkillId")
        ? String(temp.get("admSelectedClassSkillId")) : ""
    if (!findClassSkillNode(player, selectedId)) selectedId = encoded.length > 0 ? encoded[0].id : ""
    if (selectedId) temp.put("admSelectedClassSkillId", selectedId)
    var editorDraft = temp.has(CLASS_SKILL_HTML_EDITOR_KEY) ? getClassSkillNodeDraft(player) : null
    var catalogs = {
        IRON_SPELL: { ok: true, message: "", entries: [], total: 0 },
        EPIC_FIGHT: { ok: true, message: "", entries: [], total: 0 }
    }
    if (editorDraft && catalogs[editorDraft.type]) catalogs[editorDraft.type].loading = true
    var encodedEditorDraft = editorDraft ? classSkillTreeHtmlNode(editorDraft) : null
    if (encodedEditorDraft && encodedEditorDraft.type === "EPIC_FIGHT") {
        encodedEditorDraft.icon = getEpicSkillIconDataUri(encodedEditorDraft.registryId)
    }
    return {
        classId: classDraft ? String(classDraft.id || "") : "",
        className: classDraft ? String(classDraft.name || "New Class") : "",
        nodes: encoded,
        spellIcons: getAdminSpellIconMap(nodes),
        passiveIconNames: PASSIVE_ICON_NAMES.slice(),
        choiceGroups: classDraft && Array.isArray(classDraft.choiceGroups) ? JSON.parse(JSON.stringify(classDraft.choiceGroups)) : [],
        editorFolders: classDraft && Array.isArray(classDraft.editorFolders) ? classDraft.editorFolders.slice() : [],
        editorOrder: classDraft && classDraft.editorOrder ? JSON.parse(JSON.stringify(classDraft.editorOrder)) : {},
        selectedId: selectedId,
        catalogs: catalogs,
        statOptions: classSkillHtmlStatOptions(player),
        editorOpen: !!editorDraft,
        editorDraft: encodedEditorDraft,
        costItems: describeSkillCostItems(player.getWorld(), {nodes: encoded, editorDraft: encodedEditorDraft}),
        editorOriginalId: editorDraft ? String(editorDraft.originalId || "") : "",
        message: String(message || ""),
        ok: ok !== false
    }
}

function pushClassSkillTreeHtml(player, message, ok) {
    var bridge = cnpcext.getClientBridge(player.getMCEntity())
    var payload = buildClassSkillTreeHtmlPayload(player, message, ok)
    payload.transportSession = String(player.getTempdata().get(CLASS_SKILL_HTML_SESSION_KEY) || "")
    sendSkillHtmlPayload(bridge, "class_skill_tree", payload)
    var temp = player.getTempdata()
    if (temp.has(CLASS_SKILL_HTML_EDITOR_KEY)) {
        var editorDraft = getClassSkillNodeDraft(player)
        if (editorDraft && editorDraft.type !== "MILESTONE") pushClassSkillCatalog(player, editorDraft)
    }
}

function pushClassSkillCatalog(player, draft) {
    var catalog = classSkillHtmlCatalog(player, draft.type)
    var batchId = String(Date.now()) + ":" + String(++skillCatalogBatchSequence)
    var batches = []
    var entries = []
    var bytes = 0
    for (var i = 0; i < catalog.entries.length; i++) {
        var size = new JAVA_STRING(JSON.stringify(catalog.entries[i])).getBytes(JAVA_UTF8).length
        if (size > 22000 && catalog.entries[i].icon) {
            delete catalog.entries[i].icon
            size = new JAVA_STRING(JSON.stringify(catalog.entries[i])).getBytes(JAVA_UTF8).length
        }
        if (size > 22000) {
            catalog = { ok: false, message: "A skill entry exceeds the GUI size limit.", entries: [] }
            batches = []
            entries = []
            break
        }
        if (bytes + size + 1 > 22000 && entries.length) {
            batches.push(entries)
            entries = []
            bytes = 0
        }
        entries.push(catalog.entries[i])
        bytes += size + 1
    }
    batches.push(entries)
    var bridge = cnpcext.getClientBridge(player.getMCEntity())
    if (draft.type === "IRON_SPELL") sendSkillHtmlPayload(bridge, "class_skill_tree", {
        preserveState: true, spellIcons: getAdminSpellIconMap([draft])
    })
    for (var index = 0; index < batches.length; index++) {
        bridge.sendToBrowser("class_skill_catalog", JSON.stringify({
            type: draft.type, batchId: batchId, index: index, complete: index === batches.length - 1,
            catalog: { ok: catalog.ok, message: catalog.message, entries: batches[index], total: catalog.entries.length }
        }))
    }
}

function showClassSkillTreeGui(player) {
    var classDraft = getClassDraft(player)
    if (!classDraft) {
        showClassListGui(player)
        return
    }
    if (player.getCustomGui()) {
        var temp = player.getTempdata()
        var transitions = temp.has(ADM_GUI_TRANSITION_KEY) ? Number(temp.get(ADM_GUI_TRANSITION_KEY)) : 0
        temp.put(ADM_GUI_TRANSITION_KEY, transitions + 1)
    }
    var classHtmlTemp = player.getTempdata()
    if (classHtmlTemp.has(SELF_SKILL_HTML_SESSION_KEY)) classHtmlTemp.remove(SELF_SKILL_HTML_SESSION_KEY)
    if (classHtmlTemp.has(SELF_SKILL_HTML_VIEW_KEY)) classHtmlTemp.remove(SELF_SKILL_HTML_VIEW_KEY)
    if (classHtmlTemp.has(SELF_SKILL_HTML_REBIND_KEY)) classHtmlTemp.remove(SELF_SKILL_HTML_REBIND_KEY)
    var session = String(Date.now()) + ":" + String(++skillHtmlBatchSequence)
    skillHtmlRequestParts = null
    classHtmlTemp.put(CLASS_SKILL_HTML_SESSION_KEY, session)
    classHtmlTemp.put(HTML_ACTIVE_SESSION_KEY, "CLASS")
    var initial = JSON.parse(skillHtmlInitialPayload(buildClassSkillTreeHtmlPayload(player, "", true), session, player.getWorld()))
    var inventory = player.getInventory()
    for (var itemSlot = 0; itemSlot < Math.min(36, inventory.getSize()); itemSlot++) {
        var item = inventory.getSlot(itemSlot)
        if (item && !item.isEmpty()) {
            var previewItem = item.copy()
            previewItem.setStackSize(1)
            initial.overlayItems.push({ slot: 100 + itemSlot, nbt: String(previewItem.getItemNbt().toJsonString()) })
        }
    }
    cnpcext.openHtmlGui(player, CLASS_SKILL_HTML_FILE, 0, 0, encodeSelfSkillHtmlPayload(initial))
}

function startClassSkillNodeDraft(player, nodeId) {
    var existing = findClassSkillNode(player, nodeId)
    var existingHasManagedScheduleMarker = !!(existing && Object.prototype.hasOwnProperty.call(existing, "managedUpgradeSchedule"))
    var existingManagedSchedule = !!(existing && (existing.managedUpgradeSchedule === true
        || (!existingHasManagedScheduleMarker && Object.prototype.hasOwnProperty.call(existing, "upgradeSchedule"))))
    var draft = existing ? JSON.parse(JSON.stringify(existing)) : {
        id: "",
        title: "",
        description: "",
        type: "IRON_SPELL",
        statNode: false,
        statIconIndex: 0,
        registryId: "",
        requiredLevel: 1,
        rank: 1,
        prerequisites: [],
        epicSlot: "",
        prelearned: false,
        learnedWithNode: "",
        choiceGroupId: "",
        rankSeriesId: "",
        prerequisiteMode: "ALL",
        requiredItemSnbt: "",
        spiritCost: 0,
        grantedPermissions: [],
        consumeLearnItem: true,
        upgradeFrom: "",
        removeUpgradeSource: false,
        blockedNodes: [],
        canUnlearn: false,
        unlearnItemSnbt: "",
        consumeUnlearnItem: true,
        visibilityBeforeRequirements: "OBFUSCATE",
        visibilityWhenReady: "SHOW",
        visibilityWhenLearned: "SHOW",
        visibilityRules: [],
        statBonuses: {},
        statMultiplierBonuses: {},
        statMultiplierOverrides: {},
        upgradeSchedule: [],
        managedUpgradeSchedule: true
    }
    draft.originalId = existing ? existing.id : ""
    if (draft.description === undefined || draft.description === null) draft.description = ""
    draft.statNode = draft.type === "MILESTONE" && draft.statNode === true
    draft.statIconIndex = normalizeStatIconIndex(draft.statIconIndex)
    if (!draft.prerequisites) draft.prerequisites = []
    if (!draft.blockedNodes) draft.blockedNodes = []
    if (!draft.statBonuses) draft.statBonuses = {}
    if (!draft.statMultiplierBonuses) draft.statMultiplierBonuses = {}
    if (!draft.statMultiplierOverrides) draft.statMultiplierOverrides = {}
    if (!draft.upgradeFrom) draft.upgradeFrom = ""
    draft.removeUpgradeSource = !!draft.upgradeFrom && draft.removeUpgradeSource === true
    if (!draft.requiredItemSnbt) draft.requiredItemSnbt = ""
    draft.spiritCost = nodeSpiritCost(draft)
    draft.grantedPermissions = normalizeSkillPermissionList(draft.grantedPermissions || draft.permissionGrants || draft.grants)
    if (!draft.unlearnItemSnbt) draft.unlearnItemSnbt = ""
    draft.consumeLearnItem = draft.consumeLearnItem !== false
    draft.consumeUnlearnItem = draft.consumeUnlearnItem !== false
    draft.prelearned = draft.prelearned === true
    draft.learnedWithNode = String(draft.learnedWithNode || "")
    draft.choiceGroupId = String(draft.choiceGroupId || "")
    draft.rankSeriesId = String(draft.rankSeriesId || "")
    draft.upgradeSchedule = classSkillUpgradeSchedule(draft)
    draft.managedUpgradeSchedule = existing ? existingManagedSchedule : true
    draft.prerequisiteMode = String(draft.prerequisiteMode || "ALL").toUpperCase() === "ANY" ? "ANY" : "ALL"
    draft.canUnlearn = !draft.prelearned && !draft.learnedWithNode && draft.canUnlearn === true
    draft.visibilityBeforeRequirements = normalizeSkillVisibility(draft.visibilityBeforeRequirements, "OBFUSCATE")
    draft.visibilityWhenReady = normalizeSkillVisibility(draft.visibilityWhenReady, "SHOW")
    draft.visibilityWhenLearned = normalizeSkillVisibility(draft.visibilityWhenLearned, "SHOW")
    draft.visibilityRules = normalizeSkillVisibilityRules(draft.visibilityRules)
    player.getTempdata().put("admClassSkillNodeDraft", JSON.stringify(draft))
    clearClassSkillPrerequisitePickerState(player)
    return draft
}

function getClassSkillNodeDraft(player) {
    if (!player.getTempdata().has("admClassSkillNodeDraft")) return null
    try {
        return JSON.parse(String(player.getTempdata().get("admClassSkillNodeDraft")))
    } catch (error) {
        return null
    }
}

function saveClassSkillNodeDraft(player, draft) {
    player.getTempdata().put("admClassSkillNodeDraft", JSON.stringify(draft))
}

function clearClassSkillPrerequisitePickerState(player) {
    var temp = player.getTempdata()
    var keys = [
        "admSkillPrerequisiteBackup",
        "admSkillPrerequisiteAvailableIds",
        "admSkillPrerequisiteSelectedIds",
        "admSkillPrerequisiteAvailableId",
        "admSkillPrerequisiteSelectedId",
        "admSkillPickerMode",
        "admSkillPickerDraftBackup"
    ]
    for (var i = 0; i < keys.length; i++) {
        if (temp.has(keys[i])) temp.remove(keys[i])
    }
}

function previousClassSkillNodes(player, draft) {
    var nodes = getClassSkillNodes(player)
    var limit = nodes.length
    if (draft.originalId) {
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === draft.originalId) {
                limit = i
                break
            }
        }
    }
    return nodes.slice(0, limit)
}

function classSkillPrerequisiteLabel(node) {
    return "§f" + shortGuiText(node.title || node.id, 24) + " §8[L" + Number(node.requiredLevel || 1) + "]"
}

function getClassSkillPickerMode(player) {
    var temp = player.getTempdata()
    return temp.has("admSkillPickerMode") ? String(temp.get("admSkillPickerMode")) : "prerequisites"
}

function getClassSkillPickerValues(draft, mode) {
    if (mode === "upgrade") return draft.upgradeFrom ? [draft.upgradeFrom] : []
    if (mode === "blocked") return (draft.blockedNodes || []).slice()
    return (draft.prerequisites || []).slice()
}

function setClassSkillPickerValues(draft, mode, values) {
    if (mode === "upgrade") {
        var previousUpgradeSource = String(draft.upgradeFrom || "")
        var nextUpgradeSource = values.length > 0 ? values[0] : ""
        if (previousUpgradeSource && previousUpgradeSource !== nextUpgradeSource) {
            draft.prerequisites = (draft.prerequisites || []).filter(function(id) { return id !== previousUpgradeSource })
        }
        draft.upgradeFrom = nextUpgradeSource
        if (!draft.upgradeFrom) draft.removeUpgradeSource = false
        else if (previousUpgradeSource !== nextUpgradeSource) draft.removeUpgradeSource = true
        if (draft.upgradeFrom && (draft.prerequisites || []).indexOf(draft.upgradeFrom) < 0) {
            draft.prerequisites.push(draft.upgradeFrom)
        }
    } else if (mode === "blocked") {
        draft.blockedNodes = values.slice()
    } else {
        draft.prerequisites = values.slice()
        if (draft.upgradeFrom && draft.prerequisites.indexOf(draft.upgradeFrom) < 0) {
            draft.upgradeFrom = ""
            draft.removeUpgradeSource = false
        }
    }
}

function beginClassSkillNodePicker(player, draft, mode) {
    var temp = player.getTempdata()
    clearClassSkillPrerequisitePickerState(player)
    temp.put("admSkillPickerMode", mode)
    temp.put("admSkillPrerequisiteBackup", JSON.stringify(getClassSkillPickerValues(draft, mode)))
    temp.put("admSkillPickerDraftBackup", JSON.stringify(draft))
    showClassSkillPrerequisiteGui(player)
}

function beginClassSkillPrerequisitePicker(player, draft) {
    beginClassSkillNodePicker(player, draft, "prerequisites")
}

function showClassSkillPrerequisiteGui(player) {
    var draft = getClassSkillNodeDraft(player)
    if (!draft) {
        showClassSkillTreeGui(player)
        return
    }
    var temp = player.getTempdata()
    var mode = getClassSkillPickerMode(player)
    var selectedIds = getClassSkillPickerValues(draft, mode)
    var candidates = mode === "blocked" ? getClassSkillNodes(player).slice() : previousClassSkillNodes(player, draft)
    var availableIds = []
    var availableLabels = []
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].id === draft.originalId || candidates[i].id === draft.id) continue
        if (selectedIds.indexOf(candidates[i].id) !== -1) continue
        availableIds.push(candidates[i].id)
        availableLabels.push(classSkillPrerequisiteLabel(candidates[i]))
    }
    var selectedLabels = []
    for (var selectedIndex = 0; selectedIndex < selectedIds.length; selectedIndex++) {
        var selectedNode = findClassSkillNode(player, selectedIds[selectedIndex])
        selectedLabels.push(selectedNode
            ? classSkillPrerequisiteLabel(selectedNode)
            : "§cMissing §8[" + selectedIds[selectedIndex] + "]")
    }
    temp.put("admSkillPrerequisiteAvailableIds", JSON.stringify(availableIds))
    temp.put("admSkillPrerequisiteSelectedIds", JSON.stringify(selectedIds))
    if (temp.has("admSkillPrerequisiteAvailableId")) temp.remove("admSkillPrerequisiteAvailableId")
    if (temp.has("admSkillPrerequisiteSelectedId")) temp.remove("admSkillPrerequisiteSelectedId")
    if (availableLabels.length === 0) availableLabels.push("(No nodes available)")
    if (selectedLabels.length === 0) selectedLabels.push(mode === "upgrade"
        ? "(No upgrade source)" : mode === "blocked" ? "(No exclusions)" : "(No prerequisites)")

    var title = mode === "upgrade" ? "SELECT UPGRADE SOURCE"
        : mode === "blocked" ? "SELECT MUTUALLY EXCLUSIVE NODES" : "SELECT PREREQUISITES"
    var selectedTitle = mode === "upgrade" ? "UPGRADES FROM"
        : mode === "blocked" ? "BLOCKED TOGETHER" : "REQUIRED FIRST"
    var gui = API.createCustomGui(CLASS_SKILL_PREREQ_GUI_ID, CLASS_SKILL_GUI_WIDTH, CLASS_SKILL_GUI_HEIGHT, false, player)
    addRpgFrame(gui, CLASS_SKILL_GUI_WIDTH, CLASS_SKILL_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 44, 204, 232, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 266, 44, 204, 232, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, "§6§l" + title, 112, 10, 270, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§8Choose nodes by title; IDs remain internal.", 132, 26, 240, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§b§lAVAILABLE", 22, 54, 180, 12)
    gui.addLabel(LAYER.CONTENT_LABELS + 3, "§6§l" + selectedTitle, 278, 54, 180, 12)
    gui.addScroll(CLASS_SKILL_IDS.SCROLL_PREREQ_AVAILABLE, 22, 72, 180, 190, availableLabels)
    gui.addScroll(CLASS_SKILL_IDS.SCROLL_PREREQ_SELECTED, 278, 72, 180, 190, selectedLabels)
    gui.addButton(CLASS_SKILL_IDS.BTN_PREREQ_ADD, "§a§l>", 220, 108, 40, 28).setEnabled(availableIds.length > 0 && (mode !== "upgrade" || selectedIds.length === 0))
    gui.addButton(CLASS_SKILL_IDS.BTN_PREREQ_REMOVE, "§c§l<", 220, 148, 40, 28).setEnabled(selectedIds.length > 0)
    gui.addButton(CLASS_SKILL_IDS.BTN_PREREQ_DONE, "§a§lDONE", 142, 292, 88, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_PREREQ_CANCEL, "§c§lCANCEL", 250, 292, 88, 20)
    showManagedGui(player, gui)
}

function getClassSkillItemMode(player) {
    var temp = player.getTempdata()
    if (!temp.has("admSkillItemMode")) return "learn"
    var mode = String(temp.get("admSkillItemMode"))
    return mode === "unlearn" || mode === "upgrade" ? mode : "learn"
}

function getClassSkillItemValue(draft, mode) {
    if (mode === "unlearn") return String(draft.unlearnItemSnbt || "")
    if (mode === "upgrade") {
        var upgradeIndex = draft && draft._upgradeItemIndex !== undefined ? Number(draft._upgradeItemIndex) : -1
        var upgradeRows = draft && draft.upgradeSchedule || []
        return upgradeIndex >= 0 && upgradeIndex < upgradeRows.length
            ? String(upgradeRows[upgradeIndex].requiredItemSnbt || "") : ""
    }
    return String(draft.requiredItemSnbt || "")
}

function setClassSkillItemValue(draft, mode, value) {
    if (mode === "unlearn") draft.unlearnItemSnbt = String(value || "")
    else if (mode === "upgrade") {
        var upgradeIndex = draft && draft._upgradeItemIndex !== undefined ? Number(draft._upgradeItemIndex) : -1
        if (!draft.upgradeSchedule) draft.upgradeSchedule = []
        if (upgradeIndex >= 0 && upgradeIndex < draft.upgradeSchedule.length) {
            draft.upgradeSchedule[upgradeIndex].requiredItemSnbt = String(value || "")
        }
    }
    else draft.requiredItemSnbt = String(value || "")
}

function getClassSkillItemConsume(draft, mode) {
    if (mode === "unlearn") return draft.consumeUnlearnItem !== false
    if (mode === "upgrade") {
        var upgradeIndex = draft && draft._upgradeItemIndex !== undefined ? Number(draft._upgradeItemIndex) : -1
        var upgradeRows = draft && draft.upgradeSchedule || []
        return upgradeIndex >= 0 && upgradeIndex < upgradeRows.length
            ? upgradeRows[upgradeIndex].consumeLearnItem !== false : true
    }
    return draft.consumeLearnItem !== false
}

function setClassSkillItemConsume(draft, mode, consume) {
    if (mode === "unlearn") draft.consumeUnlearnItem = consume !== false
    else if (mode === "upgrade") {
        var upgradeIndex = draft && draft._upgradeItemIndex !== undefined ? Number(draft._upgradeItemIndex) : -1
        if (!draft.upgradeSchedule) draft.upgradeSchedule = []
        if (upgradeIndex >= 0 && upgradeIndex < draft.upgradeSchedule.length) {
            draft.upgradeSchedule[upgradeIndex].consumeLearnItem = consume !== false
        }
    }
    else draft.consumeLearnItem = consume !== false
}

function beginClassSkillItemEditor(player, draft, mode, upgradeIndex) {
    mode = mode === "unlearn" || mode === "upgrade" ? mode : "learn"
    var temp = player.getTempdata()
    if (mode === "upgrade") {
        upgradeIndex = Number(upgradeIndex)
        if (!isFinite(upgradeIndex)) return false
        upgradeIndex = Math.floor(upgradeIndex)
        if (!draft.upgradeSchedule || upgradeIndex < 0 || upgradeIndex >= draft.upgradeSchedule.length) return false
        draft._upgradeItemIndex = upgradeIndex
    } else if (draft._upgradeItemIndex !== undefined) {
        delete draft._upgradeItemIndex
    }
    temp.put("admSkillItemMode", mode)
    if (mode === "upgrade") temp.put("admSkillUpgradeIndex", upgradeIndex)
    else if (temp.has("admSkillUpgradeIndex")) temp.remove("admSkillUpgradeIndex")
    saveClassSkillNodeDraft(player, draft)
    temp.put("admSkillItemBackup", getClassSkillItemValue(draft, mode))
    temp.put("admSkillItemConsumeBackup", getClassSkillItemConsume(draft, mode))
    showClassSkillItemGui(player)
    return true
}

function returnToClassSkillNodeEditor(player) {
    var temp = player.getTempdata()
    if (temp.has(CLASS_SKILL_HTML_EDITOR_KEY)) {
        temp.put("admSkillBookReturnAt", player.getWorld().getTotalTime() + 10)
        player.closeGui()
    } else {
        showClassSkillNodeGui(player)
    }
}

function reopenClassSkillHtmlEditorAfterNativeClose(player, gui) {
    var temp = player.getTempdata()
    if (!temp.has(CLASS_SKILL_HTML_EDITOR_KEY)) return false
    var guiId = gui.getID()
    var draft = getClassSkillNodeDraft(player)
    if (guiId === CLASS_SKILL_ITEM_GUI_ID && draft) {
        var hasItemBackup = temp.has("admSkillItemBackup") && temp.has("admSkillItemMode")
        if (hasItemBackup) {
            var itemMode = getClassSkillItemMode(player)
            if (itemMode === "upgrade" && temp.has("admSkillUpgradeIndex")) draft._upgradeItemIndex = Number(temp.get("admSkillUpgradeIndex"))
            setClassSkillItemValue(draft, itemMode, String(temp.get("admSkillItemBackup")))
            setClassSkillItemConsume(draft, itemMode,
                !temp.has("admSkillItemConsumeBackup") || String(temp.get("admSkillItemConsumeBackup")) !== "false")
        }
        if (draft._upgradeItemIndex !== undefined) delete draft._upgradeItemIndex
        saveClassSkillNodeDraft(player, draft)
    } else if (guiId === CLASS_SKILL_PREREQ_GUI_ID && temp.has("admSkillPickerDraftBackup")) {
        saveClassSkillNodeDraft(player, JSON.parse(String(temp.get("admSkillPickerDraftBackup"))))
    } else if (guiId === CLASS_SKILL_EFFECT_GUI_ID) {
        captureClassSkillEffectEditor(player, gui)
    }
    temp.remove("admSkillItemBackup")
    temp.remove("admSkillItemConsumeBackup")
    temp.remove("admSkillItemMode")
    temp.remove("admSkillUpgradeIndex")
    clearClassSkillPrerequisitePickerState(player)
    returnToClassSkillNodeEditor(player)
    return true
}

function showClassSkillItemGui(player) {
    var draft = getClassSkillNodeDraft(player)
    if (!draft) {
        showClassSkillTreeGui(player)
        return
    }
    var mode = getClassSkillItemMode(player)
    var isUnlearn = mode === "unlearn"
    if (mode === "upgrade" && player.getTempdata().has("admSkillUpgradeIndex")) {
        draft._upgradeItemIndex = Number(player.getTempdata().get("admSkillUpgradeIndex"))
    }
    var consume = getClassSkillItemConsume(draft, mode)
    var gui = API.createCustomGui(CLASS_SKILL_ITEM_GUI_ID, CLASS_SKILL_GUI_WIDTH, CLASS_SKILL_GUI_HEIGHT, false, player)
    addRpgFrame(gui, CLASS_SKILL_GUI_WIDTH, CLASS_SKILL_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 118, 224, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 136, 40, 334, 224, RPG_UI.cyan)
    gui.addLabel(LAYER.CONTENT_LABELS, isUnlearn ? "§e§lUNLEARN ITEM COST"
        : mode === "upgrade" ? "§d§lUPGRADE ITEM COST" : "§6§lREQUIRED ITEM COST", 156, 10, 200, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, isUnlearn
        ? "§7Place the exact item, count, and NBT required to unlearn."
        : mode === "upgrade" ? "§7Place the exact item, count, and NBT required for this rank."
        : "§7Place the exact item, count, and NBT required to learn.", 52, 26, 390, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§6§lCOST", 52, 58, 70, 12)
    var configured = createClassItemFromSnbt(player.getWorld(), getClassSkillItemValue(draft, mode))
    addRpgSlotFrame(gui, LAYER.CONTENT_BASE, 58, 82, RPG_UI.gold)
    if (configured) gui.addItemSlot(58, 82, configured)
    else gui.addItemSlot(58, 82)
    gui.addLabel(LAYER.CONTENT_LABELS + 3, "§8Empty = free", 34, 112, 84, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 4, "§b§lYOUR INVENTORY", 150, 58, 200, 12)
    addRpgInventorySlotFrames(gui, LAYER.CONTENT_BASE + 10, 150, 82, RPG_UI.chrome)
    gui.showPlayerInventory(150, 82)
    gui.addButton(CLASS_SKILL_IDS.BTN_ITEM_CONSUME, consume ? "§eCONSUME ITEM: ON" : "§aCONSUME ITEM: OFF",
        150, CLASS_SKILL_GUI_HEIGHT - 104, CLASS_SKILL_GUI_WIDTH - 168, 20)
    gui.addLabel(LAYER.CONTENT_LABELS + 5, consume ? "§7Required items are removed." : "§7Required items stay in the inventory.",
        150, CLASS_SKILL_GUI_HEIGHT - 80, CLASS_SKILL_GUI_WIDTH - 168, 10)
    gui.addButton(CLASS_SKILL_IDS.BTN_ITEM_SAVE, "§a§lSAVE COST", 112, 292, 92, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_ITEM_CLEAR, "§eCLEAR COST", 210, 292, 92, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_ITEM_CANCEL, "§c§lCANCEL", 308, 292, 72, 20)
    showManagedGui(player, gui)
}

function captureClassSkillItemCost(player, gui) {
    var draft = getClassSkillNodeDraft(player)
    if (!draft) return null
    var mode = getClassSkillItemMode(player)
    var slots = gui.getSlots()
    if (slots.size() > 0 && slots.get(0).hasStack() && slots.get(0).getStack() && !slots.get(0).getStack().isEmpty()) {
        setClassSkillItemValue(draft, mode, slots.get(0).getStack().getItemNbt().toJsonString())
    } else {
        setClassSkillItemValue(draft, mode, "")
    }
    saveClassSkillNodeDraft(player, draft)
    return draft
}

function getSelectedSkillEffectStatKey(player) {
    refreshStatKeys()
    var temp = player.getTempdata()
    var selected = temp.has("admSkillEffectSelected") ? normalizeStatKey(temp.get("admSkillEffectSelected")) : ""
    if (STAT_KEYS.indexOf(selected) < 0) selected = STAT_KEYS.length > 0 ? STAT_KEYS[0] : ""
    if (selected) temp.put("admSkillEffectSelected", selected)
    return selected
}

function captureClassSkillEffectEditor(player, gui) {
    var draft = getClassSkillNodeDraft(player)
    var statKey = getSelectedSkillEffectStatKey(player)
    if (!draft || !statKey) return draft
    if (!draft.statBonuses) draft.statBonuses = {}
    if (!draft.statMultiplierBonuses) draft.statMultiplierBonuses = {}
    if (!draft.statMultiplierOverrides) draft.statMultiplierOverrides = {}
    var bonusField = gui.getComponent(CLASS_SKILL_EFFECT_IDS.FIELD_BONUS)
    var effectivenessField = gui.getComponent(CLASS_SKILL_EFFECT_IDS.FIELD_EFFECTIVENESS)
    var bonus = bonusField ? Math.round(Number(bonusField.getText())) : Number(draft.statBonuses[statKey] || 0)
    var percentText = effectivenessField ? String(effectivenessField.getText()).trim() : ""
    var overrideEnabled = hasOwnStatValue(draft.statMultiplierOverrides, statKey)
        || hasOwnStatValue(draft.statMultiplierBonuses, statKey)
    var percent = percentText ? Number(percentText) : NaN
    if (isNaN(bonus)) bonus = 0
    bonus = Math.max(-10000, Math.min(10000, bonus))
    if (bonus === 0) delete draft.statBonuses[statKey]
    else draft.statBonuses[statKey] = bonus
    delete draft.statMultiplierBonuses[statKey]
    if (!overrideEnabled || isNaN(percent)) {
        delete draft.statMultiplierOverrides[statKey]
    } else {
        draft.statMultiplierOverrides[statKey] = Math.max(0, Math.min(1000, percent)) / 100
    }
    saveClassSkillNodeDraft(player, draft)
    return draft
}

function showClassSkillEffectGui(player) {
    var draft = getClassSkillNodeDraft(player)
    if (!draft) {
        showClassSkillTreeGui(player)
        return
    }
    if (!draft.statBonuses) draft.statBonuses = {}
    if (!draft.statMultiplierBonuses) draft.statMultiplierBonuses = {}
    if (!draft.statMultiplierOverrides) draft.statMultiplierOverrides = {}
    refreshStatKeys()
    var selectedKey = getSelectedSkillEffectStatKey(player)
    var labels = []
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var key = STAT_KEYS[i]
        var stat = ATTR_CONFIG.stats[key]
        var bonus = Number(draft.statBonuses[key] || 0)
        var multiplier = getClassSkillDraftStatMultiplier(player, draft, key)
        var inherited = !hasOwnStatValue(draft.statMultiplierOverrides, key)
            && !hasOwnStatValue(draft.statMultiplierBonuses, key)
        labels.push((stat.color || "§f") + stat.name + " §8• §f" + (bonus >= 0 ? "+" : "") + bonus
            + " pts §8• §f" + Math.round(multiplier * 100) + "%" + (inherited ? " §8(inherit)" : " §d(override)"))
    }
    if (labels.length === 0) labels.push("(No attributes configured)")
    var selected = selectedKey ? ATTR_CONFIG.stats[selectedKey] : null
    var gui = API.createCustomGui(CLASS_SKILL_EFFECT_GUI_ID, CLASS_EDIT_GUI_WIDTH, CLASS_EDIT_GUI_HEIGHT, false, player)
    addRpgFrame(gui, CLASS_EDIT_GUI_WIDTH, CLASS_EDIT_GUI_HEIGHT, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 192, 230, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 210, 40, 200, 230, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, "§b§lNODE ATTRIBUTE EFFECTS", 126, 10, 200, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7Optional effects applied while this node is learned.", 92, 26, 260, 10)
    var scroll = gui.addScroll(CLASS_SKILL_EFFECT_IDS.SCROLL_STATS, 18, 54, 176, 204, labels)
    if (selectedKey) scroll.setDefaultSelection(STAT_KEYS.indexOf(selectedKey))
    if (selected) {
        var overrideEnabled = hasOwnStatValue(draft.statMultiplierOverrides, selectedKey)
            || hasOwnStatValue(draft.statMultiplierBonuses, selectedKey)
        gui.addLabel(LAYER.CONTENT_LABELS + 2, (selected.color || "§f") + "§l" + selected.name, 224, 54, 172, 14)
        gui.addLabel(LAYER.CONTENT_LABELS + 3, "§7Attribute point bonus", 224, 86, 166, 10)
        gui.addTextField(CLASS_SKILL_EFFECT_IDS.FIELD_BONUS, 224, 100, 166, 20).setText("" + Number(draft.statBonuses[selectedKey] || 0))
        gui.addLabel(LAYER.CONTENT_LABELS + 4, "§7Final effectiveness override (%)", 224, 132, 166, 10)
        var effectivenessField = gui.addTextField(CLASS_SKILL_EFFECT_IDS.FIELD_EFFECTIVENESS, 224, 146, 166, 20)
        effectivenessField.setText("" + Math.round(getClassSkillDraftStatMultiplier(player, draft, selectedKey) * 10000) / 100)
        effectivenessField.setEnabled(overrideEnabled)
        gui.addButton(CLASS_SKILL_EFFECT_IDS.BTN_TOGGLE_OVERRIDE,
            overrideEnabled ? "§d§lOVERRIDE ON" : "§7INHERIT CLASS", 224, 172, 166, 20)
        gui.addLabel(LAYER.CONTENT_LABELS + 5, "§8The displayed class value is inherited until OVERRIDE is enabled. Literal 0 remains a real override.", 224, 198, 166, 28)
        gui.addButton(CLASS_SKILL_EFFECT_IDS.BTN_SAVE_STAT, "§a§lSAVE EFFECT", 224, 232, 82, 22)
        gui.addButton(CLASS_SKILL_EFFECT_IDS.BTN_RESET_STAT, "§cRESET", 312, 232, 78, 22)
    }
    gui.addButton(CLASS_SKILL_EFFECT_IDS.BTN_BACK, "§f§lBACK TO NODE", 142, 282, 136, 20)
    showManagedGui(player, gui)
}

function captureClassSkillNodeEditor(player, gui) {
    var draft = getClassSkillNodeDraft(player)
    if (!draft) return null
    var component = gui.getComponent(CLASS_SKILL_IDS.FIELD_TITLE)
    if (component) draft.title = String(component.getText()).trim()
    component = gui.getComponent(CLASS_SKILL_IDS.FIELD_REGISTRY)
    if (component) draft.registryId = String(component.getText()).trim().toLowerCase()
    component = gui.getComponent(CLASS_SKILL_IDS.FIELD_LEVEL)
    if (component) draft.requiredLevel = parseInt(component.getText())
    component = gui.getComponent(CLASS_SKILL_IDS.FIELD_RANK)
    if (component) draft.rank = parseInt(component.getText())
    saveClassSkillNodeDraft(player, draft)
    return draft
}

function classSkillHtmlNumberMap(source, multiplier) {
    refreshStatKeys()
    var clean = {}
    source = source && typeof source === "object" ? source : {}
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var key = STAT_KEYS[i]
        var value = Number(source[key] || 0)
        if (isNaN(value)) value = 0
        if (multiplier) value = Math.max(-10, Math.min(10, value))
        else value = Math.max(-10000, Math.min(10000, Math.round(value)))
        if (Math.abs(value) >= 0.0001) clean[key] = value
    }
    return clean
}

function classSkillHtmlOverrideMap(player, source) {
    refreshStatKeys()
    var clean = {}
    source = source && typeof source === "object" ? source : {}
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var key = STAT_KEYS[i]
        if (!hasOwnStatValue(source, key)) continue
        var value = Number(source[key])
        if (isNaN(value)) continue
        value = Math.max(0, Math.min(10, value))
        clean[key] = value
    }
    return clean
}

function classSkillDraftFromHtml(player, value) {
    value = value && typeof value === "object" ? value : {}
    var originalId = String(value.originalId || value.id || "")
    var currentDraft = getClassSkillNodeDraft(player)
    var draft = currentDraft && String(currentDraft.originalId || "") === originalId
        ? currentDraft : startClassSkillNodeDraft(player, originalId)
    draft.originalId = findClassSkillNode(player, originalId) ? originalId : ""
    draft.id = draft.originalId
    draft.title = String(value.title || "").trim()
    if (value.hasOwnProperty("description")) draft.description = value.description === null ? "" : value.description
    draft.type = String(value.type || "IRON_SPELL")
    if (["IRON_SPELL", "EPIC_FIGHT", "MILESTONE"].indexOf(draft.type) < 0) draft.type = "IRON_SPELL"
    draft.statNode = draft.type === "MILESTONE" && (value.hasOwnProperty("statNode") ? value.statNode === true : draft.statNode === true)
    draft.statIconIndex = normalizeStatIconIndex(value.statIconIndex === undefined ? draft.statIconIndex : value.statIconIndex)
    draft.registryId = draft.type === "MILESTONE" ? "" : String(value.registryId || "").trim().toLowerCase()
    draft.requiredLevel = parseInt(value.requiredLevel)
    draft.rank = draft.type === "IRON_SPELL" ? parseInt(value.rank) : 1
    draft.epicSlot = draft.type === "EPIC_FIGHT" ? String(value.epicSlot || "") : ""
    draft.prelearned = value.prelearned === true
    draft.learnedWithNode = String(value.learnedWithNode || "").trim()
    draft.choiceGroupId = String(value.choiceGroupId || "").trim()
    if (draft.statNode) draft.choiceGroupId = ""
    draft.editorGroup = normalizeSkillEditorFolder(value.editorGroup || draft.editorGroup || "Core")
    draft.rankSeriesId = String(value.rankSeriesId || "").trim()
    if (value.hasOwnProperty("upgradeSchedule")) draft.upgradeSchedule = normalizeClassSkillUpgradeSchedule(value.upgradeSchedule)
    else draft.upgradeSchedule = classSkillUpgradeSchedule(draft)
    if (!supportsClassSkillUpgradeSchedule(draft)) draft.upgradeSchedule = []
    draft.managedUpgradeSchedule = value.managedUpgradeSchedule === true
        || draft.upgradeSchedule.length > 0
    if (draft.managedUpgradeSchedule) draft.rankSeriesId = ""
    draft.prerequisiteMode = String(value.prerequisiteMode || "ALL").toUpperCase() === "ANY" ? "ANY" : "ALL"
    if (Array.isArray(value.prerequisites)) draft.prerequisites = value.prerequisites.slice(0, 16)
    draft.prerequisiteRanks = normalizePrerequisiteRanks(value.prerequisiteRanks || draft.prerequisiteRanks, draft.prerequisites)
    if (Array.isArray(value.blockedNodes)) draft.blockedNodes = value.blockedNodes.slice(0, 512)
    draft.upgradeFrom = String(value.upgradeFrom || draft.upgradeFrom || "").trim()
    if (draft.learnedWithNode) {
        draft.prelearned = false
        draft.requiredLevel = 1
        draft.requiredItemSnbt = ""
        draft.canUnlearn = false
        draft.unlearnItemSnbt = ""
        draft.upgradeFrom = ""
        draft.removeUpgradeSource = false
        if (draft.prerequisites.indexOf(draft.learnedWithNode) < 0) draft.prerequisites.push(draft.learnedWithNode)
    }
    draft.canUnlearn = !draft.prelearned && !draft.learnedWithNode && value.canUnlearn === true
    if (!draft.canUnlearn) draft.unlearnItemSnbt = ""
    draft.removeUpgradeSource = !draft.prelearned && !!draft.upgradeFrom
        && value.removeUpgradeSource === true
    draft.requiredItemSnbt = String(value.hasOwnProperty("requiredItemSnbt") ? value.requiredItemSnbt || "" : draft.requiredItemSnbt || "")
    draft.spiritCost = normalizeWholeResource(value.hasOwnProperty("spiritCost") ? value.spiritCost : draft.spiritCost, 0, SPIRIT_MAX_SAFE_INTEGER)
    draft.grantedPermissions = normalizeSkillPermissionList(value.hasOwnProperty("grantedPermissions")
        ? value.grantedPermissions : (value.hasOwnProperty("permissionGrants") ? value.permissionGrants : draft.grantedPermissions))
    if (draft.prelearned || draft.learnedWithNode) draft.spiritCost = 0
    draft.unlearnItemSnbt = draft.canUnlearn ? String(value.hasOwnProperty("unlearnItemSnbt") ? value.unlearnItemSnbt || "" : draft.unlearnItemSnbt || "") : ""
    if (value.hasOwnProperty("consumeLearnItem")) draft.consumeLearnItem = value.consumeLearnItem !== false
    if (value.hasOwnProperty("consumeUnlearnItem")) draft.consumeUnlearnItem = value.consumeUnlearnItem !== false
    draft.visibilityBeforeRequirements = normalizeSkillVisibility(value.visibilityBeforeRequirements, "OBFUSCATE")
    draft.visibilityWhenReady = normalizeSkillVisibility(value.visibilityWhenReady, "SHOW")
    draft.visibilityWhenLearned = normalizeSkillVisibility(value.visibilityWhenLearned, "SHOW")
    draft.visibilityRules = normalizeSkillVisibilityRules(value.visibilityRules)
    draft.statBonuses = classSkillHtmlNumberMap(value.statBonuses, false)
    if (value.hasOwnProperty("statMultiplierBonuses")) {
        draft.statMultiplierBonuses = classSkillHtmlNumberMap(value.statMultiplierBonuses, true)
        if (value.hasOwnProperty("statMultiplierOverrides")) draft.statMultiplierOverrides = classSkillHtmlOverrideMap(player, value.statMultiplierOverrides)
        if (!draft.statMultiplierOverrides) draft.statMultiplierOverrides = {}
    } else if (value.hasOwnProperty("statMultiplierOverrides")) {
        draft.statMultiplierBonuses = {}
        draft.statMultiplierOverrides = classSkillHtmlOverrideMap(player, value.statMultiplierOverrides)
    }
    saveClassSkillNodeDraft(player, draft)
    return draft
}

function classSkillNodeDraftError(draft) {
    if (draft.spiritCost === undefined || draft.spiritCost === null) draft.spiritCost = 0
    if (draft.grantedPermissions === undefined || draft.grantedPermissions === null) draft.grantedPermissions = []
    if (draft.description !== undefined && draft.description !== null && typeof draft.description !== "string") return "Description must be plain text."
    if (String(draft.description || "").length > 16384) return "Description must be at most 16384 characters."
    if (!draft.title || (draft.type !== "MILESTONE" && !draft.registryId)) {
        return "A title is required, and skill nodes need a premade skill selection."
    }
    if (isNaN(draft.requiredLevel) || draft.requiredLevel < 1 || (draft.type !== "MILESTONE" && (isNaN(draft.rank) || draft.rank < 1))) {
        return "Level and rank must be positive numbers."
    }
    if (isNaN(draft.spiritCost) || draft.spiritCost < 0 || draft.spiritCost > SPIRIT_MAX_SAFE_INTEGER || Math.floor(draft.spiritCost) !== draft.spiritCost) {
        return "Spirit cost must be a whole number from 0 to 9007199254740991."
    }
    if (!Array.isArray(draft.grantedPermissions)) return "Granted permissions must be a list."
    return ""
}

function validateLearnedWithNodeLinks(nodes) {
    var byId = {}
    var links = {}
    for (var i = 0; i < nodes.length; i++) byId[nodes[i].id] = nodes[i]
    for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
        var node = nodes[nodeIndex]
        var sourceId = String(node.learnedWithNode || "")
        if (!sourceId) continue
        if (sourceId === node.id) return "A node cannot be learned with itself."
        if (!byId[sourceId]) return "Learned with node must reference an existing node."
        if ((node.prerequisites || []).indexOf(sourceId) < 0) return "Learned with node must also be a prerequisite."
        links[node.id] = sourceId
    }
    for (var start in links) {
        var seen = {}
        var current = start
        while (links[current]) {
            if (seen[current]) return "Learned with node links cannot form a cycle."
            seen[current] = true
            current = links[current]
        }
    }
    return ""
}

function getSkillCatalog(player, draft) {
    if (draft.type === "MILESTONE") return { ok: true, message: "No catalog needed", entries: [], total: 0 }
    return callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.catalog(player.getMCEntity(), draft.type, "", 0)
    })
}

function classSkillCatalogCategory(category) {
    var value = String(category || "")
    var separator = value.lastIndexOf(":")
    if (separator >= 0) value = value.substring(separator + 1)
    return value.replace(/_/g, " ").toUpperCase()
}

function showClassSkillNodeGui(player) {
    var draft = getClassSkillNodeDraft(player)
    if (!draft) draft = startClassSkillNodeDraft(player, "")
    var catalog = getSkillCatalog(player, draft)
    if (!catalog.ok) catalog = { ok: false, message: catalog.message, entries: [], total: 0 }
    var gui = API.createCustomGui(CLASS_SKILL_NODE_GUI_ID, CLASS_SKILL_GUI_WIDTH, CLASS_SKILL_GUI_HEIGHT, false, player)
    var accent = draft.type === "EPIC_FIGHT" ? RPG_UI.red : draft.type === "MILESTONE" ? RPG_UI.gold : RPG_UI.cyan
    addRpgFrame(gui, CLASS_SKILL_GUI_WIDTH, CLASS_SKILL_GUI_HEIGHT, accent)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 270, 236, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 288, 40, 182, 236, accent)
    gui.addLabel(LAYER.CONTENT_LABELS, draft.originalId ? "§e§lEDIT SKILL NODE" : "§a§lNEW SKILL NODE", 160, 10, 180, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7Title", 18, 48, 80, 10)
    gui.addTextField(CLASS_SKILL_IDS.FIELD_TITLE, 104, 44, 162, 20).setText(draft.title || "")
    gui.addLabel(LAYER.CONTENT_LABELS + 3, "§7Required Level", 18, 100, 84, 10)
    gui.addTextField(CLASS_SKILL_IDS.FIELD_LEVEL, 104, 96, 54, 20).setText("" + (draft.requiredLevel || 1))
    if (draft.type === "EPIC_FIGHT") {
        gui.addLabel(LAYER.CONTENT_LABELS + 4, "§7Epic Slot", 174, 100, 42, 10)
        gui.addButton(CLASS_SKILL_IDS.BTN_EPIC_SLOT, "§c" + (draft.epicSlot || "Select"), 216, 96, 50, 20)
    } else if (draft.type === "IRON_SPELL") {
        gui.addLabel(LAYER.CONTENT_LABELS + 4, "§7Spell Rank", 166, 100, 50, 10)
        gui.addTextField(CLASS_SKILL_IDS.FIELD_RANK, 216, 96, 50, 20).setText("" + (draft.rank || 1))
    } else {
        gui.addLabel(LAYER.CONTENT_LABELS + 4, "§6Route / empty node", 174, 100, 92, 10)
    }
    gui.addButton(CLASS_SKILL_IDS.BTN_IRON, draft.type === "IRON_SPELL" ? "§b§lSPELL" : "§7SPELL", 18, 122, 76, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_EPIC, draft.type === "EPIC_FIGHT" ? "§c§lEPIC" : "§7EPIC", 102, 122, 76, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_MILESTONE, draft.type === "MILESTONE" ? "§6§lMILESTONE" : "§7MILESTONE", 186, 122, 80, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_PREREQUISITES, "§6REQUIRES §f" + (draft.prerequisites || []).length, 18, 148, 120, 20)
        .setEnabled(!draft.prelearned)
    gui.addButton(CLASS_SKILL_IDS.BTN_PRELEARNED, draft.prelearned ? "§a§lPRELEARNED" : "§7PRELEARNED", 146, 148, 120, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_UPGRADE, draft.upgradeFrom ? "§dUPGRADES §f1" : "§7UPGRADE SOURCE", 18, 174, 120, 20)
        .setEnabled(!draft.prelearned)
    gui.addButton(CLASS_SKILL_IDS.BTN_BLOCKED, "§cEXCLUDES §f" + (draft.blockedNodes || []).length, 146, 174, 120, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_ITEM_COST, draft.requiredItemSnbt ? "§eITEM COST §aSET" : "§7ITEM COST §8FREE", 18, 200, 120, 20)
        .setEnabled(!draft.prelearned)
    var effectCount = countClassSkillNodeEffects(draft)
    gui.addButton(CLASS_SKILL_IDS.BTN_EFFECTS, "§bSTAT EFFECTS §f" + effectCount, 146, 200, 120, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_CAN_UNLEARN, draft.canUnlearn ? "§a§lCAN UNLEARN" : "§7CAN UNLEARN", 18, 226, 120, 20)
        .setEnabled(!draft.prelearned)
    if (draft.canUnlearn && !draft.prelearned) {
        gui.addButton(CLASS_SKILL_IDS.BTN_UNLEARN_COST, draft.unlearnItemSnbt ? "§eUNLEARN COST §aSET" : "§7UNLEARN COST §8FREE", 146, 226, 120, 20)
    }
    gui.addButton(CLASS_SKILL_IDS.BTN_REPLACE_UPGRADE,
        draft.removeUpgradeSource ? "§d§lREPLACES SOURCE" : "§7KEEP UPGRADE SOURCE",
        82, 252, 184, 20).setEnabled(!draft.prelearned && !!draft.upgradeFrom)

    if (draft.type === "MILESTONE") {
        player.getTempdata().put("admSkillCatalogEntries", "[]")
        gui.addLabel(LAYER.CONTENT_LABELS + 8, "§6§lMILESTONE NODE", 316, 54, 140, 12)
        gui.addLabel(LAYER.CONTENT_LABELS + 9, "§7Grants no spell or Epic Fight skill.", 304, 82, 150, 28)
        gui.addLabel(LAYER.CONTENT_LABELS + 10, "§7Use it as an empty tier, route choice, blocker, upgrade gate, or stat-effect node.", 304, 122, 150, 74)
        gui.addLabel(LAYER.CONTENT_LABELS + 11, draft.prelearned ? "§aGranted with class" : "§eLearned normally", 304, 220, 150, 12)
    } else {
        gui.addLabel(LAYER.CONTENT_LABELS + 8, draft.type === "EPIC_FIGHT"
            ? "§c§lEPIC FIGHT CATALOG" : "§b§lIRON SPELL CATALOG", 300, 48, 158, 10)
        var names = []
        var catalogIds = []
        for (var i = 0; i < catalog.entries.length; i++) {
            var entry = catalog.entries[i]
            var category = classSkillCatalogCategory(entry.category)
            names.push("§f" + shortGuiText(entry.displayName, 24) + (category ? " §8[" + category + "]" : ""))
            catalogIds.push(entry.registryId)
        }
        if (names.length === 0) names.push(catalog.ok ? "(No matches)" : "(Integration unavailable)")
        player.getTempdata().put("admSkillCatalogEntries", JSON.stringify(catalog.entries || []))
        var catalogScroll = gui.addScroll(CLASS_SKILL_IDS.SCROLL_CATALOG, 300, 64, 158, 196, names)
        var selectedIndex = catalogIds.indexOf(draft.registryId)
        if (selectedIndex >= 0) catalogScroll.setDefaultSelection(selectedIndex)
        gui.addLabel(LAYER.CONTENT_LABELS + 9, catalog.ok ? "§7" + catalog.total + " skills" : "§c" + shortGuiText(catalog.message, 27), 300, 264, 158, 10)
    }
    gui.addButton(CLASS_SKILL_IDS.BTN_SAVE, "§a§lSAVE NODE", 116, 292, 100, 20)
    gui.addButton(CLASS_SKILL_IDS.BTN_CANCEL, "§c§lCANCEL", 228, 292, 88, 20)
    showManagedGui(player, gui)
}

function saveClassSkillNode(player, gui) {
    var draft = captureClassSkillNodeEditor(player, gui)
    if (!draft) return false
    return commitClassSkillNodeDraft(player, draft)
}

function commitClassSkillNodeDraft(player, draft) {
    var originalNode = draft.originalId ? findClassSkillNode(player, draft.originalId) : null
    var draftError = classSkillNodeDraftError(draft)
    if (draftError) {
        player.message("§c[Skills] " + draftError)
        return false
    }
    if (!draft.id) draft.id = createUniqueClassSkillNodeId(player, draft.title, draft.originalId)
    if (!draft.id.match(/^[a-z0-9_.-]{1,64}$/)) {
        player.message("§c[Skills] Node ID must use lowercase letters, digits, '.', '_' or '-'.")
        return false
    }
    if (draft.type === "EPIC_FIGHT") {
        var entry = findEpicCatalogEntry(player, draft.registryId)
        if (!entry || entry.assignable !== true) {
            player.message("§c[Skills] " + String(entry && entry.unavailableReason || "Select an available player skill from the catalog."))
            return false
        }
        if (!draft.epicSlot) draft.epicSlot = defaultEpicSlotForCatalogEntry(entry)
        if (!entry.compatibleSlots || entry.compatibleSlots.indexOf(draft.epicSlot) < 0) {
            player.message("§c[Skills] This skill cannot use the selected Epic Fight slot.")
            return false
        }
    }
    if (draft.type !== "EPIC_FIGHT") draft.epicSlot = ""
    if (draft.type === "MILESTONE") {
        draft.registryId = ""
        draft.rank = 1
        draft.statNode = draft.statNode === true
        draft.statIconIndex = normalizeStatIconIndex(draft.statIconIndex)
        if (draft.statNode) draft.choiceGroupId = ""
    } else {
        draft.statNode = false
        draft.statIconIndex = 0
    }
    if (!supportsClassSkillUpgradeSchedule(draft)) draft.upgradeSchedule = []
    if (draft.prelearned) {
        draft.prerequisites = []
        draft.requiredItemSnbt = ""
        draft.upgradeFrom = ""
        draft.removeUpgradeSource = false
        draft.canUnlearn = false
        draft.unlearnItemSnbt = ""
    }
    if (draft.learnedWithNode) {
        draft.prelearned = false
        draft.requiredLevel = 1
        draft.requiredItemSnbt = ""
        draft.canUnlearn = false
        draft.unlearnItemSnbt = ""
        draft.upgradeFrom = ""
        draft.removeUpgradeSource = false
        if ((draft.prerequisites || []).indexOf(draft.learnedWithNode) < 0) draft.prerequisites.push(draft.learnedWithNode)
    }
    draft.spiritCost = (draft.prelearned || draft.learnedWithNode)
        ? 0 : normalizeWholeResource(draft.spiritCost, 0, SPIRIT_MAX_SAFE_INTEGER)
    draft.grantedPermissions = normalizeSkillPermissionList(draft.grantedPermissions)
    if (draft.upgradeFrom && (draft.prerequisites || []).indexOf(draft.upgradeFrom) < 0) draft.prerequisites.push(draft.upgradeFrom)
    if (!draft.upgradeFrom) draft.removeUpgradeSource = false
    var savedNode = {
        id: draft.id,
        title: draft.title,
        description: String(draft.description || ""),
        type: draft.type,
        statNode: draft.statNode === true,
        statIconIndex: normalizeStatIconIndex(draft.statIconIndex),
        registryId: draft.registryId,
        requiredLevel: draft.requiredLevel,
        rank: draft.rank,
        prerequisites: (draft.prerequisites || []).slice(),
        prerequisiteRanks: normalizePrerequisiteRanks(draft.prerequisiteRanks, draft.prerequisites),
        epicSlot: draft.epicSlot,
        prelearned: draft.prelearned === true,
        learnedWithNode: String(draft.learnedWithNode || ""),
        choiceGroupId: String(draft.choiceGroupId || ""),
        editorGroup: String(draft.editorGroup || "Core"),
        rankSeriesId: classSkillUpgradeSchedule(draft).length ? "" : String(draft.rankSeriesId || ""),
        upgradeSchedule: classSkillUpgradeSchedule(draft),
        managedUpgradeSchedule: supportsClassSkillUpgradeSchedule(draft)
            && (draft.managedUpgradeSchedule === true || classSkillUpgradeSchedule(draft).length > 0),
        prerequisiteMode: String(draft.prerequisiteMode || "ALL").toUpperCase() === "ANY" ? "ANY" : "ALL",
        requiredItemSnbt: String(draft.requiredItemSnbt || ""),
        spiritCost: draft.spiritCost,
        grantedPermissions: draft.grantedPermissions.slice(),
        consumeLearnItem: draft.consumeLearnItem !== false,
        upgradeFrom: String(draft.upgradeFrom || ""),
        removeUpgradeSource: draft.removeUpgradeSource === true && !!draft.upgradeFrom,
        blockedNodes: (draft.blockedNodes || []).slice(),
        canUnlearn: draft.canUnlearn === true && draft.prelearned !== true,
        unlearnItemSnbt: draft.canUnlearn === true && draft.prelearned !== true ? String(draft.unlearnItemSnbt || "") : "",
        consumeUnlearnItem: draft.consumeUnlearnItem !== false,
        visibilityBeforeRequirements: normalizeSkillVisibility(draft.visibilityBeforeRequirements, "OBFUSCATE"),
        visibilityWhenReady: normalizeSkillVisibility(draft.visibilityWhenReady, "SHOW"),
        visibilityWhenLearned: normalizeSkillVisibility(draft.visibilityWhenLearned, "SHOW"),
        visibilityRules: normalizeSkillVisibilityRules(draft.visibilityRules),
        statBonuses: JSON.parse(JSON.stringify(draft.statBonuses || {})),
        statMultiplierBonuses: JSON.parse(JSON.stringify(draft.statMultiplierBonuses || {})),
        statMultiplierOverrides: JSON.parse(JSON.stringify(draft.statMultiplierOverrides || {}))
    }
    if (isClassSkillTreeCoordinate(draft.treeX) && isClassSkillTreeCoordinate(draft.treeY)) {
        savedNode.treeX = Number(draft.treeX)
        savedNode.treeY = Number(draft.treeY)
    }
    var classDraft = getClassDraft(player)
    if (!classDraft) {
        player.message("§c[Skills] The class draft is no longer available. Reopen the class editor.")
        return false
    }
    if (!classDraft.skillNodes) classDraft.skillNodes = []
    var candidateNodes = JSON.parse(JSON.stringify(classDraft.skillNodes))
    var candidateFound = false
    for (var candidateIndex = 0; candidateIndex < candidateNodes.length; candidateIndex++) {
        if (candidateNodes[candidateIndex].id === draft.originalId) {
            candidateNodes[candidateIndex] = savedNode
            candidateFound = true
            break
        }
    }
    if (!candidateFound) candidateNodes.push(savedNode)
    var scheduleError = validateClassSkillUpgradeSchedules(player, candidateNodes)
    if (scheduleError) {
        player.message("§c[Skills] " + scheduleError)
        return false
    }
    var replaced = false
    for (var i = 0; i < classDraft.skillNodes.length; i++) {
        var node = classDraft.skillNodes[i]
        if (node.id === draft.id && node.id !== draft.originalId) {
            player.message("§c[Skills] A node already uses ID §e" + draft.id)
            return false
        }
        if (node.id === draft.originalId) {
            classDraft.skillNodes[i] = savedNode
            replaced = true
        }
    }
    if (!replaced) classDraft.skillNodes.push(savedNode)
    assignDefaultClassSkillNodePosition(classDraft, savedNode)
    if (draft.originalId && draft.originalId !== draft.id) {
        for (var nodeIndex = 0; nodeIndex < classDraft.skillNodes.length; nodeIndex++) {
            var prerequisites = classDraft.skillNodes[nodeIndex].prerequisites || []
            for (var prerequisiteIndex = 0; prerequisiteIndex < prerequisites.length; prerequisiteIndex++) {
                if (prerequisites[prerequisiteIndex] === draft.originalId) prerequisites[prerequisiteIndex] = draft.id
            }
            var blocked = classDraft.skillNodes[nodeIndex].blockedNodes || []
            for (var blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
                if (blocked[blockedIndex] === draft.originalId) blocked[blockedIndex] = draft.id
            }
            if (classDraft.skillNodes[nodeIndex].upgradeFrom === draft.originalId) classDraft.skillNodes[nodeIndex].upgradeFrom = draft.id
            if (classDraft.skillNodes[nodeIndex].learnedWithNode === draft.originalId) classDraft.skillNodes[nodeIndex].learnedWithNode = draft.id
            var visibilityRules = normalizeSkillVisibilityRules(classDraft.skillNodes[nodeIndex].visibilityRules)
            for (var visibilityIndex = 0; visibilityIndex < visibilityRules.length; visibilityIndex++) {
                if (visibilityRules[visibilityIndex].nodeId === draft.originalId) visibilityRules[visibilityIndex].nodeId = draft.id
            }
            classDraft.skillNodes[nodeIndex].visibilityRules = visibilityRules
        }
    }
    var learnedWithError = validateLearnedWithNodeLinks(classDraft.skillNodes)
    if (learnedWithError) {
        for (var restoreIndex = 0; restoreIndex < classDraft.skillNodes.length; restoreIndex++) {
            if (classDraft.skillNodes[restoreIndex].id === savedNode.id) {
                if (replaced) classDraft.skillNodes[restoreIndex] = originalNode
                else classDraft.skillNodes.splice(restoreIndex, 1)
                break
            }
        }
        player.message("§c[Skills] " + learnedWithError)
        return false
    }
    saveClassDraft(player, classDraft)
    player.getTempdata().put("admSelectedClassSkillId", draft.id)
    player.getTempdata().remove("admClassSkillNodeDraft")
    if (player.getTempdata().has(CLASS_SKILL_HTML_EDITOR_KEY)) player.getTempdata().remove(CLASS_SKILL_HTML_EDITOR_KEY)
    clearClassSkillPrerequisitePickerState(player)
    return true
}

function deleteClassSkillNode(player, nodeId) {
    var classDraft = getClassDraft(player)
    if (!classDraft || !findClassSkillNode(player, nodeId)) return false
    for (var linkedIndex = 0; linkedIndex < classDraft.skillNodes.length; linkedIndex++) {
        if (String(classDraft.skillNodes[linkedIndex].learnedWithNode || "") === nodeId) {
            player.message("§c[Skills] Clear Learned with node on " + classDraft.skillNodes[linkedIndex].title + " before deleting this source node.")
            return false
        }
    }
    classDraft.skillNodes = classDraft.skillNodes.filter(function(node) { return node.id !== nodeId })
    for (var i = 0; i < classDraft.skillNodes.length; i++) {
        classDraft.skillNodes[i].prerequisites = (classDraft.skillNodes[i].prerequisites || []).filter(function(id) { return id !== nodeId })
        classDraft.skillNodes[i].blockedNodes = (classDraft.skillNodes[i].blockedNodes || []).filter(function(id) { return id !== nodeId })
        if (classDraft.skillNodes[i].upgradeFrom === nodeId) {
            classDraft.skillNodes[i].upgradeFrom = ""
            classDraft.skillNodes[i].removeUpgradeSource = false
        }
        classDraft.skillNodes[i].visibilityRules = normalizeSkillVisibilityRules(classDraft.skillNodes[i].visibilityRules).filter(function(rule) { return rule.nodeId !== nodeId })
    }
    saveClassDraft(player, classDraft)
    player.getTempdata().remove("admSelectedClassSkillId")
    return true
}

function classSkillNodeDependsOn(player, nodeId, requiredId, visited) {
    if (nodeId === requiredId) return true
    if (visited[nodeId]) return false
    visited[nodeId] = true
    var node = findClassSkillNode(player, nodeId)
    if (!node) return false
    var prerequisites = node.prerequisites || []
    for (var i = 0; i < prerequisites.length; i++) {
        if (classSkillNodeDependsOn(player, prerequisites[i], requiredId, visited)) return true
    }
    return false
}

function removeClassSkillGraphRelation(left, right) {
    left.prerequisites = (left.prerequisites || []).filter(function(id) { return id !== right.id })
    right.prerequisites = (right.prerequisites || []).filter(function(id) { return id !== left.id })
    left.blockedNodes = (left.blockedNodes || []).filter(function(id) { return id !== right.id })
    right.blockedNodes = (right.blockedNodes || []).filter(function(id) { return id !== left.id })
    if (left.upgradeFrom === right.id) {
        left.upgradeFrom = ""
        left.removeUpgradeSource = false
    }
    if (right.upgradeFrom === left.id) {
        right.upgradeFrom = ""
        right.removeUpgradeSource = false
    }
}

function connectClassSkillGraphNodes(player, mode, sourceId, targetId) {
    var classDraft = getClassDraft(player)
    var source = findClassSkillNodeInDraft(classDraft, sourceId)
    var target = findClassSkillNodeInDraft(classDraft, targetId)
    if (!source || !target) return { ok: false, message: "One of those nodes no longer exists." }
    if (source.id === target.id) return { ok: false, message: "A node cannot connect to itself." }
    if (mode === "remove") {
        removeClassSkillGraphRelation(source, target)
        saveClassDraft(player, classDraft)
        return { ok: true, message: "Removed links between " + source.title + " and " + target.title + "." }
    }
    if (mode === "exclude") {
        if (source.prelearned && target.prelearned) return { ok: false, message: "Two prelearned nodes cannot exclude each other." }
        if (classSkillNodeDependsOn(player, source.id, target.id, {}) || classSkillNodeDependsOn(player, target.id, source.id, {})) {
            return { ok: false, message: "A node cannot exclude one of its prerequisites or dependents." }
        }
        if (!source.blockedNodes) source.blockedNodes = []
        if (!target.blockedNodes) target.blockedNodes = []
        if (source.blockedNodes.indexOf(target.id) === -1) source.blockedNodes.push(target.id)
        if (target.blockedNodes.indexOf(source.id) === -1) target.blockedNodes.push(source.id)
        saveClassDraft(player, classDraft)
        return { ok: true, message: source.title + " and " + target.title + " are now mutually exclusive." }
    }
    if (mode !== "require" && mode !== "upgrade") return { ok: false, message: "Unknown connection type." }
    if (target.prelearned) return { ok: false, message: "Prelearned nodes cannot require another node." }
    if (Number(source.requiredLevel || 1) > Number(target.requiredLevel || 1)) {
        return { ok: false, message: "A prerequisite cannot unlock after its dependent node." }
    }
    if (classSkillNodeDependsOn(player, source.id, target.id, {})) {
        return { ok: false, message: "That connection would create a cycle." }
    }
    if ((source.blockedNodes || []).indexOf(target.id) >= 0 || (target.blockedNodes || []).indexOf(source.id) >= 0) {
        return { ok: false, message: "Remove the exclusion between these nodes before connecting their path." }
    }
    if (mode === "upgrade" && target.upgradeFrom && target.upgradeFrom !== source.id) {
        var previousUpgradeSource = target.upgradeFrom
        target.prerequisites = (target.prerequisites || []).filter(function(id) { return id !== previousUpgradeSource })
    }
    if (!target.prerequisites) target.prerequisites = []
    if (target.prerequisites.indexOf(source.id) === -1) {
        if (target.prerequisites.length >= 16) return { ok: false, message: "A node may have at most 16 prerequisites." }
        target.prerequisites.push(source.id)
    }
    if (mode === "upgrade") {
        if (target.upgradeFrom !== source.id) target.removeUpgradeSource = true
        target.upgradeFrom = source.id
    }
    saveClassDraft(player, classDraft)
    return {
        ok: true,
        message: mode === "upgrade"
            ? target.title + (target.removeUpgradeSource ? " replaces " : " upgrades from and keeps ") + source.title + "."
            : target.title + " now requires " + source.title + "."
    }
}

function assignDefaultClassSkillNodePosition(classDraft, node) {
    if (!classDraft || !node || (isClassSkillTreeCoordinate(node.treeX) && isClassSkillTreeCoordinate(node.treeY))) return
    var nodes = classDraft.skillNodes || []
    var parentX = 0
    var parentY = -94
    var parentCount = 0
    for (var i = 0; i < (node.prerequisites || []).length; i++) {
        var parent = findClassSkillNodeInDraft(classDraft, node.prerequisites[i])
        if (!parent || !isClassSkillTreeCoordinate(parent.treeX) || !isClassSkillTreeCoordinate(parent.treeY)) continue
        parentX += Number(parent.treeX)
        parentY = Math.max(parentY, Number(parent.treeY))
        parentCount++
    }
    var levels = []
    for (var levelIndex = 0; levelIndex < nodes.length; levelIndex++) levels.push(Number(nodes[levelIndex].requiredLevel || 1))
    levels.sort(function(left, right) { return left - right })
    levels = levels.filter(function(value, index) { return index === 0 || value !== levels[index - 1] })
    var desiredX = parentCount > 0 ? Math.round(parentX / parentCount) : 281
    var desiredY = parentCount > 0 ? Math.round(parentY + 176)
        : 82 + Math.max(0, levels.indexOf(Number(node.requiredLevel || 1))) * 176
    var offsets = [0]
    for (var offsetIndex = 1; offsetIndex <= nodes.length; offsetIndex++) {
        offsets.push(offsetIndex * 244)
        offsets.push(-offsetIndex * 244)
    }
    for (var candidateIndex = 0; candidateIndex < offsets.length; candidateIndex++) {
        var candidateX = desiredX + offsets[candidateIndex]
        var occupied = false
        for (var existingIndex = 0; existingIndex < nodes.length; existingIndex++) {
            var existing = nodes[existingIndex]
            if (existing === node || !isClassSkillTreeCoordinate(existing.treeX) || !isClassSkillTreeCoordinate(existing.treeY)) continue
            if (Math.abs(Number(existing.treeX) - candidateX) < 210 && Math.abs(Number(existing.treeY) - desiredY) < 100) {
                occupied = true
                break
            }
        }
        if (!occupied) {
            node.treeX = Math.max(-6000, Math.min(6000, candidateX))
            node.treeY = Math.max(-6000, Math.min(6000, desiredY))
            return
        }
    }
}

function saveClassSkillTreePositions(player, positions) {
    if (!Array.isArray(positions)) return { applied: 0, invalid: 1 }
    var classDraft = getClassDraft(player)
    if (!classDraft) return { applied: 0, invalid: positions.length }
    var applied = 0
    var invalid = 0
    for (var i = 0; i < positions.length; i++) {
        var position = positions[i]
        if (!position || !isClassSkillTreeCoordinate(position.x) || !isClassSkillTreeCoordinate(position.y)) {
            invalid++
            continue
        }
        var node = findClassSkillNodeInDraft(classDraft, String(position.id || ""))
        if (!node) {
            invalid++
            continue
        }
        node.treeX = Math.max(-6000, Math.min(6000, Math.round(Number(position.x))))
        node.treeY = Math.max(-6000, Math.min(6000, Math.round(Number(position.y))))
        applied++
    }
    if (applied > 0) saveClassDraft(player, classDraft)
    return { applied: applied, invalid: invalid }
}

function normalizeSkillEditorFolder(value) {
    var parts = String(value || "Core").split("/")
    var normalized = []
    for (var i = 0; i < parts.length; i++) {
        var name = parts[i].trim()
        if (!name) continue
        if (name.length > 64) throw new Error("Folder names may contain at most 64 characters.")
        normalized.push(name)
    }
    var path = normalized.join("/") || "Core"
    if (path.length > 512) throw new Error("This folder path is too long.")
    return path
}

function normalizeSkillBookCreatorData(draft, data) {
    if (data.nodes.length > 512 || data.choiceGroups.length > 512) throw new Error("The class has too many entries.")
    var nodes = JSON.parse(JSON.stringify(data.nodes))
    var groups = JSON.parse(JSON.stringify(data.choiceGroups))
    function allocate(entries, oldEntries, fallback) {
        var existing = {}, used = {}, remap = {}, seen = {}
        for (var i = 0; i < oldEntries.length; i++) existing["$" + oldEntries[i].id] = used["$" + oldEntries[i].id] = true
        for (i = 0; i < entries.length; i++) {
            var entry = entries[i]
            if (!entry || typeof entry !== "object" || !String(entry.title || "").trim()) throw new Error("Each entry needs a title.")
            var oldId = String(entry.id || "")
            if (oldId && seen["$" + oldId]) throw new Error("Duplicate entry. Reopen the editor and try again.")
            if (oldId) seen["$" + oldId] = true
            if (oldId && existing["$" + oldId]) continue
            var base = String(entry.title).toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^[_\-.]+|[_\-.]+$/g, "").substring(0, 50) || fallback
            var key = base, suffix = 2
            while (used["$" + key]) key = base + "_" + suffix++
            entry.id = key
            used["$" + key] = true
            if (oldId) remap["$" + oldId] = key
        }
        return remap
    }
    var nodeIds = allocate(nodes, draft.skillNodes || [], "skill")
    var groupIds = allocate(groups, draft.choiceGroups || [], "paths")
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        node.editorGroup = normalizeSkillEditorFolder(node.editorGroup)
        node.statNode = node.type === "MILESTONE" && node.statNode === true
        node.statIconIndex = normalizeStatIconIndex(node.statIconIndex)
        node.spiritCost = (node.prelearned === true || node.learnedWithNode)
            ? 0 : normalizeWholeResource(node.spiritCost !== undefined ? node.spiritCost : node.spirit, 0, SPIRIT_MAX_SAFE_INTEGER)
        node.grantedPermissions = normalizeSkillPermissionList(node.grantedPermissions || node.permissionGrants || node.grants)
        if (node.statNode) node.choiceGroupId = ""
        node.upgradeSchedule = supportsClassSkillUpgradeSchedule(node)
            ? normalizeClassSkillUpgradeSchedule(node.upgradeSchedule) : []
        node.managedUpgradeSchedule = supportsClassSkillUpgradeSchedule(node)
            && (node.managedUpgradeSchedule === true || node.upgradeSchedule.length > 0)
        if (node.managedUpgradeSchedule) node.rankSeriesId = ""
        node.choiceGroupId = groupIds["$" + node.choiceGroupId] || node.choiceGroupId || ""
        node.upgradeFrom = nodeIds["$" + node.upgradeFrom] || node.upgradeFrom || ""
        node.learnedWithNode = nodeIds["$" + node.learnedWithNode] || node.learnedWithNode || ""
        var relations = ["prerequisites", "blockedNodes"]
        for (var r = 0; r < relations.length; r++) {
            var ids = node[relations[r]] || []
            for (var j = 0; j < ids.length; j++) ids[j] = nodeIds["$" + ids[j]] || ids[j]
            node[relations[r]] = ids
        }
        var rules = node.visibilityRules || []
        node.prerequisiteRanks = normalizePrerequisiteRanks(node.prerequisiteRanks, node.prerequisites, nodeIds)
        Object.keys(node.prerequisiteRanks).forEach(function(requiredId) {
            resolvePrerequisiteRank(nodes, requiredId, node.prerequisiteRanks[requiredId])
        })
        for (var k = 0; k < rules.length; k++) rules[k].nodeId = nodeIds["$" + rules[k].nodeId] || rules[k].nodeId
    }
    draft.skillNodes = nodes
    draft.choiceGroups = groups
    var folders = Array.isArray(data.editorFolders) ? data.editorFolders : draft.editorFolders || []
    if (folders.length > 512) throw new Error("The class has too many folders.")
    var folderPaths = []
    for (var f = 0; f < folders.length; f++) {
        var folder = normalizeSkillEditorFolder(folders[f])
        if (folderPaths.indexOf(folder) < 0) folderPaths.push(folder)
    }
    for (var n = 0; n < nodes.length; n++) if (folderPaths.indexOf(nodes[n].editorGroup) < 0) folderPaths.push(nodes[n].editorGroup)
    draft.editorFolders = folderPaths
    var order = data.editorOrder || draft.editorOrder || {}
    if (typeof order !== "object" || Array.isArray(order)) throw new Error("Invalid folder order.")
    var parents = Object.create(null)
    for (var folderIndex = 0; folderIndex < folderPaths.length; folderIndex++) {
        var path = folderPaths[folderIndex]
        while (path) {
            var slash = path.lastIndexOf("/")
            var parent = slash < 0 ? "" : path.substring(0, slash)
            parents["folder:" + path] = parent
            path = parent
        }
    }
    for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) parents["node:" + nodes[nodeIndex].id] = nodes[nodeIndex].editorGroup
    var cleanedOrder = Object.create(null)
    var orderKeys = Object.keys(order)
    if (orderKeys.length > 4096) throw new Error("Too many folder order entries.")
    for (var orderIndex = 0; orderIndex < orderKeys.length; orderIndex++) {
        var orderParent = orderKeys[orderIndex] === "" ? "" : normalizeSkillEditorFolder(orderKeys[orderIndex])
        var items = order[orderKeys[orderIndex]]
        if (!Array.isArray(items) || items.length > 1024) throw new Error("Invalid folder order.")
        var cleanedItems = []
        for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
            var token = String(items[itemIndex])
            if (token.indexOf("node:") === 0) token = "node:" + (nodeIds["$" + token.substring(5)] || token.substring(5))
            if (Object.prototype.hasOwnProperty.call(parents, token) && parents[token] === orderParent && cleanedItems.indexOf(token) < 0) cleanedItems.push(token)
        }
        cleanedOrder[orderParent] = cleanedItems
    }
    draft.editorOrder = cleanedOrder
}

function parseClassSkillHtmlData(value) {
    var data = value
    try {
        if (typeof data === "string") data = JSON.parse(data)
        if (typeof data === "string") data = JSON.parse(data)
    } catch (error) {
        return {}
    }
    return data && typeof data === "object" ? data : {}
}

function _classSkill_customGuiButton(e) {
    var player = e.player
    var guiId = e.gui.getID()
    var buttonId = e.buttonId
    if (guiId === CLASS_SKILL_TREE_GUI_ID) {
        var selectedId = player.getTempdata().has("admSelectedClassSkillId") ? String(player.getTempdata().get("admSelectedClassSkillId")) : ""
        if (buttonId === CLASS_SKILL_IDS.BTN_NEW) {
            startClassSkillNodeDraft(player, "")
            showClassSkillNodeGui(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_EDIT && findClassSkillNode(player, selectedId)) {
            startClassSkillNodeDraft(player, selectedId)
            showClassSkillNodeGui(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_DELETE && selectedId) {
            deleteClassSkillNode(player, selectedId)
            showClassSkillTreeGui(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_BACK) {
            showClassEditorGui(player)
        }
        return
    }
    if (guiId === CLASS_SKILL_PREREQ_GUI_ID) {
        var prerequisiteDraft = getClassSkillNodeDraft(player)
        if (!prerequisiteDraft) return
        var temp = player.getTempdata()
        var pickerMode = getClassSkillPickerMode(player)
        if (buttonId === CLASS_SKILL_IDS.BTN_PREREQ_ADD && temp.has("admSkillPrerequisiteAvailableId")) {
            var addId = String(temp.get("admSkillPrerequisiteAvailableId"))
            var selectedValues = getClassSkillPickerValues(prerequisiteDraft, pickerMode)
            if (pickerMode === "upgrade") selectedValues = [addId]
            else if (selectedValues.indexOf(addId) === -1) selectedValues.push(addId)
            setClassSkillPickerValues(prerequisiteDraft, pickerMode, selectedValues)
            saveClassSkillNodeDraft(player, prerequisiteDraft)
            showClassSkillPrerequisiteGui(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_PREREQ_REMOVE && temp.has("admSkillPrerequisiteSelectedId")) {
            var removeId = String(temp.get("admSkillPrerequisiteSelectedId"))
            var remainingValues = getClassSkillPickerValues(prerequisiteDraft, pickerMode).filter(function(id) { return id !== removeId })
            setClassSkillPickerValues(prerequisiteDraft, pickerMode, remainingValues)
            saveClassSkillNodeDraft(player, prerequisiteDraft)
            showClassSkillPrerequisiteGui(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_PREREQ_DONE) {
            clearClassSkillPrerequisitePickerState(player)
            returnToClassSkillNodeEditor(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_PREREQ_CANCEL) {
            if (temp.has("admSkillPickerDraftBackup")) {
                prerequisiteDraft = JSON.parse(String(temp.get("admSkillPickerDraftBackup")))
                saveClassSkillNodeDraft(player, prerequisiteDraft)
            }
            clearClassSkillPrerequisitePickerState(player)
            returnToClassSkillNodeEditor(player)
        }
        return
    }
    if (guiId === CLASS_SKILL_ITEM_GUI_ID) {
        var itemDraft = getClassSkillNodeDraft(player)
        if (!itemDraft) return
        var itemMode = getClassSkillItemMode(player)
        if (buttonId === CLASS_SKILL_IDS.BTN_ITEM_CONSUME) {
            itemDraft = captureClassSkillItemCost(player, e.gui)
            setClassSkillItemConsume(itemDraft, itemMode, !getClassSkillItemConsume(itemDraft, itemMode))
            saveClassSkillNodeDraft(player, itemDraft)
            showClassSkillItemGui(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_ITEM_SAVE) {
            captureClassSkillItemCost(player, e.gui)
            player.getTempdata().remove("admSkillItemBackup")
            player.getTempdata().remove("admSkillItemConsumeBackup")
            player.getTempdata().remove("admSkillItemMode")
            player.getTempdata().remove("admSkillUpgradeIndex")
            returnToClassSkillNodeEditor(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_ITEM_CLEAR) {
            setClassSkillItemValue(itemDraft, itemMode, "")
            saveClassSkillNodeDraft(player, itemDraft)
            player.getTempdata().remove("admSkillItemBackup")
            player.getTempdata().remove("admSkillItemConsumeBackup")
            player.getTempdata().remove("admSkillItemMode")
            player.getTempdata().remove("admSkillUpgradeIndex")
            returnToClassSkillNodeEditor(player)
        } else if (buttonId === CLASS_SKILL_IDS.BTN_ITEM_CANCEL) {
            setClassSkillItemValue(itemDraft, itemMode, player.getTempdata().has("admSkillItemBackup")
                ? String(player.getTempdata().get("admSkillItemBackup")) : "")
            setClassSkillItemConsume(itemDraft, itemMode, String(player.getTempdata().get("admSkillItemConsumeBackup")) !== "false")
            saveClassSkillNodeDraft(player, itemDraft)
            player.getTempdata().remove("admSkillItemBackup")
            player.getTempdata().remove("admSkillItemConsumeBackup")
            player.getTempdata().remove("admSkillItemMode")
            player.getTempdata().remove("admSkillUpgradeIndex")
            returnToClassSkillNodeEditor(player)
        }
        return
    }
    if (guiId === CLASS_SKILL_EFFECT_GUI_ID) {
        var effectDraft = getClassSkillNodeDraft(player)
        if (!effectDraft) return
        if (buttonId === CLASS_SKILL_EFFECT_IDS.BTN_SAVE_STAT) {
            captureClassSkillEffectEditor(player, e.gui)
            showClassSkillEffectGui(player)
        } else if (buttonId === CLASS_SKILL_EFFECT_IDS.BTN_TOGGLE_OVERRIDE) {
            var toggleKey = getSelectedSkillEffectStatKey(player)
            var overrideEnabled = hasOwnStatValue(effectDraft.statMultiplierOverrides, toggleKey)
                || hasOwnStatValue(effectDraft.statMultiplierBonuses, toggleKey)
            effectDraft = captureClassSkillEffectEditor(player, e.gui) || effectDraft
            delete effectDraft.statMultiplierBonuses[toggleKey]
            if (overrideEnabled) delete effectDraft.statMultiplierOverrides[toggleKey]
            else effectDraft.statMultiplierOverrides[toggleKey] = getClassDraftStatMultiplier(player, toggleKey)
            saveClassSkillNodeDraft(player, effectDraft)
            showClassSkillEffectGui(player)
        } else if (buttonId === CLASS_SKILL_EFFECT_IDS.BTN_RESET_STAT) {
            var effectKey = getSelectedSkillEffectStatKey(player)
            delete effectDraft.statBonuses[effectKey]
            delete effectDraft.statMultiplierBonuses[effectKey]
            delete effectDraft.statMultiplierOverrides[effectKey]
            saveClassSkillNodeDraft(player, effectDraft)
            showClassSkillEffectGui(player)
        } else if (buttonId === CLASS_SKILL_EFFECT_IDS.BTN_BACK) {
            captureClassSkillEffectEditor(player, e.gui)
            returnToClassSkillNodeEditor(player)
        }
        return
    }
    if (guiId !== CLASS_SKILL_NODE_GUI_ID) return
    var draft = captureClassSkillNodeEditor(player, e.gui)
    if (!draft) return
    if (buttonId === CLASS_SKILL_IDS.BTN_CANCEL) {
        player.getTempdata().remove("admClassSkillNodeDraft")
        clearClassSkillPrerequisitePickerState(player)
        showClassSkillTreeGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_SAVE) {
        if (saveClassSkillNode(player, e.gui)) showClassSkillTreeGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_IRON || buttonId === CLASS_SKILL_IDS.BTN_EPIC || buttonId === CLASS_SKILL_IDS.BTN_MILESTONE) {
        var selectedType = buttonId === CLASS_SKILL_IDS.BTN_EPIC ? "EPIC_FIGHT"
            : buttonId === CLASS_SKILL_IDS.BTN_MILESTONE ? "MILESTONE" : "IRON_SPELL"
        if (draft.type === selectedType) return
        draft.type = selectedType
        draft.registryId = ""
        draft.epicSlot = ""
        if (draft.type === "MILESTONE") draft.rank = 1
        saveClassSkillNodeDraft(player, draft)
        showClassSkillNodeGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_EPIC_SLOT) {
        var selectedEpicEntry = findEpicCatalogEntry(player, draft.registryId)
        var slots = selectedEpicEntry && selectedEpicEntry.assignable ? selectedEpicEntry.compatibleSlots || [] : []
        if (!slots.length) return
        var slotIndex = slots.indexOf(draft.epicSlot)
        draft.epicSlot = slots[(slotIndex + 1) % slots.length]
        saveClassSkillNodeDraft(player, draft)
        showClassSkillNodeGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_PREREQUISITES) {
        if (!draft.prelearned) beginClassSkillPrerequisitePicker(player, draft)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_PRELEARNED) {
        draft.prelearned = !draft.prelearned
        if (draft.prelearned) {
            draft.prerequisites = []
            draft.requiredItemSnbt = ""
            draft.upgradeFrom = ""
            draft.removeUpgradeSource = false
            draft.canUnlearn = false
            draft.unlearnItemSnbt = ""
        }
        saveClassSkillNodeDraft(player, draft)
        showClassSkillNodeGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_UPGRADE) {
        if (!draft.prelearned) beginClassSkillNodePicker(player, draft, "upgrade")
    } else if (buttonId === CLASS_SKILL_IDS.BTN_REPLACE_UPGRADE) {
        if (draft.prelearned || !draft.upgradeFrom) return
        draft.removeUpgradeSource = !draft.removeUpgradeSource
        saveClassSkillNodeDraft(player, draft)
        showClassSkillNodeGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_BLOCKED) {
        beginClassSkillNodePicker(player, draft, "blocked")
    } else if (buttonId === CLASS_SKILL_IDS.BTN_ITEM_COST) {
        if (!draft.prelearned) beginClassSkillItemEditor(player, draft, "learn")
    } else if (buttonId === CLASS_SKILL_IDS.BTN_EFFECTS) {
        showClassSkillEffectGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_CAN_UNLEARN) {
        if (draft.prelearned) return
        draft.canUnlearn = !draft.canUnlearn
        if (!draft.canUnlearn) draft.unlearnItemSnbt = ""
        saveClassSkillNodeDraft(player, draft)
        showClassSkillNodeGui(player)
    } else if (buttonId === CLASS_SKILL_IDS.BTN_UNLEARN_COST && draft.canUnlearn && !draft.prelearned) {
        beginClassSkillItemEditor(player, draft, "unlearn")
    }
}

function _classSkill_customGuiScroll(e) {
    if (!e.selection || e.selection.length === 0) return
    if (e.gui.getID() === CLASS_SKILL_EFFECT_GUI_ID && e.scrollId === CLASS_SKILL_EFFECT_IDS.SCROLL_STATS) {
        captureClassSkillEffectEditor(e.player, e.gui)
        if (e.scrollIndex >= 0 && e.scrollIndex < STAT_KEYS.length) {
            e.player.getTempdata().put("admSkillEffectSelected", STAT_KEYS[e.scrollIndex])
            showClassSkillEffectGui(e.player)
        }
        return
    }
    if (e.gui.getID() === CLASS_SKILL_TREE_GUI_ID && e.scrollId === CLASS_SKILL_IDS.SCROLL_NODES) {
        var ids = JSON.parse(String(e.player.getTempdata().get("admClassSkillListIds") || "[]"))
        if (e.scrollIndex >= 0 && e.scrollIndex < ids.length) {
            e.player.getTempdata().put("admSelectedClassSkillId", ids[e.scrollIndex])
            if (e.doubleClick) {
                startClassSkillNodeDraft(e.player, ids[e.scrollIndex])
                showClassSkillNodeGui(e.player)
            } else {
                showClassSkillTreeGui(e.player)
            }
        }
        return
    }
    if (e.gui.getID() === CLASS_SKILL_NODE_GUI_ID && e.scrollId === CLASS_SKILL_IDS.SCROLL_CATALOG) {
        var catalogEntries = JSON.parse(String(e.player.getTempdata().get("admSkillCatalogEntries") || "[]"))
        if (e.scrollIndex < 0 || e.scrollIndex >= catalogEntries.length) return
        var selectedEntry = catalogEntries[e.scrollIndex]
        var draft = getClassSkillNodeDraft(e.player)
        draft.registryId = selectedEntry.registryId
        if (!draft.title) draft.title = selectedEntry.displayName
        if (draft.type === "IRON_SPELL") {
            var maximumRank = Math.max(1, Number(selectedEntry.maxRank || 1))
            draft.rank = Math.max(1, Math.min(Number(draft.rank || 1), maximumRank))
        } else if (draft.type === "EPIC_FIGHT") {
            draft.epicSlot = defaultEpicSlotForCatalogEntry(selectedEntry)
        }
        saveClassSkillNodeDraft(e.player, draft)
        showClassSkillNodeGui(e.player)
        return
    }
    if (e.gui.getID() === CLASS_SKILL_PREREQ_GUI_ID) {
        var key = e.scrollId === CLASS_SKILL_IDS.SCROLL_PREREQ_AVAILABLE
            ? "admSkillPrerequisiteAvailableIds"
            : (e.scrollId === CLASS_SKILL_IDS.SCROLL_PREREQ_SELECTED ? "admSkillPrerequisiteSelectedIds" : "")
        if (!key) return
        var prerequisiteIds = JSON.parse(String(e.player.getTempdata().get(key) || "[]"))
        if (e.scrollIndex < 0 || e.scrollIndex >= prerequisiteIds.length) return
        e.player.getTempdata().put(
            e.scrollId === CLASS_SKILL_IDS.SCROLL_PREREQ_AVAILABLE
                ? "admSkillPrerequisiteAvailableId" : "admSkillPrerequisiteSelectedId",
            prerequisiteIds[e.scrollIndex]
        )
    }
}

function _class_customGuiScroll(e) {
    var guiId = e.gui.getID()
    if (guiId === CLASS_STAT_GUI_ID && e.scrollId === CLASS_STAT_IDS.SCROLL_STATS) {
        if (!e.selection || e.selection.length === 0) return
        captureClassStatEditor(e.player, e.gui)
        if (e.scrollIndex >= 0 && e.scrollIndex < STAT_KEYS.length) {
            e.player.getTempdata().put("admClassStatSelected", STAT_KEYS[e.scrollIndex])
            showClassStatEditorGui(e.player)
        }
        return
    }
    if (guiId !== CLASS_LIST_GUI_ID || e.scrollId !== CLASS_IDS.SCROLL_LIST) return
    if (!e.selection || e.selection.length === 0 || e.selection[0] === "(No classes created)") return
    var player = e.player
    var ids = []
    try {
        ids = JSON.parse(player.getTempdata().get("admClassListIds"))
    } catch (error) {
        return
    }
    if (e.scrollIndex < 0 || e.scrollIndex >= ids.length) return
    var classId = ids[e.scrollIndex]
    player.getTempdata().put("admSelectedClassId", classId)
    if (e.doubleClick) {
        startClassDraft(player, classId)
        showClassEditorGui(player)
    } else {
        showClassListGui(player, getClassListPage(player))
    }
}

function _class_customGuiClosed(e) {
    if (e.gui.getID() === CLASS_CHOOSER_GUI_ID && playerNeedsClass(e.player)) {
        e.player.getTempdata().put("admClassLastPrompt", e.player.getWorld().getTotalTime())
    }
}

function addClassRoleCard(gui, world, classData, cardIndex, selected) {
    var layout = CLASS_CHOOSER_LAYOUT
    var position = ClassGuiMath.grid(
        cardIndex, 0, layout.cardWidth, layout.cardHeight,
        layout.cardGap, 0, layout.cardX, layout.cardY)
    var panelId = CLASS_IDS.ROLE_PANEL_BASE + cardIndex * 3
    gui.addTexturedRect(
        panelId, selected ? RPG_UI.gold : RPG_UI.chrome,
        position.x, position.y, layout.cardWidth, layout.cardHeight)
    gui.addTexturedRect(
        panelId + 1, selected ? RPG_UI.panel : RPG_UI.panelAlt,
        position.x + 2, position.y + 2, layout.cardWidth - 4, layout.cardHeight - 4)
    gui.addTexturedRect(
        panelId + 2, selected ? RPG_UI.gold : RPG_UI.cyan,
        position.x + 2, position.y + 2, layout.cardWidth - 4, 2)
    var icon = createClassIconStack(world, classData.iconItemId)
    if (icon) {
        gui.addItemRenderer(
            CLASS_IDS.ITEM_ROLE_BASE + cardIndex,
            position.x + 17, position.y + 9, 24, 24, icon)
            .setHoverText("§f" + classData.name)
    }
    gui.addButton(
        CLASS_IDS.BTN_ROLE_BASE + cardIndex,
        (selected ? "§6§l" : "§f") + shortGuiText(classData.name, 8),
        position.x + 3, position.y + 45, layout.cardWidth - 6, 20)
        .setHoverText("§f" + classData.name + "\n§7Click to preview this role")
}

function addClassStarterPreview(gui, world, selected) {
    var starterItems = selected.startingItems || []
    var visibleItems = Math.min(starterItems.length, 10)
    if (visibleItems === 0) {
        gui.addLabel(LAYER.CONTENT_LABELS + 6, "§8No starting items", 92, 202, 210, 10)
        return
    }
    for (var starterIndex = 0; starterIndex < visibleItems; starterIndex++) {
        var starter = createClassItemFromSnbt(world, starterItems[starterIndex])
        if (!starter) continue
        var starterName = String(starter.getDisplayName()).replace(/§./g, "")
        gui.addItemRenderer(
            CLASS_IDS.ITEM_STARTER_BASE + starterIndex,
            92 + starterIndex * 23, 199, 20, 20, starter)
            .setHoverText("§f" + starterName)
    }
    if (starterItems.length > visibleItems) {
        gui.addLabel(
            LAYER.CONTENT_LABELS + 6,
            "§7+" + (starterItems.length - visibleItems),
            92 + visibleItems * 23, 204, 30, 10)
    }
}

function showClassChooserGui(player, page) {
    var world = player.getWorld()
    var ids = getSortedClassIds(world)
    if (ids.length === 0) return false
    var maxPage = Math.max(0, Math.ceil(ids.length / CLASS_CONFIG.chooserPageSize) - 1)
    if (page === undefined || page === null) {
        page = player.getTempdata().has("admClassChooserPage") ? Number(player.getTempdata().get("admClassChooserPage")) : 0
    }
    page = Math.max(0, Math.min(page, maxPage))
    var pageStart = page * CLASS_CONFIG.chooserPageSize
    var pageIds = ids.slice(pageStart, pageStart + CLASS_CONFIG.chooserPageSize)
    var selectedId = player.getTempdata().has("admSelectedChooserClassId") ? String(player.getTempdata().get("admSelectedChooserClassId")) : ""
    if (pageIds.indexOf(selectedId) === -1) selectedId = pageIds[0]
    player.getTempdata().put("admClassChooserPage", page)
    player.getTempdata().put("admClassChooserIds", JSON.stringify(pageIds))
    player.getTempdata().put("admSelectedChooserClassId", selectedId)

    var gui = API.createCustomGui(CLASS_CHOOSER_GUI_ID, CLASS_GUI_WIDTH, CLASS_GUI_HEIGHT, false, player)
    addRpgFrame(gui, CLASS_GUI_WIDTH, CLASS_GUI_HEIGHT, RPG_UI.gold)
    var selected = getClassById(world, selectedId)
    var layout = CLASS_CHOOSER_LAYOUT
    gui.addLabel(LAYER.CONTENT_LABELS, "§6§lCHOOSE YOUR CLASS", 120, 8, 180, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7Select the role that will define your journey", 70, 21, 260, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§b§lCLASS ROLES", layout.cardX, layout.sectionLabelY, 120, 10)
    if (maxPage > 0) {
        gui.addLabel(
            LAYER.CONTENT_LABELS + 3,
            "§7PAGE §f" + (page + 1) + "§7/§f" + (maxPage + 1),
            330, layout.sectionLabelY, 58, 10)
    }
    for (var i = 0; i < pageIds.length; i++) {
        var classData = getClassById(world, pageIds[i])
        addClassRoleCard(gui, world, classData, i, classData.id === selectedId)
    }

    addRpgPanel(
        gui, CLASS_IDS.DETAIL_PANEL,
        layout.detailX, layout.detailY, layout.detailWidth, layout.detailHeight, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS + 4, "§b§lSELECTED ROLE", 92, 151, 124, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 5, "§6§l" + shortGuiText(selected.name, 34), 92, 166, 238, 16)
        .setHoverText("§f" + selected.name)
    var icon = createClassIconStack(world, selected.iconItemId)
    if (icon) gui.addItemRenderer(CLASS_IDS.ITEM_PREVIEW, 36, 163, 40, 40, icon)
        .setHoverText("§f" + selected.name)
    gui.addLabel(
        LAYER.CONTENT_LABELS + 7,
        "§7STARTING KIT §f" + (selected.startingItems || []).length,
        92, 186, 150, 10)
    addClassStarterPreview(gui, world, selected)
    gui.addLabel(
        LAYER.CONTENT_LABELS + 8,
        "§cPermanent choice §8• §7Admin reset required",
        92, 224, 270, 10)

    if (maxPage > 0) gui.addButton(CLASS_IDS.BTN_LIST_PREV, "§7<", 12, layout.footerY, 28, 20).setEnabled(page > 0)
    gui.addButton(CLASS_IDS.BTN_CHOOSE, "§6§lCONFIRM ROLE", 132, layout.footerY, 136, 20)
        .setHoverText("§fBegin as " + selected.name)
    if (maxPage > 0) gui.addButton(CLASS_IDS.BTN_LIST_NEXT, "§7>", 360, layout.footerY, 28, 20).setEnabled(page < maxPage)
    player.showCustomGui(gui)
    return true
}

function _class_login(e) {
    var temp = e.player.getTempdata()
    if (temp.has("admClassLastPrompt")) temp.remove("admClassLastPrompt")
    if (temp.has(CLASS_CONFIG.completionSignalKey)) temp.remove(CLASS_CONFIG.completionSignalKey)
}

function _class_tick(e) {
    var player = e.player
    if (player.hasTag(ARVAN_CLONE_TRANSFER_QUARANTINE_TAG)) return
    var temp = player.getTempdata()
    // Reset commands only publish a request. Forge owns the persistence lease and
    // adds the execute tag before this script may touch CustomNPC player data.
    if (hasPlayerResetTransaction(player)) advanceArvanResetTransaction(player)
    if (applyAuthorizedPlayerReset(player)) {
        advanceArvanResetTransaction(player)
        return
    }
    if (player.hasTag(ARVAN_APPEARANCE_PENDING_TAG)) {
        var appearanceBlockedGui = player.getCustomGui()
        if (appearanceBlockedGui && appearanceBlockedGui.getID() === CLASS_CHOOSER_GUI_ID) player.closeGui()
        if (temp.has("admClassLastPrompt")) temp.remove("admClassLastPrompt")
        clearClassCompletionSignal(player)
        return
    }
    var classWorld = player.getWorld()
    if (!getClassSystemEnabled(classWorld) || getSortedClassIds(classWorld).length === 0) {
        // An intentionally disabled or empty registry cannot offer a replacement.
        // Keep completed players intact until at least one valid class exists again.
        clearClassCompletionSignal(player)
        if (temp.has("admClassLastPrompt")) temp.remove("admClassLastPrompt")
        return
    }
    var staleClassId = getPlayerClassId(player)
    if (staleClassId && !getClassById(classWorld, staleClassId)) {
        clearClassCompletionSignal(player)
        resetPlayerClass(player)
        return
    }
    if (refreshClassCompletionSignal(player)) {
        if (temp.has("admClassLastPrompt")) temp.remove("admClassLastPrompt")
        return
    }
    if (!playerNeedsClass(player)) return
    var currentGui = player.getCustomGui()
    if (currentGui && currentGui.getID() === CLASS_CHOOSER_GUI_ID) return
    var now = player.getWorld().getTotalTime()
    var canPrompt = !temp.has("admClassLastPrompt") || now - Number(temp.get("admClassLastPrompt")) >= CLASS_CONFIG.enforceIntervalTicks
    if (!canPrompt) return
    temp.put("admClassLastPrompt", now)
    showClassChooserGui(player)
}

function _class_chat(e) {
    var message = String(e.message)
    if (message.indexOf("/class") !== 0) return false
    e.setCanceled(true)
    var player = e.player
    var parts = message.trim().split(/\s+/)
    handleClassResetCommand(player, parts.length > 1 ? parts[1] : "", parts.length > 2 ? parts[2] : "")
    return true
}

function handleClassResetCommand(player, action, targetName) {
    if (player.getGamemode() !== 1) {
        player.message("§c[Classes] This command requires Creative mode.")
        return true
    }
    if (String(action).toLowerCase() !== "reset" || !targetName) {
        player.message("§eUsage: /class reset <player>")
        return true
    }
    var target = player.getWorld().getPlayer(String(targetName))
    if (!target) {
        player.message("§c[Classes] Player not found: §e" + targetName)
        return true
    }
    if (rejectFrozenTargetMutation(player, target)) return true
    var resetResult = resetPlayerClass(target)
    if (resetResult === PLAYER_RESET_REJECTED) {
        player.message("§c[Classes] That player already has a reset transaction in progress.")
        return true
    }
    if (resetResult === PLAYER_RESET_GUARDED) {
        player.message("§a[Classes] Queued a safe class reset for §e" + target.getName())
        if (player.getName() !== target.getName()) target.message("§e[Classes] Your class reset is being saved. You will choose a new class next.")
    } else {
        player.message("§a[Classes] Reset class for §e" + target.getName() + "§a. Choose a new class next.")
        if (player.getName() !== target.getName()) target.message("§a[Classes] Your class was reset. Choose a new class next.")
    }
    return true
}

function handleStatResetCommand(player, action, targetName) {
    if (!isAdmin(player)) {
        player.message("§c[Stats] This command requires Creative mode.")
        return true
    }
    if (String(action).toLowerCase() !== "reset" || !targetName) {
        player.message("§eUsage: /stat reset <player>")
        return true
    }
    var target = player.getWorld().getPlayer(String(targetName))
    if (!target) {
        player.message("§c[Stats] Player not found: §e" + targetName)
        return true
    }
    if (rejectFrozenTargetMutation(player, target)) return true
    var resetResult = requestPlayerStatReset(target)
    if (resetResult === PLAYER_RESET_REJECTED) {
        player.message("§c[Stats] That player already has a reset transaction in progress.")
        return true
    }
    if (resetResult === PLAYER_RESET_GUARDED) {
        player.message("§a[Stats] Queued a safe stat reset for §e" + target.getName())
        if (player.getName() !== target.getName()) target.message("§e[Stats] Your allocated-stat reset is being saved.")
    } else {
        player.message("§a[Stats] Reset allocated stats for §e" + target.getName() + "§a.")
        if (player.getName() !== target.getName()) target.message("§a[Stats] Your allocated stats were reset.")
    }
    return true
}

function handleFullPlayerResetCommand(player, action, targetName) {
    if (!isAdmin(player)) {
        player.message("§c[Admin] This command requires Creative mode.")
        return true
    }
    if (String(action).toLowerCase() !== "reset" || !targetName) {
        player.message("§eUsage: /admin reset <player>")
        return true
    }
    var target = player.getWorld().getPlayer(String(targetName))
    if (!target) {
        player.message("§c[Admin] Player not found: §e" + targetName)
        return true
    }
    if (rejectFrozenTargetMutation(player, target)) return true
    var resetResult = requestFullPlayerReset(target)
    if (resetResult === PLAYER_RESET_REJECTED) {
        player.message("§c[Admin] That player already has a reset transaction in progress.")
        return true
    }
    if (resetResult === PLAYER_RESET_GUARDED) {
        player.message("§a[Admin] Queued a safe full progress reset for §e" + target.getName())
        if (player.getName() !== target.getName()) target.message("§e[Admin] Your level, EXP, class, and allocated-stat reset is being saved.")
    } else {
        player.message("§a[Admin] Reset level, EXP, class, and allocated stats for §e" + target.getName() + "§a.")
        if (player.getName() !== target.getName()) target.message("§a[Admin] Your level, EXP, class, and allocated stats were reset.")
    }
    return true
}

// ===== GUI CONFIGURATION =====
var ATTR_GUI_WIDTH = 300
var ATTR_GUI_HEIGHT = 180
var ATTR_GUI_ID = 200

// ===== ATTRIBUTE CONFIGURATION =====
function createDefaultStatRegistry() {
    return {
        STR: {
            id: "STR",
            name: "Strength",
            icon: "§e[STR]",
            description: "Increases damage. Required for heavy weapons.",
            color: "§e",
            order: 0,
            affects: {
                "minecraft:generic.attack_damage": { base: 1, perPoint: 0.3 }
            }
        },
        VIT: {
            id: "VIT",
            name: "Vitality",
            icon: "§b[VIT]",
            description: "Increases health. Required for heavy armor.",
            color: "§b",
            order: 1,
            affects: {
                "minecraft:generic.max_health": { base: 20, perPoint: 2 }
            }
        },
        DEX: {
            id: "DEX",
            name: "Dexterity",
            icon: "§3[DEX]",
            description: "Increases speed. Required for light weapons.",
            color: "§3",
            order: 2,
            affects: {
                "minecraft:generic.movement_speed": { base: 0.1, perPoint: 0.002 }
            }
        }
    }
}

var ATTR_CONFIG = {
    prefix: "/attr",
    
    // Points system
    pointsPerLevel: 3,              // Points gained per level
    startingPoints: 0,              // Points at level 1
    initialPoints: 0,               // Initial points at level 1 (for admin config)
    
    // Reset item configuration
    resetItemName: "§eReset Stone", // Name of item required to reset attributes
    
    // Passive bonuses (applied automatically per level, NOT from points)
    passivePerLevel: {
        health: 1                   // +1 HP per level (passive)
        // No passive damage or speed - only from stat points
    },
    
    stats: createDefaultStatRegistry()
}

var ATTRIBUTE_RESTORE_PENDING_KEY = "admAttributeRestorePending"

var STAT_KEYS = []

function normalizeStatKey(value) {
    var key = String(value || "").toUpperCase().trim()
    key = key.replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
    return key
}

function normalizeStatRegistry(registry) {
    var normalized = {}
    if (!registry || typeof registry !== "object") return normalized
    var fallbackOrder = 0

    for (var rawKey in registry) {
        if (!registry.hasOwnProperty(rawKey)) continue
        var source = registry[rawKey] || {}
        var key = normalizeStatKey(source.id || rawKey)
        if (!key || normalized[key]) continue
        var affects = {}
        var sourceAffects = source.affects || {}

        for (var attributeId in sourceAffects) {
            if (!sourceAffects.hasOwnProperty(attributeId)) continue
            var effect = sourceAffects[attributeId] || {}
            var base = Number(effect.base)
            var perPoint = Number(effect.perPoint)
            if (!attributeId || isNaN(base) || isNaN(perPoint)) continue
            affects[String(attributeId)] = { base: base, perPoint: perPoint }
        }

        var order = Number(source.order)
        if (isNaN(order)) order = fallbackOrder
        normalized[key] = {
            id: key,
            name: String(source.name || key),
            icon: String(source.icon || "[" + key + "]"),
            description: String(source.description || "Custom character stat."),
            color: String(source.color || "§f"),
            order: order,
            affects: affects
        }
        fallbackOrder++
    }
    return normalized
}

function refreshStatKeys() {
    STAT_KEYS = Object.keys(ATTR_CONFIG.stats)
    STAT_KEYS.sort(function(a, b) {
        var orderA = Number(ATTR_CONFIG.stats[a].order)
        var orderB = Number(ATTR_CONFIG.stats[b].order)
        if (orderA !== orderB) return orderA - orderB
        return a < b ? -1 : a > b ? 1 : 0
    })
}

function getStatDefinition(statKey) {
    return ATTR_CONFIG.stats[normalizeStatKey(statKey)] || null
}

function saveStatRegistry(world, registry) {
    ATTR_CONFIG.stats = normalizeStatRegistry(registry)
    refreshStatKeys()
    saveConfigToWorld(world)
}

function getStatRegistry(world) {
    loadConfigFromWorld(world)
    refreshStatKeys()
    return JSON.parse(JSON.stringify(ATTR_CONFIG.stats))
}

refreshStatKeys()

// ===== GUI LAYOUT HELPER =====
var AttrGuiMath = {
    centerX: function(width) {
        return (ATTR_GUI_WIDTH - width) / 2
    },
    centerY: function(height) {
        return (ATTR_GUI_HEIGHT - height) / 2
    }
}

// ===== HELPER FUNCTIONS =====

function runCommand(player, command) {
    try {
        API.executeCommand(player.getWorld(), command)
    } catch (ex) {
        print("Command execution failed: " + ex)
    }
}

function getPlayerLevel(player) {
    var stored = player.getStoreddata()
    return stored.has("level") ? stored.get("level") : 1
}

// Get total points player has earned based on level
function getTotalEarnedPoints(player) {
    var level = getPlayerLevel(player)
    // Points start at level 2 (level 1 = 0 points earned)
    return ATTR_CONFIG.initialPoints + ((level - 1) * ATTR_CONFIG.pointsPerLevel)
}

// Get points allocated to a specific stat (STR, VIT, DEX)
function getStatPoints(player, statKey) {
    var stored = player.getStoreddata()
    var key = "stat_" + statKey
    return stored.has(key) ? stored.get(key) : 0
}

function getClassBaseStatPoints(player, statKey) {
    var classData = getClassById(player.getWorld(), getPlayerClassId(player))
    if (!classData || !classData.baseStats) return 0
    var value = Number(classData.baseStats[normalizeStatKey(statKey)] || 0)
    return isNaN(value) ? 0 : value
}

function getLearnedNodeStatValue(player, statKey, field) {
    var snapshot = getCachedPlayerSkillSnapshot(player)
    if (!snapshot || !snapshot.nodes) return 0
    var normalized = normalizeStatKey(statKey)
    var total = 0
    for (var i = 0; i < snapshot.nodes.length; i++) {
        var node = snapshot.nodes[i]
        if (!node.learned || !node[field]) continue
        var value = Number(node[field][normalized] || 0)
        if (!isNaN(value)) total += value
    }
    return total
}

function getEffectiveStatPoints(player, statKey) {
    return getStatPoints(player, statKey) + getClassBaseStatPoints(player, statKey)
        + getLearnedNodeStatValue(player, statKey, "statBonuses")
        + (typeof ARVAN_ITEMS !== "undefined" ? ARVAN_ITEMS.bonus(player, normalizeStatKey(statKey), "points") : 0)
}

function getClassStatEffectivenessMultiplier(player, statKey) {
    var normalized = normalizeStatKey(statKey)
    var classData = getClassById(player.getWorld(), getPlayerClassId(player))
    var multiplier = classData && classData.statMultipliers && classData.statMultipliers.hasOwnProperty(normalized)
        ? Number(classData.statMultipliers[normalized]) : 1
    if (isNaN(multiplier)) multiplier = 1
    return Math.max(0, Math.min(10, multiplier))
}

function getStatEffectivenessMultiplier(player, statKey, details) {
    var normalized = normalizeStatKey(statKey)
    var classMultiplier = getClassStatEffectivenessMultiplier(player, normalized)
    var snapshot = getCachedPlayerSkillSnapshot(player)
    var delta = 0
    for (var i = 0; snapshot && snapshot.nodes && i < snapshot.nodes.length; i++) {
        var node = snapshot.nodes[i]
        if (!node.learned) continue
        var change = 0
        if (hasOwnStatValue(node.statMultiplierOverrides, normalized)) {
            change = Number(node.statMultiplierOverrides[normalized]) - classMultiplier
        } else if (hasOwnStatValue(node.statMultiplierBonuses, normalized)) {
            change = Number(node.statMultiplierBonuses[normalized])
        }
        if (isFinite(change)) delta += change
    }
    if (typeof ARVAN_ITEMS !== "undefined") delta += ARVAN_ITEMS.bonus(player, normalized, "effectiveness") / 100
    var effective = Math.max(0, Math.min(10, classMultiplier + delta))
    return details ? { value: effective, source: delta ? "Class + learned skills" : "Class" } : effective
}

// Set points allocated to a specific stat
function setStatPoints(player, statKey, points) {
    var stored = player.getStoreddata()
    var key = "stat_" + statKey
    stored.put(key, points)
}

// Get total points spent across all stats
function getTotalSpentPoints(player) {
    var total = 0
    for (var i = 0; i < STAT_KEYS.length; i++) {
        total += getStatPoints(player, STAT_KEYS[i])
    }
    return total
}

// Get available (unspent) points
function getAvailablePoints(player) {
    return getTotalEarnedPoints(player) - getTotalSpentPoints(player)
}

// Calculate the value of a minecraft attribute based on stats and passive bonuses
function calculateMcAttribute(player, mcAttribute) {
    var level = getPlayerLevel(player)
    var value = 0
    var baseSet = false
    
    // Go through all stats and accumulate their effect on this attribute
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var statKey = STAT_KEYS[i]
        var stat = ATTR_CONFIG.stats[statKey]
        
        if (stat.affects && stat.affects[mcAttribute]) {
            var effect = stat.affects[mcAttribute]
            var points = getEffectiveStatPoints(player, statKey)
            
            if (!baseSet) {
                value = effect.base
                baseSet = true
            }
            
            value += effect.perPoint * points * getStatEffectivenessMultiplier(player, statKey)
        }
    }
    
    // Add passive bonus per level (if applicable)
    if (mcAttribute === "minecraft:generic.max_health" && ATTR_CONFIG.passivePerLevel.health) {
        value += ATTR_CONFIG.passivePerLevel.health * (level - 1)
    }
    
    return value
}

// Apply a minecraft attribute to player
function applyMcAttribute(player, mcAttribute) {
    var value = calculateMcAttribute(player, mcAttribute)
    var playerName = player.getName()
    
    var command = "attribute " + playerName + " " + mcAttribute + " base set " + value
    runCommand(player, command)
}

// Apply all minecraft attributes affected by our stats
function applyAllAttributes(player) {
    // Collect all unique MC attributes from stats
    var mcAttributes = {}
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var stat = ATTR_CONFIG.stats[STAT_KEYS[i]]
        for (var mcAttr in stat.affects) {
            if (stat.affects.hasOwnProperty(mcAttr)) {
                mcAttributes[mcAttr] = true
            }
        }
    }
    
    // Apply each unique attribute
    for (var mcAttr in mcAttributes) {
        if (mcAttributes.hasOwnProperty(mcAttr)) {
            applyMcAttribute(player, mcAttr)
        }
    }
    
    var stored = player.getStoreddata()
    stored.put("attributesApplied", 1)
    stored.put("attributeLevel", getPlayerLevel(player))
}

// Add a point to a stat (returns true if successful)
function addPointToStat(player, statKey) {
    if (getAvailablePoints(player) <= 0) {
        return false
    }
    
    var stat = ATTR_CONFIG.stats[statKey]
    if (!stat) return false
    
    var currentPoints = getStatPoints(player, statKey)
    setStatPoints(player, statKey, currentPoints + 1)
    
    // Apply all attributes immediately
    applyAllAttributes(player)
    
    return true
}

// Remove a point from a stat (returns true if successful)
function removePointFromStat(player, statKey) {
    var currentPoints = getStatPoints(player, statKey)
    if (currentPoints <= 0) {
        return false
    }
    
    setStatPoints(player, statKey, currentPoints - 1)
    applyAllAttributes(player)
    return true
}

function removeDataKeysWithPrefix(data, prefix) {
    var keys = data.getKeys()
    for (var i = 0; i < keys.length; i++) {
        var key = String(keys[i])
        if (key.indexOf(prefix) === 0) data.remove(key)
    }
}

function resetAllStatPoints(player) {
    var stored = player.getStoreddata()
    removeDataKeysWithPrefix(stored, "stat_")
    clearPendingStatPoints(player)
    if (stored.has(ATTRIBUTE_RESTORE_PENDING_KEY)) stored.remove(ATTRIBUTE_RESTORE_PENDING_KEY)
    applyAllAttributes(player)
}

function clearPlayerLevelingTempData(player) {
    var temp = player.getTempdata()
    clearPendingStatPoints(player)
    var keys = [
        "selfVisibleStatIds", "selfStatPage", "admClassLastPrompt",
        "admSelectedChooserClassId", "admClassChooserPage", "admClassChooserIds",
        "attrRestoreNeeded", "justDied", "lastArmorWarnTime",
        "lastWarnedItem", "lastItemWarnTime"
    ]
    for (var i = 0; i < keys.length; i++) {
        if (temp.has(keys[i])) temp.remove(keys[i])
    }
}

function resetAllPlayerProgressNow(player) {
    if (resetPlayerClassNow(player) === false) return false
    var stored = player.getStoreddata()
    stored.put("level", CONFIG.defaultLevel)
    stored.put("exp", CONFIG.defaultExp)
    removeDataKeysWithPrefix(stored, "quest_completed_")
    removeDataKeysWithPrefix(stored, "quest_turnin_")
    clearPlayerLevelingTempData(player)
    resetAllStatPoints(player)
    return true
}

function resetAllPlayerProgress(player) {
    return requestFullPlayerReset(player)
}

function checkAttributeSync(player) {
    // Just reapply attributes if needed
    applyAllAttributes(player)
    return true
}


// ===== GUI DISPLAY =====

function showAttributeGui(player) {
    // Legacy entry point now targets the dedicated Attributes branch.
    showSelfAttributesGui(player)
    return

    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var gui = API.createCustomGui(ATTR_GUI_ID, ATTR_GUI_WIDTH, ATTR_GUI_HEIGHT, false, player)
    
    var level = getPlayerLevel(player)
    var availablePoints = getAvailablePoints(player)
    var totalPoints = getTotalEarnedPoints(player)
    var spentPoints = getTotalSpentPoints(player)
    
    // ===== LAYER 1: Main background =====
    gui.addTexturedRect(LAYER.BG_MAIN, TEXTURES.darkPanel, 0, 0, ATTR_GUI_WIDTH, ATTR_GUI_HEIGHT)
    
    // ===== LAYER 2: Header background =====
    gui.addTexturedRect(LAYER.BG_HEADER, TEXTURES.headerBg, 4, 4, ATTR_GUI_WIDTH - 8, 32)
    
    // ===== LAYER 3: Footer background =====
    var buttonY = ATTR_GUI_HEIGHT - 30
    gui.addTexturedRect(LAYER.BG_FOOTER, TEXTURES.headerBg, 4, buttonY - 4, ATTR_GUI_WIDTH - 8, 28)
    
    // ===== LAYER 10-19: Stat row light panels =====
    // ===== LAYER 20-29: Stat row colored accents =====
    var startY = 42
    var rowHeight = 36
    var rowTextures = [TEXTURES.strRow, TEXTURES.vitRow, TEXTURES.dexRow]
    
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var y = startY + (i * rowHeight)
        
        // Row light panel (background layer)
        gui.addTexturedRect(LAYER.BG_ROW_BASE + i, TEXTURES.lightPanel, 14, y, ATTR_GUI_WIDTH - 18, rowHeight - 2)
        
        // Row colored accent strip (slightly above row panel)
        gui.addTexturedRect(LAYER.BG_ROW_ACCENT_BASE + i, rowTextures[i], 4, y, 10, rowHeight - 2)
    }
    
    // ===== LAYER 100+: Labels (Gray/Yellow/Blue Theme) =====
    var labelId = LAYER.CONTENT_LABELS
    
    // Title - gold/yellow
    var titleX = AttrGuiMath.centerX(160)
    gui.addLabel(labelId++, "§e§lCHARACTER STATS", titleX, 8, 160, 14)
    
    // Level and Points row - yellow/white
    gui.addLabel(labelId++, "§eLevel §f" + level, 15, 22, 50, 12)
    
    // Passive HP bonus - gray
    var passiveHP = ATTR_CONFIG.passivePerLevel.health * (level - 1)
    gui.addLabel(labelId++, "§8+§7" + passiveHP + "§8 HP passive", 60, 22, 80, 12)
    
    // Available points - blue when available, gray when empty
    var pointsColor = availablePoints > 0 ? "§b" : "§7"
    gui.addLabel(labelId++, pointsColor + "§lPOINTS: §r§f" + availablePoints, 200, 22, 90, 12)
    
    // Stat row labels
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var statKey = STAT_KEYS[i]
        var stat = ATTR_CONFIG.stats[statKey]
        var points = getStatPoints(player, statKey)
        
        var y = startY + (i * rowHeight)
        
        // Stat icon and name (uses stat's themed color)
        gui.addLabel(labelId++, stat.icon + " " + stat.color + "§l" + stat.name, 20, y + 4, 80, 12)
        
        // Points invested - gray
        gui.addLabel(labelId++, "§7" + points + " pts", 20, y + 17, 50, 10)
        
        // Effect value - gold arrow, gray value
        var effectText = ""
        for (var mcAttr in stat.affects) {
            if (stat.affects.hasOwnProperty(mcAttr)) {
                var currentValue = calculateMcAttribute(player, mcAttr)
                // Format based on attribute type
                if (mcAttr.indexOf("speed") !== -1) {
                    effectText = "§6? §f" + (currentValue * 100).toFixed(0) + "%"
                } else {
                    effectText = "§6? §f" + currentValue.toFixed(1)
                }
            }
        }
        gui.addLabel(labelId++, effectText, 180, y + 4, 60, 12)
        
        // Description (shortened) - gray
        var shortDesc = stat.description.length > 30 ? stat.description.substring(0, 30) + "..." : stat.description
        gui.addLabel(labelId++, "§7" + shortDesc, 85, y + 17, 145, 10)
    }
    
    // ===== LAYER 200+: Buttons (Gray/Yellow/Blue Theme) =====
    // Button ID scheme:
    // 200-202: + buttons for STR, VIT, DEX
    // 250: Reset button (requires Reset Stone)
    // 251: Sync button
    // 253: Close button
    
    // Stat + buttons only (no minus - use Reset Stone)
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var y = startY + (i * rowHeight)
        
        // + Button (IDs: 200, 201, 202) - yellow when available
        var plusId = LAYER.BUTTONS + i
        if (availablePoints > 0) {
            gui.addButton(plusId, "§e§l+", 272, y + 6, 20, 22)
        } else {
            gui.addButton(plusId, "§8+", 272, y + 6, 20, 22).setEnabled(false)
        }
    }
    
    // Bottom buttons (IDs: 250, 251, 253) - themed
    gui.addButton(250, "§7§lRESET", 15, buttonY, 60, 20)
    gui.addButton(251, "§b§lSYNC", 80, buttonY, 50, 20)
    gui.addButton(253, "§f§lCLOSE", 230, buttonY, 60, 20)
    
    player.showCustomGui(gui)
}

// ===== GUI EVENT HANDLERS =====

function _attr_customGuiButton(e) {
    var player = e.player
    if (rejectFrozenCustomGuiMutation(player)) return
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    
    if (guiId !== ATTR_GUI_ID) return
    
    // + Buttons (200-202) for STR, VIT, DEX
    if (buttonId >= 200 && buttonId <= 202) {
        var statIndex = buttonId - 200
        var statKey = STAT_KEYS[statIndex]
        
        if (addPointToStat(player, statKey)) {
            showAttributeGui(player)
        } else {
            player.message("§c[Stats] No points available!")
        }
        return
    }
    
    switch(buttonId) {
        case 250: // Reset All - requires Reset Stone
            if (!hasResetStone(player)) {
                player.message("§c[Stats] You need a " + ATTR_CONFIG.resetItemName + " §cin your main hand to reset stats!")
                return
            }
            consumeResetStone(player)
            resetAllStatPoints(player)
            player.message("§a[Stats] All points reset! Item consumed.")
            showAttributeGui(player)
            break
        case 251: // Sync
            var repairResult = syncPlayerSkills(player, true)
            if (repairResult && !repairResult.ok) {
                player.message("§c[Stats] Sync failed: " + repairResult.message)
                return
            }
            applyAllAttributes(player)
            player.message("§a[Stats] Synced!")
            showAttributeGui(player)
            break
        case 253: // Close
            player.closeGui()
            break
    }
}

// ===== EVENT HANDLERS =====

// Called on player script initialization (every time script loads for player)
function _attr_init(e) {
    var player = e.player
    if (isArvanPersistenceFrozen(player)) return
    // Apply attributes immediately on init to ensure sync
    applyAllAttributes(player)
}

function _attr_login(e) {
    var player = e.player
    player.getStoreddata().put(ATTRIBUTE_RESTORE_PENDING_KEY, "login")
}

function _attr_tick(e) {
    var player = e.player
    var temp = player.getTempdata()

    if (temp.has("attrRestoreNeeded")) {
        temp.remove("attrRestoreNeeded")
        player.getStoreddata().put(ATTRIBUTE_RESTORE_PENDING_KEY, "login")
    }

    if (temp.has("justDied")) {
        temp.remove("justDied")
        player.getStoreddata().put(ATTRIBUTE_RESTORE_PENDING_KEY, "respawn")
    }

    var stored = player.getStoreddata()
    if (stored.has(ATTRIBUTE_RESTORE_PENDING_KEY) && player.isAlive()) {
        var restoreReason = String(stored.get(ATTRIBUTE_RESTORE_PENDING_KEY))
        applyAllAttributes(player)
        stored.remove(ATTRIBUTE_RESTORE_PENDING_KEY)
        player.message(restoreReason === "respawn"
            ? "§b[Stats] §7Restored after respawn!"
            : "§b[Stats] §7Restored!")
    }
}

function _attr_died(e) {
    var player = e.player
    player.getStoreddata().put(ATTRIBUTE_RESTORE_PENDING_KEY, "respawn")
}

function _attr_chat(e) {
    var message = String(e.message).toLowerCase().trim()
    if (message === ATTR_CONFIG.prefix || message === "/attributes") {
        e.setCanceled(true)
        showSelfAttributesGui(e.player)
        return true
    }
    return false
}

function showAttrHelp(player) {
    player.message("§e/attr §7- Open your character stats")
}

var STAT_LIST_GUI_ID = 660
var STAT_EDIT_GUI_ID = 661
var STAT_REGISTRY_PAGE_SIZE = 25
var STAT_LIST_GUI_WIDTH = 420
var STAT_LIST_GUI_HEIGHT = 290
var STAT_EDIT_GUI_WIDTH = 430
var STAT_EDIT_GUI_HEIGHT = 360
var STAT_IDS = {
    SCROLL_STATS: 150,
    SCROLL_EFFECTS: 151,
    SCROLL_ATTRIBUTE_CATALOG: 152,
    FIELD_KEY: 180,
    FIELD_NAME: 181,
    FIELD_ICON: 182,
    FIELD_DESCRIPTION: 183,
    FIELD_ATTRIBUTE: 184,
    FIELD_BASE: 185,
    FIELD_PER_POINT: 186,
    BTN_NEW: 200,
    BTN_EDIT: 201,
    BTN_DELETE: 202,
    BTN_PREVIOUS: 203,
    BTN_NEXT: 204,
    BTN_BACK: 205,
    BTN_SAVE: 210,
    BTN_CANCEL: 211,
    BTN_EFFECT_SET: 212,
    BTN_EFFECT_DELETE: 213,
    BTN_EFFECT_NEW: 214
}

var STAT_ATTRIBUTE_CATALOG = []
var statAttributesScanned = false

function canonicalStatAttributeId(attributeId) {
    var id = String(attributeId || "").toLowerCase().trim()
    if (id && id.indexOf(":") < 0) id = "minecraft:" + id
    return id
}

function createStatAttributeEntry(attributeId) {
    var id = canonicalStatAttributeId(attributeId)
    var path = id.indexOf(":") >= 0 ? id.substring(id.indexOf(":") + 1) : id
    return {
        id: id,
        name: id,
        searchText: (id + " " + path.replace(/[._/-]/g, " ")).toLowerCase()
    }
}

function buildStatAttributeCatalog(attributeIds) {
    var catalog = []
    var seen = {}
    for (var i = 0; i < attributeIds.length; i++) {
        var id = canonicalStatAttributeId(attributeIds[i])
        if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id) || seen[id]) continue
        seen[id] = true
        catalog.push(createStatAttributeEntry(id))
    }
    catalog.sort(function(a, b) {
        if (a.id < b.id) return -1
        if (a.id > b.id) return 1
        return 0
    })
    return catalog
}

function scanStatAttributeRegistry(registry) {
    var attributeIds = []
    var iterator = registry.getKeys().iterator()
    while (iterator.hasNext()) attributeIds.push(String(iterator.next()))
    STAT_ATTRIBUTE_CATALOG = buildStatAttributeCatalog(attributeIds)
    statAttributesScanned = true
    return STAT_ATTRIBUTE_CATALOG
}

function ensureStatAttributesScanned() {
    if (statAttributesScanned) return STAT_ATTRIBUTE_CATALOG
    try {
        var ForgeRegistries = Java.type("net.minecraftforge.registries.ForgeRegistries")
        return scanStatAttributeRegistry(ForgeRegistries.ATTRIBUTES)
    } catch (error) {
        STAT_ATTRIBUTE_CATALOG = []
        statAttributesScanned = true
        return STAT_ATTRIBUTE_CATALOG
    }
}

function getStatAttributeCatalog(draft) {
    ensureStatAttributesScanned()
    var ids = []
    for (var i = 0; i < STAT_ATTRIBUTE_CATALOG.length; i++) ids.push(STAT_ATTRIBUTE_CATALOG[i].id)
    for (var statKey in ATTR_CONFIG.stats) {
        if (!ATTR_CONFIG.stats.hasOwnProperty(statKey)) continue
        var effects = ATTR_CONFIG.stats[statKey].affects || {}
        for (var effectId in effects) {
            if (effects.hasOwnProperty(effectId)) ids.push(effectId)
        }
    }
    var draftEffects = draft && draft.affects ? draft.affects : {}
    for (var draftEffectId in draftEffects) {
        if (draftEffects.hasOwnProperty(draftEffectId)) ids.push(draftEffectId)
    }
    return buildStatAttributeCatalog(ids)
}

function showStatRegistryGui(player, requestedPage) {
    getStatRegistry(player.getWorld())
    var page = parseInt(requestedPage, 10)
    if (isNaN(page)) page = player.getTempdata().has("admStatListPage")
        ? Number(player.getTempdata().get("admStatListPage"))
        : 0
    var maxPage = Math.max(0, Math.ceil(STAT_KEYS.length / STAT_REGISTRY_PAGE_SIZE) - 1)
    if (page < 0) page = 0
    if (page > maxPage) page = maxPage
    var start = page * STAT_REGISTRY_PAGE_SIZE
    var visibleIds = STAT_KEYS.slice(start, start + STAT_REGISTRY_PAGE_SIZE)
    var selectedKey = player.getTempdata().has("admSelectedStatKey")
        ? String(player.getTempdata().get("admSelectedStatKey"))
        : ""
    if (!ATTR_CONFIG.stats[selectedKey]) selectedKey = visibleIds.length > 0 ? visibleIds[0] : ""
    player.getTempdata().put("admStatListPage", page)
    player.getTempdata().put("admStatListIds", JSON.stringify(visibleIds))
    if (selectedKey) player.getTempdata().put("admSelectedStatKey", selectedKey)

    var gui = API.createCustomGui(STAT_LIST_GUI_ID, STAT_LIST_GUI_WIDTH, STAT_LIST_GUI_HEIGHT, false, player)
    addRpgFrame(gui, STAT_LIST_GUI_WIDTH, STAT_LIST_GUI_HEIGHT, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 270, 206, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 288, 40, 122, 206, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, "§b§lSTAT REGISTRY", 145, 10, 150, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7" + STAT_KEYS.length + " definitions", 16, 26, 100, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§7Page §f" + (page + 1) + "§7/§f" + (maxPage + 1), 342, 26, 68, 10)

    var display = []
    for (var i = 0; i < visibleIds.length; i++) {
        var stat = ATTR_CONFIG.stats[visibleIds[i]]
        display.push(stat.color + visibleIds[i] + " §7- " + stat.name)
    }
    var selectedIndex = visibleIds.indexOf(selectedKey)
    var scroll = gui.addScroll(STAT_IDS.SCROLL_STATS, 16, 56, 258, 184, display)
    if (selectedIndex >= 0) scroll.setDefaultSelection(selectedIndex)

    var selected = ATTR_CONFIG.stats[selectedKey]
    if (selected) {
        gui.addLabel(LAYER.CONTENT_LABELS + 3, "§6§lSELECTED STAT", 298, 48, 104, 10)
        gui.addLabel(LAYER.CONTENT_LABELS + 4, selected.color + "§l" + shortGuiText(selected.name, 18), 298, 66, 104, 14).setHoverText("§f" + selected.name)
        gui.addLabel(LAYER.CONTENT_LABELS + 5, "§7Key", 298, 88, 100, 10)
        gui.addLabel(LAYER.CONTENT_LABELS + 6, "§f" + shortGuiText(selected.id, 18), 298, 102, 104, 10).setHoverText("§f" + selected.id)
        gui.addLabel(LAYER.CONTENT_LABELS + 7, "§7Effects §f" + Object.keys(selected.affects).length, 298, 122, 104, 10)
        gui.addLabel(LAYER.CONTENT_LABELS + 8, "§7" + shortGuiText(selected.description, 42), 298, 148, 104, 34).setHoverText("§f" + selected.description)
        gui.addLabel(LAYER.CONTENT_LABELS + 9, "§8Double-click to edit", 298, 222, 104, 10)
    } else {
        gui.addLabel(LAYER.CONTENT_LABELS + 3, "§7Create your first stat", 298, 66, 104, 10)
    }

    gui.addButton(STAT_IDS.BTN_PREVIOUS, "§7<", 12, 262, 28, 20).setEnabled(page > 0)
    gui.addButton(STAT_IDS.BTN_NEW, "§a§lNEW", 48, 262, 52, 20)
    gui.addButton(STAT_IDS.BTN_EDIT, "§e§lEDIT", 106, 262, 54, 20).setEnabled(!!selected)
    gui.addButton(STAT_IDS.BTN_DELETE, "§c§lDEL", 166, 262, 46, 20).setEnabled(!!selected)
    gui.addButton(STAT_IDS.BTN_NEXT, "§7>", 220, 262, 28, 20).setEnabled(page < maxPage)
    gui.addButton(STAT_IDS.BTN_BACK, "§f§lBACK", 346, 262, 62, 20)
    player.showCustomGui(gui)
}

function startStatDraft(player, statKey) {
    var registry = getStatRegistry(player.getWorld())
    var existing = registry[statKey]
    var draft = existing ? JSON.parse(JSON.stringify(existing)) : {
        id: "",
        name: "",
        icon: "",
        description: "",
        color: "§f",
        order: STAT_KEYS.length,
        affects: {}
    }
    draft.originalKey = existing ? statKey : ""
    var temp = player.getTempdata()
    temp.put("admStatDraft", JSON.stringify(draft))
    temp.remove("admSelectedStatEffect")
    temp.remove("admStatEffectCreating")
    temp.remove("admStatEffectInput")
    temp.remove("admSelectedCatalogAttribute")
    return draft
}

function getStatDraft(player) {
    if (!player.getTempdata().has("admStatDraft")) return null
    return JSON.parse(String(player.getTempdata().get("admStatDraft")))
}

function saveStatDraft(player, draft) {
    player.getTempdata().put("admStatDraft", JSON.stringify(draft))
}

function clearStatDraft(player) {
    var temp = player.getTempdata()
    temp.remove("admStatDraft")
    temp.remove("admStatEffectIds")
    temp.remove("admSelectedStatEffect")
    temp.remove("admStatEffectCreating")
    temp.remove("admStatEffectInput")
    temp.remove("admStatAttributeIds")
    temp.remove("admSelectedCatalogAttribute")
}

function captureStatEditorFields(player, gui) {
    var draft = getStatDraft(player)
    if (!draft) return null
    draft.id = String(gui.getComponent(STAT_IDS.FIELD_KEY).getText())
    draft.name = String(gui.getComponent(STAT_IDS.FIELD_NAME).getText())
    draft.icon = String(gui.getComponent(STAT_IDS.FIELD_ICON).getText())
    draft.description = String(gui.getComponent(STAT_IDS.FIELD_DESCRIPTION).getText())
    saveStatDraft(player, draft)
    return draft
}

function getStatEffectInput(player) {
    var temp = player.getTempdata()
    if (!temp.has("admStatEffectInput")) return null
    try {
        return JSON.parse(String(temp.get("admStatEffectInput")))
    } catch (error) {
        temp.remove("admStatEffectInput")
        return null
    }
}

function saveStatEffectInput(player, input) {
    player.getTempdata().put("admStatEffectInput", JSON.stringify(input))
}

function captureStatEffectEditorFields(player, gui) {
    var baseField = gui.getComponent(STAT_IDS.FIELD_BASE)
    var perPointField = gui.getComponent(STAT_IDS.FIELD_PER_POINT)
    if (!baseField || !perPointField) return null
    var previousInput = getStatEffectInput(player)
    var selectedEffect = player.getTempdata().has("admSelectedStatEffect")
        ? String(player.getTempdata().get("admSelectedStatEffect"))
        : ""
    var input = {
        attributeId: previousInput ? String(previousInput.attributeId || "") : selectedEffect,
        base: String(baseField.getText()),
        perPoint: String(perPointField.getText())
    }
    saveStatEffectInput(player, input)
    return input
}

function showStatEditorGui(player) {
    var draft = getStatDraft(player)
    if (!draft) draft = startStatDraft(player, "")
    var effectIds = Object.keys(draft.affects || {}).sort()
    var selectedEffect = player.getTempdata().has("admSelectedStatEffect")
        ? String(player.getTempdata().get("admSelectedStatEffect"))
        : ""
    var creatingEffect = player.getTempdata().has("admStatEffectCreating")
    if (creatingEffect) {
        selectedEffect = ""
    } else if (!draft.affects[selectedEffect]) {
        selectedEffect = effectIds.length > 0 ? effectIds[0] : ""
    }
    if (selectedEffect) {
        player.getTempdata().put("admSelectedStatEffect", selectedEffect)
    } else {
        player.getTempdata().remove("admSelectedStatEffect")
    }
    player.getTempdata().put("admStatEffectIds", JSON.stringify(effectIds))

    var attributeCatalog = getStatAttributeCatalog(draft)
    var visibleAttributeIds = []
    for (var catalogIndex = 0; catalogIndex < attributeCatalog.length; catalogIndex++) {
        visibleAttributeIds.push(attributeCatalog[catalogIndex].id)
    }
    var selectedCatalogAttribute = player.getTempdata().has("admSelectedCatalogAttribute")
        ? String(player.getTempdata().get("admSelectedCatalogAttribute"))
        : ""
    player.getTempdata().put("admStatAttributeIds", JSON.stringify(visibleAttributeIds))

    var selectedData = selectedEffect ? draft.affects[selectedEffect] : null
    var editorAttribute = selectedEffect
    var editorBase = selectedData ? String(selectedData.base) : "0"
    var editorPerPoint = selectedData ? String(selectedData.perPoint) : "0"
    var effectInput = getStatEffectInput(player)
    if (effectInput) {
        editorAttribute = String(effectInput.attributeId || "")
        editorBase = String(effectInput.base === undefined ? "0" : effectInput.base)
        editorPerPoint = String(effectInput.perPoint === undefined ? "0" : effectInput.perPoint)
    }

    var gui = API.createCustomGui(STAT_EDIT_GUI_ID, STAT_EDIT_GUI_WIDTH, STAT_EDIT_GUI_HEIGHT, false, player)
    addRpgFrame(gui, STAT_EDIT_GUI_WIDTH, STAT_EDIT_GUI_HEIGHT, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 410, 76, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 10, 124, 246, 196, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 4, 264, 124, 156, 196, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, draft.originalKey ? "§e§lEDIT STAT" : "§a§lCREATE STAT", 160, 10, 130, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7Key", 18, 42, 50, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§7Name", 142, 42, 50, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 3, "§7Icon", 312, 42, 50, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 4, "§7Description", 18, 72, 80, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 5, "§b§lATTRIBUTE LIBRARY", 18, 132, 120, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 6, "§7" + attributeCatalog.length + " available", 144, 132, 96, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 7, "§6§lSELECTED ATTRIBUTE", 274, 132, 138, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 8, "§7Base", 274, 160, 50, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 9, "§7Per Point", 344, 160, 62, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 10, "§6§lSAVED EFFECTS", 274, 224, 100, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 11, "§7" + effectIds.length + " saved", 374, 224, 40, 10)
    var selectedAttributeLabel = editorAttribute ? "§f" + editorAttribute : "§8No attribute selected"
    gui.addLabel(LAYER.CONTENT_LABELS + 12, shortGuiText(selectedAttributeLabel, 25), 274, 146, 138, 10).setHoverText(editorAttribute)

    var keyField = gui.addTextField(STAT_IDS.FIELD_KEY, 18, 52, 112, 20).setText(draft.id)
    keyField.setEnabled(!draft.originalKey)
    gui.addTextArea(STAT_IDS.FIELD_NAME, 142, 52, 158, 20).setText(draft.name)
    gui.addTextArea(STAT_IDS.FIELD_ICON, 312, 52, 96, 20).setText(draft.icon)
    gui.addTextArea(STAT_IDS.FIELD_DESCRIPTION, 98, 80, 310, 28).setText(draft.description)

    var effectDisplay = []
    for (var i = 0; i < effectIds.length; i++) {
        var effectId = effectIds[i]
        effectDisplay.push(effectId)
    }
    var effectIndex = effectIds.indexOf(selectedEffect)
    var effectScroll = gui.addScroll(STAT_IDS.SCROLL_EFFECTS, 270, 238, 144, 76, effectDisplay)
    if (effectIndex >= 0) effectScroll.setDefaultSelection(effectIndex)

    var attributeScroll = gui.addScroll(STAT_IDS.SCROLL_ATTRIBUTE_CATALOG, 16, 148, 234, 166, visibleAttributeIds)
    var selectedCatalogIndex = visibleAttributeIds.indexOf(selectedCatalogAttribute)
    if (selectedCatalogIndex >= 0) attributeScroll.setDefaultSelection(selectedCatalogIndex)

    gui.addTextField(STAT_IDS.FIELD_BASE, 274, 172, 62, 20).setText(editorBase)
    gui.addTextField(STAT_IDS.FIELD_PER_POINT, 344, 172, 68, 20).setText(editorPerPoint)

    gui.addButton(STAT_IDS.BTN_EFFECT_SET, "§aSET", 274, 198, 42, 20)
    gui.addButton(STAT_IDS.BTN_EFFECT_NEW, "§bNEW", 322, 198, 42, 20)
    gui.addButton(STAT_IDS.BTN_EFFECT_DELETE, "§cDEL", 370, 198, 42, 20).setEnabled(!!selectedData)
    gui.addButton(STAT_IDS.BTN_SAVE, "§a§lSAVE", 125, 332, 80, 20)
    gui.addButton(STAT_IDS.BTN_CANCEL, "§c§lCANCEL", 225, 332, 80, 20)
    player.showCustomGui(gui)
}

function applyAllAttributesToOnlinePlayers(world) {
    var players = world.getAllPlayers()
    for (var i = 0; i < players.length; i++) applyAllAttributes(players[i])
}

function getRegistryAttributeBases(registry) {
    var bases = {}
    for (var statKey in registry) {
        if (!registry.hasOwnProperty(statKey)) continue
        var affects = registry[statKey].affects || {}
        for (var attributeId in affects) {
            if (affects.hasOwnProperty(attributeId) && !bases.hasOwnProperty(attributeId)) {
                bases[attributeId] = Number(affects[attributeId].base) || 0
            }
        }
    }
    return bases
}

function resetRemovedRegistryAttributes(world, previousRegistry, nextRegistry) {
    var previousBases = getRegistryAttributeBases(previousRegistry || {})
    var nextBases = getRegistryAttributeBases(nextRegistry || {})
    var players = world.getAllPlayers()
    for (var attributeId in previousBases) {
        if (!previousBases.hasOwnProperty(attributeId) || nextBases.hasOwnProperty(attributeId)) continue
        for (var i = 0; i < players.length; i++) {
            var value = previousBases[attributeId]
            if (attributeId === "minecraft:generic.max_health") {
                value += ATTR_CONFIG.passivePerLevel.health * (getPlayerLevel(players[i]) - 1)
            }
            runCommand(players[i], "attribute " + players[i].getName() + " " + attributeId + " base set " + value)
        }
    }
}

function saveStatEditor(player, gui) {
    var draft = captureStatEditorFields(player, gui)
    if (!draft) return false
    var key = draft.originalKey || normalizeStatKey(draft.id)
    var name = draft.name.trim()
    if (!key || !name) {
        player.message("§c[Stats] Key and name are required.")
        return false
    }
    var registry = getStatRegistry(player.getWorld())
    var previousRegistry = JSON.parse(JSON.stringify(registry))
    if (!draft.originalKey && registry[key]) {
        player.message("§c[Stats] A stat with key §e" + key + " §calready exists.")
        return false
    }
    draft.id = key
    draft.name = name
    draft.icon = draft.icon.trim() || "[" + key + "]"
    draft.description = draft.description.trim() || "Custom character stat."
    draft.order = draft.originalKey && registry[draft.originalKey]
        ? registry[draft.originalKey].order
        : STAT_KEYS.length
    registry[key] = draft
    saveStatRegistry(player.getWorld(), registry)
    resetRemovedRegistryAttributes(player.getWorld(), previousRegistry, registry)
    player.getTempdata().put("admSelectedStatKey", key)
    clearStatDraft(player)
    applyAllAttributesToOnlinePlayers(player.getWorld())
    player.message("§a[Stats] Saved §e" + name)
    return true
}

function _stat_customGuiButton(e) {
    var player = e.player
    var guiId = e.gui.getID()
    var buttonId = e.buttonId
    if (guiId === STAT_LIST_GUI_ID) {
        var page = player.getTempdata().has("admStatListPage") ? Number(player.getTempdata().get("admStatListPage")) : 0
        var selectedKey = player.getTempdata().has("admSelectedStatKey") ? String(player.getTempdata().get("admSelectedStatKey")) : ""
        if (buttonId === STAT_IDS.BTN_NEW) {
            startStatDraft(player, "")
            showStatEditorGui(player)
        } else if (buttonId === STAT_IDS.BTN_EDIT && ATTR_CONFIG.stats[selectedKey]) {
            startStatDraft(player, selectedKey)
            showStatEditorGui(player)
        } else if (buttonId === STAT_IDS.BTN_DELETE && ATTR_CONFIG.stats[selectedKey]) {
            var registry = getStatRegistry(player.getWorld())
            var previousRegistry = JSON.parse(JSON.stringify(registry))
            delete registry[selectedKey]
            saveStatRegistry(player.getWorld(), registry)
            resetRemovedRegistryAttributes(player.getWorld(), previousRegistry, registry)
            player.getTempdata().remove("admSelectedStatKey")
            applyAllAttributesToOnlinePlayers(player.getWorld())
            showStatRegistryGui(player, page)
        } else if (buttonId === STAT_IDS.BTN_PREVIOUS) {
            showStatRegistryGui(player, page - 1)
        } else if (buttonId === STAT_IDS.BTN_NEXT) {
            showStatRegistryGui(player, page + 1)
        } else if (buttonId === STAT_IDS.BTN_BACK) {
            showAdminGui(player, "Stats")
        }
        return
    }
    if (guiId !== STAT_EDIT_GUI_ID) return
    if (buttonId === STAT_IDS.BTN_CANCEL) {
        clearStatDraft(player)
        showStatRegistryGui(player)
        return
    }
    if (buttonId === STAT_IDS.BTN_SAVE) {
        if (saveStatEditor(player, e.gui)) showStatRegistryGui(player)
        return
    }

    var draft = captureStatEditorFields(player, e.gui)
    if (!draft) return
    if (buttonId === STAT_IDS.BTN_EFFECT_SET) {
        var effectInput = getStatEffectInput(player)
        var attributeId = effectInput
            ? canonicalStatAttributeId(effectInput.attributeId)
            : (player.getTempdata().has("admSelectedStatEffect")
                ? canonicalStatAttributeId(player.getTempdata().get("admSelectedStatEffect"))
                : "")
        var base = parseFloat(e.gui.getComponent(STAT_IDS.FIELD_BASE).getText())
        var perPoint = parseFloat(e.gui.getComponent(STAT_IDS.FIELD_PER_POINT).getText())
        if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(attributeId) || isNaN(base) || isNaN(perPoint)) {
            player.message("§c[Stats] Use a valid namespaced attribute ID and numeric values.")
            return
        }
        var previousEffect = player.getTempdata().has("admSelectedStatEffect")
            ? String(player.getTempdata().get("admSelectedStatEffect"))
            : ""
        if (previousEffect && previousEffect !== attributeId) delete draft.affects[previousEffect]
        draft.affects[attributeId] = { base: base, perPoint: perPoint }
        player.getTempdata().remove("admStatEffectCreating")
        player.getTempdata().remove("admStatEffectInput")
        player.getTempdata().put("admSelectedStatEffect", attributeId)
        saveStatDraft(player, draft)
        showStatEditorGui(player)
    } else if (buttonId === STAT_IDS.BTN_EFFECT_NEW) {
        player.getTempdata().remove("admSelectedStatEffect")
        player.getTempdata().put("admStatEffectCreating", 1)
        saveStatEffectInput(player, { attributeId: "", base: "0", perPoint: "0" })
        saveStatDraft(player, draft)
        showStatEditorGui(player)
    } else if (buttonId === STAT_IDS.BTN_EFFECT_DELETE) {
        var selectedEffect = player.getTempdata().has("admSelectedStatEffect")
            ? String(player.getTempdata().get("admSelectedStatEffect"))
            : ""
        if (selectedEffect) delete draft.affects[selectedEffect]
        player.getTempdata().remove("admSelectedStatEffect")
        player.getTempdata().remove("admStatEffectCreating")
        player.getTempdata().remove("admStatEffectInput")
        saveStatDraft(player, draft)
        showStatEditorGui(player)
    }
}

function _stat_customGuiScroll(e) {
    var player = e.player
    if (e.gui.getID() === STAT_LIST_GUI_ID && e.scrollId === STAT_IDS.SCROLL_STATS) {
        var ids = JSON.parse(String(player.getTempdata().get("admStatListIds")))
        if (e.scrollIndex >= 0 && e.scrollIndex < ids.length) {
            player.getTempdata().put("admSelectedStatKey", ids[e.scrollIndex])
            if (e.doubleClick) {
                startStatDraft(player, ids[e.scrollIndex])
                showStatEditorGui(player)
            } else {
                showStatRegistryGui(player)
            }
        }
        return
    }
    if (e.gui.getID() === STAT_EDIT_GUI_ID && e.scrollId === STAT_IDS.SCROLL_EFFECTS) {
        var draft = captureStatEditorFields(player, e.gui)
        var effectIds = JSON.parse(String(player.getTempdata().get("admStatEffectIds")))
        var selectedEffectId = e.selection && e.selection.length > 0
            ? String(e.selection[0])
            : (e.scrollIndex >= 0 && e.scrollIndex < effectIds.length ? effectIds[e.scrollIndex] : "")
        if (draft && effectIds.indexOf(selectedEffectId) >= 0) {
            saveStatDraft(player, draft)
            player.getTempdata().remove("admStatEffectCreating")
            player.getTempdata().remove("admStatEffectInput")
            player.getTempdata().remove("admSelectedCatalogAttribute")
            player.getTempdata().put("admSelectedStatEffect", selectedEffectId)
            showStatEditorGui(player)
        }
        return
    }
    if (e.gui.getID() === STAT_EDIT_GUI_ID && e.scrollId === STAT_IDS.SCROLL_ATTRIBUTE_CATALOG) {
        var catalogDraft = captureStatEditorFields(player, e.gui)
        var attributeIds = player.getTempdata().has("admStatAttributeIds")
            ? JSON.parse(String(player.getTempdata().get("admStatAttributeIds")))
            : []
        var selectedAttributeId = e.selection && e.selection.length > 0
            ? String(e.selection[0])
            : (e.scrollIndex >= 0 && e.scrollIndex < attributeIds.length ? attributeIds[e.scrollIndex] : "")
        if (catalogDraft && attributeIds.indexOf(selectedAttributeId) >= 0) {
            var input = captureStatEffectEditorFields(player, e.gui) || { attributeId: "", base: "0", perPoint: "0" }
            input.attributeId = selectedAttributeId
            saveStatEffectInput(player, input)
            saveStatDraft(player, catalogDraft)
            player.getTempdata().put("admSelectedCatalogAttribute", input.attributeId)
            showStatEditorGui(player)
        }
    }
}

function _stat_customGuiClosed(e) {
    // Keep the draft across GUI rebuilds. Save and Cancel clear it explicitly.
}

// ============================================
// RATE TIER REGISTRY SYSTEM
// ============================================
// Configurable EXP multipliers by level range
// GUI-based registry accessed from Admin > Leveling > Rate Tiers

// ===== RATE TIER GUI CONFIGURATION =====
var RATE_TIER_GUI_WIDTH = 400
var RATE_TIER_GUI_HEIGHT = 280
var RATE_TIER_GUI_ID = 450           // Main rate tier list GUI
var RATE_TIER_ADD_GUI_ID = 451       // Add new tier GUI
var RATE_TIER_EDIT_GUI_ID = 452      // Edit tier GUI

// ===== RATE TIER LIST GUI =====
function showRateTierListGui(player) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var gui = API.createCustomGui(RATE_TIER_GUI_ID, RATE_TIER_GUI_WIDTH, RATE_TIER_GUI_HEIGHT, false, player)
    var tiers = CONFIG.expCurveTiers
    var selectedIndex = player.getTempdata().has("selectedRateTierIndex")
        ? parseInt(player.getTempdata().get("selectedRateTierIndex"), 10)
        : -1
    if (selectedIndex < 0 || selectedIndex >= tiers.length) selectedIndex = -1

    addRpgFrame(gui, RATE_TIER_GUI_WIDTH, RATE_TIER_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 260, 198, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 278, 40, 112, 198, RPG_UI.cyan)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§6§l✦ EXP CURVE TIERS", 125, 10, 170, 14)
    gui.addLabel(labelId++, "§7" + tiers.length + " configured ranges", 14, 26, 130, 10)

    var scrollList = []
    if (tiers.length > 0) {
        for (var i = 0; i < tiers.length; i++) {
            var tier = tiers[i]
            var rateColor = tier.expRate >= 1.2 ? "§c" : tier.expRate >= 1.1 ? "§e" : "§a"
            scrollList.push("§eLv " + tier.minLevel + "-" + tier.maxLevel + " §7→ " + rateColor + tier.expRate + "x §7curve")
        }
    } else {
        scrollList.push("§8(No tiers configured)")
    }
    player.getTempdata().put("rateTierCount", tiers.length)
    var scroll = gui.addScroll(LAYER.SCROLL_LIST, 16, 56, 248, 176, scrollList)
    if (selectedIndex >= 0) scroll.setDefaultSelection(selectedIndex)

    gui.addLabel(labelId++, "§b§lSELECTED TIER", 288, 48, 96, 10)
    if (selectedIndex >= 0) {
        var selectedTier = tiers[selectedIndex]
        var increase = Math.round((selectedTier.expRate - 1) * 100)
        gui.addLabel(labelId++, "§fLevels " + selectedTier.minLevel + " - " + selectedTier.maxLevel, 288, 68, 96, 12)
        gui.addLabel(labelId++, "§e§l" + selectedTier.expRate + "x curve", 288, 92, 96, 12)
        gui.addLabel(labelId++, "§7Approximately", 288, 120, 96, 10)
        gui.addLabel(labelId++, "§f+" + increase + "% per level", 288, 134, 96, 10)
        gui.addLabel(labelId++, "§8Applies when entering", 288, 170, 96, 10)
        gui.addLabel(labelId++, "§8this level range", 288, 182, 96, 10)
    } else {
        gui.addLabel(labelId++, "§7Choose a range", 288, 68, 96, 10)
        gui.addLabel(labelId++, "§7to inspect its", 288, 82, 96, 10)
        gui.addLabel(labelId++, "§7growth rate.", 288, 96, 96, 10)
        gui.addLabel(labelId++, "§8Example: 1.15", 288, 132, 96, 10)
        gui.addLabel(labelId++, "§8adds about 15%", 288, 144, 96, 10)
        gui.addLabel(labelId++, "§8per level.", 288, 156, 96, 10)
    }

    gui.addButton(LAYER.BUTTONS + 4, "§7<", 12, RATE_TIER_GUI_HEIGHT - 28, 28, 20)
    gui.addButton(LAYER.BUTTONS, "§a§lNEW", 48, RATE_TIER_GUI_HEIGHT - 28, 54, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§e§lEDIT", 108, RATE_TIER_GUI_HEIGHT - 28, 54, 20).setEnabled(selectedIndex >= 0)
    gui.addButton(LAYER.BUTTONS + 2, "§c§lDEL", 168, RATE_TIER_GUI_HEIGHT - 28, 46, 20).setEnabled(selectedIndex >= 0)
    gui.addButton(LAYER.BUTTONS + 3, "§f§lBACK", 326, RATE_TIER_GUI_HEIGHT - 28, 62, 20)
    player.showCustomGui(gui)
}
function showAddRateTierGui(player) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var width = 360
    var height = 230
    var gui = API.createCustomGui(RATE_TIER_ADD_GUI_ID, width, height, false, player)
    var tiers = CONFIG.expCurveTiers
    var suggestMin = 1
    var suggestMax = 10
    if (tiers.length > 0) {
        var lastTier = tiers[tiers.length - 1]
        suggestMin = lastTier.maxLevel + 1
        suggestMax = Math.min(suggestMin + 10, CONFIG.maxLevel)
    }

    addRpgFrame(gui, width, height, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 340, 146, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, "§a§lADD EXP CURVE TIER", 105, 10, 170, 14)
    var labelId = LAYER.CONTENT_LABELS + 1
    var fieldId = LAYER.TEXT_FIELDS

    gui.addLabel(labelId++, "§7Minimum Level", 24, 58, 110, 10)
    gui.addTextField(fieldId++, 24, 72, 140, 20).setText("" + suggestMin)
    gui.addLabel(labelId++, "§7Maximum Level", 196, 58, 110, 10)
    gui.addTextField(fieldId++, 196, 72, 140, 20).setText("" + suggestMax)
    gui.addLabel(labelId++, "§7EXP Growth Rate", 24, 108, 130, 10)
    gui.addTextField(fieldId++, 24, 122, 140, 20).setText("1.15")
    gui.addLabel(labelId++, "§f1.15 §7means roughly +15% EXP per level", 178, 124, 158, 20)
    gui.addLabel(labelId++, "§8Ranges should not overlap. Higher rates create steeper progression.", 24, 158, 310, 10)

    gui.addButton(LAYER.BUTTONS, "§a§lADD TIER", 92, 202, 80, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§7§lCANCEL", 188, 202, 80, 20)
    player.showCustomGui(gui)
}
function showEditRateTierGui(player, tierIndex) {
    if (tierIndex < 0 || tierIndex >= CONFIG.expCurveTiers.length) {
        player.message("§c[Curve Tier] Invalid tier selection!")
        showRateTierListGui(player)
        return
    }

    var tier = CONFIG.expCurveTiers[tierIndex]
    player.getTempdata().put("editTierIndex", tierIndex)

    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var width = 360
    var height = 230
    var gui = API.createCustomGui(RATE_TIER_EDIT_GUI_ID, width, height, false, player)

    addRpgFrame(gui, width, height, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 340, 146, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, "§e§lEDIT EXP CURVE TIER §7#" + (tierIndex + 1), 96, 10, 190, 14)
    var labelId = LAYER.CONTENT_LABELS + 1
    var fieldId = LAYER.TEXT_FIELDS

    gui.addLabel(labelId++, "§7Minimum Level", 24, 58, 110, 10)
    gui.addTextField(fieldId++, 24, 72, 140, 20).setText("" + tier.minLevel)
    gui.addLabel(labelId++, "§7Maximum Level", 196, 58, 110, 10)
    gui.addTextField(fieldId++, 196, 72, 140, 20).setText("" + tier.maxLevel)
    gui.addLabel(labelId++, "§7EXP Growth Rate", 24, 108, 130, 10)
    gui.addTextField(fieldId++, 24, 122, 140, 20).setText("" + tier.expRate)
    gui.addLabel(labelId++, "§f" + tier.expRate + "x §7controls the increase inside this range", 178, 124, 158, 20)
    gui.addLabel(labelId++, "§8Changes apply to future EXP calculations immediately.", 24, 158, 310, 10)

    gui.addButton(LAYER.BUTTONS, "§a§lSAVE", 92, 202, 80, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§7§lCANCEL", 188, 202, 80, 20)
    player.showCustomGui(gui)
}
function _rateTier_customGuiButton(e) {
    var player = e.player
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    
    // Rate Tier List GUI
    if (guiId === RATE_TIER_GUI_ID) {
        if (buttonId === LAYER.BUTTONS + 4) {
            // Back button - return to admin Leveling
            showAdminGui(player, "Leveling")
            return
        }
        if (buttonId === LAYER.BUTTONS) {
            // New tier
            showAddRateTierGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 1) {
            // Edit selected tier
            var selectedIndex = player.getTempdata().has("selectedRateTierIndex") 
                ? player.getTempdata().get("selectedRateTierIndex") 
                : -1
            if (selectedIndex < 0) {
                player.message("§c[Rate Tier] Select a tier first!")
                return
            }
            showEditRateTierGui(player, selectedIndex)
            return
        }
        if (buttonId === LAYER.BUTTONS + 2) {
            // Delete selected tier
            var selectedIndex = player.getTempdata().has("selectedRateTierIndex") 
                ? player.getTempdata().get("selectedRateTierIndex") 
                : -1
            if (selectedIndex < 0) {
                player.message("§c[Curve Tier] Select a tier first!")
                return
            }
            if (selectedIndex >= 0 && selectedIndex < CONFIG.expCurveTiers.length) {
                var deletedTier = CONFIG.expCurveTiers[selectedIndex]
                CONFIG.expCurveTiers.splice(selectedIndex, 1)
                saveConfigToWorld(player.getWorld())
                player.message("§c[Curve Tier] Deleted tier Lv " + deletedTier.minLevel + "-" + deletedTier.maxLevel)
                player.getTempdata().remove("selectedRateTierIndex")
            }
            showRateTierListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 3) {
            // Close
            showAdminGui(player, "Leveling")
            return
        }
    }
    
    // Add Tier GUI
    if (guiId === RATE_TIER_ADD_GUI_ID) {
        if (buttonId === LAYER.BUTTONS) {
            // Add button - save new tier
            try {
                var minLvl = parseInt(gui.getComponent(LAYER.TEXT_FIELDS).getText())
                var maxLvl = parseInt(gui.getComponent(LAYER.TEXT_FIELDS + 1).getText())
                var expRate = parseFloat(gui.getComponent(LAYER.TEXT_FIELDS + 2).getText())
                
                if (isNaN(minLvl) || minLvl < 1) {
                    player.message("§c[Curve Tier] Invalid min level!")
                    return
                }
                if (isNaN(maxLvl) || maxLvl < minLvl) {
                    player.message("§c[Curve Tier] Max level must be >= min level!")
                    return
                }
                if (isNaN(expRate) || expRate < 1.0) {
                    player.message("§c[Curve Tier] Exp rate must be >= 1.0!")
                    return
                }
                
                CONFIG.expCurveTiers.push({
                    minLevel: minLvl,
                    maxLevel: maxLvl,
                    expRate: expRate
                })
                
                // Sort by minLevel
                CONFIG.expCurveTiers.sort(function(a, b) { return a.minLevel - b.minLevel })
                
                saveConfigToWorld(player.getWorld())
                player.message("§a[Curve Tier] Added tier Lv " + minLvl + "-" + maxLvl + " (" + expRate + "x curve)")
            } catch (err) {
                player.message("§c[Curve Tier] Error: " + err)
            }
            showRateTierListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 1) {
            // Cancel
            showRateTierListGui(player)
            return
        }
    }
    
    // Edit Tier GUI
    if (guiId === RATE_TIER_EDIT_GUI_ID) {
        if (buttonId === LAYER.BUTTONS) {
            // Save button
            var tierIndex = player.getTempdata().has("editTierIndex") 
                ? player.getTempdata().get("editTierIndex") 
                : -1
            if (tierIndex < 0 || tierIndex >= CONFIG.expCurveTiers.length) {
                player.message("§c[Curve Tier] Invalid tier!")
                showRateTierListGui(player)
                return
            }
            
            try {
                var minLvl = parseInt(gui.getComponent(LAYER.TEXT_FIELDS).getText())
                var maxLvl = parseInt(gui.getComponent(LAYER.TEXT_FIELDS + 1).getText())
                var expRate = parseFloat(gui.getComponent(LAYER.TEXT_FIELDS + 2).getText())
                
                if (isNaN(minLvl) || minLvl < 1) {
                    player.message("§c[Curve Tier] Invalid min level!")
                    return
                }
                if (isNaN(maxLvl) || maxLvl < minLvl) {
                    player.message("§c[Curve Tier] Max level must be >= min level!")
                    return
                }
                if (isNaN(expRate) || expRate < 1.0) {
                    player.message("§c[Curve Tier] Exp rate must be >= 1.0!")
                    return
                }
                
                CONFIG.expCurveTiers[tierIndex] = {
                    minLevel: minLvl,
                    maxLevel: maxLvl,
                    expRate: expRate
                }
                
                // Sort by minLevel
                CONFIG.expCurveTiers.sort(function(a, b) { return a.minLevel - b.minLevel })
                
                saveConfigToWorld(player.getWorld())
                player.message("§a[Curve Tier] Updated tier Lv " + minLvl + "-" + maxLvl + " (" + expRate + "x curve)")
            } catch (err) {
                player.message("§c[Curve Tier] Error: " + err)
            }
            showRateTierListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 1) {
            // Cancel
            showRateTierListGui(player)
            return
        }
    }
}

// Handle scroll selection for rate tiers
function _rateTier_customGuiScroll(e) {
    var player = e.player
    var gui = e.gui
    var guiId = gui.getID()
    var scrollId = e.scrollId
    var scrollIndex = e.scrollIndex
    
    if (guiId === RATE_TIER_GUI_ID && scrollId === LAYER.SCROLL_LIST) {
        var tierCount = player.getTempdata().has("rateTierCount") 
            ? player.getTempdata().get("rateTierCount") 
            : 0
        
        if (scrollIndex >= 0 && scrollIndex < tierCount) {
            player.getTempdata().put("selectedRateTierIndex", scrollIndex)
            showRateTierListGui(player)
        }
    }
}

// ============================================
// MOB REWARDS SYSTEM SECTION
// ============================================
// Configure EXP rewards for killing vanilla/modded mobs
// GUI-based registry similar to Quest EXP System

// ===== MOB REWARDS GUI CONFIGURATION =====
var MOB_GUI_WIDTH = 400
var MOB_GUI_HEIGHT = 280
var MOB_REWARDS_GUI_ID = 360       // Main mob list GUI
var MOB_REWARDS_ADD_GUI_ID = 361   // Add new mob GUI
var MOB_REWARDS_EDIT_GUI_ID = 362  // Edit mob GUI

// ===== MOB REWARDS CONFIGURATION =====
var MOB_CONFIG = {
    registryKey: "mobExpRegistry",
    // Default EXP values for common mobs
    defaultRewards: {
        "minecraft:zombie": 10,
        "minecraft:skeleton": 10,
        "minecraft:spider": 8,
        "minecraft:creeper": 15,
        "minecraft:enderman": 25
    },
    expGainMessage: "§a+{EXP} EXP §7({MOB})",
    spiritGainMessage: "§b+{SPIRIT} Spirit §7({MOB})"
}

// ===== MOB REWARDS REGISTRY FUNCTIONS =====

// Get mob EXP registry from world storeddata
function getMobExpRegistry(world) {
    var stored = world.getStoreddata()
    if (stored.has(MOB_CONFIG.registryKey)) {
        try {
            return JSON.parse(stored.get(MOB_CONFIG.registryKey))
        } catch (e) {
            return {}
        }
    }
    return {}
}

// Save mob EXP registry to world storeddata
function saveMobExpRegistry(world, registry) {
    var stored = world.getStoreddata()
    stored.put(MOB_CONFIG.registryKey, JSON.stringify(registry))
}

// Add or update a mob in registry
function registerMobExp(world, mobId, expAmount, spiritAmount) {
    var registry = getMobExpRegistry(world)
    var source = expAmount && typeof expAmount === "object" ? expAmount : { exp: expAmount, spirit: spiritAmount }
    registry[mobId] = {
        exp: normalizeWholeResource(source.exp, 0, CURRENCY_MAX_SAFE_INTEGER),
        spirit: normalizeWholeResource(source.spirit, 0, SPIRIT_MAX_SAFE_INTEGER)
    }
    saveMobExpRegistry(world, registry)
    return true
}

// Remove a mob from registry
function unregisterMobExp(world, mobId) {
    var registry = getMobExpRegistry(world)
    if (registry[mobId]) {
        delete registry[mobId]
        saveMobExpRegistry(world, registry)
        return true
    }
    return false
}

// Get EXP for a mob
function getMobExp(world, mobId) {
    var registry = getMobExpRegistry(world)
    if (registry[mobId]) {
        return registry[mobId].exp
    }
    return null
}

// Get list of all registered mob IDs
function getRegisteredMobIds(world) {
    var registry = getMobExpRegistry(world)
    return Object.keys(registry)
}

// ===== MOB REWARDS GUI - MAIN LIST =====

function showMobRewardsListGui(player) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var gui = API.createCustomGui(MOB_REWARDS_GUI_ID, MOB_GUI_WIDTH, MOB_GUI_HEIGHT, false, player)
    var world = player.getWorld()
    var registry = getMobExpRegistry(world)
    var mobIds = Object.keys(registry)
    var selectedMob = player.getTempdata().has("selectedMob")
        ? String(player.getTempdata().get("selectedMob"))
        : ""
    if (!registry[selectedMob]) selectedMob = ""

    addRpgFrame(gui, MOB_GUI_WIDTH, MOB_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 260, 198, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 278, 40, 112, 198, RPG_UI.cyan)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§6§lMOB REWARD REGISTRY", 120, 10, 180, 14)
    gui.addLabel(labelId++, "§7" + mobIds.length + " configured mobs", 14, 26, 120, 10)

    var scrollEntries = []
    for (var i = 0; i < mobIds.length; i++) {
        var mobId = mobIds[i]
        var reward = registry[mobId] || {}
        scrollEntries.push("§e" + normalizeWholeResource(reward.exp, 0, CURRENCY_MAX_SAFE_INTEGER) + " EXP §7/ §b" + normalizeWholeResource(reward.spirit, 0, SPIRIT_MAX_SAFE_INTEGER) + " Spirit §7• §f" + mobId)
    }
    if (scrollEntries.length === 0) scrollEntries.push("§8(No mobs registered)")

    var scroll = gui.addScroll(LAYER.SCROLL_LIST, 16, 56, 248, 176, scrollEntries)
    var selectedIndex = mobIds.indexOf(selectedMob)
    if (selectedIndex >= 0) scroll.setDefaultSelection(selectedIndex)

    gui.addLabel(labelId++, "§b§lSELECTED MOB", 288, 48, 96, 10)
    if (selectedMob) {
        var namespaceParts = selectedMob.split(":")
        var displayName = namespaceParts.length > 1 ? namespaceParts[1] : selectedMob
        gui.addLabel(labelId++, "§f" + shortGuiText(displayName, 17), 288, 68, 96, 12).setHoverText("§f" + selectedMob)
        gui.addLabel(labelId++, "§7Entity ID", 288, 94, 96, 10)
        gui.addLabel(labelId++, "§f" + shortGuiText(selectedMob, 18), 288, 108, 96, 20).setHoverText("§f" + selectedMob)
        gui.addLabel(labelId++, "§7Kill Reward", 288, 144, 96, 10)
        gui.addLabel(labelId++, "§e§l" + normalizeWholeResource(registry[selectedMob].exp, 0, CURRENCY_MAX_SAFE_INTEGER) + " EXP", 288, 160, 96, 12)
        gui.addLabel(labelId++, "§b§l" + normalizeWholeResource(registry[selectedMob].spirit, 0, SPIRIT_MAX_SAFE_INTEGER) + " Spirit", 288, 176, 96, 12)
        gui.addLabel(labelId++, "§8Double-clicking is", 288, 202, 96, 10)
        gui.addLabel(labelId++, "§8not required; use Edit.", 288, 214, 96, 10)
    } else {
        gui.addLabel(labelId++, "§7Select a mob to", 288, 68, 96, 10)
        gui.addLabel(labelId++, "§7inspect its reward.", 288, 82, 96, 10)
        gui.addLabel(labelId++, "§8Modded entity IDs", 288, 118, 96, 10)
        gui.addLabel(labelId++, "§8are supported.", 288, 130, 96, 10)
    }

    gui.addButton(LAYER.BUTTONS, "§7<", 12, 252, 28, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§a§lNEW", 48, 252, 54, 20)
    gui.addButton(LAYER.BUTTONS + 2, "§e§lEDIT", 108, 252, 54, 20).setEnabled(!!selectedMob)
    gui.addButton(LAYER.BUTTONS + 3, "§c§lDEL", 168, 252, 46, 20).setEnabled(!!selectedMob)
    gui.addButton(LAYER.BUTTONS + 4, "§f§lBACK", 326, 252, 62, 20)
    player.showCustomGui(gui)
}
function showAddMobGui(player) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var width = 360
    var height = 230
    var gui = API.createCustomGui(MOB_REWARDS_ADD_GUI_ID, width, height, false, player)

    addRpgFrame(gui, width, height, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 340, 146, RPG_UI.cyan)
    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§a§lADD MOB REWARD", 120, 10, 150, 14)
    gui.addLabel(labelId++, "§7Entity ID", 24, 58, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS, 24, 72, 312, 20).setText("minecraft:")
    gui.addLabel(labelId++, "§7EXP Reward", 24, 108, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 1, 24, 122, 140, 20).setText("10")
    gui.addLabel(labelId++, "§7Spirit Reward", 178, 108, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 2, 178, 122, 140, 20).setText("0")
    gui.addLabel(labelId++, "§fExample §7minecraft:zombie", 24, 158, 150, 10)
    gui.addLabel(labelId++, "§8Vanilla and modded namespaced IDs are accepted.", 24, 172, 310, 10)

    gui.addButton(LAYER.BUTTONS, "§7§lCANCEL", 92, 202, 80, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§a§lADD MOB", 188, 202, 80, 20)
    player.showCustomGui(gui)
}
function showEditMobGui(player, mobId) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var world = player.getWorld()
    var mobData = getMobExpRegistry(world)[mobId]
    if (!mobData) {
        player.message("§c[Mob Rewards] Mob not found: " + mobId)
        showMobRewardsListGui(player)
        return
    }

    player.getTempdata().put("editingMob", mobId)
    var width = 360
    var height = 230
    var gui = API.createCustomGui(MOB_REWARDS_EDIT_GUI_ID, width, height, false, player)

    addRpgFrame(gui, width, height, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 340, 146, RPG_UI.gold)
    var labelId = LAYER.CONTENT_LABELS
    var displayName = mobId.split(":")[1] || mobId
    gui.addLabel(labelId++, "§e§lEDIT MOB REWARD", 120, 10, 150, 14)
    gui.addLabel(labelId++, "§7Entity", 24, 58, 100, 10)
    gui.addLabel(labelId++, "§f" + shortGuiText(displayName, 40), 24, 72, 312, 12).setHoverText("§f" + mobId)
    gui.addLabel(labelId++, "§7Entity ID §f" + shortGuiText(mobId, 38), 24, 94, 312, 10).setHoverText("§f" + mobId)
    gui.addLabel(labelId++, "§7EXP Reward", 24, 122, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS, 24, 136, 140, 20).setText("" + normalizeWholeResource(mobData.exp, 0, CURRENCY_MAX_SAFE_INTEGER))
    gui.addLabel(labelId++, "§7Spirit Reward", 188, 122, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 1, 188, 136, 140, 20).setText("" + normalizeWholeResource(mobData.spirit, 0, SPIRIT_MAX_SAFE_INTEGER))
    gui.addLabel(labelId++, "§8These values are awarded for every registered kill.", 24, 164, 310, 20)

    gui.addButton(LAYER.BUTTONS, "§7§lCANCEL", 92, 202, 80, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§e§lSAVE", 188, 202, 80, 20)
    player.showCustomGui(gui)
}
function _mobRewards_customGuiButton(e) {
    var player = e.player
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    var world = player.getWorld()
    
    // Main list GUI
    if (guiId === MOB_REWARDS_GUI_ID) {
        if (buttonId === LAYER.BUTTONS) {
            // Back to Admin panel
            showAdminGui(player, "Leveling")
            return
        }
        if (buttonId === LAYER.BUTTONS + 1) {
            // Add new mob
            showAddMobGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 2) {
            // Edit selected mob
            var selectedMob = player.getTempdata().has("selectedMob") ? player.getTempdata().get("selectedMob") : null
            if (selectedMob) {
                showEditMobGui(player, selectedMob)
            } else {
                player.message("§c[Mob Rewards] Select a mob first!")
            }
            return
        }
        if (buttonId === LAYER.BUTTONS + 3) {
            // Delete selected mob
            var selectedMob = player.getTempdata().has("selectedMob") ? player.getTempdata().get("selectedMob") : null
            if (selectedMob) {
                unregisterMobExp(world, selectedMob)
                player.getTempdata().remove("selectedMob")
                player.message("§a[Mob Rewards] Removed: " + selectedMob)
                showMobRewardsListGui(player)
            } else {
                player.message("§c[Mob Rewards] Select a mob first!")
            }
            return
        }
        if (buttonId === LAYER.BUTTONS + 4) {
            // Close
            showAdminGui(player, "Leveling")
            return
        }
    }
    
    // Add new mob GUI
    if (guiId === MOB_REWARDS_ADD_GUI_ID) {
        if (buttonId === LAYER.BUTTONS) {
            // Cancel
            showMobRewardsListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 1) {
            // Add
            var mobIdField = gui.getComponent(LAYER.TEXT_FIELDS)
            var expField = gui.getComponent(LAYER.TEXT_FIELDS + 1)
            
            var mobId = mobIdField.getText().trim()
            var exp = parseInt(expField.getText())
            var spiritField = gui.getComponent(LAYER.TEXT_FIELDS + 2)
            var spirit = spiritField ? parseInt(spiritField.getText()) : 0
            
            if (!mobId || mobId === "minecraft:" || mobId.length < 3) {
                player.message("§c[Mob Rewards] Enter a valid mob ID!")
                return
            }
            if (isNaN(exp) || exp < 0 || isNaN(spirit) || spirit < 0 || spirit > SPIRIT_MAX_SAFE_INTEGER) {
                player.message("§c[Mob Rewards] Enter a valid EXP amount!")
                return
            }
            
            registerMobExp(world, mobId, exp, spirit)
            player.message("§a[Mob Rewards] Added: " + mobId + " = " + exp + " EXP / " + spirit + " Spirit")
            showMobRewardsListGui(player)
            return
        }
    }
    
    // Edit mob GUI
    if (guiId === MOB_REWARDS_EDIT_GUI_ID) {
        if (buttonId === LAYER.BUTTONS) {
            // Cancel
            player.getTempdata().remove("editingMob")
            showMobRewardsListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 1) {
            // Save
            var mobId = player.getTempdata().get("editingMob")
            var expField = gui.getComponent(LAYER.TEXT_FIELDS)
            var spiritField = gui.getComponent(LAYER.TEXT_FIELDS + 1)
            
            var exp = parseInt(expField.getText())
            var spirit = spiritField ? parseInt(spiritField.getText()) : 0
            
            if (isNaN(exp) || exp < 0 || isNaN(spirit) || spirit < 0 || spirit > SPIRIT_MAX_SAFE_INTEGER) {
                player.message("§c[Mob Rewards] Enter a valid EXP amount!")
                return
            }
            
            registerMobExp(world, mobId, exp, spirit)
            player.message("§a[Mob Rewards] Updated: " + mobId + " = " + exp + " EXP / " + spirit + " Spirit")
            player.getTempdata().remove("editingMob")
            showMobRewardsListGui(player)
            return
        }
    }
}

// Handle scroll selection
function _mobRewards_customGuiScroll(e) {
    var player = e.player
    var gui = e.gui
    var guiId = gui.getID()
    var world = player.getWorld()
    
    if (guiId !== MOB_REWARDS_GUI_ID) return
    
    var selection = e.selection
    if (!selection || selection.length === 0) return
    
    var selectedEntry = selection[0]
    if (selectedEntry.indexOf("(No mobs registered)") >= 0) return
    
    // Parse mob ID from entry format: "§e10 EXP §7- §fzombie"
    var registry = getMobExpRegistry(world)
    var mobIds = Object.keys(registry)
    var scrollIndex = e.scrollIndex
    
    if (scrollIndex >= 0 && scrollIndex < mobIds.length) {
        var selectedMob = mobIds[scrollIndex]
        player.getTempdata().put("selectedMob", selectedMob)
        showMobRewardsListGui(player)
    }
}

// ===== MOB KILL EVENT HANDLER =====
// Awards EXP when player kills a registered mob
function _mob_killedEntity(e) {
    var player = e.player
    var entity = e.entity
    var world = player.getWorld()
    
    // Get the entity's type name (e.g., "minecraft:zombie")
    var entityType = entity.getTypeName()
    
    // Check if this mob is registered for EXP and/or Spirit reward.
    var reward = getMobReward(world, entityType)
    if (!reward) {
        var legacyExp = getMobExp(world, entityType)
        if (legacyExp !== null && legacyExp !== undefined) reward = { exp: normalizeWholeResource(legacyExp, 0, CURRENCY_MAX_SAFE_INTEGER), spirit: 0 }
    }
    if (reward) {
        var expAmount = reward.exp > 0 ? awardMobLevelKillExp(player, entity, reward.exp) : 0
        var entityUuid = ""
        try { entityUuid = String(entity.getUUID()) } catch (ignored) {}
        var spiritResult = awardSpiritOnce(player, reward.spirit, "Mob kill", "mob:" + entityType + ":" + entityUuid + ":" + String(world.getTotalTime()))
        if (expAmount <= 0 && spiritResult.awarded <= 0) return

        var displayName = entityType.split(":")[1] || entityType
    }
}

// ============================================
// QUEST EXP SYSTEM SECTION
// ============================================
// Configure EXP rewards for quest completion/turn-in
// GUI-based registry similar to Equipment System

// ===== QUEST GUI CONFIGURATION =====
var QUEST_GUI_WIDTH = 400
var QUEST_GUI_HEIGHT = 280
var QUEST_GUI_ID = 350           // Main quest list GUI
var QUEST_ADD_GUI_ID = 351       // Add new quest GUI
var QUEST_EDIT_GUI_ID = 352      // Edit quest GUI

// ===== QUEST CONFIGURATION =====
var QUEST_CONFIG = {
    prefix: "/quest",
    
    // Storage key for quest registry (world storeddata)
    registryKey: "questExpRegistry",
    
    // Quest types
    types: ["turnin", "complete"],
    
    // Type colors for display (Gray/Yellow/Blue Theme)
    typeColors: {
        "turnin": "§e",
        "complete": "§b"
    },
    
    // Message settings
    expGainMessage: "§a+{EXP} EXP §7from quest: §f{QUEST}",
    spiritGainMessage: "§b+{SPIRIT} Spirit §7from quest: §f{QUEST}",
    firstTimeSpiritPolicyKey: "questFirstTimeSpiritPolicyV1"
}

function getQuestFirstTimeSpiritPolicy(world) {
    var stored = world && world.getStoreddata ? world.getStoreddata() : null
    if (!stored || !stored.has(QUEST_CONFIG.firstTimeSpiritPolicyKey)) return { mode: "DISABLED", enabledAt: 0 }
    try {
        var policy = JSON.parse(String(stored.get(QUEST_CONFIG.firstTimeSpiritPolicyKey) || "{}"))
        if (policy && policy.mode === "ALLOW_UNMARKED") return { mode: "ALLOW_UNMARKED", enabledAt: Number(policy.enabledAt || 0) }
    } catch (error) {}
    return { mode: "DISABLED", enabledAt: 0 }
}

function setQuestFirstTimeSpiritPolicy(world, mode) {
    if (!world || !world.getStoreddata) return false
    var normalized = String(mode || "DISABLED").toUpperCase() === "ALLOW_UNMARKED" ? "ALLOW_UNMARKED" : "DISABLED"
    var enabledAt = 0
    try { enabledAt = Number(world.getTotalTime()) } catch (error) {}
    world.getStoreddata().put(QUEST_CONFIG.firstTimeSpiritPolicyKey, JSON.stringify({ mode: normalized, enabledAt: enabledAt, revision: 1 }))
    return true
}

function questFirstTimeSpiritAllowed(world) {
    return getQuestFirstTimeSpiritPolicy(world).mode === "ALLOW_UNMARKED"
}

// ===== QUEST REGISTRY FUNCTIONS =====

// Get quest registry from world storeddata
function getQuestRegistry(world) {
    var stored = world.getStoreddata()
    if (!stored.has(QUEST_CONFIG.registryKey)) {
        return {}
    }
    
    try {
        var json = stored.get(QUEST_CONFIG.registryKey)
        return JSON.parse(json)
    } catch (ex) {
        return {}
    }
}

// Save quest registry to world storeddata
function saveQuestRegistry(world, registry) {
    var stored = world.getStoreddata()
    stored.put(QUEST_CONFIG.registryKey, JSON.stringify(registry))
}

// Add or update a quest in registry
function registerQuestExp(world, questId, config) {
    var registry = getQuestRegistry(world)
    registry[questId] = {
        questId: questId,
        name: config.name || "Quest #" + questId,
        type: config.type || "complete",
        exp: config.exp || 0,
        bonusFirstTime: normalizeWholeResource(config.bonusFirstTime, 0, CURRENCY_MAX_SAFE_INTEGER),
        spirit: normalizeWholeResource(config.spirit !== undefined ? config.spirit : config.spiritReward, 0, SPIRIT_MAX_SAFE_INTEGER),
        bonusFirstTimeSpirit: normalizeWholeResource(config.bonusFirstTimeSpirit !== undefined ? config.bonusFirstTimeSpirit : config.firstTimeSpirit, 0, SPIRIT_MAX_SAFE_INTEGER)
    }
    saveQuestRegistry(world, registry)
}

function questRewardCycle(e, quest, world) {
    var stored = e.player.getStoreddata(), key = "arvanQuestRewardCycle:" + String(quest.getId())
    // QuestStart owns repeatable-quest identity; already-active legacy quests get one stable cycle.
    if (!stored.has(key)) stored.put(key, "legacy")
    return String(stored.get(key))
}

// Remove a quest from registry
function unregisterQuestExp(world, questId) {
    var registry = getQuestRegistry(world)
    if (registry[questId]) {
        delete registry[questId]
        saveQuestRegistry(world, registry)
        return true
    }
    return false
}

// Get config for a quest
function getQuestExpConfig(world, questId) {
    var registry = getQuestRegistry(world)
    return registry[questId] || null
}

// Get list of all registered quest IDs (optionally filtered by type)
function getRegisteredQuestIds(world, typeFilter) {
    var registry = getQuestRegistry(world)
    var ids = []
    for (var id in registry) {
        if (registry.hasOwnProperty(id)) {
            if (!typeFilter || typeFilter === "All" || registry[id].type === typeFilter) {
                ids.push(id)
            }
        }
    }
    // Sort numerically
    ids.sort(function(a, b) { return parseInt(a) - parseInt(b) })
    return ids
}

// Get type color
function getQuestTypeColor(type) {
    return QUEST_CONFIG.typeColors[type] || "§7"
}

// ===== QUEST EXP EVENT HANDLERS =====

// Called when player completes a quest
function _quest_completed(e) {
    try {
        var player = e.player
        if (isArvanPersistenceFrozen(player)) return
        var quest = e.quest
        if (!quest) return
        
        var questId = String(quest.getId())
        var world = player.getWorld()
        var config = getQuestExpConfig(world, questId)
        
        if (!config) return
        if (config.type !== "complete") return  // Only handle complete type here
        
        var expAmount = normalizeWholeResource(config.exp, 0, CURRENCY_MAX_SAFE_INTEGER)
        var spiritAmount = normalizeWholeResource(config.spirit, 0, SPIRIT_MAX_SAFE_INTEGER)
        
        // Check for first time bonus
        var stored = player.getStoreddata()
        var completedKey = "quest_completed_" + questId
        if (!stored.has(completedKey)) {
            expAmount += normalizeWholeResource(config.bonusFirstTime, 0, CURRENCY_MAX_SAFE_INTEGER)
            if (questFirstTimeSpiritAllowed(world)) spiritAmount += normalizeWholeResource(config.bonusFirstTimeSpirit, 0, SPIRIT_MAX_SAFE_INTEGER)
            stored.put(completedKey, 1)
        }
        
        if (expAmount <= 0 && spiritAmount <= 0) return
        
        if (expAmount > 0) addPlayerExp(player, expAmount)
        var spiritResult = awardSpiritOnce(player, spiritAmount, "Quest complete", "quest:complete:" + questId + ":" + questRewardCycle(e, quest, world))
        
        // Message player
        var questName = config.name || quest.getName() || "Quest #" + questId
        
    } catch (error) {
        // Silent fail
    }
}

// Called when player turns in a quest
function _quest_turnin(e) {
    try {
        var player = e.player
        if (isArvanPersistenceFrozen(player)) return
        var quest = e.quest
        if (!quest) return
        
        var questId = String(quest.getId())
        var world = player.getWorld()
        var config = getQuestExpConfig(world, questId)
        
        if (!config) return
        if (config.type !== "turnin") return  // Only handle turnin type here
        
        var expAmount = normalizeWholeResource(config.exp, 0, CURRENCY_MAX_SAFE_INTEGER)
        var spiritAmount = normalizeWholeResource(config.spirit, 0, SPIRIT_MAX_SAFE_INTEGER)
        
        // Check for first time bonus
        var stored = player.getStoreddata()
        var turninKey = "quest_turnin_" + questId
        if (!stored.has(turninKey)) {
            expAmount += normalizeWholeResource(config.bonusFirstTime, 0, CURRENCY_MAX_SAFE_INTEGER)
            if (questFirstTimeSpiritAllowed(world)) spiritAmount += normalizeWholeResource(config.bonusFirstTimeSpirit, 0, SPIRIT_MAX_SAFE_INTEGER)
            stored.put(turninKey, 1)
        }
        
        if (expAmount <= 0 && spiritAmount <= 0) return
        
        if (expAmount > 0) addPlayerExp(player, expAmount)
        var spiritResult = awardSpiritOnce(player, spiritAmount, "Quest turn-in", "quest:turnin:" + questId + ":" + questRewardCycle(e, quest, world))
        
        // Message player
        var questName = config.name || quest.getName() || "Quest #" + questId
        
    } catch (error) {
        // Silent fail
    }
}

// ===== QUEST GUI - MAIN LIST =====

function showQuestListGui(player, typeFilter) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var gui = API.createCustomGui(QUEST_GUI_ID, QUEST_GUI_WIDTH, QUEST_GUI_HEIGHT, false, player)
    var world = player.getWorld()

    if (!typeFilter) {
        typeFilter = player.getTempdata().has("questTypeFilter")
            ? player.getTempdata().get("questTypeFilter")
            : "All"
    }
    player.getTempdata().put("questTypeFilter", typeFilter)

    var questIds = getRegisteredQuestIds(world, typeFilter === "All" ? null : typeFilter)
    player.getTempdata().put("questIdsList", JSON.stringify(questIds))
    var selectedQuestId = player.getTempdata().has("selectedQuestId")
        ? String(player.getTempdata().get("selectedQuestId"))
        : ""
    if (questIds.indexOf(selectedQuestId) === -1) selectedQuestId = ""

    addRpgFrame(gui, QUEST_GUI_WIDTH, QUEST_GUI_HEIGHT, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 260, 198, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 278, 40, 112, 198, RPG_UI.gold)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§b§l✦ QUEST REWARDS", 116, 10, 190, 14)
    gui.addLabel(labelId++, "§7" + questIds.length + " quests in " + typeFilter, 14, 26, 150, 10)

    var scrollList = []
    var registry = getQuestRegistry(world)
    for (var i = 0; i < questIds.length; i++) {
        var id = questIds[i]
        var config = registry[id]
        var color = getQuestTypeColor(config.type)
        scrollList.push(color + "#" + id + " §f" + config.name + " §8(" + config.exp + " EXP · " + (config.spirit || 0) + " Spirit)")
    }
    if (scrollList.length === 0) scrollList.push("(No quests configured)")
    var scroll = gui.addScroll(LAYER.SCROLL_LIST, 16, 56, 248, 176, scrollList)
    var selectedIndex = questIds.indexOf(selectedQuestId)
    if (selectedIndex >= 0) scroll.setDefaultSelection(selectedIndex)

    gui.addLabel(labelId++, "§6§lFILTER", 288, 48, 88, 10)
    gui.addButton(220, typeFilter === "All" ? "§a§lALL" : "§7ALL", 288, 62, 92, 20)
    gui.addButton(221, typeFilter === "turnin" ? "§e§lTURN-IN" : "§7TURN-IN", 288, 86, 92, 20)
    gui.addButton(222, typeFilter === "complete" ? "§b§lCOMPLETE" : "§7COMPLETE", 288, 110, 92, 20)

    var selectedConfig = selectedQuestId ? registry[selectedQuestId] : null
    gui.addLabel(labelId++, "§6§lSELECTED", 288, 142, 92, 10)
    if (selectedConfig) {
        gui.addLabel(labelId++, "§f" + selectedConfig.name, 288, 158, 92, 24).setHoverText("§f" + selectedConfig.name)
        gui.addLabel(labelId++, getQuestTypeColor(selectedConfig.type) + selectedConfig.type, 288, 184, 92, 10)
        gui.addLabel(labelId++, "§e§l" + selectedConfig.exp + " EXP", 288, 198, 92, 10)
        gui.addLabel(labelId++, "§b" + (selectedConfig.spirit || 0) + " Spirit", 288, 212, 92, 10)
        gui.addLabel(labelId++, "§dFirst-time " + selectedConfig.bonusFirstTime + " EXP · " + (selectedConfig.bonusFirstTimeSpirit || 0) + " Spirit", 288, 226, 92, 10)
    } else {
        gui.addLabel(labelId++, "§7Select a quest", 288, 158, 92, 10)
        gui.addLabel(labelId++, "§7to inspect rewards.", 288, 172, 92, 10)
    }
    var firstTimePolicy = getQuestFirstTimeSpiritPolicy(world)
    gui.addLabel(labelId++, "§8Spirit first-time: " + firstTimePolicy.mode, 278, 238, 112, 10)

    gui.addButton(LAYER.BUTTONS + 4, "§7<", 12, 252, 28, 20)
    gui.addButton(LAYER.BUTTONS, "§a§lNEW", 48, 252, 54, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§e§lEDIT", 108, 252, 54, 20).setEnabled(!!selectedConfig)
    gui.addButton(LAYER.BUTTONS + 2, "§c§lDEL", 168, 252, 46, 20).setEnabled(!!selectedConfig)
    gui.addButton(LAYER.BUTTONS + 5, firstTimePolicy.mode === "ALLOW_UNMARKED" ? "§cDISABLE 1ST" : "§dENABLE 1ST", 220, 252, 100, 20)
    gui.addButton(LAYER.BUTTONS + 3, "§f§lCLOSE", 326, 252, 62, 20)
    showManagedGui(player, gui)
}
function showAddQuestGui(player) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var width = 400
    var height = 270
    var gui = API.createCustomGui(QUEST_ADD_GUI_ID, width, height, false, player)
    var defaultType = player.getTempdata().has("questTypeFilter")
        ? player.getTempdata().get("questTypeFilter")
        : "complete"
    if (defaultType === "All") defaultType = "complete"
    player.getTempdata().put("newQuestType", defaultType)

    addRpgFrame(gui, width, height, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 250, 188, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 268, 40, 122, 188, RPG_UI.gold)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§a§lADD QUEST EXP", 135, 10, 150, 14)
    gui.addLabel(labelId++, "§7Quest ID", 22, 54, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS, 22, 68, 226, 20)
    gui.addLabel(labelId++, "§7Quest Name", 22, 100, 100, 10)
    gui.addTextArea(LAYER.TEXT_FIELDS + 1, 22, 114, 226, 20)
    gui.addLabel(labelId++, "§7EXP Reward", 22, 148, 90, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 2, 22, 162, 102, 20).setText("100")
    gui.addLabel(labelId++, "§7First-time Bonus", 136, 148, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 3, 136, 162, 112, 20).setText("0")
    gui.addLabel(labelId++, "§7Spirit Reward", 22, 188, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 4, 22, 202, 102, 20).setText("0")
    gui.addLabel(labelId++, "§7First-time Spirit", 136, 188, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 5, 136, 202, 112, 20).setText("0")
    gui.addLabel(labelId++, "§8Quest ID is the numeric CustomNPCs quest ID.", 22, 226, 220, 10)

    gui.addLabel(labelId++, "§6§lREWARD EVENT", 278, 50, 104, 10)
    var types = QUEST_CONFIG.types
    var typeIndex = types.indexOf(defaultType)
    if (typeIndex < 0) typeIndex = 0
    gui.addScroll(LAYER.SCROLL_LIST + 1, 274, 66, 110, 150, types).setDefaultSelection(typeIndex)
    gui.addLabel(labelId++, "§7Turn-in fires at NPC", 278, 202, 100, 10)
    gui.addLabel(labelId++, "§7Complete fires earlier.", 278, 214, 100, 10)

    gui.addButton(LAYER.BUTTONS, "§a§lSAVE", 112, 242, 80, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§c§lCANCEL", 208, 242, 80, 20)
    showManagedGui(player, gui)
}
function showEditQuestGui(player, questId) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var width = 400
    var height = 270
    var gui = API.createCustomGui(QUEST_EDIT_GUI_ID, width, height, false, player)
    var world = player.getWorld()
    var config = getQuestExpConfig(world, questId) || {
        name: "Quest #" + questId, type: "complete", exp: 100, bonusFirstTime: 0
    }

    player.getTempdata().put("editingQuestId", questId)
    player.getTempdata().put("editQuestType", config.type || "complete")

    addRpgFrame(gui, width, height, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 250, 188, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 268, 40, 122, 188, RPG_UI.gold)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§e§lEDIT QUEST #" + questId, 135, 10, 150, 14)
    gui.addLabel(labelId++, "§7Quest Name", 22, 54, 100, 10)
    gui.addTextArea(LAYER.TEXT_FIELDS, 22, 68, 226, 20).setText(config.name || "")
    gui.addLabel(labelId++, "§7EXP Reward", 22, 108, 90, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 1, 22, 122, 102, 20).setText(String(config.exp || 100))
    gui.addLabel(labelId++, "§7First-time Bonus", 136, 108, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 2, 136, 122, 112, 20).setText(String(normalizeWholeResource(config.bonusFirstTime, 0, CURRENCY_MAX_SAFE_INTEGER)))
    gui.addLabel(labelId++, "§7Spirit Reward", 22, 146, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 3, 22, 160, 102, 20).setText(String(normalizeWholeResource(config.spirit, 0, SPIRIT_MAX_SAFE_INTEGER)))
    gui.addLabel(labelId++, "§7First-time Spirit", 136, 146, 100, 10)
    gui.addTextField(LAYER.TEXT_FIELDS + 4, 136, 160, 112, 20).setText(String(normalizeWholeResource(config.bonusFirstTimeSpirit, 0, SPIRIT_MAX_SAFE_INTEGER)))
    gui.addLabel(labelId++, "§7Quest ID §f#" + questId, 22, 190, 180, 10)
    gui.addLabel(labelId++, "§8Changes affect future completions and turn-ins.", 22, 212, 220, 10)

    gui.addLabel(labelId++, "§6§lREWARD EVENT", 278, 50, 104, 10)
    var types = QUEST_CONFIG.types
    var typeIndex = types.indexOf(config.type)
    if (typeIndex < 0) typeIndex = 0
    gui.addScroll(LAYER.SCROLL_LIST + 1, 274, 66, 110, 150, types).setDefaultSelection(typeIndex)
    gui.addLabel(labelId++, "§7Current " + getQuestTypeColor(config.type) + config.type, 278, 202, 100, 10)

    gui.addButton(LAYER.BUTTONS, "§a§lSAVE", 112, 242, 80, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§c§lCANCEL", 208, 242, 80, 20)
    showManagedGui(player, gui)
}
function _quest_customGuiButton(e) {
    var player = e.player
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    
    // === MAIN LIST GUI (350) ===
    if (guiId === QUEST_GUI_ID) {
        // Type filter buttons (220-222)
        if (buttonId >= 220 && buttonId <= 222) {
            if (buttonId === 220) {
                // "All" button
                showQuestListGui(player, "All")
            } else {
                // Type button
                var typeIndex = buttonId - 221
                var types = QUEST_CONFIG.types
                if (typeIndex >= 0 && typeIndex < types.length) {
                    showQuestListGui(player, types[typeIndex])
                }
            }
            return
        }
        if (buttonId === LAYER.BUTTONS + 5) {
            var policyWorld = player.getWorld()
            var currentPolicy = getQuestFirstTimeSpiritPolicy(policyWorld)
            setQuestFirstTimeSpiritPolicy(policyWorld, currentPolicy.mode === "ALLOW_UNMARKED" ? "DISABLED" : "ALLOW_UNMARKED")
            player.message(currentPolicy.mode === "ALLOW_UNMARKED"
                ? "§e[Quest] First-time Spirit bonuses disabled."
                : "§d[Quest] First-time Spirit bonuses enabled for unmarked completions; review legacy history first.")
            showQuestListGui(player)
            return
        }
        
        switch(buttonId) {
            case LAYER.BUTTONS:     // NEW
                showAddQuestGui(player)
                break
            case LAYER.BUTTONS + 1: // EDIT
                var selectedId = player.getTempdata().get("selectedQuestId")
                if (selectedId) {
                    showEditQuestGui(player, selectedId)
                } else {
                    player.message("§c[Quest] Select a quest first!")
                }
                break
            case LAYER.BUTTONS + 2: // DELETE
                var selectedId = player.getTempdata().get("selectedQuestId")
                if (selectedId) {
                    var world = player.getWorld()
                    if (unregisterQuestExp(world, selectedId)) {
                        player.message("§c[Quest] Deleted: Quest #§e" + selectedId)
                        player.getTempdata().remove("selectedQuestId")
                    }
                    showQuestListGui(player)
                } else {
                    player.message("§c[Quest] Select a quest first!")
                }
                break
            case LAYER.BUTTONS + 3: // CLOSE
                player.closeGui()
                break
            case LAYER.BUTTONS + 4: // BACK to Admin Panel
                showAdminGui(player, "Tools")
                break
        }
        return
    }
    
    // === ADD QUEST GUI (351) ===
    if (guiId === QUEST_ADD_GUI_ID) {
        switch(buttonId) {
            case LAYER.BUTTONS:     // SAVE
                var idField = gui.getComponent(LAYER.TEXT_FIELDS)
                var nameField = gui.getComponent(LAYER.TEXT_FIELDS + 1)
                var expField = gui.getComponent(LAYER.TEXT_FIELDS + 2)
                var bonusField = gui.getComponent(LAYER.TEXT_FIELDS + 3)
                var spiritField = gui.getComponent(LAYER.TEXT_FIELDS + 4)
                var firstSpiritField = gui.getComponent(LAYER.TEXT_FIELDS + 5)
                
                var questId = idField ? idField.getText().trim() : ""
                
                if (!questId || questId.length === 0 || isNaN(parseInt(questId))) {
                    player.message("§c[Quest] Valid Quest ID (number) is required!")
                    return
                }
                
                var questType = player.getTempdata().has("newQuestType") 
                    ? player.getTempdata().get("newQuestType") 
                    : "complete"
                var questName = nameField ? nameField.getText().trim() : ""
                if (!questName) questName = "Quest #" + questId
                var exp = parseInt(expField ? expField.getText() : "100") || 100
                var bonus = parseInt(bonusField ? bonusField.getText() : "0") || 0
                var spirit = parseInt(spiritField ? spiritField.getText() : "0") || 0
                var firstSpirit = parseInt(firstSpiritField ? firstSpiritField.getText() : "0") || 0
                if (exp < 0 || bonus < 0 || spirit < 0 || firstSpirit < 0 || spirit > SPIRIT_MAX_SAFE_INTEGER || firstSpirit > SPIRIT_MAX_SAFE_INTEGER) {
                    player.message("§c[Quest] Rewards must be whole numbers at least 0.")
                    return
                }
                
                var world = player.getWorld()
                registerQuestExp(world, questId, {
                    name: questName,
                    type: questType,
                    exp: exp,
                    bonusFirstTime: bonus,
                    spirit: spirit,
                    bonusFirstTimeSpirit: firstSpirit
                })
                
                var typeColor = getQuestTypeColor(questType)
                player.message("§a[Quest] Registered: §f" + questName + " §7(ID: " + questId + ")")
                player.message("§7  Type: " + typeColor + questType + " §7| EXP: §e" + exp + " §7| Spirit: §b" + spirit + " §7| First Spirit: §b" + firstSpirit)
                player.getTempdata().remove("newQuestType")
                showQuestListGui(player)
                break
                
            case LAYER.BUTTONS + 1: // CANCEL
                player.getTempdata().remove("newQuestType")
                showQuestListGui(player)
                break
        }
        return
    }
    
    // === EDIT QUEST GUI (352) ===
    if (guiId === QUEST_EDIT_GUI_ID) {
        switch(buttonId) {
            case LAYER.BUTTONS:     // SAVE
                var questId = player.getTempdata().get("editingQuestId")
                if (!questId) {
                    player.message("§c[Quest] Error: No quest being edited!")
                    showQuestListGui(player)
                    return
                }
                
                var questType = player.getTempdata().has("editQuestType") 
                    ? player.getTempdata().get("editQuestType") 
                    : "complete"
                
                var nameField = gui.getComponent(LAYER.TEXT_FIELDS)
                var expField = gui.getComponent(LAYER.TEXT_FIELDS + 1)
                var bonusField = gui.getComponent(LAYER.TEXT_FIELDS + 2)
                var spiritField = gui.getComponent(LAYER.TEXT_FIELDS + 3)
                var firstSpiritField = gui.getComponent(LAYER.TEXT_FIELDS + 4)
                
                var questName = nameField ? nameField.getText().trim() : ""
                if (!questName) questName = "Quest #" + questId
                var exp = parseInt(expField ? expField.getText() : "100") || 100
                var bonus = parseInt(bonusField ? bonusField.getText() : "0") || 0
                var spirit = parseInt(spiritField ? spiritField.getText() : "0") || 0
                var firstSpirit = parseInt(firstSpiritField ? firstSpiritField.getText() : "0") || 0
                if (exp < 0 || bonus < 0 || spirit < 0 || firstSpirit < 0 || spirit > SPIRIT_MAX_SAFE_INTEGER || firstSpirit > SPIRIT_MAX_SAFE_INTEGER) {
                    player.message("§c[Quest] Rewards must be whole numbers at least 0.")
                    return
                }
                
                var world = player.getWorld()
                registerQuestExp(world, questId, {
                    name: questName,
                    type: questType,
                    exp: exp,
                    bonusFirstTime: bonus,
                    spirit: spirit,
                    bonusFirstTimeSpirit: firstSpirit
                })
                
                var typeColor = getQuestTypeColor(questType)
                player.message("§a[Quest] Updated: §f" + questName + " §7(ID: " + questId + ")")
                player.message("§7  Type: " + typeColor + questType + " §7| EXP: §e" + exp + " §7| Spirit: §b" + spirit + " §7| First Spirit: §b" + firstSpirit)
                player.getTempdata().remove("editingQuestId")
                player.getTempdata().remove("editQuestType")
                showQuestListGui(player)
                break
                
            case LAYER.BUTTONS + 1: // CANCEL
                player.getTempdata().remove("editingQuestId")
                player.getTempdata().remove("editQuestType")
                showQuestListGui(player)
                break
        }
        return
    }
}

// Handle scroll selection
function _quest_customGuiScroll(e) {
    var player = e.player
    var gui = e.gui
    var guiId = gui.getID()
    var scrollId = e.scrollId
    
    // Main list GUI - quest selection
    if (guiId === QUEST_GUI_ID && scrollId === LAYER.SCROLL_LIST) {
        var scrollIndex = e.scrollIndex
        var selection = e.selection
        
        // Convert Java array to JS array if needed
        var selectionArray = selection
        if (typeof Java !== 'undefined' && Java.from) {
            try { selectionArray = Java.from(selection) } catch(ex) {}
        }
        
        if (selectionArray && selectionArray.length > 0) {
            var selected = String(selectionArray[0])
            if (selected !== "(No quests configured)") {
                // Get actual quest ID from stored list using scroll index
                var questId = null
                
                // First try: use stored ID list with scroll index
                if (player.getTempdata().has("questIdsList")) {
                    try {
                        var questIdsJson = player.getTempdata().get("questIdsList")
                        var questIds = JSON.parse(questIdsJson)
                        if (scrollIndex >= 0 && scrollIndex < questIds.length) {
                            questId = questIds[scrollIndex]
                        }
                    } catch (ex) {
                        // Continue to fallback
                    }
                }
                
                // Fallback: extract from selection string (e.g., "§e[123] Name §7(100)")
                if (!questId) {
                    // Strip color codes first for easier parsing
                    var cleanSelected = selected.replace(/§./g, "")
                    // Match pattern: [123] or just extract digits at start
                    var match = cleanSelected.match(/\[(\d+)\]/)
                    if (match) {
                        questId = match[1]
                    }
                }
                
                if (questId) {
                    player.getTempdata().put("selectedQuestId", String(questId))
                    
                    // Show quest info in chat
                    var world = player.getWorld()
                    var config = getQuestExpConfig(world, String(questId))
                    if (config) {
                        var typeColor = getQuestTypeColor(config.type)
                        player.message("§6[Quest #" + questId + "] §f" + config.name +
                                       " §7| " + typeColor + config.type + 
                                       " §7| §eEXP: " + config.exp + 
                                       (config.bonusFirstTime > 0 ? " §7| §bBonus: " + config.bonusFirstTime : ""))
                    }
                    
                    // Double click to edit
                    if (e.doubleClick) {
                        showEditQuestGui(player, String(questId))
                    } else {
                        showQuestListGui(player, player.getTempdata().get("questTypeFilter"))
                    }
                }
            }
        }
        return
    }
    
    // Add quest GUI - type selection
    if (guiId === QUEST_ADD_GUI_ID && scrollId === LAYER.SCROLL_LIST + 1) {
        var selection = e.selection
        var selectionArray = selection
        if (typeof Java !== 'undefined' && Java.from) {
            try { selectionArray = Java.from(selection) } catch(ex) {}
        }
        if (selectionArray && selectionArray.length > 0) {
            player.getTempdata().put("newQuestType", String(selectionArray[0]))
        }
        return
    }
    
    // Edit quest GUI - type selection
    if (guiId === QUEST_EDIT_GUI_ID && scrollId === LAYER.SCROLL_LIST + 1) {
        var selection = e.selection
        var selectionArray = selection
        if (typeof Java !== 'undefined' && Java.from) {
            try { selectionArray = Java.from(selection) } catch(ex) {}
        }
        if (selectionArray && selectionArray.length > 0) {
            player.getTempdata().put("editQuestType", String(selectionArray[0]))
        }
        return
    }
}

function _quest_customGuiClosed(e) {
    // Cleanup temp data
    var player = e.player
    player.getTempdata().remove("selectedQuestId")
    player.getTempdata().remove("editingQuestId")
    player.getTempdata().remove("questTypeFilter")
    player.getTempdata().remove("newQuestType")
    player.getTempdata().remove("editQuestType")
    player.getTempdata().remove("questIdsList")
}

// ============================================
// EQUIPMENT SYSTEM SECTION
// ============================================

// ===== GUI CONFIGURATION =====
var EQUIP_GUI_WIDTH = 420
var EQUIP_GUI_HEIGHT = 320
var EQUIP_GUI_ID = 300           // Main equipment list GUI
var EQUIP_ADD_GUI_ID = 301       // Add new item GUI
var EQUIP_EDIT_GUI_ID = 302      // Edit item GUI
var EQUIP_STATS_GUI_ID = 303     // Dynamic stat requirements GUI
var EQUIPMENT_STAT_PAGE_SIZE = 25

// ===== EQUIPMENT CONFIGURATION =====
var EQUIP_CONFIG = {
    prefix: "/equip",
    
    // Storage key for equipment registry (world storeddata)
    registryKey: "equipmentRegistry",
    
    // Message settings
    equipFailMessage: "§c[Equipment] You don't meet the requirements for §e{ITEM}§c!",
    equipSuccessMessage: "",  // Empty = no message on success
    
    // Validation mode: "prevent" = cancel equip, "warn" = just message
    validationMode: "prevent",
    
    // Default categories (can be extended by user)
    defaultCategories: ["Weapons", "Equipment", "Misc"],
    
    // Category colors for display (Gray/Yellow/Blue Theme)
    categoryColors: {
        "Weapons": "§e",
        "Equipment": "§6",
        "Misc": "§7"
    }
}


// ===== GUI LAYOUT HELPER =====
var EquipGuiMath = {
    centerX: function(width, guiWidth) {
        return (guiWidth - width) / 2
    },
    centerY: function(height, guiHeight) {
        return (guiHeight - height) / 2
    }
}

// ===== REGISTRY FUNCTIONS =====

// Get equipment registry from world storeddata
function getEquipmentRegistry(world) {
    var stored = world.getStoreddata()
    if (!stored.has(EQUIP_CONFIG.registryKey)) {
        return {}
    }
    
    try {
        var json = stored.get(EQUIP_CONFIG.registryKey)
        return JSON.parse(json)
    } catch (ex) {
        return {}
    }
}

// Save equipment registry to world storeddata
function saveEquipmentRegistry(world, registry) {
    var stored = world.getStoreddata()
    stored.put(EQUIP_CONFIG.registryKey, JSON.stringify(registry))
}

function normalizeEquipmentClassIds(requirements) {
    var normalized = []
    var source = requirements && Array.isArray(requirements.classIds)
        ? requirements.classIds
        : requirements && requirements.classId
            ? [requirements.classId]
            : []
    for (var i = 0; i < source.length; i++) {
        var classId = String(source[i] || "").trim()
        if (classId && normalized.indexOf(classId) === -1) normalized.push(classId)
    }
    return normalized
}

// Add or update an item in registry
function registerEquipment(world, itemName, requirements) {
    var registry = getEquipmentRegistry(world)
    var registeredMeta = typeof ARVAN_ITEMS !== "undefined" ? ARVAN_ITEMS.fromSnbt(world, requirements.itemSnbt) : null
    var registeredId = String(requirements.registryItemId || (registeredMeta && registeredMeta.template) || "")
    if (registeredId) {
        for (var existingName in registry) {
            if (existingName !== itemName && registry[existingName].registryItemId === registeredId) delete registry[existingName]
        }
    }
    var stats = normalizeEquipmentStatRequirements(requirements)
    var classIds = normalizeEquipmentClassIds(requirements)
    var requiredPermissions = normalizeSkillPermissionList(requirements.requiredPermissions || requirements.requiredPermissionKeys || requirements.permissionRequirements)
    registry[itemName] = {
        name: itemName,
        itemId: String(requirements.itemId || ""),
        itemSnbt: String(requirements.itemSnbt || ""),
        matchMode: registeredId ? "REGISTRY" : normalizeEquipmentMatchMode(requirements.matchMode),
        registryItemId: registeredId,
        category: requirements.category || "Misc",
        level: requirements.level || 1,
        stats: stats,
        STR: stats.STR || 0,
        VIT: stats.VIT || 0,
        DEX: stats.DEX || 0,
        classIds: classIds,
        classId: classIds.length > 0 ? classIds[0] : "",
        requiredPermissions: requiredPermissions
    }
    saveEquipmentRegistry(world, registry)
}

// Remove an item from registry
function unregisterEquipment(world, itemName) {
    var registry = getEquipmentRegistry(world)
    if (registry[itemName]) {
        delete registry[itemName]
        saveEquipmentRegistry(world, registry)
        return true
    }
    return false
}

// Get requirements for an item
function getEquipmentRequirements(world, itemName) {
    var registry = getEquipmentRegistry(world)
    var requirements = registry[itemName]
    if (!requirements) return null
    return normalizeEquipmentRequirements(requirements, itemName)
}

function normalizeEquipmentRequirements(requirements, itemName) {
    var stats = normalizeEquipmentStatRequirements(requirements)
    var classIds = normalizeEquipmentClassIds(requirements)
    var requiredPermissions = normalizeSkillPermissionList(requirements && (requirements.requiredPermissions !== undefined
        ? requirements.requiredPermissions : requirements.requiredPermissionKeys !== undefined
            ? requirements.requiredPermissionKeys : requirements.permissionRequirements))
    return {
        name: requirements.name || itemName,
        registryItemId: String(requirements.registryItemId || ""),
        itemId: String(requirements.itemId || ""),
        itemSnbt: String(requirements.itemSnbt || ""),
        matchMode: normalizeEquipmentMatchMode(requirements.matchMode),
        category: requirements.category || "Misc",
        level: parseInt(requirements.level, 10) || 1,
        stats: stats,
        STR: stats.STR || 0,
        VIT: stats.VIT || 0,
        DEX: stats.DEX || 0,
        classIds: classIds,
        classId: classIds.length > 0 ? classIds[0] : "",
        requiredPermissions: requiredPermissions
    }
}

function formatEquipmentClassNames(world, requirements) {
    var classIds = normalizeEquipmentClassIds(requirements)
    if (classIds.length === 0) return "Any Class"
    var names = []
    for (var i = 0; i < classIds.length; i++) names.push(getClassDisplayName(world, classIds[i]))
    return names.join(", ")
}

function formatEquipmentPermissionNames(world, requirements) {
    var keys = normalizeSkillPermissionList(requirements && (requirements.requiredPermissions || requirements.requiredPermissionKeys || requirements.permissionRequirements))
    if (keys.length === 0) return "None"
    var names = []
    for (var i = 0; i < keys.length; i++) names.push(friendlyPermissionLabel(world, keys[i]) + " (" + keys[i] + ")")
    return names.join(", ")
}

function createEquipmentConfiguredStack(world, requirements) {
    if (!requirements) return null
    var stack = createClassItemFromSnbt(world, requirements.itemSnbt)
    if (stack) return stack
    return createClassIconStack(world, requirements.itemId)
}

function equipmentStacksMatch(actual, configured) {
    if (!actual || actual.isEmpty() || !configured || configured.isEmpty()) return false
    try {
        var actualCopy = actual.copy()
        var configuredCopy = configured.copy()
        actualCopy.setStackSize(1)
        configuredCopy.setStackSize(1)
        return actualCopy.compare(configuredCopy, false)
    } catch (error) {
        return false
    }
}

function findEquipmentRequirements(world, itemStack) {
    if (!itemStack || itemStack.isEmpty()) return null
    var registry = getEquipmentRegistry(world)
    var names = Object.keys(registry).sort()
    var matches = []
    var itemId = String(itemStack.getName())
    var displayName = String(itemStack.getDisplayName())
    for (var i = 0; i < names.length; i++) {
        var requirements = normalizeEquipmentRequirements(registry[names[i]], names[i])
        if (requirements.matchMode === "REGISTRY") {
            var registered = typeof ARVAN_ITEMS !== "undefined" ? ARVAN_ITEMS.meta(itemStack) : null
            if (registered && requirements.registryItemId === registered.template) matches.push(requirements)
        } else if (requirements.matchMode === "ITEM_TYPE") {
            if (requirements.itemId && requirements.itemId === itemId) matches.push(requirements)
        } else if (requirements.matchMode === "NAME") {
            if (requirements.name === displayName) matches.push(requirements)
        } else if (requirements.matchMode === "EXACT") {
            if (requirements.itemId === itemId && equipmentStacksMatch(itemStack, createEquipmentConfiguredStack(world, requirements))) matches.push(requirements)
        } else if (names[i] === displayName || names[i] === itemId) {
            if (!requirements.itemSnbt || equipmentStacksMatch(itemStack, createEquipmentConfiguredStack(world, requirements))) matches.push(requirements)
        }
    }
    return matches.length ? { rules: matches } : null
}

function normalizeEquipmentMatchMode(mode) {
    return mode === "REGISTRY" || mode === "ITEM_TYPE" || mode === "EXACT" || mode === "NAME" ? mode : "LEGACY"
}

function cycleEquipmentMatchMode(player, gui, mode) {
    ensureEquipmentEditorSlotLoaded(player, mode, gui)
    var draft = mode === "edit" ? captureEditEquipmentDraft(player, gui) : captureNewEquipmentDraft(player, gui)
    if (draft.matchMode === "REGISTRY") return
    draft.matchMode = draft.matchMode === "ITEM_TYPE" ? "EXACT" : draft.matchMode === "EXACT" ? "NAME" : "ITEM_TYPE"
    saveEquipmentRequirementDraft(player, mode, draft)
    refreshEquipmentEditorComponents(player, gui, mode, draft)
    reopenEquipmentEditorGui(player, mode)
}

function getMobReward(world, mobId) {
    if (!world || typeof world.getStoreddata !== "function") return null
    var registry = getMobExpRegistry(world)
    if (!hasOwnValue(registry, mobId)) return null
    var value = registry[mobId] && typeof registry[mobId] === "object" ? registry[mobId] : { exp: registry[mobId] }
    return { exp: normalizeWholeResource(value.exp, 0, CURRENCY_MAX_SAFE_INTEGER), spirit: normalizeWholeResource(value.spirit, 0, SPIRIT_MAX_SAFE_INTEGER) }
}

function normalizeEquipmentStatRequirements(requirements) {
    var normalized = {}
    var source = requirements && requirements.stats && typeof requirements.stats === "object"
        ? requirements.stats
        : {}
    var statKey

    for (statKey in source) {
        if (!source.hasOwnProperty(statKey)) continue
        var normalizedKey = normalizeStatKey(statKey)
        var requiredValue = parseFloat(source[statKey])
        if (normalizedKey && !isNaN(requiredValue) && requiredValue > 0) {
            normalized[normalizedKey] = requiredValue
        }
    }

    var legacyKeys = ["STR", "VIT", "DEX"]
    for (var i = 0; i < legacyKeys.length; i++) {
        statKey = legacyKeys[i]
        if (normalized.hasOwnProperty(statKey)) continue
        var legacyValue = requirements ? parseFloat(requirements[statKey]) : 0
        if (!isNaN(legacyValue) && legacyValue > 0) normalized[statKey] = legacyValue
    }

    return normalized
}

function formatEquipmentStatRequirements(requirements) {
    var stats = normalizeEquipmentStatRequirements(requirements)
    var keys = Object.keys(stats).sort()
    var parts = []
    for (var i = 0; i < keys.length; i++) {
        parts.push(keys[i] + " " + stats[keys[i]])
    }
    return parts.length > 0 ? parts.join(" | ") : "None"
}

function getEquipmentStatRequirementLines(requirements, maxLines) {
    var stats = normalizeEquipmentStatRequirements(requirements)
    var keys = Object.keys(stats).sort()
    var lines = []
    for (var i = 0; i < keys.length; i++) lines.push(keys[i] + " " + stats[keys[i]])
    if (lines.length === 0) return ["None"]
    if (maxLines && lines.length > maxLines) {
        var hidden = lines.length - maxLines + 1
        lines = lines.slice(0, maxLines - 1)
        lines.push("+" + hidden + " more")
    }
    return lines
}

// Get list of all registered item names (optionally filtered by category)
function getRegisteredItemNames(world, categoryFilter) {
    var registry = getEquipmentRegistry(world)
    var names = []
    for (var name in registry) {
        if (registry.hasOwnProperty(name)) {
            if (!categoryFilter || categoryFilter === "All" || registry[name].category === categoryFilter) {
                names.push(name)
            }
        }
    }
    names.sort()
    return names
}

// Get all available categories (default + any in registry)
function getCategories(world) {
    var categories = EQUIP_CONFIG.defaultCategories.slice()
    var registry = getEquipmentRegistry(world)
    
    for (var name in registry) {
        if (registry.hasOwnProperty(name)) {
            var cat = registry[name].category
            if (cat && categories.indexOf(cat) === -1) {
                categories.push(cat)
            }
        }
    }
    return categories
}

// Get category color
function getCategoryColor(category) {
    return EQUIP_CONFIG.categoryColors[category] || "§7"
}

function getEquipmentClassChoices(world, selectedClassIds) {
    var classIds = getSortedClassIds(world)
    var selected = normalizeEquipmentClassIds({ classIds: selectedClassIds })
    for (var missingIndex = 0; missingIndex < selected.length; missingIndex++) {
        if (classIds.indexOf(selected[missingIndex]) === -1) classIds.push(selected[missingIndex])
    }
    var ids = [""]
    var names = [(selected.length === 0 ? "§a[x] §f" : "§8[ ] §7") + "Any Class"]
    for (var i = 0; i < classIds.length; i++) {
        var classId = classIds[i]
        var classData = getClassById(world, classId)
        ids.push(classId)
        var marker = selected.indexOf(classId) >= 0 ? "§a[x] §f" : "§8[ ] §7"
        names.push(marker + (classData ? classData.name : "Missing: " + classId))
    }
    return { ids: ids, names: names }
}

function getEquipmentFormText(gui, componentId, fallback) {
    var component = gui.getComponent(componentId)
    return component ? String(component.getText()) : String(fallback)
}

function getEquipmentFormDraft(player, key, defaults) {
    var draft = {}
    var field
    for (field in defaults) {
        if (defaults.hasOwnProperty(field)) draft[field] = defaults[field]
    }

    if (!player.getTempdata().has(key)) return draft

    try {
        var saved = JSON.parse(String(player.getTempdata().get(key)))
        if (saved && typeof saved === "object") {
            for (field in defaults) {
                if (defaults.hasOwnProperty(field) && saved.hasOwnProperty(field)) {
                    draft[field] = saved[field]
                }
            }
        }
    } catch (error) {
        player.getTempdata().remove(key)
    }
    return draft
}

function getEquipmentEditorSlotStack(gui) {
    var slots = gui.getSlots()
    if (!slots || slots.size() <= 0) return null
    var slot = slots.get(0)
    if (!slot || !slot.hasStack()) return null
    var stack = slot.getStack()
    return stack && !stack.isEmpty() ? stack : null
}

function getEquipmentStackSignature(stack) {
    if (!stack || stack.isEmpty()) return ""
    return String(stack.getName()) + "|" + String(stack.getItemNbt().toJsonString())
}

function captureEquipmentItemSlot(gui, draft) {
    var stack = getEquipmentEditorSlotStack(gui)
    if (stack) {
        stack = stack.copy()
        stack.setStackSize(1)
        draft.name = String(stack.getDisplayName())
        draft.itemId = String(stack.getName())
        draft.itemSnbt = stack.getItemNbt().toJsonString()
    }
    return draft
}

function captureNewEquipmentDraft(player, gui) {
    var current = getEquipmentFormDraft(player, "newEquipFormDraft", {
        name: "", itemId: "", itemSnbt: "", matchMode: "ITEM_TYPE", level: "1", stats: {}, classIds: [], requiredPermissions: []
    })
    var draft = {
        name: current.name,
        itemId: current.itemId,
        itemSnbt: current.itemSnbt,
        matchMode: current.matchMode,
        level: getEquipmentFormText(gui, LAYER.TEXT_FIELDS, "1"),
        stats: normalizeEquipmentStatRequirements(current),
        classIds: normalizeEquipmentClassIds(current),
        requiredPermissions: normalizeSkillPermissionList(getEquipmentFormText(gui, LAYER.TEXT_FIELDS + 1, (current.requiredPermissions || []).join(", ")))
    }
    captureEquipmentItemSlot(gui, draft)
    player.getTempdata().put("newEquipFormDraft", JSON.stringify(draft))
    return draft
}

function captureEditEquipmentDraft(player, gui) {
    var current = getEquipmentFormDraft(player, "editEquipFormDraft", {
        name: "", itemId: "", itemSnbt: "", matchMode: "LEGACY", level: "1", stats: {}, classIds: [], requiredPermissions: []
    })
    var draft = {
        name: current.name,
        itemId: current.itemId,
        itemSnbt: current.itemSnbt,
        matchMode: current.matchMode,
        level: getEquipmentFormText(gui, LAYER.TEXT_FIELDS, "1"),
        stats: normalizeEquipmentStatRequirements(current),
        classIds: normalizeEquipmentClassIds(current),
        requiredPermissions: normalizeSkillPermissionList(getEquipmentFormText(gui, LAYER.TEXT_FIELDS + 1, (current.requiredPermissions || []).join(", ")))
    }
    captureEquipmentItemSlot(gui, draft)
    player.getTempdata().put("editEquipFormDraft", JSON.stringify(draft))
    return draft
}

function clearEquipmentRequirementEditorState(player) {
    var temp = player.getTempdata()
    temp.remove("equipRequirementMode")
    temp.remove("equipRequirementStatKeys")
    temp.remove("equipRequirementSelectedStat")
    temp.remove("equipRequirementPage")
}

function clearNewEquipmentEditorState(player) {
    var temp = player.getTempdata()
    temp.remove("newEquipCategory")
    temp.remove("newEquipClassId")
    temp.remove("newEquipClassIds")
    temp.remove("newEquipClassPage")
    temp.remove("newEquipClassOptions")
    temp.remove("newEquipFormDraft")
    temp.remove("equipEditorSlotSignature")
    clearEquipmentRequirementEditorState(player)
}

function clearEditEquipmentEditorState(player) {
    var temp = player.getTempdata()
    temp.remove("editingEquipItem")
    temp.remove("editEquipSourceItem")
    temp.remove("editEquipCreateNew")
    temp.remove("editEquipCategory")
    temp.remove("editEquipClassId")
    temp.remove("editEquipClassIds")
    temp.remove("editEquipClassPage")
    temp.remove("editEquipClassOptions")
    temp.remove("editEquipFormDraft")
    temp.remove("equipEditorSlotSignature")
    clearEquipmentRequirementEditorState(player)
}

// ===== PLAYER STAT FUNCTIONS =====

function getPlayerStat(player, statKey) {
    return getEffectiveStatPoints(player, statKey)
}

// ===== REQUIREMENT VALIDATION =====

// Check if player meets requirements for an item
function checkRequirements(player, requirements) {
    if (!requirements) return { passed: true, failures: [] }
    if (requirements.rules) {
        var combined = []
        for (var ruleIndex = 0; ruleIndex < requirements.rules.length; ruleIndex++) {
            var ruleResult = checkRequirements(player, requirements.rules[ruleIndex])
            for (var failureIndex = 0; failureIndex < ruleResult.failures.length; failureIndex++) {
                if (combined.indexOf(ruleResult.failures[failureIndex]) === -1) combined.push(ruleResult.failures[failureIndex])
            }
        }
        return { passed: combined.length === 0, failures: combined }
    }
    
    var failures = []
    var playerLevel = getPlayerLevel(player)
    var stats = normalizeEquipmentStatRequirements(requirements)
    
    if (requirements.level && playerLevel < requirements.level) {
        failures.push("Level " + requirements.level + " required (you: " + playerLevel + ")")
    }
    var statKeys = Object.keys(stats).sort()
    for (var i = 0; i < statKeys.length; i++) {
        var statKey = statKeys[i]
        var requiredValue = stats[statKey]
        var playerValue = getPlayerStat(player, statKey)
        if (playerValue < requiredValue) {
            failures.push(statKey + " " + requiredValue + " required (you: " + playerValue + ")")
        }
    }
    var requiredClassIds = normalizeEquipmentClassIds(requirements)
    if (requiredClassIds.length > 0 && getClassSystemEnabled(player.getWorld())) {
        var playerClassId = getPlayerClassId(player)
        if (requiredClassIds.indexOf(playerClassId) === -1) {
            var requiredClassName = formatEquipmentClassNames(player.getWorld(), requirements)
            var playerClassName = playerClassId ? getClassDisplayName(player.getWorld(), playerClassId) : "None"
            failures.push("Allowed classes: " + requiredClassName + " (you: " + playerClassName + ")")
        }
    }
    var requiredPermissions = normalizeSkillPermissionList(requirements.requiredPermissions || requirements.requiredPermissionKeys || requirements.permissionRequirements)
    if (requiredPermissions.length > 0) {
        var skillSnapshot = getCachedPlayerSkillSnapshot(player)
        if (!skillSnapshot) skillSnapshot = getSelfSkillSnapshot(player)
        var permissionResult = skillNodePermissionCheck(player, { requiredPermissions: requiredPermissions }, skillSnapshot && skillSnapshot.ok ? skillSnapshot : null)
        for (var permissionIndex = 0; permissionIndex < permissionResult.missing.length; permissionIndex++) {
            var missingPermission = permissionResult.missing[permissionIndex]
            failures.push("Permission required: " + friendlyPermissionLabel(player.getWorld(), missingPermission) + " (" + missingPermission + ")")
        }
    }
    
    return {
        passed: failures.length === 0,
        failures: failures
    }
}

// Validate an item against registry
function validateEquipment(player, itemStack) {
    if (!itemStack || itemStack.isEmpty()) return { passed: true, failures: [] }
    var registeredValidation = typeof ARVAN_ITEMS !== "undefined" ? ARVAN_ITEMS.validation(player, itemStack) : null
    if (registeredValidation) return registeredValidation
    var requirements = findEquipmentRequirements(player.getWorld(), itemStack)
    if (!requirements) return { passed: true, failures: [] }
    if (typeof ARVAN_ITEMS !== "undefined" && ARVAN_ITEMS.meta(itemStack)) return ARVAN_ITEMS.check(player, requirements)
    return checkRequirements(player, requirements)
}

function queueEquipmentReturn(player, stack) {
    if (!player || !stack || stack.isEmpty()) return false
    try {
        var stored = player.getStoreddata()
        var raw = stored.get("arvanEquipmentReturnedItems")
        var pending = []
        try { pending = JSON.parse(String(raw || "[]")) } catch (error) { pending = [] }
        if (!Array.isArray(pending)) pending = []
        var snbt = String(stack.getItemNbt().toJsonString())
        if (pending.indexOf(snbt) < 0) pending.push(snbt)
        if (pending.length > 256) pending = pending.slice(pending.length - 256)
        stored.put("arvanEquipmentReturnedItems", JSON.stringify(pending))
        return true
    } catch (error) {
        return false
    }
}

function returnEquipmentSafely(player, stack) {
    if (!player || !stack || stack.isEmpty()) return true
    try {
        if (player.giveItem(stack)) return true
    } catch (error) {}
    return queueEquipmentReturn(player, stack)
}

function recoverEquipmentReturns(player) {
    if (!player || !player.getStoreddata || !player.getWorld) return
    var stored = player.getStoreddata()
    if (!stored.has("arvanEquipmentReturnedItems")) return
    var pending
    try { pending = JSON.parse(String(stored.get("arvanEquipmentReturnedItems") || "[]")) } catch (error) { pending = [] }
    if (!Array.isArray(pending) || !pending.length) {
        stored.remove("arvanEquipmentReturnedItems")
        return
    }
    while (pending.length) {
        var stack = null
        try { stack = player.getWorld().createItemFromNbt(API.stringToNbt(String(pending[0]))) } catch (error) { pending.shift(); continue }
        if (!stack || !player.giveItem(stack)) break
        pending.shift()
    }
    if (pending.length) stored.put("arvanEquipmentReturnedItems", JSON.stringify(pending))
    else stored.remove("arvanEquipmentReturnedItems")
}

// ===== MAIN GUI - EQUIPMENT LIST =====

function showEquipmentListGui(player, categoryFilter) {
    var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
    var gui = API.createCustomGui(EQUIP_GUI_ID, EQUIP_GUI_WIDTH, EQUIP_GUI_HEIGHT, false, player)
    var world = player.getWorld()
    var temp = player.getTempdata()

    if (!categoryFilter) {
        categoryFilter = temp.has("equipCategoryFilter") ? temp.get("equipCategoryFilter") : "All"
    }
    temp.put("equipCategoryFilter", categoryFilter)

    var itemNames = getRegisteredItemNames(world, categoryFilter === "All" ? null : categoryFilter)
    var categories = ["All"].concat(getCategories(world))
    temp.put("equipItemNamesList", JSON.stringify(itemNames))
    var selectedItem = temp.has("selectedEquipItem") ? String(temp.get("selectedEquipItem")) : ""
    if (itemNames.indexOf(selectedItem) === -1) selectedItem = ""
    var selectedRequirements = selectedItem ? getEquipmentRequirements(world, selectedItem) : null

    addRpgFrame(gui, EQUIP_GUI_WIDTH, EQUIP_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 400, 88, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 10, 136, 278, 144, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 4, 296, 136, 114, 144, RPG_UI.cyan)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§6§lEQUIPMENT REGISTRY", 130, 10, 180, 14)
    gui.addLabel(labelId++, "§7" + itemNames.length + " items in " + categoryFilter, 14, 26, 160, 10)
    gui.addLabel(labelId++, "§6§lCATEGORY FILTER", 18, 46, 130, 10)
    var categoryIndex = categories.indexOf(categoryFilter)
    if (categoryIndex < 0) categoryIndex = 0
    gui.addScroll(LAYER.SCROLL_LIST + 1, 16, 52, 388, 72, categories).setDefaultSelection(categoryIndex)

    var scrollList = []
    for (var i = 0; i < itemNames.length; i++) {
        var itemName = itemNames[i]
        var requirements = getEquipmentRequirements(world, itemName)
        scrollList.push(getCategoryColor(requirements ? requirements.category : "Misc") + itemName)
    }
    if (scrollList.length === 0) scrollList.push("(No items in this category)")
    var itemScroll = gui.addScroll(LAYER.SCROLL_LIST, 16, 150, 266, 124, scrollList)
    var selectedIndex = itemNames.indexOf(selectedItem)
    if (selectedIndex >= 0) itemScroll.setDefaultSelection(selectedIndex)

    gui.addLabel(labelId++, "§b§lSELECTED ITEM", 306, 144, 96, 10)
    if (selectedRequirements) {
        gui.addLabel(labelId++, "§f" + selectedItem, 306, 160, 96, 24).setHoverText("§f" + selectedItem)
        gui.addLabel(labelId++, getCategoryColor(selectedRequirements.category) + selectedRequirements.category, 306, 188, 96, 10)
        gui.addLabel(labelId++, "§eLevel " + selectedRequirements.level, 306, 204, 96, 10)
        var allowedClasses = formatEquipmentClassNames(world, selectedRequirements)
        gui.addLabel(labelId++, "§7Classes §f" + shortGuiText(allowedClasses, 14), 306, 220, 96, 10).setHoverText("§f" + allowedClasses)
        var requirementsText = formatEquipmentStatRequirements(selectedRequirements)
        gui.addLabel(labelId++, "§7Stats", 306, 238, 96, 10)
        gui.addLabel(labelId++, "§f" + requirementsText, 306, 250, 96, 24).setHoverText("§f" + requirementsText)
        var permissionText = formatEquipmentPermissionNames(world, selectedRequirements)
        gui.addLabel(labelId++, "§7Permissions", 306, 276, 96, 10)
            .setHoverText("§f" + permissionText)
    } else {
        gui.addLabel(labelId++, "§7Select an item", 306, 162, 96, 10)
        gui.addLabel(labelId++, "§7to inspect every", 306, 176, 96, 10)
        gui.addLabel(labelId++, "§7requirement here.", 306, 190, 96, 10)
        gui.addLabel(labelId++, "§8Double-click to edit.", 306, 224, 96, 10)
    }

    gui.addButton(LAYER.BUTTONS + 4, "§7<", 12, 292, 28, 20)
    gui.addButton(LAYER.BUTTONS, "§a§lNEW", 48, 292, 54, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§e§lEDIT", 108, 292, 54, 20).setEnabled(!!selectedRequirements)
    gui.addButton(LAYER.BUTTONS + 2, "§c§lDEL", 168, 292, 46, 20).setEnabled(!!selectedRequirements)
    gui.addButton(LAYER.BUTTONS + 3, "§f§lCLOSE", 346, 292, 62, 20)
    showManagedGui(player, gui)
}
function getEquipmentRequirementDraft(player, mode) {
    var key = mode === "edit" ? "editEquipFormDraft" : "newEquipFormDraft"
    var defaults = { name: "", itemId: "", itemSnbt: "", matchMode: mode === "edit" ? "LEGACY" : "ITEM_TYPE", level: "1", stats: {}, classIds: [], requiredPermissions: [] }
    var draft = getEquipmentFormDraft(player, key, defaults)
    draft.stats = normalizeEquipmentStatRequirements(draft)
    draft.classIds = normalizeEquipmentClassIds(draft)
    draft.requiredPermissions = normalizeSkillPermissionList(draft.requiredPermissions || draft.requiredPermissionKeys || draft.permissionRequirements)
    return { key: key, value: draft }
}

function saveEquipmentRequirementDraft(player, mode, draft) {
    var key = mode === "edit" ? "editEquipFormDraft" : "newEquipFormDraft"
    draft.stats = normalizeEquipmentStatRequirements(draft)
    draft.classIds = normalizeEquipmentClassIds(draft)
    draft.requiredPermissions = normalizeSkillPermissionList(draft.requiredPermissions || draft.requiredPermissionKeys || draft.permissionRequirements)
    player.getTempdata().put(key, JSON.stringify(draft))
}

function getEquipmentEditorMatch(world, stack) {
    var found = findEquipmentRequirements(world, stack)
    return found && found.rules && found.rules.length > 0 ? found.rules[0] : null
}

function getEquipmentEditorCategory(player, mode, world) {
    var temp = player.getTempdata()
    var categoryKey = mode === "edit" ? "editEquipCategory" : "newEquipCategory"
    var category = temp.has(categoryKey) ? String(temp.get(categoryKey)) : "Misc"
    var categories = getCategories(world)
    if (category === "All" || categories.indexOf(category) === -1) category = "Misc"
    temp.put(categoryKey, category)
    return category
}

function refreshEquipmentEditorComponents(player, gui, mode, draft) {
    var world = player.getWorld()
    var temp = player.getTempdata()
    var categoryKey = mode === "edit" ? "editEquipCategory" : "newEquipCategory"
    var categories = getCategories(world)
    var category = temp.has(categoryKey) ? String(temp.get(categoryKey)) : "Misc"
    if (category === "All" || categories.indexOf(category) === -1) category = "Misc"
    temp.put(categoryKey, category)

    var itemLabel = gui.getComponent(LAYER.CONTENT_LABELS + 2)
    if (itemLabel) itemLabel.setText("§f" + shortGuiText(draft.name ? "Loaded: " + draft.name : "Place item in slot", 30))
    var itemIdLabel = gui.getComponent(LAYER.CONTENT_LABELS + 3)
    if (itemIdLabel) itemIdLabel.setText("§8" + shortGuiText(draft.itemId ? "Place actual item; " + draft.itemId : "Place actual item; settings load on insert", 32))
    var levelField = gui.getComponent(LAYER.TEXT_FIELDS)
    if (levelField) levelField.setText(String(draft.level || 1))
    var permissionField = gui.getComponent(LAYER.TEXT_FIELDS + 1)
    if (permissionField) permissionField.setText((draft.requiredPermissions || []).join(", "))
    var statsLabel = gui.getComponent(LAYER.CONTENT_LABELS + 5)
    if (statsLabel) statsLabel.setText("§7Stats §f" + shortGuiText(formatEquipmentStatRequirements(draft), 31))
    var statsButton = gui.getComponent(LAYER.BUTTONS + 4)
    if (statsButton) statsButton.setLabel("§eSTATS §8[§f" + Object.keys(draft.stats || {}).length + "§8]")

    var matchLabel = draft.matchMode === "REGISTRY" ? "Registered item ID" : draft.matchMode === "ITEM_TYPE" ? "Item type" : draft.matchMode === "EXACT" ? "Exact copy" : draft.matchMode === "NAME" ? "Name" : "Legacy (unchanged)"
    var matchButton = gui.getComponent(LAYER.BUTTONS + 5)
    if (matchButton) matchButton.setLabel("§bMatch: " + matchLabel)

    var categoryChoices = gui.getComponent(LAYER.SCROLL_LIST + 1)
    if (categoryChoices) {
        categoryChoices.setList(categories)
        categoryChoices.setDefaultSelection(Math.max(0, categories.indexOf(category)))
    }

    var classChoices = getEquipmentClassChoices(world, draft.classIds)
    temp.put(mode === "edit" ? "editEquipClassOptions" : "newEquipClassOptions", JSON.stringify(classChoices.ids))
    var classScroll = gui.getComponent(LAYER.SCROLL_LIST + 2)
    if (classScroll) classScroll.setList(classChoices.names)
}

function reopenEquipmentEditorGui(player, mode, slotStack) {
    var temp = player.getTempdata()
    var itemName = mode === "edit" && temp.has("editingEquipItem") ? String(temp.get("editingEquipItem")) : ""
    if (!slotStack && temp.has("equipEditorSlotSignature")) {
        var savedDraft = getEquipmentRequirementDraft(player, mode).value
        slotStack = createEquipmentConfiguredStack(player.getWorld(), savedDraft)
    }
    showEquipmentEditorGui(player, mode, itemName, slotStack)
}

function loadEquipmentEditorFromSlot(player, mode, stack) {
    var world = player.getWorld()
    var temp = player.getTempdata()
    var draftData = getEquipmentRequirementDraft(player, mode)
    var draft = draftData.value
    var matched = getEquipmentEditorMatch(world, stack)
    var categoryKey = mode === "edit" ? "editEquipCategory" : "newEquipCategory"

    draft.itemId = String(stack.getName())
    draft.itemSnbt = String(stack.getItemNbt().toJsonString())
    if (matched) {
        draft.name = String(matched.name || stack.getDisplayName())
        draft.matchMode = normalizeEquipmentMatchMode(matched.matchMode)
        draft.level = String(matched.level || 1)
        draft.stats = normalizeEquipmentStatRequirements(matched)
        draft.classIds = normalizeEquipmentClassIds(matched)
        draft.requiredPermissions = normalizeSkillPermissionList(matched.requiredPermissions || matched.requiredPermissionKeys || matched.permissionRequirements)
        temp.put(categoryKey, matched.category || "Misc")
        if (mode === "edit") {
            temp.put("editingEquipItem", String(matched.name || draft.name))
            temp.remove("editEquipCreateNew")
        }
    } else {
        draft.name = String(stack.getDisplayName())
        if (mode === "new") {
            ۍ4����(�+my�antedId = canonicalPotionEffectId(effectId)
        for (var i = 0; i < draft.effects.length; i++) {
            if (canonicalPotionEffectId(draft.effects[i].id) === wantedId) return draft.effects[i]
        }
        return {seconds: POTION_MAKER_DEFAULT_SECONDS, level: 1, particles: true, icon: true}
    }

    function getPotionMakerEffectName(effectId) {
        var wantedId = canonicalPotionEffectId(effectId)
        for (var i = 0; i < POTION_EFFECTS.length; i++) {
            if (POTION_EFFECTS[i].id === wantedId) return POTION_EFFECTS[i].displayName
        }
        return wantedId
    }

    function createPotionFromDraft(player, draft) {
        if (!isAdmin(player)) return false
        ensurePotionEffectsScanned()
        if (draft && draft.color !== undefined && draft.color !== null && (typeof draft.color !== "string" || !/^#[0-9a-f]{6}$/i.test(draft.color))) {
            sendMessage(player, "Potion color must be a six-digit hex color.", COLORS.ERROR)
            return false
        }
        var originalEffects = draft && Array.isArray(draft.effects) ? draft.effects : []
        if (originalEffects.length > 16) {
            sendMessage(player, "A potion can contain up to 16 effects.", COLORS.ERROR)
            return false
        }
        for (var n = 0; n < originalEffects.length; n++) {
            var original = originalEffects[n]
            var duration = original && original.seconds !== undefined ? Number(original.seconds) : Number(original && original.duration) / 20
            var level = Number(original && original.level)
            if (!original || !isFinite(duration) || duration < POTION_MAKER_MIN_SECONDS || duration > POTION_MAKER_MAX_SECONDS || !isFinite(level) || level < 1 || level > 128 || Math.floor(level) !== level) {
                sendMessage(player, "Check effect duration and level before creating the potion.", COLORS.ERROR)
                return false
            }
        }
        draft = normalizePotionMakerDraft(draft)
        if (!draft.effects.length) {
            sendMessage(player, "Add at least one potion effect first!", COLORS.ERROR)
            return false
        }

        try {
            var itemId = draft.type === "splash" ? "minecraft:splash_potion" : "minecraft:potion"
            var stackNbt = API.stringToNbt("{}")
            stackNbt.putString("id", itemId)
            stackNbt.setByte("Count", 1)
            var nbt = API.stringToNbt("{}")
            var effects = []

            for (var i = 0; i < draft.effects.length; i++) {
                var configured = draft.effects[i]
                var registered = null
                for (var j = 0; j < POTION_EFFECTS.length; j++) {
                    if (POTION_EFFECTS[j].id === configured.id) registered = POTION_EFFECTS[j]
                }
                if (!registered) {
                    sendMessage(player, "Effect is no longer registered: " + configured.id, COLORS.ERROR)
                    return false
                }
                var effectNbt = API.stringToNbt("{}")
                // Forge 1.20.1 uses legacy keys plus forge:id for mod registry IDs above 255.
                effectNbt.setInteger("Id", registered.numericId)
                effectNbt.putString("forge:id", registered.id)
                effectNbt.setByte("Amplifier", configured.level - 1)
                effectNbt.setInteger("Duration", registered.instant ? 1 : potionMakerSecondsToTicks(configured.seconds))
                effectNbt.setBoolean("Ambient", false)
                effectNbt.setBoolean("ShowParticles", configured.particles)
                effectNbt.setBoolean("ShowIcon", configured.icon)
                effects.push(effectNbt)
            }

            nbt.setList("CustomPotionEffects", effects)
            nbt.putString("Potion", "minecraft:water")
            if (draft.color !== null) nbt.setInteger("CustomPotionColor", parseInt(draft.color.substring(1), 16))
            var display = API.stringToNbt("{}")
            display.putString("Name", JSON.stringify({text: draft.type === "splash" ? "Custom Splash Potion" : "Custom Potion", italic: false}))
            nbt.setCompound("display", display)
            stackNbt.setCompound("tag", nbt)
            var potion = player.getWorld().createItemFromNbt(stackNbt)
            if (!player.giveItem(potion)) {
                sendMessage(player, "Your inventory is full; make room for the potion.", COLORS.ERROR)
                return false
            }
        } catch (e) {
            sendMessage(player, "Potion could not be created: " + e.message, COLORS.ERROR)
            return false
        }
        sendMessage(player, (draft.type === "splash" ? "Splash" : "Drink") + " potion created", COLORS.SUCCESS)
        return true
    }

    function potionMakerUiState(player) {
        var playerName = String(player.getName())
        var state = playerPotionMakerUi[playerName]
        if (!state) {
            state = {
                category: "minecraft",
                categoryPage: 0,
                effectPage: 0,
                search: "",
                searchInput: "",
                scope: POTION_MAKER_SCOPE_POTION,
                effectValues: {},
                status: "",
                statusColor: COLORS.GRAY
            }
            playerPotionMakerUi[playerName] = state
        }
        if (!state.effectValues) state.effectValues = {}
        if (!state.scope) state.scope = POTION_MAKER_SCOPE_POTION
        if (state.categoryPage === undefined) state.categoryPage = 0
        if (state.effectPage === undefined) state.effectPage = 0
        if (state.search === undefined) state.search = ""
        if (state.searchInput === undefined) state.searchInput = state.search
        return state
    }

    function potionMakerSetStatus(player, message, color) {
        var state = potionMakerUiState(player)
        state.status = String(message || "")
        state.statusColor = color || COLORS.GRAY
    }

    function potionMakerFitText(value, maxLength) {
        var text = String(value || "")
        var plain = text.replace(/§./g, "")
        if (plain.length <= maxLength) return text
        if (maxLength < 4) return plain.substring(0, maxLength)
        return "§f" + plain.substring(0, maxLength - 3) + "..."
    }

    function potionMakerNamespaceTitle(namespace) {
        var id = String(namespace || "minecraft").toLowerCase()
        if (id === "minecraft") return "Vanilla"
        return titleCasePath(id)
    }

    function potionMakerScopeIncludes(effect, state) {
        if (state.scope === POTION_MAKER_SCOPE_ALL) return true
        return effect.inPotion === true
    }

    function potionMakerCategories(state) {
        var categories = []
        var seen = {}
        for (var i = 0; i < POTION_EFFECTS.length; i++) {
            var effect = POTION_EFFECTS[i]
            if (!potionMakerScopeIncludes(effect, state)) continue
            var namespace = String(effect.namespace || getNamespace(effect.id) || "minecraft").toLowerCase()
            if (seen[namespace]) continue
            seen[namespace] = true
            categories.push({id: namespace, label: potionMakerNamespaceTitle(namespace)})
        }
        categories.sort(function(a, b) {
            if (a.id === "minecraft" && b.id !== "minecraft") return -1
            if (b.id === "minecraft" && a.id !== "minecraft") return 1
            if (a.label.toLowerCase() < b.label.toLowerCase()) return -1
            if (a.label.toLowerCase() > b.label.toLowerCase()) return 1
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        })
        return categories
    }

    function potionMakerFilteredEffects(state) {
        var effects = []
        var category = String(state.category || "minecraft").toLowerCase()
        var search = String(state.search || "").toLowerCase()
        for (var i = 0; i < POTION_EFFECTS.length; i++) {
            var effect = POTION_EFFECTS[i]
            var namespace = String(effect.namespace || getNamespace(effect.id) || "minecraft").toLowerCase()
            if (namespace !== category || !potionMakerScopeIncludes(effect, state)) continue
            if (search && String(effect.id).toLowerCase().indexOf(search) < 0 && String(effect.displayName || "").toLowerCase().indexOf(search) < 0) continue
            effects.push(i)
        }
        return effects
    }

    function potionMakerPageCount(itemCount) {
        return Math.max(1, Math.ceil(Number(itemCount || 0) / POTION_MAKER_PAGE_SIZE))
    }

    function potionMakerClampUiPage(value, itemCount) {
        var page = Number(value)
        if (!isFinite(page) || page < 0) page = 0
        var lastPage = potionMakerPageCount(itemCount) - 1
        if (page > lastPage) page = lastPage
        return Math.floor(page)
    }

    function potionMakerCatalogIndex(effectId) {
        var wanted = canonicalPotionEffectId(effectId)
        for (var i = 0; i < POTION_EFFECTS.length; i++) {
            if (canonicalPotionEffectId(POTION_EFFECTS[i].id) === wanted) return i
        }
        return -1
    }

    function potionMakerSetSelectionById(player, effectId) {
        var index = potionMakerCatalogIndex(effectId)
        if (index < 0) delete playerPotionMakerSelection[String(player.getName())]
        else playerPotionMakerSelection[String(player.getName())] = index
        return index
    }

    function potionMakerDraftIndex(draft, effectId) {
        var wanted = canonicalPotionEffectId(effectId)
        for (var i = 0; i < draft.effects.length; i++) {
            if (canonicalPotionEffectId(draft.effects[i].id) === wanted) return i
        }
        return -1
    }

    function potionMakerValuesFor(player, draft, effect) {
        var state = potionMakerUiState(player)
        var key = canonicalPotionEffectId(effect.id)
        if (!state.effectValues[key]) {
            var saved = getPotionMakerEffectValues(draft, key)
            state.effectValues[key] = {
                seconds: String(saved.seconds),
                level: String(saved.level),
                particles: saved.particles !== false,
                icon: saved.icon !== false
            }
        }
        return state.effectValues[key]
    }

    function potionMakerReadComponentText(gui, id) {
        if (!gui || typeof gui.getComponent !== "function") return null
        var component = gui.getComponent(id)
        if (!component || typeof component.getText !== "function") return null
        return String(component.getText())
    }

    function potionMakerCaptureGui(event) {
        var player = event.player
        var gui = event.gui
        var state = potionMakerUiState(player)
        var search = potionMakerReadComponentText(gui, POTION_MAKER_IDS.SEARCH)
        if (search !== null) state.searchInput = search
        var selectedEffect = getPotionMakerSelectedEffect(player)
        if (!selectedEffect) return
        var draft = loadPotionMakerDraft(player)
        var values = potionMakerValuesFor(player, draft, selectedEffect)
        var seconds = potionMakerReadComponentText(gui, POTION_MAKER_IDS.DURATION)
        var level = potionMakerReadComponentText(gui, POTION_MAKER_IDS.LEVEL)
        if (seconds !== null) values.seconds = seconds
        if (level !== null) values.level = level
        state.effectValues[canonicalPotionEffectId(selectedEffect.id)] = values
    }

    function potionMakerBuildConfiguredEffect(player, draft, selectedEffect) {
        var values = potionMakerValuesFor(player, draft, selectedEffect)
        var seconds = Number(values.seconds)
        var level = Number(values.level)
        if (!selectedEffect.instant && (!isFinite(seconds) || seconds < POTION_MAKER_MIN_SECONDS || seconds > POTION_MAKER_MAX_SECONDS)) {
            potionMakerSetStatus(player, "Seconds: 0.05 to " + POTION_MAKER_MAX_SECONDS, COLORS.ERROR)
            return null
        }
        if (!isFinite(level) || level < 1 || level > POTION_MAKER_MAX_LEVEL || Math.floor(level) !== level) {
            potionMakerSetStatus(player, "Level: whole number 1 to " + POTION_MAKER_MAX_LEVEL, COLORS.ERROR)
            return null
        }
        if (selectedEffect.instant) seconds = POTION_MAKER_DEFAULT_SECONDS
        else seconds = potionMakerClampSeconds(seconds)
        var configured = {
            id: selectedEffect.id,
            seconds: seconds,
            level: level,
            particles: values.particles !== false,
            icon: values.icon !== false
        }
        return configured
    }

    function buildPotionMakerBackground(gui) {
        gui.addTexturedRect(POTION_MAKER_IDS.BG_ROOT, "minecraft:textures/block/black_concrete.png", 0, 0, POTION_MAKER_WIDTH, POTION_MAKER_HEIGHT)
        gui.addTexturedRect(POTION_MAKER_IDS.BG_TITLE, "minecraft:textures/block/deepslate_tiles.png", 0, 0, POTION_MAKER_WIDTH, 32)
        gui.addTexturedRect(POTION_MAKER_IDS.BG_MODS, "minecraft:textures/block/gray_concrete.png", 12, 34, 100, 236)
        gui.addTexturedRect(POTION_MAKER_IDS.BG_EFFECTS, "minecraft:textures/block/gray_concrete.png", 122, 34, 150, 236)
        gui.addTexturedRect(POTION_MAKER_IDS.BG_RECIPE, "minecraft:textures/block/gray_concrete.png", 282, 34, 186, 236)
        gui.addTexturedRect(POTION_MAKER_IDS.BG_FOOTER, "minecraft:textures/block/deepslate_tiles.png", 12, 272, 456, 24)
        gui.addTexturedRect(POTION_MAKER_IDS.BG_ACCENT, "minecraft:textures/block/gold_block.png", 0, 0, POTION_MAKER_WIDTH, 2)
        gui.addTexturedRect(POTION_MAKER_IDS.BG_ACCENT_2, "minecraft:textures/block/cyan_concrete.png", 12, 34, 456, 2)
    }

    function buildPotionMakerGui(gui, player) {
        var state = potionMakerUiState(player)
        var playerName = String(player.getName())
        var draft = loadPotionMakerDraft(player)
        var categories = potionMakerCategories(state)
        var categoryFound = false
        for (var categoryIndex = 0; categoryIndex < categories.length; categoryIndex++) {
            if (categories[categoryIndex].id === state.category) categoryFound = true
        }
        if (categories.length && !categoryFound) state.category = categories[0].id
        state.categoryPage = potionMakerClampUiPage(state.categoryPage, categories.length)
        var categoryStart = state.categoryPage * POTION_MAKER_PAGE_SIZE
        var visibleCategories = categories.slice(categoryStart, categoryStart + POTION_MAKER_PAGE_SIZE)
        var filteredEffects = potionMakerFilteredEffects(state)
        state.effectPage = potionMakerClampUiPage(state.effectPage, filteredEffects.length)
        var effectStart = state.effectPage * POTION_MAKER_PAGE_SIZE
        var visibleEffects = filteredEffects.slice(effectStart, effectStart + POTION_MAKER_PAGE_SIZE)
        var selectedEffect = getPotionMakerSelectedEffect(player)
        var selectedIndex = playerPotionMakerSelection[playerName]
        var selectedVisibleIndex = -1
        for (var i = 0; i < visibleEffects.length; i++) {
            if (visibleEffects[i] === selectedIndex) selectedVisibleIndex = i
        }

        gui.addLabel(POTION_MAKER_IDS.TITLE, "§6§lPotion Maker", 12, 10, 400, 16)
        gui.addButton(POTION_MAKER_IDS.BACK, "§7Back", 426, 10, 42, 18)

        gui.addButton(POTION_MAKER_IDS.MOD_SCOPE, state.scope === POTION_MAKER_SCOPE_ALL ? "§8All effects" : "§bPotion effects", 12, 40, 100, 18)
        gui.addLabel(POTION_MAKER_IDS.MOD_LABEL, "§6§lMODS", 12, 60, 100, 10)
        var categoryLabels = []
        for (i = 0; i < visibleCategories.length; i++) categoryLabels.push(potionMakerFitText(visibleCategories[i].label, 16))
        var modScroll = gui.addScroll(POTION_MAKER_IDS.MODS, 12, 72, 100, 170, categoryLabels)
        var selectedCategory = -1
        for (i = 0; i < visibleCategories.length; i++) {
            if (visibleCategories[i].id === state.category) selectedCategory = i
        }
        if (selectedCategory >= 0) modScroll.setDefaultSelection(selectedCategory)
        var modPrev = gui.addButton(POTION_MAKER_IDS.MOD_PREV, "§7<", 12, 248, 48, 18)
        var modNext = gui.addButton(POTION_MAKER_IDS.MOD_NEXT, "§7>", 64, 248, 48, 18)
        modPrev.setEnabled(state.categoryPage > 0)
        modNext.setEnabled(state.categoryPage < potionMakerPageCount(categories.length) - 1)

        gui.addTextField(POTION_MAKER_IDS.SEARCH, 122, 40, 98, 20).setText(state.searchInput)
        gui.addButton(POTION_MAKER_IDS.SEARCH_APPLY, "§bFind", 224, 40, 48, 20)
        gui.addLabel(POTION_MAKER_IDS.EFFECT_LABEL, "§6§lEFFECTS", 122, 60, 150, 10)
        var effectLabels = []
        for (i = 0; i < visibleEffects.length; i++) {
            var visibleEffect = POTION_EFFECTS[visibleEffects[i]]
            effectLabels.push(potionMakerFitText("§f" + (visibleEffect.displayName || visibleEffect.id), 25))
        }
        var effectScroll = gui.addScroll(POTION_MAKER_IDS.EFFECTS, 122, 70, 150, 170, effectLabels)
        if (selectedVisibleIndex >= 0) effectScroll.setDefaultSelection(selectedVisibleIndex)
        var effectPrev = gui.addButton(POTION_MAKER_IDS.EFFECT_PREV, "§7< Prev", 122, 248, 72, 18)
        var effectNext = gui.addButton(POTION_MAKER_IDS.EFFECT_NEXT, "§7Next >", 200, 248, 72, 18)
        effectPrev.setEnabled(state.effectPage > 0)
        effectNext.setEnabled(state.effectPage < potionMakerPageCount(filteredEffects.length) - 1)

        var drinkButton = gui.addButton(POTION_MAKER_IDS.TYPE_DRINK, draft.type === "drink" ? "§a§lDrink" : "§bDrink", 282, 40, 88, 20)
        var splashButton = gui.addButton(POTION_MAKER_IDS.TYPE_SPLASH, draft.type === "splash" ? "§d§lSplash" : "§5Splash", 380, 40, 88, 20)
        drinkButton.setEnabled(true)
        splashButton.setEnabled(true)
        gui.addLabel(POTION_MAKER_IDS.RECIPE_LABEL, "§6§lRECIPE " + draft.effects.length + "/" + POTION_MAKER_MAX_RECIPE_EFFECTS, 282, 60, 186, 10)
        var recipeLabels = []
        var recipeCount = Math.min(draft.effects.length, POTION_MAKER_MAX_RECIPE_EFFECTS)
        for (i = 0; i < recipeCount; i++) {
            var recipeEffect = draft.effects[i]
            var catalogEffect = POTION_EFFECTS[potionMakerCatalogIndex(recipeEffect.id)]
            var recipeDuration = catalogEffect && catalogEffect.instant ? "Instant" : String(recipeEffect.seconds) + "s"
            recipeLabels.push(potionMakerFitText("§f" + getPotionMakerEffectName(recipeEffect.id) + " §7" + recipeDuration + " L" + recipeEffect.level, 29))
        }
        var recipeScroll = gui.addScroll(POTION_MAKER_IDS.RECIPE, 282, 72, 186, 66, recipeLabels)
        var selectedRecipe = selectedEffect ? potionMakerDraftIndex(draft, selectedEffect.id) : -1
        if (selectedRecipe >= 0 && selectedRecipe < recipeCount) recipeScroll.setDefaultSelection(selectedRecipe)

        var selectedName = selectedEffect ? potionMakerFitText(selectedEffect.displayName || selectedEffect.id, 28) : "Select an effect"
        gui.addLabel(POTION_MAKER_IDS.SELECTED, selectedEffect ? "§f" + selectedName : "§8" + selectedName, 282, 146, 186, 24)
        var values = selectedEffect ? potionMakerValuesFor(player, draft, selectedEffect) : {seconds: "", level: "", particles: false, icon: false}
        gui.addLabel(POTION_MAKER_IDS.DURATION_LABEL, selectedEffect && selectedEffect.instant ? "§7Instant" : "§7Seconds", 282, 178, 88, 10)
        gui.addLabel(POTION_MAKER_IDS.LEVEL_LABEL, "§7Level", 380, 178, 88, 10)
        var durationInput = gui.addTextField(POTION_MAKER_IDS.DURATION, 282, 190, 88, 20)
        durationInput.setText(selectedEffect ? String(values.seconds) : "")
        durationInput.setEnabled(!!selectedEffect && !selectedEffect.instant)
        var levelInput = gui.addTextField(POTION_MAKER_IDS.LEVEL, 380, 190, 88, 20)
        levelInput.setText(selectedEffect ? String(values.level) : "")
        levelInput.setEnabled(!!selectedEffect)
        var particlesButton = gui.addButton(POTION_MAKER_IDS.PARTICLES, values.particles ? "§bParticles ON" : "§8Particles OFF", 282, 216, 88, 20)
        var iconButton = gui.addButton(POTION_MAKER_IDS.ICON, values.icon ? "§bIcon ON" : "§8Icon OFF", 380, 216, 88, 20)
        particlesButton.setEnabled(!!selectedEffect)
        iconButton.setEnabled(!!selectedEffect)
        var draftIndex = selectedEffect ? potionMakerDraftIndex(draft, selectedEffect.id) : -1
        var addButton = gui.addButton(POTION_MAKER_IDS.ADD, draftIndex >= 0 ? "§bUpdate" : "§aAdd", 282, 240, 88, 18)
        var removeButton = gui.addButton(POTION_MAKER_IDS.REMOVE, "§cRemove", 380, 240, 88, 18)
        addButton.setEnabled(!!selectedEffect && (draftIndex >= 0 || draft.effects.length < POTION_MAKER_MAX_RECIPE_EFFECTS))
        removeButton.setEnabled(!!selectedEffect && draftIndex >= 0)

        var status = state.status ? state.statusColor + state.status : ""
        if (!status && typeof potionEffectScanError !== "undefined" && potionEffectScanError) status = COLORS.ERROR + potionEffectScanError
        var statusLabel = gui.addLabel(POTION_MAKER_IDS.STATUS, potionMakerFitText(status, 29), 282, 260, 186, 12)
        if (status && typeof statusLabel.setHoverText === "function") statusLabel.setHoverText(status)
        var createButton = gui.addButton(POTION_MAKER_IDS.CREATE, "§aCreate potion (" + draft.effects.length + ")", 12, 276, 160, 18)
        var clearButton = gui.addButton(POTION_MAKER_IDS.CLEAR, "§eClear recipe", 182, 276, 90, 18)
        gui.addButton(POTION_MAKER_IDS.COLOR, "§bColor: " + (draft.color || "Automatic"), 282, 276, 186, 18)
        clearButton.setEnabled(draft.effects.length > 0)
        createButton.setEnabled(true)
    }

    function openPotionMaker(player) {
        if (!isAdmin(player)) return
        ensurePotionEffectsScanned()
        var gui = API.createCustomGui(ADM_POTION_MAKER_GUI_ID, POTION_MAKER_WIDTH, POTION_MAKER_HEIGHT, false, player)
        if (potionMakerUiState(player).colorOpen) buildPotionColorGui(gui, player)
        else {
            buildPotionMakerBackground(gui)
            buildPotionMakerGui(gui, player)
        }
        player.showCustomGui(gui)
    }

    function buildPotionColorGui(gui, player) {
        var draft = loadPotionMakerDraft(player)
        var color = draft.color || "#55ffff"
        var number = parseInt(color.substring(1), 16)
        var origin = 24
        var width = POTION_MAKER_WIDTH - origin * 2
        gui.addTexturedRect(1, "minecraft:textures/block/black_concrete.png", 0, 0, POTION_MAKER_WIDTH, POTION_MAKER_HEIGHT)
        gui.addTexturedRect(2, "minecraft:textures/block/deepslate_tiles.png", 0, 0, POTION_MAKER_WIDTH, 32)
        gui.addTexturedRect(3, "minecraft:textures/block/gray_concrete.png", 12, 36, POTION_MAKER_WIDTH - 24, 234)
        gui.addLabel(POTION_MAKER_IDS.COLOR_TITLE, "§6§lPotion color", origin, 10, width, 16)
        gui.addLabel(POTION_MAKER_IDS.COLOR_SWATCH, "██████", origin, 46, 70, 16).setColor(number)
        gui.addLabel(POTION_MAKER_IDS.COLOR_VALUE, "§f" + (draft.color || "Automatic effect color"), origin + 90, 46, width - 90, 16)
        for (var i = 0; i < POTION_COLOR_PRESETS.length; i++) {
            gui.addButton(POTION_MAKER_IDS.COLOR_PRESET + i, POTION_COLOR_PRESETS[i][0], origin + (i % 4) * 110, 72 + Math.floor(i / 4) * 26, 100, 20)
        }
        var channels = [number >> 16, (number >> 8) & 255, number & 255]
        var labels = ["Red (0-255)", "Green (0-255)", "Blue (0-255)"]
        for (var channel = 0; channel < 3; channel++) {
            gui.addLabel(POTION_MAKER_IDS.COLOR_RGB_LABEL + channel, "§7" + labels[channel], origin + channel * 100, 164, 94, 12)
            gui.addTextField(POTION_MAKER_IDS.COLOR_RGB + channel, origin + channel * 100, 180, 90, 20).setText(String(channels[channel]))
        }
        gui.addButton(POTION_MAKER_IDS.COLOR_APPLY_RGB, "§aApply RGB", origin + 330, 180, 100, 20)
        gui.addLabel(POTION_MAKER_IDS.COLOR_HEX_LABEL, "§7Hex color (#RRGGBB)", origin, 212, 210, 12)
        gui.addTextField(POTION_MAKER_IDS.COLOR_HEX, origin, 228, 210, 20).setText(color)
        gui.addButton(POTION_MAKER_IDS.COLOR_APPLY_HEX, "§aApply hex", origin + 230, 228, 100, 20)
        var state = potionMakerUiState(player)
        gui.addLabel(POTION_MAKER_IDS.STATUS, (state.statusColor || "§7") + (state.status || "Choose a preset or enter a custom color."), origin, 254, width, 14)
        gui.addButton(POTION_MAKER_IDS.COLOR_AUTO, "§eAutomatic", origin, 276, 110, 18)
        gui.addButton(POTION_MAKER_IDS.COLOR_BACK, "§bBack to potion", POTION_MAKER_WIDTH - origin - 130, 276, 130, 18)
    }

    function potionMakerColorButton(player, gui, buttonId) {
        var state = potionMakerUiState(player)
        if (buttonId === POTION_MAKER_IDS.COLOR_BACK) {
            state.colorOpen = false
            potionMakerSetStatus(player, "", COLORS.GRAY)
            openPotionMaker(player)
            return
        }
        var draft = loadPotionMakerDraft(player)
        var color = draft.color
        var preset = buttonId - POTION_MAKER_IDS.COLOR_PRESET
        if (preset >= 0 && preset < POTION_COLOR_PRESETS.length) color = POTION_COLOR_PRESETS[preset][1]
        else if (buttonId === POTION_MAKER_IDS.COLOR_AUTO) color = null
        else if (buttonId === POTION_MAKER_IDS.COLOR_APPLY_HEX) {
            color = String(gui.getComponent(POTION_MAKER_IDS.COLOR_HEX).getText()).replace(/^\s+|\s+$/g, "")
            if (!/^#[0-9a-f]{6}$/i.test(color)) {
                player.message("§cEnter a six-digit hex color, for example #55FFFF.")
                return
            }
            color = color.toLowerCase()
        } else if (buttonId === POTION_MAKER_IDS.COLOR_APPLY_RGB) {
            var value = 0
            for (var i = 0; i < 3; i++) {
                var text = String(gui.getComponent(POTION_MAKER_IDS.COLOR_RGB + i).getText()).replace(/^\s+|\s+$/g, "")
                var channel = Number(text)
                if (text === "" || !isFinite(channel) || channel < 0 || channel > 255 || Math.floor(channel) !== channel) {
                    player.message("§cRGB values must be whole numbers from 0 to 255.")
                    return
                }
                value = value * 256 + channel
            }
            color = "#" + ("000000" + value.toString(16)).slice(-6)
        } else return
        draft.color = color
        savePotionMakerDraft(player, draft)
        potionMakerSetStatus(player, color ? "Color saved: " + color : "Using automatic effect color", COLORS.SUCCESS)
        openPotionMaker(player)
    }

    function potionMakerHtmlEvent(player, data) {
        if (!isAdmin(player) || !data) return
        var bridge = cnpcext.getClientBridge(player.getMCEntity())
        if (data.action === "ready") {
            ensurePotionEffectsScanned()
            bridge.sendToBrowser("potion_catalog", JSON.stringify({reset: true, effects: [], error: potionEffectScanError}))
            for (var i = 0; i < POTION_EFFECTS.length; i += 50) {
                var batch = []
                for (var j = i; j < Math.min(i + 50, POTION_EFFECTS.length); j++) {
                    var effect = POTION_EFFECTS[j]
                    batch.push({id: effect.id, name: effect.displayName, mod: effect.namespace, instant: effect.instant, inPotion: effect.inPotion})
                }
                bridge.sendToBrowser("potion_catalog", JSON.stringify({effects: batch}))
            }
            bridge.sendToBrowser("potion_catalog", JSON.stringify({effects: [], done: true}))
            return
        }
        if (!data.draft || !Array.isArray(data.draft.effects) || data.draft.effects.length > 16) return
        if (data.action === "create") {
            var ok = createPotionFromDraft(player, data.draft)
            if (ok) savePotionMakerDraft(player, data.draft)
            bridge.sendToBrowser("potion_result", JSON.stringify({ok: ok, message: ok ? "Potion added to your inventory." : "Could not create potion. Check your recipe and the chat message."}))
            return
        }
        if (data.action === "save" || data.action === "back" || data.action === "close") {
            savePotionMakerDraft(player, data.draft)
            if (data.action !== "save") {
                bridge.closeHtmlGui()
                if (data.action === "back") showAdminGui(player, "Items")
            }
        }
    }

    function potionMakerButton(event) {
        var player = event.player
        if (!isAdmin(player)) return
        if (potionMakerUiState(player).colorOpen) {
            potionMakerColorButton(player, event.gui, event.buttonId)
            return
        }
        potionMakerCaptureGui(event)
        var buttonId = event.buttonId
        var draft = loadPotionMakerDraft(player)
        var state = potionMakerUiState(player)

        if (buttonId === POTION_MAKER_IDS.COLOR) {
            state.colorOpen = true
            potionMakerSetStatus(player, "", COLORS.GRAY)
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.BACK) {
            showAdminGui(player, "Items")
            return
        }

        if (buttonId === POTION_MAKER_IDS.MOD_SCOPE) {
            state.scope = state.scope === POTION_MAKER_SCOPE_ALL ? POTION_MAKER_SCOPE_POTION : POTION_MAKER_SCOPE_ALL
            state.categoryPage = 0
            state.effectPage = 0
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.SEARCH_APPLY) {
            state.search = state.searchInput || ""
            state.effectPage = 0
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.MOD_PREV || buttonId === POTION_MAKER_IDS.MOD_NEXT) {
            var categories = potionMakerCategories(state)
            state.categoryPage = potionMakerClampUiPage(state.categoryPage + (buttonId === POTION_MAKER_IDS.MOD_NEXT ? 1 : -1), categories.length)
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.EFFECT_PREV || buttonId === POTION_MAKER_IDS.EFFECT_NEXT) {
            var filteredEffects = potionMakerFilteredEffects(state)
            state.effectPage = potionMakerClampUiPage(state.effectPage + (buttonId === POTION_MAKER_IDS.EFFECT_NEXT ? 1 : -1), filteredEffects.length)
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.CLEAR) {
            draft.effects = []
            savePotionMakerDraft(player, draft)
            potionMakerSetStatus(player, "Recipe cleared", COLORS.WARNING)
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.CREATE) {
            var created = createPotionFromDraft(player, draft)
            if (created) potionMakerSetStatus(player, "Potion created", COLORS.SUCCESS)
            else if (!draft.effects.length) potionMakerSetStatus(player, "Add at least one effect first", COLORS.ERROR)
            else potionMakerSetStatus(player, "Potion could not be created", COLORS.ERROR)
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.TYPE_DRINK || buttonId === POTION_MAKER_IDS.TYPE_SPLASH) {
            draft.type = buttonId === POTION_MAKER_IDS.TYPE_SPLASH ? "splash" : "drink"
            savePotionMakerDraft(player, draft)
            openPotionMaker(player)
            return
        }

        var selectedEffect = getPotionMakerSelectedEffect(player)
        if (!selectedEffect) {
            potionMakerSetStatus(player, "Select an effect first", COLORS.ERROR)
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.PARTICLES || buttonId === POTION_MAKER_IDS.ICON) {
            var toggleValues = potionMakerValuesFor(player, draft, selectedEffect)
            if (buttonId === POTION_MAKER_IDS.PARTICLES) toggleValues.particles = !toggleValues.particles
            else toggleValues.icon = !toggleValues.icon
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.REMOVE) {
            var removeIndex = potionMakerDraftIndex(draft, selectedEffect.id)
            if (removeIndex < 0) potionMakerSetStatus(player, "That effect is not in the recipe", COLORS.ERROR)
            else {
                draft.effects.splice(removeIndex, 1)
                savePotionMakerDraft(player, draft)
                potionMakerSetStatus(player, "Effect removed", COLORS.WARNING)
            }
            openPotionMaker(player)
            return
        }

        if (buttonId === POTION_MAKER_IDS.ADD) {
            var existingIndex = potionMakerDraftIndex(draft, selectedEffect.id)
            if (existingIndex < 0 && draft.effects.length >= POTION_MAKER_MAX_RECIPE_EFFECTS) {
                potionMakerSetStatus(player, "Recipe is full (" + POTION_MAKER_MAX_RECIPE_EFFECTS + " effects)", COLORS.ERROR)
                openPotionMaker(player)
                return
            }
            var configuredEffect = potionMakerBuildConfiguredEffect(player, draft, selectedEffect)
            if (!configuredEffect) {
                openPotionMaker(player)
                return
            }
            if (existingIndex >= 0) {
                draft.effects[existingIndex] = configuredEffect
                potionMakerSetStatus(player, "Effect updated", COLORS.SUCCESS)
            } else {
                draft.effects.push(configuredEffect)
                potionMakerSetStatus(player, "Effect added", COLORS.SUCCESS)
            }
            state.effectValues[canonicalPotionEffectId(selectedEffect.id)] = {
                seconds: String(configuredEffect.seconds),
                level: String(configuredEffect.level),
                particles: configuredEffect.particles,
                icon: configuredEffect.icon
            }
            savePotionMakerDraft(player, draft)
            openPotionMaker(player)
        }
    }

    function potionMakerScroll(event) {
        var player = event.player
        if (!isAdmin(player)) return
        potionMakerCaptureGui(event)
        var state = potionMakerUiState(player)
        var scrollIndex = Number(event.scrollIndex)

        if (event.scrollId === POTION_MAKER_IDS.MODS) {
            var categories = potionMakerCategories(state)
            state.categoryPage = potionMakerClampUiPage(state.categoryPage, categories.length)
            var categoryStart = state.categoryPage * POTION_MAKER_PAGE_SIZE
            var category = categories[categoryStart + scrollIndex]
            if (category) {
                state.category = category.id
                state.effectPage = 0
                potionMakerSetStatus(player, "", COLORS.GRAY)
            }
            openPotionMaker(player)
            return
        }

        if (event.scrollId === POTION_MAKER_IDS.EFFECTS) {
            var filteredEffects = potionMakerFilteredEffects(state)
            state.effectPage = potionMakerClampUiPage(state.effectPage, filteredEffects.length)
            var effectIndex = filteredEffects[state.effectPage * POTION_MAKER_PAGE_SIZE + scrollIndex]
            if (effectIndex !== undefined && POTION_EFFECTS[effectIndex]) {
                playerPotionMakerSelection[String(player.getName())] = effectIndex
                potionMakerSetStatus(player, "", COLORS.GRAY)
            }
            openPotionMaker(player)
            return
        }

        if (event.scrollId === POTION_MAKER_IDS.RECIPE) {
            var draft = loadPotionMakerDraft(player)
            var recipeIndex = Math.floor(scrollIndex)
            if (recipeIndex >= 0 && recipeIndex < draft.effects.length && recipeIndex < POTION_MAKER_MAX_RECIPE_EFFECTS) {
                potionMakerSetSelectionById(player, draft.effects[recipeIndex].id)
                potionMakerSetStatus(player, "", COLORS.GRAY)
            }
            openPotionMaker(player)
        }
    }

    function buildNBTTab(gui, player) {
        var contentWidth = GuiMath.contentWidth()
        gui.addLabel(IDS.LABEL_TAB_TITLE, COLORS.HIGHLIGHT + "§l⚙ NBT Actions", LAYOUT.CONTENT_X, 34, contentWidth, 14)
        gui.addLabel(IDS.LABEL_HINT, COLORS.DARK_GRAY + "Quick NBT modifications", LAYOUT.CONTENT_X, 48, contentWidth, 10)

        var startY = 65
        var btnWidth = 150
        var btnHeight = 22
        var gap = 5

        for (var i = 0; i < NBT_ACTIONS.length; i++) {
            var row = Math.floor(i / 2)
            var col = i % 2
            var pos = GuiMath.grid(col, row, btnWidth, btnHeight, gap, gap, LAYOUT.CONTENT_X, startY)

            var btn = gui.addButton(IDS.BTN_ACTION_1 + i, NBT_ACTIONS[i].name, pos[0], pos[1], btnWidth, btnHeight)
            btn.setHoverText(NBT_ACTIONS[i].desc)
        }
    }

    function buildRawNBTTab(gui, player) {
        var item = player.getMainhandItem()
        var contentWidth = GuiMath.contentWidth()

        gui.addLabel(IDS.LABEL_TAB_TITLE, COLORS.ERROR + "§l{ } Raw NBT Editor", LAYOUT.CONTENT_X, 34, contentWidth, 14)
        gui.addLabel(IDS.LABEL_HINT, COLORS.WARNING + "⚠ Advanced - Edit with care!", LAYOUT.CONTENT_X, 48, contentWidth, 10)

        var nbtString = ""
        if (item && !item.isEmpty()) {
            try {
                var nbt = item.getNbt()
                nbtString = nbt.toJsonString()
            } catch (e) {
                nbtString = "Error reading NBT: " + e.message
            }
        } else {
            nbtString = "No item in hand"
        }

        var nbtArea = gui.addTextArea(IDS.INPUT_RAW_NBT, LAYOUT.CONTENT_X, 62, contentWidth, 135)
        nbtArea.setText(nbtString)
        nbtArea.setCodeTheme(true) 

        gui.addButton(IDS.BTN_APPLY, "§aApply NBT", LAYOUT.CONTENT_X, 203, 95, 16)
        gui.addButton(IDS.BTN_REFRESH_NBT, "§e↻ Refresh", 200, 203, 95, 16)
        gui.addButton(IDS.BTN_CLEAR, "§c✕ Clear NBT", 300, 203, 105, 16)

        gui.addLabel(IDS.LABEL_INFO_3, COLORS.DARK_GRAY + "Edit JSON, then Apply to modify item", LAYOUT.CONTENT_X, 224, contentWidth, 10)
    }

    // ============================================
    // pFEATURES TAB - PERSONALIZED FEATURES
    // ============================================

    function buildPFeaturesTab(gui, player) {
        var item = player.getMainhandItem()
        var contentWidth = GuiMath.contentWidth()

        gui.addLabel(IDS.LABEL_TAB_TITLE, "§5§l★ Personalized Features", LAYOUT.CONTENT_X, 34, contentWidth, 14)
        gui.addLabel(IDS.LABEL_HINT, COLORS.GRAY + "Special item styling tools", LAYOUT.CONTENT_X, 48, contentWidth, 10)

        // Sweetify Section
        gui.addLabel(IDS.LABEL_INFO_1, "§d§lSweetify §8- Pretty Attribute Display", LAYOUT.CONTENT_X, 65, contentWidth, 12)
        
        var sweetBtn = gui.addButton(IDS.BTN_SWEETIFY, "§d✨ Sweetify", LAYOUT.CONTENT_X, 80, 120, 18)
        sweetBtn.setHoverText("Hides vanilla attributes and adds\nbeautiful styled lore instead!")
        
        var unsweetBtn = gui.addButton(IDS.BTN_UNSWEETIFY, "§7↩ Undo", 225, 80, 90, 18)
        unsweetBtn.setHoverText("Remove sweet lore and restore\nvanilla attribute display")

        // Show current attribute count
        if (item && !item.isEmpty()) {
            var attrs = extractAttributesFromItem(item)
            if (attrs.length > 0) {
                gui.addLabel(IDS.LABEL_INFO_2, "§a✓ " + attrs.length + " attribute(s) detected", LAYOUT.CONTENT_X, 105, contentWidth, 10)
            } else {
                gui.addLabel(IDS.LABEL_INFO_2, "§8No attributes on this item", LAYOUT.CONTENT_X, 105, contentWidth, 10)
            }
        } else {
            gui.addLabel(IDS.LABEL_INFO_2, "§8Hold an item to sweetify", LAYOUT.CONTENT_X, 105, contentWidth, 10)
        }

        // Divider
        gui.addLabel(IDS.LABEL_INFO_3, "§8═╬════════════════════════════════╬═", LAYOUT.CONTENT_X, 123, contentWidth, 10)

        // Rarity Section (bonus feature)
        gui.addLabel(IDS.LABEL_INFO_4, "§e§lRarity Tags §8- Add rarity to name", LAYOUT.CONTENT_X, 138, contentWidth, 12)

        var rarityY = 153
        gui.addButton(IDS.BTN_RARITY_COMMON, "§fCommon", LAYOUT.CONTENT_X, rarityY, 55, 14)
        gui.addButton(IDS.BTN_RARITY_UNCOMMON, "§aUncommon", 158, rarityY, 65, 14)
        gui.addButton(IDS.BTN_RARITY_RARE, "§9Rare", 226, rarityY, 50, 14)
        gui.addButton(IDS.BTN_RARITY_EPIC, "§5Epic", 279, rarityY, 50, 14)
        gui.addButton(IDS.BTN_RARITY_LEGENDARY, "§6★ Legendary", 332, rarityY, 73, 14)

        var cleanBtn = gui.addButton(IDS.BTN_CLEAN_LORE, "§c✕ Clean All Lore", LAYOUT.CONTENT_X, rarityY + 22, 140, 16)
        cleanBtn.setHoverText("Removes all lore from the item")
    }

    function buildBottomBar(gui) {
        var sectionPos = GuiMath.anchor("bottom-left", 20, 16, 10, 8)
        var sectionField = gui.addTextArea(IDS.INPUT_SECTION_SYMBOL, sectionPos[0], sectionPos[1], 20, 16)
        sectionField.setText("§")
        sectionField.setEnabled(false)

        gui.addLabel(IDS.LABEL_SECTION_COPY, COLORS.DARK_GRAY + "Copy →", 32, sectionPos[1] + 4, 40, 10)
            .setHoverText("§00 §11 §22 §33 §44 §55 §66 §77\n§88 §99 §aa §bb §cc §dd §ee §ff\n§ll=Bold §oo=Italic §nn=Underline\n§mm=Strike §kk=Obfuscate §rr=Reset")

        var closePos = GuiMath.anchor("bottom-right", 50, 16, 10, 8)
        gui.addButton(IDS.BTN_CLOSE, "§cClose", closePos[0], closePos[1], 50, 16)
        gui.addButton(990, "§6Item Registry", 112, sectionPos[1], 108, 16)
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    function detectArmorSlot(itemName) {
        if (!itemName) return ""
        var parts = itemName.split('_')
        var type = parts[parts.length - 1]

        switch(type) {
            case "helmet": return 5
            case "chestplate": return 4
            case "leggings": return 3
            case "boots": return 2
            default: return ""
        }
    }

    function sendMessage(player, message, color) {
        color = color || COLORS.INFO
        player.message(color + message + COLORS.RESET)
    }

    function validateItem(player) {
        var item = player.getMainhandItem()
        if (!item || item.isEmpty()) {
            sendMessage(player, "Hold an item in your main hand!", COLORS.ERROR)
            return null
        }
        return item
    }

    function isPotionItem(item) {
        if (!item || item.isEmpty()) return false
        var itemId = String(item.getName() || item.getItemName() || "").toLowerCase()
        return itemId.indexOf("potion") >= 0
    }

    function createPotionItem(player) {
        var potion = player.getWorld().createItem("minecraft:potion", 1)
        player.setMainhandItem(potion)
        return potion
    }

    function getPotionItemForEdit(player) {
        var item = player.getMainhandItem()
        if (isPotionItem(item)) return item
        return createPotionItem(player)
    }

    function getLegacyPotionEffectId(legacyId) {
        var legacyIds = {
            1: "minecraft:speed",
            2: "minecraft:slowness",
            3: "minecraft:haste",
            4: "minecraft:mining_fatigue",
            5: "minecraft:strength",
            6: "minecraft:instant_health",
            7: "minecraft:instant_damage",
            8: "minecraft:jump_boost",
            9: "minecraft:nausea",
            10: "minecraft:regeneration",
            11: "minecraft:resistance",
            12: "minecraft:fire_resistance",
            13: "minecraft:water_breathing",
            14: "minecraft:invisibility",
            15: "minecraft:blindness",
            16: "minecraft:night_vision",
            17: "minecraft:hunger",
            18: "minecraft:weakness",
            19: "minecraft:poison",
            20: "minecraft:wither",
            21: "minecraft:health_boost",
            22: "minecraft:absorption",
            23: "minecraft:saturation",
            24: "minecraft:glowing",
            25: "minecraft:levitation",
            26: "minecraft:luck",
            27: "minecraft:unluck",
            28: "minecraft:slow_falling",
            29: "minecraft:conduit_power",
            30: "minecraft:dolphins_grace",
            31: "minecraft:bad_omen",
            32: "minecraft:hero_of_the_village",
            33: "minecraft:darkness"
        }
        return legacyIds[Number(legacyId)] || ""
    }

    function potionEffectIdFromNbt(effectNbt) {
        if (!effectNbt) return ""
        var id = ""
        try {
            id = String(effectNbt.getString("id") || "")
        } catch (e) {
            id = ""
        }
        if (id) return canonicalPotionEffectId(id)
        try {
            if (effectNbt.has("Id")) return getLegacyPotionEffectId(effectNbt.getInteger("Id"))
        } catch (e) {
            return ""
        }
        return ""
    }

    function extractPotionEffectsFromItem(item) {
        var effects = []
        if (!item || item.isEmpty()) return effects

        var nbt = item.getNbt()
        if (!nbt.has("CustomPotionEffects")) return effects

        var list = nbt.getList("CustomPotionEffects", 10)
        if (!list || !list.length) return effects

        for (var i = 0; i < list.length; i++) {
            var effectNbt = list[i]
            var id = potionEffectIdFromNbt(effectNbt)
            if (!id) continue
            effects.push({
                id: id,
                duration: effectNbt.has("duration") ? effectNbt.getInteger("duration") : 0,
                level: effectNbt.has("amplifier") ? effectNbt.getByte("amplifier") + 1 : 1,
                particles: !effectNbt.has("show_particles") || effectNbt.getBoolean("show_particles"),
                icon: !effectNbt.has("show_icon") || effectNbt.getBoolean("show_icon")
            })
        }
        return effects
    }

    function getPotionEffectEditorValues(item, effectId) {
        var values = {
            duration: 600,
            level: 1,
            particles: true,
            icon: true
        }
        var wantedId = canonicalPotionEffectId(effectId)
        var effects = extractPotionEffectsFromItem(item)
        for (var i = 0; i < effects.length; i++) {
            if (effects[i].id === wantedId) {
                values.duration = effects[i].duration > 0 ? effects[i].duration : values.duration
                values.level = effects[i].level > 0 ? effects[i].level : values.level
                values.particles = effects[i].particles
                values.icon = effects[i].icon
                break
            }
        }
        return values
    }

    function applyPotionEffectToItem(item, effectId, duration, level, particles, icon) {
        var nbt = item.getNbt()
        var wantedId = canonicalPotionEffectId(effectId)
        var effects = []

        if (nbt.has("CustomPotionEffects")) {
            var existing = nbt.getList("CustomPotionEffects", 10)
            if (existing && existing.length) {
                for (var i = 0; i < existing.length; i++) {
                    if (potionEffectIdFromNbt(existing[i]) !== wantedId) effects.push(existing[i])
                }
            }
        }

        var effectNbt = API.stringToNbt("{}")
        effectNbt.putString("id", wantedId)
        effectNbt.setByte("amplifier", Math.max(0, Number(level) - 1))
        effectNbt.setInteger("duration", Math.max(1, Number(duration)))
        effectNbt.setBoolean("ambient", false)
        effectNbt.setBoolean("show_particles", particles !== false)
        effectNbt.setBoolean("show_icon", icon !== false)
        effects.push(effectNbt)

        nbt.setList("CustomPotionEffects", effects)
        nbt.putString("Potion", "minecraft:water")
    }

    function removePotionEffectFromItem(item, effectId) {
        var nbt = item.getNbt()
        if (!nbt.has("CustomPotionEffects")) return false

        var wantedId = canonicalPotionEffectId(effectId)
        var existing = nbt.getList("CustomPotionEffects", 10)
        var remaining = []
        var removed = false
        if (existing && existing.length) {
            for (var i = 0; i < existing.length; i++) {
                if (potionEffectIdFromNbt(existing[i]) === wantedId) {
                    removed = true
                } else {
                    remaining.push(existing[i])
                }
            }
        }

        if (remaining.length) nbt.setList("CustomPotionEffects", remaining)
        else nbt.remove("CustomPotionEffects")
        return removed
    }

    function clearPotionEffectsFromItem(item) {
        var nbt = item.getNbt()
        if (nbt.has("CustomPotionEffects")) nbt.remove("CustomPotionEffects")
    }

    function applyAttributeWithOperation(item, attributeId, value, slot, operation) {
        var nbt = item.getNbt()

        var slotName = ATTRIBUTE_SLOT_NAMES[slot] || "mainhand"

        var modifiers = []
        var updatedModifier = null
        if (nbt.has("AttributeModifiers")) {
            var existingList = nbt.getList("AttributeModifiers", 10) 

            if (existingList && existingList.length) {
                for (var i = 0; i < existingList.length; i++) {
                    var existing = existingList[i]
                    var existingAttr = existing.getString("AttributeName")

                    if (attributeIdsEqual(existingAttr, attributeId)) {
                        if (!updatedModifier) {
                            existing.setDouble("Amount", value)
                            existing.setInteger("Operation", operation)
                            existing.putString("Slot", slotName)
                            modifiers.push(existing)
                            updatedModifier = existing
                        }
                    } else {
                        modifiers.push(existing)
                    }
                }
            }
        }

        if (!updatedModifier) {
            var storedAttributeId = getStoredAttributeId(attributeId)
            var uuid = [
                Math.floor(Math.random() * 2147483647) - 1073741824,
                Math.floor(Math.random() * 2147483647) - 1073741824,
                Math.floor(Math.random() * 2147483647) - 1073741824,
                Math.floor(Math.random() * 2147483647) - 1073741824
            ]
            var modifierJson = '{' +
                'AttributeName:"' + storedAttributeId + '",' +
                'Name:"' + storedAttributeId + '",' +
                'Amount:' + value + 'd,' +
                'Operation:' + operation + ',' +
                'UUID:[I;' + uuid[0] + ',' + uuid[1] + ',' + uuid[2] + ',' + uuid[3] + '],' +
                'Slot:"' + slotName + '"' +
            '}'

            modifiers.push(API.stringToNbt(modifierJson))
        }

        nbt.setList("AttributeModifiers", modifiers)
    }

    function rarityName(name, rarity) {
        var style = RARITY_STYLES[String(rarity).toLowerCase()]
        var stem = String(name || "").replace(/§[0-9a-fk-or]/gi, "").replace(/^[✦★]+\s*/, "")
        return style ? style.prefix + style.color + stem : "§e" + stem
    }
    function applyRarityTag(player, item, rarity) {
        var style = RARITY_STYLES[rarity]
        if (!style) return
        
        var currentName = item.getDisplayName()
        // Remove existing rarity prefix if any
        for (var key in RARITY_STYLES) {
            var prefix = RARITY_STYLES[key].prefix
            if (prefix && currentName.indexOf(prefix) === 0) {
                currentName = currentName.substring(prefix.length)
            }
        }
        // Remove color codes at start
        currentName = currentName.replace(/^(§[0-9a-fklmnor])+/gi, '')
        
        var newName = rarityName(currentName, rarity)
        item.setCustomName(newName)
        
        sendMessage(player, "Applied " + style.color + style.name + " §frarity!", COLORS.SUCCESS)
    }

    // ============================================
    // MAIN GUI FUNCTIONS
    // ============================================

    function openEditor(event, tab) {
        var player = event.player
        var playerName = player.getName()

        if (tab !== undefined) {
            playerActiveTab[playerName] = tab
        } else if (playerActiveTab[playerName] === undefined) {
            playerActiveTab[playerName] = TABS.NAME
        }

        var activeTab = playerActiveTab[playerName]

        var gui = API.createCustomGui(CONFIG.GUI_ID, CONFIG.WIDTH, CONFIG.HEIGHT, false, player)

        buildBackground(gui)
        buildHeader(gui, player)
        buildTabScroll(gui, player)
        buildBottomBar(gui)

        switch(activeTab) {
            case TABS.NAME:
                buildNameTab(gui, player)
                break
            case TABS.LORE:
                buildLoreTab(gui, player)
                break
            case TABS.ATTRIBUTES:
                buildAttributesTab(gui, player)
                break
            case TABS.ENCHANTS:
                buildEnchantsTab(gui, player)
                break
            case TABS.NBT:
                buildNBTTab(gui, player)
                break
            case TABS.RAW_NBT:
                buildRawNBTTab(gui, player)
                break
            case TABS.PFEATURES:
                buildPFeaturesTab(gui, player)
                break
            case TABS.POTION:
                buildPotionTab(gui, player)
                break
        }

        player.showCustomGui(gui)
    }

    /**
     * @param {BlockEvent.InteractEvent} event
     */
    function interact(event) {
        openEditor(event)
    }

    /**
     * @param {CustomGuiEvent.ButtonEvent} event
     */
    function customGuiButton(event) {
        var player = event.player
        var buttonId = event.buttonId
        var gui = event.gui
        var playerName = player.getName()
        var activeTab = playerActiveTab[playerName] || TABS.NAME
        if (buttonId === 990) { ARVAN_ITEMS.open(player); return }

        if (buttonId === IDS.BTN_CLOSE) {
            player.closeGui()
            return
        }

        switch(activeTab) {
            case TABS.NAME:
                if (buttonId === IDS.BTN_APPLY) {
                    var item = validateItem(player)
                    if (item) {
                        var newName = gui.getComponent(IDS.INPUT_PRIMARY).getText()
                        if (newName && newName.trim() !== "") {
                            item.setCustomName(newName)
                            sendMessage(player, "Name set: " + newName, COLORS.SUCCESS)
                        }
                    }
                    openEditor(event)
                }
                break

            case TABS.LORE:
                if (buttonId === IDS.BTN_APPLY) {
                    var item = validateItem(player)
                    if (item) {
                        var loreLines = []
                        for (var i = 0; i < 10; i++) {
                            var comp = gui.getComponent(IDS.INPUT_LORE_START + i)
                            if (comp) {
                                var line = comp.getText()
                                if (line && line.trim() !== "") {
                                    loreLines.push(line)
                                }
                            }
                        }
                        item.setLore(loreLines)
                        sendMessage(player, "Lore saved! (" + loreLines.length + " lines)", COLORS.SUCCESS)
                    }
                    openEditor(event)
                } else if (buttonId === IDS.BTN_CLEAR) {
                    var item = validateItem(player)
                    if (item) {
                        item.setLore([])
                        sendMessage(player, "Lore cleared!", COLORS.WARNING)
                    }
                    openEditor(event)
                }
                break

            case TABS.ATTRIBUTES:
                if (buttonId === IDS.BTN_APPLY) {
                    var item = validateItem(player)
                    var selectedIdx = playerSelectedAttribute[playerName]

                    if (item && selectedIdx !== undefined && selectedIdx >= 0) {
                        var attr = ATTRIBUTES[selectedIdx]
                        var value = parseFloat(gui.getComponent(IDS.INPUT_PRIMARY).getText())
                        var operation = parseInt(gui.getComponent(IDS.INPUT_OPERATION).getText())
                        var slot = parseInt(gui.getComponent(IDS.INPUT_SECONDARY).getText())

                        if (isNaN(value)) {
                            sendMessage(player, "Invalid value!", COLORS.ERROR)
                        } else if (isNaN(operation) || operation < 0 || operation > 2) {
                            sendMessage(player, "Type must be 0, 1, or 2!", COLORS.ERROR)
                        } else if (isNaN(slot) || slot < 0 || slot > 5) {
                            sendMessage(player, "Slot must be 0-5!", COLORS.ERROR)
                        } else {
                            var opNames = ["Add", "MulBase", "MulTotal"]
                            applyAttributeWithOperation(item, attr.id, value, slot, operation)
                            sendMessage(player, "Applied " + attr.name + " §f(" + opNames[operation] + ") = " + value, COLORS.SUCCESS)
                        }
                    } else {
                        sendMessage(player, "Select an attribute first!", COLORS.ERROR)
                    }
                    openEditor(event)
                }
                break

            case TABS.ENCHANTS:
                if (buttonId === IDS.BTN_APPLY) {
                    var item = validateItem(player)
                    var selectedIdx = playerSelectedEnchant[playerName]

                    if (item && selectedIdx !== undefined && selectedIdx >= 0) {
                        var enchant = ENCHANTMENTS[selectedIdx]
                        var level = parseInt(gui.getComponent(IDS.INPUT_ENCHANT_LEVEL).getText())

                        if (isNaN(level) || level < 1) {
                            sendMessage(player, "Level must be at least 1!", COLORS.ERROR)
                        } else {
                            item.addEnchantment(enchant.id, level)
                            sendMessage(player, "Added " + enchant.name + " §f" + level, COLORS.SUCCESS)
                        }
                    } else {
                        sendMessage(player, "Select an enchantment first!", COLORS.ERROR)
                    }
                    openEditor(event)
                } else if (buttonId === IDS.BTN_REMOVE_ENCHANT) {
                    var item = validateItem(player)
                    var selectedIdx = playerSelectedEnchant[playerName]

                    if (item && selectedIdx !== undefined && selectedIdx >= 0) {
                        var enchant = ENCHANTMENTS[selectedIdx]
                        if (item.hasEnchant(enchant.id)) {
                            item.removeEnchant(enchant.id)
                            sendMessage(player, "Removed " + enchant.name, COLORS.WARNING)
                        } else {
                            sendMessage(player, "Item doesn't have that enchant!", COLORS.ERROR)
                        }
                    } else {
                        sendMessage(player, "Select an enchantment first!", COLORS.ERROR)
                    }
                    openEditor(event)
                }
                break

            case TABS.NBT:
                handleNBTAction(event, buttonId)
                break

            case TABS.RAW_NBT:
                handleRawNBTAction(event, buttonId, gui)
                break

            case TABS.PFEATURES:
                handlePFeaturesAction(event, buttonId)
                break

            case TABS.POTION:
                handlePotionAction(event, buttonId, gui)
                break
        }
    }

    function handleNBTAction(event, buttonId) {
        var player = event.player
        var item = validateItem(player)
        if (!item) {
            openEditor(event)
            return
        }

        var actionIdx = buttonId - IDS.BTN_ACTION_1
        if (actionIdx < 0 || actionIdx >= NBT_ACTIONS.length) return

        var action = NBT_ACTIONS[actionIdx]
        var nbt = item.getNbt()

        switch(action.id) {
            case "unbreakable":
                nbt.setInteger('Unbreakable', 1)
                sendMessage(player, "Item is now Unbreakable!", COLORS.SUCCESS)
                break
            case "hideflags":
                nbt.setInteger('HideFlags', 255)
                sendMessage(player, "All flags hidden!", COLORS.SUCCESS)
                break
            case "hideenchants":
                nbt.setInteger('HideFlags', 1)
                sendMessage(player, "Enchants hidden!", COLORS.SUCCESS)
                break
            case "hideattribs":
                nbt.setInteger('HideFlags', 2)
                sendMessage(player, "Attributes hidden!", COLORS.SUCCESS)
                break
            case "hidedye":
                nbt.setInteger('HideFlags', 64)
                sendMessage(player, "Dye hidden!", COLORS.SUCCESS)
                break
            case "clearenchants":
                if (nbt.has("Enchantments")) {
                    nbt.remove("Enchantments")
                    sendMessage(player, "Enchantments cleared!", COLORS.WARNING)
                } else {
                    sendMessage(player, "No enchantments to clear", COLORS.GRAY)
                }
                break
        }

        openEditor(event)
    }

    function handleRawNBTAction(event, buttonId, gui) {
        var player = event.player

        switch(buttonId) {
            case IDS.BTN_APPLY:
                var item = validateItem(player)
                if (item) {
                    var nbtString = gui.getComponent(IDS.INPUT_RAW_NBT).getText()

                    if (!nbtString || nbtString.trim() === "" || nbtString === "No item in hand") {
                        sendMessage(player, "No NBT to apply!", COLORS.ERROR)
                    } else {
                        try {
                            var newNbt = API.stringToNbt(nbtString)
                            var itemNbt = item.getNbt()

                            var keys = itemNbt.getKeys()
                            var keyArray = []
                            for (var k = 0; k < keys.length; k++) {
                                keyArray.push(keys[k])
                            }
                            for (var k = 0; k < keyArray.length; k++) {
                                itemNbt.remove(keyArray[k])
                            }

                            itemNbt.merge(newNbt)
                            sendMessage(player, "NBT applied successfully!", COLORS.SUCCESS)
                        } catch (e) {
                            sendMessage(player, "NBT Parse Error: " + e.message, COLORS.ERROR)
                        }
                    }
                }
                break

            case IDS.BTN_REFRESH_NBT:
                sendMessage(player, "NBT refreshed", COLORS.INFO)
                break

            case IDS.BTN_CLEAR:
                var item = validateItem(player)
                if (item) {
                    var nbt = item.getNbt()
                    var keys = nbt.getKeys()
                    var keyArray = []
                    for (var i = 0; i < keys.length; i++) {
                        keyArray.push(keys[i])
                    }
                    for (var i = 0; i < keyArray.length; i++) {
                        nbt.remove(keyArray[i])
                    }
                    sendMessage(player, "All NBT cleared!", COLORS.WARNING)
                }
                break
        }

        openEditor(event)
    }

    function handlePFeaturesAction(event, buttonId) {
        var player = event.player
        var item = validateItem(player)
        
        if (!item) {
            openEditor(event)
            return
        }

        switch(buttonId) {
            case IDS.BTN_SWEETIFY:
                sweetifyItem(player, item)
                break
                
            case IDS.BTN_UNSWEETIFY:
                unsweetifyItem(player, item)
                break
                
            case IDS.BTN_CLEAN_LORE:
                item.setLore([])
                sendMessage(player, "All lore cleared!", COLORS.WARNING)
                break
                
            case IDS.BTN_RARITY_COMMON:
                applyRarityTag(player, item, "common")
                break
                
            case IDS.BTN_RARITY_UNCOMMON:
                applyRarityTag(player, item, "uncommon")
                break
                
            case IDS.BTN_RARITY_RARE:
                applyRarityTag(player, item, "rare")
                break
                
            case IDS.BTN_RARITY_EPIC:
                applyRarityTag(player, item, "epic")
                break
                
            case IDS.BTN_RARITY_LEGENDARY:
                applyRarityTag(player, item, "legendary")
                break
        }

        openEditor(event)
    }

    function handlePotionAction(event, buttonId, gui) {
        var player = event.player
        var playerName = player.getName()

        ensurePotionEffectsScanned()

        if (buttonId === IDS.BTN_POTION_CREATE) {
            createPotionItem(player)
            sendMessage(player, "Created a blank potion", COLORS.SUCCESS)
            openEditor(event, TABS.POTION)
            return
        }

        if (buttonId === IDS.BTN_POTION_CLEAR) {
            var clearItem = validateItem(player)
            if (clearItem) {
                clearPotionEffectsFromItem(clearItem)
                sendMessage(player, "Cleared custom potion effects", COLORS.WARNING)
            }
            openEditor(event, TABS.POTION)
            return
        }

        var selectedIdx = playerSelectedPotionEffect[playerName]
        if (selectedIdx === undefined || selectedIdx < 0 || selectedIdx >= POTION_EFFECTS.length) {
            sendMessage(player, "Select a potion effect first!", COLORS.ERROR)
            openEditor(event, TABS.POTION)
            return
        }

        var selectedEffect = POTION_EFFECTS[selectedIdx]
        if (buttonId === IDS.BTN_POTION_ADD) {
            var duration = parseInt(gui.getComponent(IDS.INPUT_POTION_DURATION).getText())
            var level = parseInt(gui.getComponent(IDS.INPUT_POTION_LEVEL).getText())
            var particles = parseInt(gui.getComponent(IDS.INPUT_POTION_PARTICLES).getText())
            var icon = parseInt(gui.getComponent(IDS.INPUT_POTION_ICON).getText())

            if (isNaN(duration) || duration < 1) {
                sendMessage(player, "Duration must be at least 1 tick!", COLORS.ERROR)
            } else if (isNaN(level) || level < 1) {
                sendMessage(player, "Level must be at least 1!", COLORS.ERROR)
            } else if ((particles !== 0 && particles !== 1) || (icon !== 0 && icon !== 1)) {
                sendMessage(player, "Particles and Icon must be 1 or 0!", COLORS.ERROR)
            } else {
                var potion = getPotionItemForEdit(player)
                applyPotionEffectToItem(potion, selectedEffect.id, duration, level, particles === 1, icon === 1)
                sendMessage(player, "Added " + selectedEffect.displayName + " to the potion", COLORS.SUCCESS)
            }
            openEditor(event, TABS.POTION)
            return
        }

        if (buttonId === IDS.BTN_POTION_REMOVE) {
            var item = validateItem(player)
            if (item) {
                if (removePotionEffectFromItem(item, selectedEffect.id)) {
                    sendMessage(player, "Removed " + selectedEffect.displayName, COLORS.WARNING)
                } else {
                    sendMessage(player, "That effect is not on the item", COLORS.ERROR)
                }
            }
            openEditor(event, TABS.POTION)
        }
    }

    /**
     * @param {CustomGuiEvent.ScrollEvent} event
     */
    function customGuiScroll(event) {
        var player = event.player
        var scrollId = event.scrollId
        var scrollIndex = event.scrollIndex
        var playerName = player.getName()

        if (scrollId === IDS.SCROLL_TABS) {
            playerActiveTab[playerName] = scrollIndex
            openEditor(event, scrollIndex)
            return
        }

        if (scrollId === IDS.SCROLL_ATTRIBUTES) {
            var attrEntries = ATTRIBUTE_SCROLL_ENTRIES.length ? ATTRIBUTE_SCROLL_ENTRIES : buildCategorizedScrollEntries(ATTRIBUTES)
            var attrEntry = getCategorizedEntry(attrEntries, scrollIndex)
            if (!attrEntry || attrEntry.header) {
                openEditor(event, TABS.ATTRIBUTES)
                return
            }
            playerSelectedAttribute[playerName] = attrEntry.index
            openEditor(event, TABS.ATTRIBUTES)
            return
        }

        if (scrollId === IDS.SCROLL_ENCHANTS) {
            var enchantEntries = ENCHANT_SCROLL_ENTRIES.length ? ENCHANT_SCROLL_ENTRIES : buildCategorizedScrollEntries(ENCHANTMENTS)
            var enchantEntry = getCategorizedEntry(enchantEntries, scrollIndex)
            if (!enchantEntry || enchantEntry.header) return
            playerSelectedEnchant[playerName] = enchantEntry.index
            return
        }

        if (scrollId === IDS.SCROLL_POTIONS) {
            var potionEntries = POTION_SCROLL_ENTRIES.length ? POTION_SCROLL_ENTRIES : buildCategorizedScrollEntries(POTION_EFFECTS)
            var potionEntry = getCategorizedEntry(potionEntries, scrollIndex)
            if (!potionEntry || potionEntry.header) {
                openEditor(event, TABS.POTION)
                return
            }
            playerSelectedPotionEffect[playerName] = potionEntry.index
            openEditor(event, TABS.POTION)
        }
    }

    function customGuiSlotClicked(event) {
        event.setCanceled(true)
        openEditor(event)
    }
    /**
     * @param {BlockEvent.InitEvent} event
     */
    function init(event) {
        event.block.setModel("minecraft:smithing_table")
    }

    return {
        open: openEditor,
        button: customGuiButton,
        scroll: customGuiScroll,
        slot: customGuiSlotClicked,
        potionOpen: openPotionMaker,
        potionButton: potionMakerButton,
        potionScroll: potionMakerScroll,
        potionHtml: potionMakerHtmlEvent,
        registeredStatsLore: registeredStatsLore,
        rarityName: rarityName,
        registeredStatDisplayName: registeredStatDisplayName
    }
})()

/**
 * @param {PlayerEvent.AttackEvent} e
 */
function attack(e) {
    _equip_attack(e)
}

/**
 * @param {CustomGuiEvent.ButtonEvent} e
 */
function customGuiButton(e) {
    if (rejectFrozenCustomGuiMutation(e.player)) return
    var guiId = e.gui.getID()
    if (guiId === ADM_SHOPS.PICKER || guiId === ADM_SHOPS.NPC_GUI) { ADM_SHOPS.button(e); return }
    if (typeof ARVAN_ITEMS !== "undefined" && guiId === ARVAN_ITEMS.MATERIAL_GUI) { if ([200, 201].indexOf(Number(e.buttonId)) >= 0 && ARVAN_ITEMS.materialPickerClose(e.player, e.gui, Number(e.buttonId) === 200) !== false) e.player.closeGui(); return }
    if (typeof ARVAN_ITEMS !== "undefined" && (guiId === ARVAN_ITEMS.GUI || guiId === ARVAN_ITEMS.IDENTIFY_GUI)) { ARVAN_ITEMS.button(e); return }

    if (guiId === ADM_ITEM_EDITOR_GUI_ID) {
        ADM_ITEM_EDITOR.button(e)
        return
    }
    if (guiId === ADM_POTION_MAKER_GUI_ID) {
        ADM_ITEM_EDITOR.potionButton(e)
        return
    }
    
    // Route to correct handler based on GUI ID
    if (guiId === EQUIPMENT_SERVICE_GUI_ID) {
        equipmentServiceSettingsButton(e)
    } else if (guiId === 100 || guiId === 101 || guiId === 102) {
        _lvl_customGuiButton(e)
    } else if (guiId === SELF_GUI_ID || guiId === SELF_ATTRIBUTES_GUI_ID || guiId === SELF_QUEST_GUI_ID) {
        _self_customGuiButton(e)
    } else if (guiId === SELF_SKILL_TREE_GUI_ID || guiId === SELF_SPELL_LOADOUT_GUI_ID || guiId === SELF_EPIC_LOADOUT_GUI_ID) {
        _selfSkill_customGuiButton(e)
    } else if (guiId === ATTR_GUI_ID) {
        _attr_customGuiButton(e)
    } else if (guiId === STAT_LIST_GUI_ID || guiId === STAT_EDIT_GUI_ID) {
        _stat_customGuiButton(e)
    } else if (guiId === CLASS_LIST_GUI_ID || guiId === CLASS_EDIT_GUI_ID || guiId === CLASS_CHOOSER_GUI_ID || guiId === CLASS_STAT_GUI_ID) {
        _class_customGuiButton(e)
    } else if (guiId === CLASS_SKILL_TREE_GUI_ID || guiId === CLASS_SKILL_NODE_GUI_ID || guiId === CLASS_SKILL_PREREQ_GUI_ID || guiId === CLASS_SKILL_ITEM_GUI_ID || guiId === CLASS_SKILL_EFFECT_GUI_ID) {
        _classSkill_customGuiButton(e)
    } else if (guiId === EQUIP_GUI_ID || guiId === EQUIP_ADD_GUI_ID || guiId === EQUIP_EDIT_GUI_ID || guiId === EQUIP_STATS_GUI_ID) {
        _equip_customGuiButton(e)
    } else if (guiId === QUEST_GUI_ID || guiId === QUEST_ADD_GUI_ID || guiId === QUEST_EDIT_GUI_ID) {
        _quest_customGuiButton(e)
    } else if (guiId === MOB_REWARDS_GUI_ID || guiId === MOB_REWARDS_ADD_GUI_ID || guiId === MOB_REWARDS_EDIT_GUI_ID) {
        _mobRewards_customGuiButton(e)
    } else if (guiId === RATE_TIER_GUI_ID || guiId === RATE_TIER_ADD_GUI_ID || guiId === RATE_TIER_EDIT_GUI_ID) {
        _rateTier_customGuiButton(e)
    } else if (guiId === ADMIN_GUI_ID) {
        _admin_customGuiButton(e)
    } else if (guiId === RESET_CONFIRM_GUI_ID) {
        _resetConfirm_customGuiButton(e)
    }
}

/**
 * @param {CustomGuiEvent.ScrollEvent} e
 */
function customGuiScroll(e) {
    if (isArvanPersistenceFrozen(e.player)) return
    var guiId = e.gui.getID()
    if (typeof ARVAN_ITEMS !== "undefined" && (guiId === ARVAN_ITEMS.GUI || guiId === ARVAN_ITEMS.IDENTIFY_GUI)) { ARVAN_ITEMS.scroll(e); return }

    if (guiId === ADM_ITEM_EDITOR_GUI_ID) {
        ADM_ITEM_EDITOR.scroll(e)
        return
    }
    if (guiId === ADM_POTION_MAKER_GUI_ID) {
        ADM_ITEM_EDITOR.potionScroll(e)
        return
    }

    if (guiId === SELF_QUEST_GUI_ID) {
        _self_customGuiScroll(e)
    }

    if (guiId === CLASS_LIST_GUI_ID || guiId === CLASS_CHOOSER_GUI_ID || guiId === CLASS_STAT_GUI_ID) {
        _class_customGuiScroll(e)
    }

    if (guiId === CLASS_SKILL_TREE_GUI_ID || guiId === CLASS_SKILL_NODE_GUI_ID || guiId === CLASS_SKILL_PREREQ_GUI_ID || guiId === CLASS_SKILL_EFFECT_GUI_ID) {
        _classSkill_customGuiScroll(e)
    }

    if (guiId === SELF_SKILL_TREE_GUI_ID || guiId === SELF_SPELL_LOADOUT_GUI_ID || guiId === SELF_EPIC_LOADOUT_GUI_ID) {
        _selfSkill_customGuiScroll(e)
    }

    if (guiId === STAT_LIST_GUI_ID || guiId === STAT_EDIT_GUI_ID) {
        _stat_customGuiScroll(e)
    }
    
    if (guiId === EQUIP_GUI_ID || guiId === EQUIP_ADD_GUI_ID || guiId === EQUIP_EDIT_GUI_ID || guiId === EQUIP_STATS_GUI_ID) {
        _equip_customGuiScroll(e)
    }
    
    if (guiId === QUEST_GUI_ID || guiId === QUEST_ADD_GUI_ID || guiId === QUEST_EDIT_GUI_ID) {
        _quest_customGuiScroll(e)
    }
    
    if (guiId === MOB_REWARDS_GUI_ID) {
        _mobRewards_customGuiScroll(e)
    }
    
    if (guiId === RATE_TIER_GUI_ID) {
        _rateTier_customGuiScroll(e)
    }
    
    if (guiId === ADMIN_GUI_ID) {
        _admin_customGuiScroll(e)
    }
}

/**
 * @param {CustomGuiEvent.SlotEvent} e
 */
function customGuiSlot(e) {
    if (rejectFrozenCustomGuiMutation(e.player)) return
    var guiId = e.gui.getID()
    if (guiId === ADM_ITEM_EDITOR_GUI_ID) {
        ADM_ITEM_EDITOR.slot(e)
        return
    }
    if (guiId === EQUIP_ADD_GUI_ID || guiId === EQUIP_EDIT_GUI_ID) _equip_customGuiSlot(e)
}

/**
 * @param {CustomGuiEvent.SlotClickEvent} e
 */
function customGuiSlotClicked(e) {
    if (rejectFrozenCustomGuiMutation(e.player)) return
    var guiId = e.gui.getID()
    if (guiId === ADM_ITEM_EDITOR_GUI_ID) {
        ADM_ITEM_EDITOR.slot(e)
        return
    }
    if (guiId === EQUIP_ADD_GUI_ID || guiId === EQUIP_EDIT_GUI_ID) _equip_customGuiSlot(e)
}

/**
 * @param {CustomGuiEvent.CloseEvent} e
 */
function customGuiClosed(e) {
    var guiId = e.gui.getID()
    if (guiId === ARVAN_ITEMS.MATERIAL_GUI) { ARVAN_ITEMS.materialPickerClose(e.player, e.gui, false); return }
    if (guiId === ADM_SHOPS.PICKER) { ADM_SHOPS.closed(e); return }
    if (e.player.getTempdata().has("admSkillBookReturnAt")) return
    if (consumeManagedGuiTransition(e.player)) return
    
    if (guiId === EQUIPMENT_SERVICE_GUI_ID) {
        e.player.getTempdata().remove(EQUIPMENT_SERVICE_SETTINGS_DRAFT_KEY)
    } else if (guiId === 100 || guiId === 101 || guiId === 102) {
        _lvl_customGuiClosed(e)
    } else if (guiId === SELF_GUI_ID || guiId === SELF_ATTRIBUTES_GUI_ID || guiId === SELF_QUEST_GUI_ID) {
        _self_customGuiClosed(e)
    } else if (guiId === SELF_SKILL_TREE_GUI_ID || guiId === SELF_SPELL_LOADOUT_GUI_ID || guiId === SELF_EPIC_LOADOUT_GUI_ID) {
        _selfSkill_customGuiClosed(e)
    } else if (guiId === STAT_LIST_GUI_ID || guiId === STAT_EDIT_GUI_ID) {
        _stat_customGuiClosed(e)
    } else if (guiId === CLASS_LIST_GUI_ID || guiId === CLASS_EDIT_GUI_ID || guiId === CLASS_CHOOSER_GUI_ID || guiId === CLASS_STAT_GUI_ID) {
        _class_customGuiClosed(e)
    } else if (guiId === CLASS_SKILL_TREE_GUI_ID || guiId === CLASS_SKILL_NODE_GUI_ID || guiId === CLASS_SKILL_PREREQ_GUI_ID || guiId === CLASS_SKILL_ITEM_GUI_ID || guiId === CLASS_SKILL_EFFECT_GUI_ID) {
        if (reopenClassSkillHtmlEditorAfterNativeClose(e.player, e.gui)) return
        e.player.getTempdata().remove("admClassSkillNodeDraft")
        if (e.player.getTempdata().has(CLASS_SKILL_HTML_EDITOR_KEY)) e.player.getTempdata().remove(CLASS_SKILL_HTML_EDITOR_KEY)
        e.player.getTempdata().remove("admSkillItemBackup")
        e.player.getTempdata().remove("admSkillItemConsumeBackup")
        e.player.getTempdata().remove("admSkillItemMode")
        clearClassSkillPrerequisitePickerState(e.player)
    } else if (guiId === EQUIP_GUI_ID || guiId === EQUIP_ADD_GUI_ID || guiId === EQUIP_EDIT_GUI_ID || guiId === EQUIP_STATS_GUI_ID) {
        _equip_customGuiClosed(e)
    } else if (guiId === QUEST_GUI_ID || guiId === QUEST_ADD_GUI_ID || guiId === QUEST_EDIT_GUI_ID) {
        _quest_customGuiClosed(e)
    }
}

/**
 * @param {Object} e
 */
function htmlGuiEvent(e) {
    var player = e.player
    var temp = player.getTempdata()
    if (e.eventName === "shop") { ADM_SHOPS.event(e); return }
    if (e.eventName === "equipment_service") {
        handleEquipmentServiceHtmlEvent(e)
        return
    }
    if (e.eventName === "item_identify") {
        ARVAN_ITEMS.identifierHtml(player, parseClassSkillHtmlData(e.data))
        return
    }
    if (e.eventName === "item_registry") {
        ARVAN_ITEMS.registryHtml(player, parseClassSkillHtmlData(e.data))
        return
    }
    if (e.eventName === "potion_maker") {
        ADM_ITEM_EDITOR.potionHtml(player, parseClassSkillHtmlData(e.data))
        return
    }
    if (e.eventName === "player_menu") {
        handlePlayerMenuHtmlEvent(e)
        return
    }
    if (e.eventName === "admin_inspect") {
        if (!isAdmin(player) || isArvanPersistenceFrozen(player)) return
        var inspectData = parseClassSkillHtmlData(e.data)
        if (inspectData.action === "back") {
            showAdminGui(player, "Players")
            return
        }
        if (["wallet_set", "wallet_adjust"].indexOf(String(inspectData.action || "")) >= 0) {
            var walletResult = applyInspectorWalletAction(player, {
                target: inspectData.target,
                resource: inspectData.resource,
                operation: inspectData.action === "wallet_adjust" ? (String(inspectData.operation || "add")) : "set",
                amount: inspectData.amount,
                reason: inspectData.reason
            })
            var walletInspection = buildPlayerInspection(player, String(inspectData.target || ""))
            walletInspection.message = walletResult.ok ? "Wallet updated." : String(walletResult.message || "Wallet update failed.")
            walletInspection.ok = walletResult.ok && walletInspection.ok
            cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("inspection", JSON.stringify(walletInspection))
            return
        }
        var inspection = buildPlayerInspection(player, String(inspectData.target || ""))
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("inspection", JSON.stringify(inspection))
        return
    }
    if (e.eventName === "__guiClosed") {
        if (temp.has("admRegistryPicker")) return
        if (String(temp.get(HTML_ACTIVE_SESSION_KEY) || "") === "SHOP") return
        if (temp.has(PLAYER_MENU_NAV_KEY)) {
            // Navigation already cleared the old session and armed its handoff.
            return
        }
        if (temp.has(PLAYER_MENU_TRANSITION_KEY)) {
            var menuTransition = Number(temp.get(PLAYER_MENU_TRANSITION_KEY))
            if (player.getWorld().getTotalTime() - menuTransition <= 5) return
            temp.remove(PLAYER_MENU_TRANSITION_KEY)
        }
        skillHtmlRequestParts = null
        var activeHtml = temp.has(HTML_ACTIVE_SESSION_KEY) ? String(temp.get(HTML_ACTIVE_SESSION_KEY))
            : temp.has(CLASS_SKILL_HTML_SESSION_KEY) ? "CLASS"
            : temp.has(SELF_SKILL_HTML_SESSION_KEY) ? "SELF" : ""
        if (activeHtml === "CLASS") {
            if (temp.has("admSkillItemMode") || temp.has("admSkillBookReturnAt")) return
            if (temp.has(CLASS_SKILL_HTML_REBIND_KEY)) {
                var classRebindStarted = Number(temp.get(CLASS_SKILL_HTML_REBIND_KEY))
                temp.remove(CLASS_SKILL_HTML_REBIND_KEY)
                if (player.getWorld().getTotalTime() - classRebindStarted <= 5) return
            }
            if (temp.has(CLASS_SKILL_HTML_SESSION_KEY)) {
                var closePersistResult = persistClassSkillDraft(player)
                if (!closePersistResult.ok) player.message("§c[Skills] Tree autosave failed: " + closePersistResult.message)
                temp.remove(CLASS_SKILL_HTML_SESSION_KEY)
            }
        } else if (activeHtml === "SELF") {
            if (temp.has(SELF_SKILL_HTML_REBIND_KEY)) {
                var selfRebindStarted = Number(temp.get(SELF_SKILL_HTML_REBIND_KEY))
                temp.remove(SELF_SKILL_HTML_REBIND_KEY)
                if (player.getWorld().getTotalTime() - selfRebindStarted <= 5) return
            }
            if (temp.has(SELF_SKILL_HTML_SESSION_KEY)) temp.remove(SELF_SKILL_HTML_SESSION_KEY)
            if (temp.has(SELF_SKILL_HTML_VIEW_KEY)) temp.remove(SELF_SKILL_HTML_VIEW_KEY)
        } else if (activeHtml === "MOB_LEVELS") {
            temp.remove(MOB_LEVEL_TARGET_KEY)
        } else if (activeHtml === "PLAYER") {
            temp.remove(PLAYER_MENU_SESSION_KEY)
            clearPendingStatPoints(player)
        } else if (activeHtml === "EQUIPMENT_SERVICE") {
            temp.remove(EQUIPMENT_SERVICE_SESSION_KEY)
            temp.remove("arvanEquipmentServiceQuotesV1")
        } else if (activeHtml === "ITEM_IDENTIFIER") {
            temp.remove("arvanRegistryIdentifySession")
        } else if (activeHtml === "ITEM_REGISTRY") {
            ARVAN_ITEMS.remember(player, ARVAN_ITEMS.state(player))
        }
        if (temp.has(HTML_ACTIVE_SESSION_KEY)) temp.remove(HTML_ACTIVE_SESSION_KEY)
        return
    }
    if (e.eventName === "self_skill_tree") {
        if (!temp.has(SELF_SKILL_HTML_SESSION_KEY)) temp.put(SELF_SKILL_HTML_SESSION_KEY, 1)
        temp.put(HTML_ACTIVE_SESSION_KEY, "SELF")
        handleSelfSkillTreeHtmlEvent(e)
        return
    }
    if (e.eventName === "quest_map") {
        handleQuestMapHtmlEvent(e)
        return
    }
    if (e.eventName === "mob_levels") {
        handleMobLevelHtmlEvent(e)
        return
    }
    if (e.eventName !== "class_skill_tree") return
    var data = parseClassSkillHtmlData(e.data)
    if (data.action === "request_chunk") {
        data = receiveClassSkillHtmlRequest(player, data)
        if (!data) return
    } else {
        skillHtmlRequestParts = null
    }
    if (!temp.has(CLASS_SKILL_HTML_SESSION_KEY)) {
        if (!getClassDraft(player)) {
            pushClassSkillTreeHtml(player, "This editor session expired. Reopen the class editor.", false)
            return
        }
        temp.put(CLASS_SKILL_HTML_SESSION_KEY, String(Date.now()) + ":" + String(++skillHtmlBatchSequence))
    }
    temp.put(HTML_ACTIVE_SESSION_KEY, "CLASS")
    if (!isAdmin(player) || isArvanPersistenceFrozen(player)) {
        pushClassSkillTreeHtml(player, "The tree is locked while you are not in Creative mode or persistence is busy.", false)
        return
    }
    var action = String(data.action || "")
    var nodeId = String(data.nodeId || "")
    if (action === "ready") {
        pushClassSkillTreeHtml(player, "", true)
        return
    }
    if (action === "preview") {
        var previewDraft = getClassDraft(player)
        var previewResult = callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.preview(player.getMCEntity(), String(previewDraft && previewDraft.id || ""),
                Math.max(1, Math.floor(Number(data.level || 1))), JSON.stringify(Array.isArray(data.selections) ? data.selections : []))
        })
        var previewBridge = cnpcext.getClientBridge(player.getMCEntity())
        previewBridge.sendToBrowser("class_skill_preview", JSON.stringify(previewResult))
        return
    }
    if (action === "select") {
        if (findClassSkillNode(player, nodeId)) temp.put("admSelectedClassSkillId", nodeId)
        return
    }
    if (action === "save_book") {
        var bookDraft = getClassDraft(player)
        if (!bookDraft || !Array.isArray(data.nodes) || !Array.isArray(data.choiceGroups)) {
            pushClassSkillTreeHtml(player, "The book draft was invalid.", false)
            return
        }
        var previousBookDraft = JSON.parse(JSON.stringify(bookDraft))
        try {
            normalizeSkillBookCreatorData(bookDraft, data)
        } catch (bookError) {
            pushClassSkillTreeHtml(player, String(bookError.message || bookError), false)
            return
        }
        saveClassDraft(player, bookDraft)
        var bookPersist = persistClassSkillDraft(player)
        if (!bookPersist.ok) saveClassDraft(player, previousBookDraft)
        if (bookPersist.ok) {
            temp.remove(CLASS_SKILL_HTML_EDITOR_KEY)
            temp.remove("admClassSkillNodeDraft")
        }
        pushClassSkillTreeHtml(player, bookPersist.ok ? "Skill book saved." : String(bookPersist.message || "Skill book save failed."), bookPersist.ok)
        return
    }
    if (action === "move") {
        var moveSave = saveClassSkillTreePositions(player, [{ id: nodeId, x: data.x, y: data.y }])
        if (moveSave.applied !== 1) {
            pushClassSkillTreeHtml(player, "That node position was invalid or stale. Reopen the editor and try again.", false)
            return
        }
        var movePersistResult = persistClassSkillLayout(player)
        pushClassSkillTreeHtml(player, movePersistResult.ok ? movePersistResult.message : "Layout autosave failed: " + movePersistResult.message, movePersistResult.ok)
        return
    }
    if (action === "layout") {
        var layoutSave = saveClassSkillTreePositions(player, data.positions)
        if ((getClassSkillNodes(player) || []).length > 0 && layoutSave.applied === 0) {
            pushClassSkillTreeHtml(player, "The layout contained no valid node positions.", false)
            return
        }
        var layoutPersistResult = persistClassSkillLayout(player)
        pushClassSkillTreeHtml(player, layoutPersistResult.ok ? layoutPersistResult.message : "Layout autosave failed: " + layoutPersistResult.message, layoutPersistResult.ok)
        return
    }
    if (action === "new") {
        startClassSkillNodeDraft(player, "")
        temp.put(CLASS_SKILL_HTML_EDITOR_KEY, 1)
        pushClassSkillTreeHtml(player, "New node editor opened.", true)
        return
    }
    if (action === "edit" && findClassSkillNode(player, nodeId)) {
        temp.put("admSelectedClassSkillId", nodeId)
        startClassSkillNodeDraft(player, nodeId)
        temp.put(CLASS_SKILL_HTML_EDITOR_KEY, 1)
        pushClassSkillTreeHtml(player, "Editing " + findClassSkillNode(player, nodeId).title + ".", true)
        return
    }
    if (action === "sync_node" || action === "catalog") {
        try {
            var syncedDraft = classSkillDraftFromHtml(player, data.node)
            temp.put(CLASS_SKILL_HTML_EDITOR_KEY, 1)
            if (action === "catalog") pushClassSkillCatalog(player, syncedDraft)
        } catch (error) {
            pushClassSkillTreeHtml(player, "The node draft could not be synchronized. Save or reopen the editor before continuing.", false)
        }
        return
    }
    if (action === "save_node") {
        try {
            var htmlDraft = classSkillDraftFromHtml(player, data.node)
            var htmlDraftError = classSkillNodeDraftError(htmlDraft)
            if (htmlDraftError) {
                temp.put(CLASS_SKILL_HTML_EDITOR_KEY, 1)
                pushClassSkillTreeHtml(player, htmlDraftError, false)
                return
            }
            if (!commitClassSkillNodeDraft(player, htmlDraft)) {
                temp.put(CLASS_SKILL_HTML_EDITOR_KEY, 1)
                pushClassSkillTreeHtml(player, "The node could not be saved. Reopen the class editor if this class draft is stale.", false)
                return
            }
            var nodePersistResult = persistClassSkillDraft(player)
            pushClassSkillTreeHtml(player, nodePersistResult.ok
                ? (nodePersistResult.persisted ? "Node saved and tree autosaved." : nodePersistResult.message)
                : "Node saved to the draft, but tree autosave failed: " + nodePersistResult.message, nodePersistResult.ok)
        } catch (error) {
            temp.put(CLASS_SKILL_HTML_EDITOR_KEY, 1)
            player.message("§c[Skills] Node save failed: §7" + String(error))
            pushClassSkillTreeHtml(player, "Node save failed. Your editor values were kept; try again or reopen the class editor.", false)
        }
        return
    }
    if (action === "cost_inventory") {
        var costInventory = player.getInventory()
        var costItems = []
        for (var costSlot = 0; costSlot < Math.min(36, costInventory.getSize()); costSlot++) {
            var costStack = costInventory.getSlot(costSlot)
            if (costStack && !costStack.isEmpty()) costItems.push({slot: costSlot, name: String(costStack.getDisplayName()), itemId: String(costStack.getName()), count: Number(costStack.getStackSize()), overlaySlot: 100 + costSlot})
        }
        sendSkillHtmlPayload(cnpcext.getClientBridge(player.getMCEntity()), "class_skill_cost", {items: costItems})
        return
    }
    if (action === "cost_select") {
        var selectedSlot = Number(data.slot)
        var selectedCount = 1
        var sourceInventory = player.getInventory()
        var selectedStack = isFinite(selectedSlot) && selectedSlot === Math.floor(selectedSlot) && selectedSlot >= 0 && selectedSlot < Math.min(36, sourceInventory.getSize()) ? sourceInventory.getSlot(selectedSlot) : null
        var costResponse = {ok: false, message: "Choose an inventory item."}
        if (selectedStack && !selectedStack.isEmpty()) {
            var costCopy = selectedStack.copy()
            costCopy.setStackSize(selectedCount)
            costResponse = {ok: true, snbt: String(costCopy.getItemNbt().toJsonString()), mode: String(data.mode || "learn"), upgradeIndex: Number(data.upgradeIndex || 0), consume: data.consume !== false, name: String(costCopy.getDisplayName()), count: Number(costCopy.getStackSize()), overlaySlot: 100 + selectedSlot}
        }
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("class_skill_cost_selected", JSON.stringify(costResponse))
        return
    }
    if (action === "edit_cost") {
        var costDraft = classSkillDraftFromHtml(player, data.node)
        temp.put(CLASS_SKILL_HTML_EDITOR_KEY, 1)
        if (!beginClassSkillItemEditor(player, costDraft, String(data.mode || "learn"), data.upgradeIndex)) {
            pushClassSkillTreeHtml(player, "That upgrade row is no longer available.", false)
        }
        return
    }
    if (action === "cancel_editor") {
        if (temp.has(CLASS_SKILL_HTML_EDITOR_KEY)) temp.remove(CLASS_SKILL_HTML_EDITOR_KEY)
        if (temp.has("admClassSkillNodeDraft")) temp.remove("admClassSkillNodeDraft")
        pushClassSkillTreeHtml(player, "Node changes canceled.", true)
        return
    }
    if (action === "delete") {
        var deleteDraft = getClassDraft(player)
        if (deleteDraft && deleteDraft.skillNodes) {
            for (var deleteLinkIndex = 0; deleteLinkIndex < deleteDraft.skillNodes.length; deleteLinkIndex++) {
                if (String(deleteDraft.skillNodes[deleteLinkIndex].learnedWithNode || "") === nodeId) {
                    pushClassSkillTreeHtml(player, "Clear Learned with node on " + deleteDraft.skillNodes[deleteLinkIndex].title + " before deleting this source node.", false)
                    return
                }
            }
        }
        if (!deleteClassSkillNode(player, nodeId)) {
            pushClassSkillTreeHtml(player, "That node no longer exists.", false)
            return
        }
        var deletePersistResult = persistClassSkillDraft(player)
        pushClassSkillTreeHtml(player, deletePersistResult.ok
            ? (deletePersistResult.persisted ? "Node deleted and tree autosaved." : deletePersistResult.message)
            : "Node deleted from the draft, but tree autosave failed: " + deletePersistResult.message, deletePersistResult.ok)
        return
    }
    if (action === "connect") {
        var result = connectClassSkillGraphNodes(
            player,
            String(data.mode || ""),
            String(data.sourceId || ""),
            String(data.targetId || "")
        )
        if (result.ok) temp.put("admSelectedClassSkillId", String(data.targetId || ""))
        if (result.ok) {
            var connectPersistResult = persistClassSkillDraft(player)
            if (!connectPersistResult.ok) {
                pushClassSkillTreeHtml(player, result.message + " Tree autosave failed: " + connectPersistResult.message, false)
                return
            }
        }
        pushClassSkillTreeHtml(player, result.message, result.ok)
        return
    }
    if (action === "back") {
        temp.remove(CLASS_SKILL_HTML_SESSION_KEY)
        if (temp.has(CLASS_SKILL_HTML_EDITOR_KEY)) temp.remove(CLASS_SKILL_HTML_EDITOR_KEY)
        if (temp.has("admClassSkillNodeDraft")) temp.remove("admClassSkillNodeDraft")
        showClassEditorGui(player)
        return
    }
    pushClassSkillTreeHtml(player, "That editor action is no longer available. Reopen the class editor.", false)
}

// Quest event handlers
/**
 * @param {QuestEvent.QuestTurnedInEvent} e
 */
function questTurnIn(e) {
    _quest_turnin(e)
    queueJourneyMapSync()
}

/**
 * @param {QuestEvent.QuestCompletedEvent} e
 */
function questCompleted(e) {
    _quest_completed(e)
    queueJourneyMapSync()
}

/**
 * @param {QuestEvent.QuestStartEvent} e
 */
function questStart(e) {
    if (e.quest && !isArvanPersistenceFrozen(e.player)) e.player.getStoreddata().put("arvanQuestRewardCycle:" + String(e.quest.getId()), String(Java.type("java.util.UUID").randomUUID()))
    if (e.quest && !isArvanPersistenceFrozen(e.player)) storeddataPut(getPlayerStoreddata(e.player), "admQuestTracked_" + e.quest.getId(), 1)
    queueJourneyMapSync()
}

// ============================================
// ADMIN SYSTEM
// ============================================
// /admhelp - Shows all commands
// /admin - Config panel (creative only)

var ADMIN_GUI_ID = 400
var ADMIN_GUI_WIDTH = 400
var ADMIN_GUI_HEIGHT = 280

// Check if player is in creative mode
function isAdmin(player) {
    return player.getGamemode() === 1
}

// Show all commands help
function showAdmHelp(player) {
    player.message("§6§l=== ADM's Leveling System ===")
    player.message("")
    player.message("§b§lCOMMANDS:")
        player.message("§e/admhelp §7- Show this command list")
    player.message("§e/self §7- Open your stats & level GUI")
    player.message("§e/mystats §7- Alias for /self")
    player.message("§e/stats §7- Open your attributes GUI")
    player.message("§e/attr §7- Alias for /stats")
    player.message("§e/attributes §7- Alias for /stats")
    player.message("")

    if (isAdmin(player)) {
        player.message("§c§lADMIN COMMANDS:")
        player.message("§e/adm <gold|spirit> <give|set> <player> <amount> §7- Manage currency")
        player.message("§e/admin §7- Open admin config panel")
        player.message("§e/admin reset <player> §7- Reset all player progression")
        player.message("§e/equip §7- Open equipment registry tools in /admin")
        player.message("§e/quest §7- Open Quest EXP registry")
        player.message("§e/lvl §7- Show level command help")
        player.message("§e/lvlinfo <player> §7- Show level and EXP")
        player.message("§e/lvladd <player> <amount> §7- Add EXP")
        player.message("§e/lvlset <player> <level> §7- Set level")
        player.message("§e/lvlreset <player> §7- Reset level and EXP")
        player.message("§e/class reset <player> §7- Reset a player's class")
        player.message("§e/stat reset <player> §7- Reset allocated stats")
    } else {
        player.message("§7Admin commands require Creative mode.")
    }
}

function buildPlayerInspection(admin, targetId) {
    if (!isAdmin(admin)) return { ok: false, message: "Admin access required" }
    var players = []
    var seen = {}
    var target = null
    var worlds = API.getIWorlds()
    for (var wi = 0; wi < worlds.length; wi++) {
        var online = worlds[wi].getAllPlayers()
        for (var pi = 0; pi < online.length; pi++) {
            var id = String(online[pi].getUUID())
            if (id === targetId) target = online[pi]
            if (!seen[id] && players.length < 256) players.push({ id: id, name: String(online[pi].getName()) })
            seen[id] = true
        }
    }
    players.sort(function(a, b) { return a.name.localeCompare(b.name) })
    if (!target) return { ok: false, message: "Player is offline. Choose an online player.", players: players, target: targetId }
    var report = callSkillBridge(admin, function() { return SERVER_CORE_SKILLS.inspectPlayer(admin.getMCEntity(), targetId) })
    report.players = players
    report.target = targetId
    if (!report.ok) return report
    report.name = String(target.getName())
    report.level = getPlayerLevel(target)
    report.className = getClassDisplayName(target.getWorld(), getPlayerClassId(target))
    report.spiritBalance = getSpiritBalance(target)
    report.spirit = report.spiritBalance
    report.moneyBalance = getNormalMoneyBalance(target)
    report.money = report.moneyBalance
    report.currency = getCurrencyConfig(target.getWorld())
    report.wallet = { spirit: report.spiritBalance, money: report.moneyBalance, currency: report.currency }
    report.stats = []
    report.effects = []
    var attributes = {}
    try {
        loadConfigFromWorld(target.getWorld())
        getStatRegistry(target.getWorld())
        for (var si = 0; si < STAT_KEYS.length && si < 64; si++) {
            var key = STAT_KEYS[si]
            var stat = ATTR_CONFIG.stats[key]
            var effectiveness = getStatEffectivenessMultiplier(target, key, true)
            report.stats.push({ key: key, name: stat.name || key,
                allocated: Number(getStatPoints(target, key)), base: getClassBaseStatPoints(target, key),
                nodes: getLearnedNodeStatValue(target, key, "statBonuses"),
                classPercent: getClassStatEffectivenessMultiplier(target, key) * 100,
                effectivePercent: effectiveness.value * 100, source: effectiveness.source })
            var affected = Object.keys(stat.affects || {})
            for (var ai = 0; ai < affected.length; ai++) attributes[affected[ai]] = true
        }
        var attributeIds = Object.keys(attributes).sort()
        for (var ei = 0; ei < attributeIds.length && ei < 128; ei++) {
            var attributeId = attributeIds[ei]
            var actual = report.attributes && report.attributes[attributeId]
            report.effects.push({ id: attributeId, expected: calculateMcAttribute(target, attributeId),
                base: actual ? actual.base : null, value: actual ? actual.value : null })
        }
    } finally {
        loadConfigFromWorld(admin.getWorld())
        getStatRegistry(admin.getWorld())
    }
    delete report.attributes
    return report
}

function findOnlinePlayerById(targetId) {
    var worlds = API.getIWorlds()
    for (var wi = 0; wi < worlds.length; wi++) {
        var online = worlds[wi].getAllPlayers()
        for (var pi = 0; pi < online.length; pi++) if (String(online[pi].getUUID()) === String(targetId)) return online[pi]
    }
    return null
}

function applyInspectorWalletAction(admin, data) {
    if (!isAdmin(admin) || !data) return { ok: false, message: "Admin access required" }
    var target = findOnlinePlayerById(String(data.target || ""))
    if (!target) return { ok: false, message: "Player is offline. Choose an online player." }
    var resource = String(data.resource || data.wallet || "spirit").toLowerCase()
    if (["spirit", "money"].indexOf(resource) < 0) return { ok: false, message: "Unknown wallet resource." }
    var amount = Number(data.amount)
    if (!isFinite(amount) || amount !== Math.floor(amount) || Math.abs(amount) > CURRENCY_MAX_SAFE_INTEGER) return { ok: false, message: "Amount must be a whole number." }
    var operation = String(data.operation || "set").toLowerCase()
    var reason = String(data.reason || "admin inspector").substring(0, 128)
    if (operation === "add" || operation === "subtract" || operation === "remove") {
        if (operation !== "add") amount = -Math.abs(amount)
        return resource === "spirit" ? adjustSpiritBalance(target, amount, reason) : adjustNormalMoneyBalance(target, amount, reason)
    }
    if (operation !== "set") return { ok: false, message: "Unknown wallet operation." }
    return resource === "spirit" ? setSpiritBalance(target, amount, reason) : setNormalMoneyBalance(target, amount, reason)
}

// Show admin config GUI
function showAdminGui(player, selectedCategory) {
    if (!isAdmin(player)) {
        player.message("§c[Admin] You need to be in Creative mode!")
        return
    }

    var categories = ["Leveling", "Currency", "Mob Levels", "Attributes", "Stats", "Tools", "Items", "Classes", "Players"]
    if (!selectedCategory || categories.indexOf(selectedCategory) === -1) selectedCategory = "Leveling"
    player.getTempdata().put("adminCategory", selectedCategory)
    loadConfigFromWorld(player.getWorld())

    var gui = API.createCustomGui(ADMIN_GUI_ID, ADMIN_GUI_WIDTH, ADMIN_GUI_HEIGHT, false, player)
    addRpgFrame(gui, ADMIN_GUI_WIDTH, ADMIN_GUI_HEIGHT, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 108, 206, RPG_UI.gold)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 126, 40, 264, 206, RPG_UI.cyan)

    gui.addLabel(LAYER.CONTENT_LABELS, "§6§lADM CONTROL PANEL", 130, 10, 170, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7" + selectedCategory, 330, 26, 60, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§6§lSECTIONS", 20, 48, 90, 10)
    gui.addScroll(LAYER.SCROLL_LIST, 16, 64, 96, 172, categories).setDefaultSelection(categories.indexOf(selectedCategory))

    var labelId = LAYER.CONTENT_LABELS + 10
    var fieldId = LAYER.TEXT_FIELDS
    var buttonId = LAYER.BUTTONS + 10

    if (selectedCategory === "Leveling") {
        gui.addLabel(labelId++, "§b§lLEVELING CONFIG", 138, 48, 150, 12)
        gui.addLabel(labelId++, "§7Base EXP", 138, 70, 80, 10)
        gui.addTextField(fieldId++, 138, 84, 104, 20).setText("" + CONFIG.baseExpPerLevel)
        gui.addLabel(labelId++, "§7Maximum Level", 266, 70, 100, 10)
        gui.addTextField(fieldId++, 266, 84, 110, 20).setText("" + CONFIG.maxLevel)

        gui.addButton(buttonId++, "§6§lEXP CURVES §8[§f" + CONFIG.expCurveTiers.length + "§8]", 138, 116, 112, 22)
        var mobRewardCount = Object.keys(getMobExpRegistry(player.getWorld())).length
        gui.addButton(buttonId++, "§6§lMOB REWARDS §8[§f" + mobRewardCount + "§8]", 258, 116, 118, 22)

        gui.addLabel(labelId++, "§b§lHUD DELIVERY", 138, 150, 120, 10)
        var hudMethods = ["overlay", "actionbar", "none"]
        var currentMethodIndex = hudMethods.indexOf(CONFIG.hudDisplayMethod)
        if (currentMethodIndex < 0) currentMethodIndex = 1
        gui.addScroll(LAYER.SCROLL_LIST + 1, 138, 164, 110, 72, hudMethods).setDefaultSelection(currentMethodIndex)

        gui.addLabel(labelId++, "§7HUD Enabled", 262, 166, 90, 10)
        gui.addButton(buttonId++, CONFIG.hudEnabled ? "§a§lON" : "§c§lOFF", 348, 162, 30, 20)
        gui.addLabel(labelId++, "§7Level-up Chat", 262, 198, 90, 10)
        gui.addButton(buttonId++, CONFIG.levelUpChatMessage ? "§a§lON" : "§c§lOFF", 348, 194, 30, 20)
    } else if (selectedCategory === "Currency") {
        var currency = getCurrencyConfig(player.getWorld())
        gui.addLabel(labelId++, "§b§lCURRENCY", 138, 48, 150, 12)
        gui.addLabel(labelId++, "§7Storeddata Key", 138, 72, 110, 10)
        gui.addTextField(fieldId++, 138, 86, 238, 20).setText(String(currency.storageKey))
        gui.addLabel(labelId++, "§7Display Name", 138, 120, 110, 10)
        gui.addTextField(fieldId++, 138, 134, 150, 20).setText(String(currency.displayName))
        gui.addLabel(labelId++, "§7Symbol", 306, 120, 70, 10)
        gui.addTextField(fieldId++, 306, 134, 70, 20).setText(String(currency.symbol))
        gui.addLabel(labelId++, "§7Shop scripts use the storeddata key above.", 138, 174, 238, 10)
        gui.addLabel(labelId++, "§8Changing the key migrates balances after confirmation.", 138, 192, 238, 10)
        gui.addButton(LAYER.BUTTONS + 10, "§6§lSHOPS", 138, 214, 238, 22)
    } else if (selectedCategory === "Mob Levels") {
        gui.addLabel(labelId++, "§b§lMOB LEVELS", 138, 48, 150, 12)
        gui.addButton(buttonId++, "§eOPEN LEVEL RULES", 138, 80, 238, 24)
        gui.addLabel(labelId++, "§7Configure global level rules here.", 138, 124, 238, 10)
        gui.addLabel(labelId++, "§7Use the NPC Dev Tool to edit a mob", 138, 160, 238, 10)
        gui.addLabel(labelId++, "§7or NPC's level and rewards.", 138, 176, 238, 10)
        gui.addLabel(labelId++, "§8Server operator permission is required.", 138, 210, 238, 10)
    } else if (selectedCategory === "Attributes") {
        gui.addLabel(labelId++, "§b§lATTRIBUTE ECONOMY", 138, 48, 160, 12)
        gui.addLabel(labelId++, "§7Points per Level", 138, 70, 104, 10)
        gui.addTextField(fieldId++, 138, 84, 104, 20).setText("" + ATTR_CONFIG.pointsPerLevel)
        gui.addLabel(labelId++, "§7Passive HP / Level", 266, 70, 110, 10)
        gui.addTextField(fieldId++, 266, 84, 110, 20).setText("" + ATTR_CONFIG.passivePerLevel.health)
        gui.addLabel(labelId++, "§7Initial Points", 138, 120, 104, 10)
        gui.addTextField(fieldId++, 138, 134, 104, 20).setText("" + ATTR_CONFIG.initialPoints)
        gui.addLabel(labelId++, "§7Reset Item Name", 266, 120, 110, 10)
        gui.addTextArea(fieldId++, 266, 134, 110, 20).setText(ATTR_CONFIG.resetItemName)
        gui.addLabel(labelId++, "§8Color codes are preserved in the reset item name.", 138, 178, 238, 10)
        gui.addLabel(labelId++, "§8Use the Stats section to build attribute effects.", 138, 196, 238, 10)
    } else if (selectedCategory === "Stats") {
        var statCount = STAT_KEYS.length
        gui.addLabel(labelId++, "§b§lBUILDABLE STATS", 138, 48, 150, 12)
        gui.addLabel(labelId++, "§7Definitions §f" + statCount, 138, 72, 150, 12)
        gui.addButton(buttonId++, "§e§lOpen Stat Registry §8[§f" + statCount + "§8]", 138, 94, 218, 24)
        gui.addLabel(labelId++, "§7Create stats such as INT, Faith, or Luck.", 138, 142, 230, 10)
        gui.addLabel(labelId++, "§7Attach any scanned Minecraft or mod attribute.", 138, 158, 238, 10)
        gui.addLabel(labelId++, "§8STR, VIT, and DEX remain editable defaults.", 138, 190, 238, 10)
    } else if (selectedCategory === "Classes") {
        var classCount = getSortedClassIds(player.getWorld()).length
        var classEnabled = getClassSystemEnabled(player.getWorld())
        var lockedNodeMode = getLockedSkillVisibilityMode(player.getWorld())
        gui.addLabel(labelId++, "§b§lCLASS SYSTEM", 138, 48, 150, 12)
        gui.addLabel(labelId++, "§7Created Classes §f" + classCount, 138, 72, 160, 12)
        gui.addButton(buttonId++, "§e§lOpen Class Registry §8[§f" + classCount + "§8]", 138, 94, 218, 24)
        gui.addLabel(labelId++, "§7Selection Enforcement", 138, 132, 130, 10)
        gui.addButton(buttonId++, classEnabled ? "§a§lENABLED" : "§c§lDISABLED", 276, 128, 100, 20)
        gui.addLabel(labelId++, "§7Locked Node Display", 138, 164, 130, 10)
        gui.addButton(buttonId++, lockedNodeMode === "HIDE" ? "§8§lHIDDEN" : "§d§lOBFUSCATED", 276, 160, 100, 20)
        gui.addLabel(labelId++, "§7Unmet nodes show as ??? or remain hidden.", 138, 194, 236, 10)
        gui.addLabel(labelId++, "§8Creative mode bypasses forced selection.", 138, 214, 230, 10)
    } else if (selectedCategory === "Players") {
        gui.addButton(buttonId++, "§bINSPECT PLAYER", 138, 68, 218, 24)
    } else if (selectedCategory === "Tools") {
        gui.addLabel(labelId++, "§b§lREGISTRIES & TOOLS", 138, 48, 170, 12)
        gui.addButton(buttonId++, "§eEQUIPMENT REGISTRY", 138, 68, 218, 22)
        gui.addButton(buttonId++, "§bQUEST EXP REGISTRY", 138, 94, 218, 22)
        gui.addButton(buttonId++, "§d§lQUEST MAP MARKERS", 138, 120, 218, 22)
        gui.addButton(buttonId++, "§6GET NPC DEV TOOL", 138, 146, 218, 22)
        gui.addButton(buttonId++, "§a§lRELOAD", 138, 172, 218, 22)
        gui.addButton(buttonId++, "§cRESET WORLD DATA", 138, 198, 218, 22)
    } else if (selectedCategory === "Items") {
        gui.addLabel(labelId++, "§d§lITEM CREATION & EDITING", 138, 48, 220, 12)
        gui.addButton(buttonId++, "§d§lPOTION MAKER", 138, 76, 218, 24)
        gui.addButton(buttonId++, "§5PFEATURE ITEM EDITOR", 138, 108, 218, 24)
        gui.addButton(buttonId++, "§6ITEM REGISTRY & ARMOR SETS", 138, 140, 218, 24)
        gui.addLabel(labelId++, "§7Create items, register templates, configure armor sets.", 138, 184, 238, 20)
    }

    var saveButton = gui.addButton(LAYER.BUTTONS, "§b§lSAVE", 12, ADMIN_GUI_HEIGHT - 28, 80, 20)
    saveButton.setEnabled(selectedCategory === "Leveling" || selectedCategory === "Currency" || selectedCategory === "Attributes")
    gui.addButton(LAYER.BUTTONS + 1, "§f§lCLOSE", ADMIN_GUI_WIDTH - 92, ADMIN_GUI_HEIGHT - 28, 80, 20)
    player.showCustomGui(gui)
}
function _admin_customGuiButton(e) {
    var player = e.player
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    
    if (guiId !== ADMIN_GUI_ID) return
    
    var selectedCategory = player.getTempdata().has("adminCategory") ? player.getTempdata().get("adminCategory") : "Leveling"
    if (selectedCategory === "Mob Levels" && buttonId === LAYER.BUTTONS + 10) {
        if (!isMobLevelAdmin(player)) return
        openMobLevelEditor(player, null)
        return
    }
    if (selectedCategory === "Players" && buttonId === LAYER.BUTTONS + 10) {
        if (!isAdmin(player)) return
        player.getTempdata().put(HTML_ACTIVE_SESSION_KEY, "INSPECT")
        cnpcext.openHtmlGui(player, "player_inspector.html", 0, 0, JSON.stringify(buildPlayerInspection(player, String(player.getUUID()))))
        return
    }
    
    // Footer buttons
    if (buttonId === LAYER.BUTTONS) {
        // Save button - save based on current category
        saveAdminConfig(player, gui, selectedCategory)
        return
    }
    
    if (buttonId === LAYER.BUTTONS + 1) {
        // Close button
        player.closeGui()
        return
    }
    
    if (selectedCategory === "Currency" && buttonId === LAYER.BUTTONS + 10) { ADM_SHOPS.openAdmin(player); return }
    // Category-specific buttons (LAYER.BUTTONS + 10+)
    // Leveling category buttons
    if (selectedCategory === "Leveling") {
        if (buttonId === LAYER.BUTTONS + 10) {
            // EXP Curve Tiers button - open registry GUI
            showRateTierListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 11) {
            // Mob Rewards button - open mob EXP registry
            showMobRewardsListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 12) {
            // HUD Enabled toggle
            CONFIG.hudEnabled = !CONFIG.hudEnabled
            if (!CONFIG.hudEnabled) {
                hideHudOverlay(player)
            }
            showAdminGui(player, "Leveling")
            return
        }
        if (buttonId === LAYER.BUTTONS + 13) {
            // Level Up Chat toggle
            CONFIG.levelUpChatMessage = !CONFIG.levelUpChatMessage
            showAdminGui(player, "Leveling")
            return
        }
    }
    
    if (selectedCategory === "Tools") {
        if (buttonId === LAYER.BUTTONS + 10) {
            // Equipment Registry
            showEquipmentListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 11) {
            // Quest EXP Registry
            showQuestListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 12) {
            openQuestMapHtml(player, true)
            return
        }
        if (buttonId === LAYER.BUTTONS + 13) {
            // Dev Tool
            handleDev(player)
            player.closeGui()
            return
        }
        if (buttonId === LAYER.BUTTONS + 14) {
            // Reload
            player.closeGui()
            var world = player.getWorld()
            API.executeCommand(world, "/save-all")
            API.executeCommand(world, "/noppes dialog reload")
            API.executeCommand(world, "/noppes script reload")
            player.message("§a[Admin] World saved. Dialogues and scripts reloaded!")
            return
        }
        if (buttonId === LAYER.BUTTONS + 15) {
            // Reset World Data - show confirmation dialog first
            showResetConfirmGui(player)
            return
        }
    }

    if (selectedCategory === "Items") {
        if (buttonId === LAYER.BUTTONS + 12) { ARVAN_ITEMS.open(player); return }
        if (buttonId === LAYER.BUTTONS + 10) {
            ADM_ITEM_EDITOR.potionOpen(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 11) {
            ADM_ITEM_EDITOR.open({player: player})
            return
        }
    }

    if (selectedCategory === "Stats" && buttonId === LAYER.BUTTONS + 10) {
        showStatRegistryGui(player)
        return
    }

    if (selectedCategory === "Classes") {
        if (buttonId === LAYER.BUTTONS + 10) {
            showClassListGui(player)
            return
        }
        if (buttonId === LAYER.BUTTONS + 11) {
            var world = player.getWorld()
            setClassSystemEnabled(world, !getClassSystemEnabled(world))
            showAdminGui(player, "Classes")
            return
        }
        if (buttonId === LAYER.BUTTONS + 12) {
            var world = player.getWorld()
            var nextMode = getLockedSkillVisibilityMode(world) === "HIDE" ? "OBFUSCATE" : "HIDE"
            setLockedSkillVisibilityMode(world, nextMode)
            showAdminGui(player, "Classes")
            return
        }
    }
}

// ===== RESET WORLD DATA CONFIRMATION GUI =====
var RESET_CONFIRM_GUI_ID = 410

function showResetConfirmGui(player) {
    var width = 360
    var height = 230
    var gui = API.createCustomGui(RESET_CONFIRM_GUI_ID, width, height, false, player)

    addRpgFrame(gui, width, height, RPG_UI.red)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 340, 146, RPG_UI.red)
    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§c§lRESET WORLD DATA?", 115, 10, 150, 14)
    gui.addLabel(labelId++, "§fThis permanently removes shared leveling data:", 24, 54, 310, 12)
    gui.addLabel(labelId++, "§7• Leveling, HUD, and attribute configuration", 34, 76, 290, 10)
    gui.addLabel(labelId++, "§7• Equipment, class, stat, quest, and mob registries", 34, 92, 290, 10)
    gui.addLabel(labelId++, "§7• Custom EXP curve tiers", 34, 108, 290, 10)
    gui.addLabel(labelId++, "§aPlayer levels and allocated points are kept.", 34, 134, 290, 10)
    gui.addLabel(labelId++, "§c§lThis action cannot be undone.", 82, 160, 220, 12)

    gui.addButton(LAYER.BUTTONS, "§c§lYES, RESET", 80, 202, 96, 20)
    gui.addButton(LAYER.BUTTONS + 1, "§a§lNO, CANCEL", 192, 202, 96, 20)
    player.showCustomGui(gui)
}
function executeWorldDataReset(player) {
    var world = player.getWorld()
    var stored = world.getStoreddata()
    
    // Remove all leveling system keys from persistent storage
    if (stored.has(CONFIG_STORAGE_KEY)) stored.remove(CONFIG_STORAGE_KEY)
    if (stored.has("equipmentRegistry")) stored.remove("equipmentRegistry")
    if (stored.has("questExpRegistry")) stored.remove("questExpRegistry")
    if (stored.has(QUEST_MAP_STORAGE_KEY)) stored.remove(QUEST_MAP_STORAGE_KEY)
    if (stored.has(MOB_CONFIG.registryKey)) stored.remove(MOB_CONFIG.registryKey)
    if (stored.has(CLASS_CONFIG.registryKey)) stored.remove(CLASS_CONFIG.registryKey)
    if (stored.has(CLASS_CONFIG.enabledKey)) stored.remove(CLASS_CONFIG.enabledKey)
    if (stored.has(CLASS_CONFIG.lockedNodeVisibilityKey)) stored.remove(CLASS_CONFIG.lockedNodeVisibilityKey)
    
    // Reset runtime CONFIG values to defaults
    CONFIG.baseExpPerLevel = 100
    CONFIG.maxLevel = 100
    CONFIG.hudDisplayMethod = "actionbar"
    CONFIG.hudEnabled = true
    CONFIG.levelUpChatMessage = true
    CONFIG.expCurveTiers = [
        { minLevel: 1, maxLevel: 100, expRate: 1.15 }
    ]
    
    // Reset runtime ATTR_CONFIG values to defaults
    var previousStatRegistry = JSON.parse(JSON.stringify(ATTR_CONFIG.stats))
    ATTR_CONFIG.pointsPerLevel = 3
    ATTR_CONFIG.startingPoints = 0
    ATTR_CONFIG.initialPoints = 0
    ATTR_CONFIG.passivePerLevel.health = 1
    ATTR_CONFIG.resetItemName = "§eReset Stone"
    ATTR_CONFIG.stats = createDefaultStatRegistry()
    refreshStatKeys()
    resetRemovedRegistryAttributes(world, previousStatRegistry, ATTR_CONFIG.stats)
    applyAllAttributesToOnlinePlayers(world)
    
    player.message("§a[Admin] World data reset! Defaults applied immediately.")
    player.message("§7- Cleared: Config, Equipment, Classes, Quest, Map, Mob Rewards")
}

function _resetConfirm_customGuiButton(e) {
    var player = e.player
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    
    if (guiId !== RESET_CONFIRM_GUI_ID) return
    
    if (buttonId === LAYER.BUTTONS) {
        // YES - execute reset
        executeWorldDataReset(player)
        showAdminGui(player, "Tools")
    } else if (buttonId === LAYER.BUTTONS + 1) {
        // NO - go back to admin panel
        showAdminGui(player, "Tools")
    }
}

// Handle admin GUI scroll selection
function _admin_customGuiScroll(e) {
    var player = e.player
    var gui = e.gui
    var guiId = gui.getID()
    var scrollId = e.scrollId
    
    if (guiId !== ADMIN_GUI_ID) return
    
    var selection = e.selection
    if (selection && selection.length > 0) {
        // Check if this is the category scroll (LAYER.SCROLL_LIST = 150) or HUD scroll (LAYER.SCROLL_LIST + 1 = 151)
        if (scrollId === LAYER.SCROLL_LIST) {
            // Category selection
            var category = selection[0]
            showAdminGui(player, category)
        } else if (scrollId === LAYER.SCROLL_LIST + 1) {
            // HUD display method selection
            var method = selection[0]
            CONFIG.hudDisplayMethod = method
            if (method === "none") {
                hideHudOverlay(player)
            }
            player.message("§a[Admin] HUD display method set to: §e" + method)
        }
    }
}

// Save config based on category
function saveAdminConfig(player, gui, category) {
    try {
        if (category === "Leveling") {
            var baseExp = parseInt(gui.getComponent(LAYER.TEXT_FIELDS).getText())
            var maxLvl = parseInt(gui.getComponent(LAYER.TEXT_FIELDS + 1).getText())
            
            if (!isNaN(baseExp) && baseExp > 0) CONFIG.baseExpPerLevel = baseExp
            if (!isNaN(maxLvl) && maxLvl > 0) CONFIG.maxLevel = maxLvl
            saveConfigToWorld(player.getWorld())
            player.message("§a[Admin] Leveling config saved!")
        } else if (category === "Currency") {
            var currency = getCurrencyConfig(player.getWorld())
            var currencyKeyField = gui.getComponent(LAYER.TEXT_FIELDS)
            var currencyNameField = gui.getComponent(LAYER.TEXT_FIELDS + 1)
            var currencySymbolField = gui.getComponent(LAYER.TEXT_FIELDS + 2)
            var currencyPatch = {
                storageKey: currencyKeyField ? String(currencyKeyField.getText()).trim() : currency.storageKey,
                displayName: currencyNameField ? String(currencyNameField.getText()).trim() : currency.displayName,
                symbol: currencySymbolField ? String(currencySymbolField.getText()).trim() : currency.symbol,
                unitScale: currency.unitScale
            }
            var currencyResult = updateCurrencyConfig(player.getWorld(), currencyPatch, false, player)
            if (!currencyResult.ok) {
                player.message("§e[Admin] " + currencyResult.message)
                return
            }
            saveConfigToWorld(player.getWorld())
            player.message("§a[Admin] Currency settings saved!")
        } else if (category === "Attributes") {
            var ptsPerLvl = parseInt(gui.getComponent(LAYER.TEXT_FIELDS).getText())
            var passiveHp = parseFloat(gui.getComponent(LAYER.TEXT_FIELDS + 1).getText())
            var initPts = parseInt(gui.getComponent(LAYER.TEXT_FIELDS + 2).getText())
            
            if (!isNaN(ptsPerLvl) && ptsPerLvl >= 0) ATTR_CONFIG.pointsPerLevel = ptsPerLvl
            if (!isNaN(passiveHp) && passiveHp >= 0) ATTR_CONFIG.passivePerLevel.health = passiveHp
            if (!isNaN(initPts) && initPts >= 0) ATTR_CONFIG.initialPoints = initPts
            
            var resetName = gui.getComponent(LAYER.TEXT_FIELDS + 3).getText()
            if (resetName && resetName.length > 0) {
                ATTR_CONFIG.resetItemName = resetName.indexOf("§") >= 0 ? resetName : "§e" + resetName
            }
            
            // Persist to world storeddata
            saveConfigToWorld(player.getWorld())
            
            player.message("§a[Admin] Attribute config saved!")
            
        } else if (category === "Stats") {
            player.message("§e[Admin] Use the Stat Registry to edit stat definitions.")
        }
    } catch (err) {
        player.message("§c[Admin] Error saving config: " + err)
    }
    
    showAdminGui(player, category)
}

// ===== PERSISTENT CONFIG SAVE/LOAD =====
// Saves CONFIG and ATTR_CONFIG values to world storeddata so they persist

var CONFIG_STORAGE_KEY = "admLevelingConfig"

function saveConfigToWorld(world) {
    var stored = world.getStoreddata()
    var configData = {
        // Leveling config
        baseExpPerLevel: CONFIG.baseExpPerLevel,
        maxLevel: CONFIG.maxLevel,
        hudDisplayMethod: CONFIG.hudDisplayMethod,
        hudEnabled: CONFIG.hudEnabled,
        levelUpChatMessage: CONFIG.levelUpChatMessage,
        currency: normalizeCurrencyConfig(CONFIG.currency),
        
        // EXP Curve Tiers
        expCurveTiers: CONFIG.expCurveTiers,
        
        // Attribute config
        pointsPerLevel: ATTR_CONFIG.pointsPerLevel,
        passiveHealth: ATTR_CONFIG.passivePerLevel.health,
        initialPoints: ATTR_CONFIG.initialPoints,
        resetItemName: ATTR_CONFIG.resetItemName,
        statRegistry: ATTR_CONFIG.stats
    }
    stored.put(CONFIG_STORAGE_KEY, JSON.stringify(configData))
}

function loadConfigFromWorld(world) {
    var stored = world.getStoreddata()
    if (!stored.has(CONFIG_STORAGE_KEY)) return false
    
    try {
        var configData = JSON.parse(stored.get(CONFIG_STORAGE_KEY))
        
        // Leveling config
        if (configData.baseExpPerLevel !== undefined) CONFIG.baseExpPerLevel = configData.baseExpPerLevel
        if (configData.maxLevel !== undefined) CONFIG.maxLevel = configData.maxLevel
        if (configData.hudDisplayMethod !== undefined) CONFIG.hudDisplayMethod = configData.hudDisplayMethod
        if (configData.hudEnabled !== undefined) CONFIG.hudEnabled = configData.hudEnabled
        if (configData.levelUpChatMessage !== undefined) CONFIG.levelUpChatMessage = configData.levelUpChatMessage
        if (configData.currency && typeof configData.currency === "object") CONFIG.currency = normalizeCurrencyConfig(configData.currency)
        
        // EXP Curve Tiers
        if (configData.expCurveTiers !== undefined && Array.isArray(configData.expCurveTiers)) {
            CONFIG.expCurveTiers = configData.expCurveTiers
        }
        
        // Attribute config
        if (configData.pointsPerLevel !== undefined) ATTR_CONFIG.pointsPerLevel = configData.pointsPerLevel
        if (configData.passiveHealth !== undefined) ATTR_CONFIG.passivePerLevel.health = configData.passiveHealth
        if (configData.initialPoints !== undefined) ATTR_CONFIG.initialPoints = configData.initialPoints
        if (configData.resetItemName !== undefined) ATTR_CONFIG.resetItemName = configData.resetItemName
        
        if (configData.statRegistry && typeof configData.statRegistry === "object") {
            ATTR_CONFIG.stats = normalizeStatRegistry(configData.statRegistry)
        } else {
            ATTR_CONFIG.stats = createDefaultStatRegistry()
            if (configData.strDmgPerPoint !== undefined) ATTR_CONFIG.stats.STR.affects["minecraft:generic.attack_damage"].perPoint = configData.strDmgPerPoint
            if (configData.strDmgBase !== undefined) ATTR_CONFIG.stats.STR.affects["minecraft:generic.attack_damage"].base = configData.strDmgBase
            if (configData.vitHpPerPoint !== undefined) ATTR_CONFIG.stats.VIT.affects["minecraft:generic.max_health"].perPoint = configData.vitHpPerPoint
            if (configData.vitHpBase !== undefined) ATTR_CONFIG.stats.VIT.affects["minecraft:generic.max_health"].base = configData.vitHpBase
            if (configData.dexSpdPerPoint !== undefined) ATTR_CONFIG.stats.DEX.affects["minecraft:generic.movement_speed"].perPoint = configData.dexSpdPerPoint
            if (configData.dexSpdBase !== undefined) ATTR_CONFIG.stats.DEX.affects["minecraft:generic.movement_speed"].base = configData.dexSpdBase
        }
        refreshStatKeys()
        
        return true
    } catch (err) {
        return false
    }
}

// Admin chat handler
function _admin_chat(e) {
    var player = e.player
    var msg = e.message
    
    // /admhelp - show all help
    if (msg === "/admhelp") {
        e.setCanceled(true)
        showAdmHelp(player)
        return true
    }
    
    // /admin - admin panel (creative only)
    if (msg === "/admin") {
        e.setCanceled(true)
        showAdminGui(player)
        return true
    }
    
    return false
}

// ============================================
// SELF SYSTEM - Combined Level + Attributes GUI
// ============================================
// /self - Opens player's combined stats GUI

var SELF_GUI_ID = 500
var SELF_GUI_WIDTH = 360
var SELF_GUI_HEIGHT = 270
var SELF_STAT_PAGE_SIZE = 4
var SELF_STAT_PREVIOUS_BUTTON = 255
var SELF_STAT_NEXT_BUTTON = 256
var SELF_SKILLS_BUTTON = 257
var SELF_ATTRIBUTES_BUTTON = 258
var SELF_QUESTS_BUTTON = 259
var SELF_BACK_BUTTON = 260
var SELF_QUEST_ACTIVE_BUTTON = 261
var SELF_QUEST_COMPLETED_BUTTON = 262
var SELF_QUEST_PREVIOUS_BUTTON = 263
var SELF_QUEST_NEXT_BUTTON = 264
var SELF_MAP_BUTTON = 265
var SELF_QUEST_PAGE_SIZE = 24
var SELF_SKILL_TREE_GUI_ID = 501
var SELF_SPELL_LOADOUT_GUI_ID = 502
var SELF_EPIC_LOADOUT_GUI_ID = 503
var SELF_ATTRIBUTES_GUI_ID = 504
var SELF_QUEST_GUI_ID = 505
var SELF_ENTITY_DISPLAY_ID = 180
var SELF_QUEST_SCROLL_ID = 181
var QUEST_MAP_HTML_FILE = "quest_map.html"
var QUEST_MAP_STORAGE_KEY = "questMapRegistry"
var QUEST_MINIMAP_OVERLAY_NAME = "quest_minimap"
var QUEST_MAP_MARKER_LIMIT = 256
var journeyMapLastSync = -1
var journeyMapLastError = -1
var QUEST_TRACKER_OVERLAY_ID = 601
var questTrackerLastState = ""

var SELF_TEXTURES = {
    frame: "minecraft:textures/block/deepslate_tiles.png",
    base: "minecraft:textures/block/black_concrete.png",
    chrome: "minecraft:textures/block/polished_blackstone_bricks.png",
    panel: "minecraft:textures/block/brown_terracotta.png",
    row: "minecraft:textures/block/blackstone.png",
    rowAlt: "minecraft:textures/block/polished_blackstone.png",
    gold: "minecraft:textures/block/gold_block.png",
    cyan: "minecraft:textures/block/cyan_concrete.png",
    xp: "minecraft:textures/block/yellow_concrete.png"
}

var SELF_LAYOUT = {
    headerY: 4,
    headerHeight: 28,
    summaryY: 38,
    summaryHeight: 72,
    levelX: 10,
    levelWidth: 132,
    pointsX: 148,
    pointsWidth: 202,
    statsY: 116,
    statsHeight: 112,
    rowsY: 136,
    rowHeight: 22,
    footerY: 234,
    footerHeight: 30
}

var SelfGuiMath = {
    centerX: function(width) {
        return Math.floor((SELF_GUI_WIDTH - width) / 2)
    },
    rowY: function(index) {
        return SELF_LAYOUT.rowsY + index * SELF_LAYOUT.rowHeight
    }
}

function boundedAttributeAmount(requested, available) {
    var limit = Math.max(0, Math.floor(Number(available) || 0))
    if (requested === "all") return limit
    var amount = requested === undefined ? 1 : Number(requested)
    if (!isFinite(amount) || amount < 1) return 0
    return Math.min(limit, Math.floor(amount))
}

function getPendingStatDataKey(statKey) {
    return "pendingStat_" + normalizeStatKey(statKey)
}

function getPendingStatPoints(player, statKey) {
    var key = getPendingStatDataKey(statKey)
    return player.getTempdata().has(key) ? Number(player.getTempdata().get(key)) : 0
}

function setPendingStatPoints(player, statKey, points) {
    player.getTempdata().put(getPendingStatDataKey(statKey), Math.max(0, Number(points) || 0))
}

function getTotalPendingStatPoints(player) {
    var total = 0
    for (var i = 0; i < STAT_KEYS.length; i++) {
        total += getPendingStatPoints(player, STAT_KEYS[i])
    }
    return total
}

function clearPendingStatPoints(player) {
    var temp = player.getTempdata()
    var keys = temp.getKeys()
    for (var i = 0; i < keys.length; i++) {
        var key = String(keys[i])
        if (key.indexOf("pendingStat_") === 0) temp.remove(key)
    }
    temp.remove("pendingSTR")
    temp.remove("pendingVIT")
    temp.remove("pendingDEX")
}

function getSelfStatPage(player) {
    var maxPage = Math.max(0, Math.ceil(STAT_KEYS.length / SELF_STAT_PAGE_SIZE) - 1)
    var page = player.getTempdata().has("selfStatPage") ? Number(player.getTempdata().get("selfStatPage")) : 0
    if (isNaN(page) || page < 0) page = 0
    if (page > maxPage) page = maxPage
    player.getTempdata().put("selfStatPage", page)
    return { page: page, maxPage: maxPage }
}

function getSelfVisibleStatKeys(player) {
    var pageData = getSelfStatPage(player)
    var start = pageData.page * SELF_STAT_PAGE_SIZE
    return STAT_KEYS.slice(start, start + SELF_STAT_PAGE_SIZE)
}

function calculateMcAttributeWithPending(player, mcAttribute) {
    var value = calculateMcAttribute(player, mcAttribute)
    for (var i = 0; i < STAT_KEYS.length; i++) {
        var stat = ATTR_CONFIG.stats[STAT_KEYS[i]]
        if (stat && stat.affects && stat.affects[mcAttribute]) {
            value += stat.affects[mcAttribute].perPoint * getPendingStatPoints(player, STAT_KEYS[i])
                * getStatEffectivenessMultiplier(player, STAT_KEYS[i])
        }
    }
    return value
}

// Legacy chat helper; slash commands are dispatched through customCommand(e)
function _self_chat(e) {
    var player = e.player
    var msg = e.message.toLowerCase().trim()
    
    if (msg === "/self" || msg === "/stats") {
        e.setCanceled(true)
        showSelfGui(player, true)
        return true
    }
    
    return false
}

function getQuestArray(quests) {
    var result = []
    if (!quests) return result
    if (quests.length !== undefined) {
        for (var i = 0; i < quests.length; i++) result.push(quests[i])
        return result
    }
    if (quests.size && quests.get) {
        for (var j = 0; j < quests.size(); j++) result.push(quests.get(j))
    }
    return result
}

function getPlayerQuestList(player, completed) {
    try {
        return getQuestArray(completed ? player.getFinishedQuests() : player.getActiveQuests())
    } catch (err) {
        return []
    }
}

function normalizeQuestMapMarkerId(value, fallback, occupied) {
    var base = String(value || fallback || "marker").replace(/[^A-Za-z0-9_.:-]/g, "_")
    if (!base) base = "marker"
    base = base.substring(0, 64)
    var markerId = base
    var sequence = 1
    while (Object.prototype.hasOwnProperty.call(occupied, markerId)) {
        var suffix = ":" + sequence++
        markerId = base.substring(0, 64 - suffix.length) + suffix
    }
    return markerId
}

function getQuestMapRegistry(world, strict) {
    var stored = world.getStoreddata()
    if (!stored.has(QUEST_MAP_STORAGE_KEY)) return {}
    try {
        var parsed = JSON.parse(String(stored.get(QUEST_MAP_STORAGE_KEY)))
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid marker registry")
        var normalized = {}
        var keys = Object.keys(parsed).sort()
        for (var i = 0; i < keys.length; i++) {
            var source = parsed[keys[i]]
            if (!source) continue
            var mode = String(source.mode || "QUEST").toUpperCase() === "ALWAYS" ? "ALWAYS" : "QUEST"
            var fallbackId = mode === "QUEST" ? "quest:" + Number(source.questId || keys[i]) : keys[i]
            var markerId = normalizeQuestMapMarkerId(source.markerId, fallbackId, normalized)
            normalized[markerId] = {
                markerId: markerId,
                mode: mode,
                questId: mode === "QUEST" ? Number(source.questId || keys[i]) : 0,
                name: String(source.name || ""),
                symbol: String(source.symbol || (mode === "QUEST" ? "!" : "◆")),
                showOutside: source.showOutside !== false,
                turnin: source.turnin === true,
                x: Number(source.x),
                y: source.y === undefined || source.y === null ? null : Number(source.y),
                z: Number(source.z),
                dimensionId: String(source.dimensionId || ""),
                dimension: Number(source.dimension),
                dimensionName: String(source.dimensionName || "")
            }
        }
        return normalized
    } catch (error) {
        if (strict) throw error
        return {}
    }
}

function saveQuestMapRegistry(world, registry) {
    var encoded = JSON.stringify(registry)
    world.getStoreddata().put(QUEST_MAP_STORAGE_KEY, encoded)
    var worlds = API.getIWorlds()
    for (var i = 0; i < worlds.length; i++) {
        worlds[i].getStoreddata().put(QUEST_MAP_STORAGE_KEY, encoded)
    }
}

function getQuestMapName(questId, fallback) {
    try {
        var quest = API.getQuests().get(Number(questId))
        return quest ? String(quest.getName()) : String(fallback || ("Quest #" + questId))
    } catch (error) {
        return String(fallback || ("Quest #" + questId))
    }
}

function retireScriptMinimap(player) {
    if (player.getTimers().has(QUEST_MINIMAP_TIMER_ID)) player.getTimers().stop(QUEST_MINIMAP_TIMER_ID)
    if (cnpcext.hasOverlay(player, QUEST_MINIMAP_OVERLAY_NAME)) cnpcext.closeOverlay(player, QUEST_MINIMAP_OVERLAY_NAME)
}

function queueJourneyMapSync() {
    journeyMapLastSync = -1
}

function syncJourneyMapMarkers(player, force) {
    if (!player.isAlive() || isArvanPersistenceFrozen(player)) return
    var now = Number(player.getWorld().getTotalTime())
    if (!force && journeyMapLastSync >= 0 && now >= journeyMapLastSync && now - journeyMapLastSync < 20) return
    journeyMapLastSync = now
    syncQuestTracker(player)
    try {
        if (!SERVER_CORE_MAP.isAvailable()) return
        syncJourneyMapMarkerSnapshot(player)
    } catch (error) {
        if (journeyMapLastError < 0 || now < journeyMapLastError || now - journeyMapLastError >= 1200) {
            journeyMapLastError = now
            log("[Map] " + String(error))
        }
    }
}

function syncJourneyMapMarkerSnapshot(player) {
    var world = player.getWorld()
    var dimensionId = String(SERVER_CORE_MAP.dimensionId(player.getMCEntity()))
    var visible = buildQuestMapMarkers(player, false)
    var markers = []
    for (var i = 0; i < visible.length; i++) {
        if (!questMapMarkerMatchesDimension(visible[i], world, dimensionId)) continue
        if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(visible[i].markerId) ||
            !isFinite(visible[i].x) || !isFinite(visible[i].y) || !isFinite(visible[i].z) ||
            visible[i].y !== Math.floor(visible[i].y) || visible[i].y < -2048 || visible[i].y > 2047 ||
            Math.abs(visible[i].x) > 29999984 || Math.abs(visible[i].z) > 29999984) continue
        visible[i].dimensionId = dimensionId
        visible[i].name = visible[i].name.replace(/[\u0000-\u001f\u007f]/g, "").substring(0, 64)
        visible[i].symbol = visible[i].symbol.replace(/[\u0000-\u001f\u007f]/g, "").substring(0, 4) || "!"
        markers.push(visible[i])
        if (markers.length >= QUEST_MAP_MARKER_LIMIT) break
    }
    var result = JSON.parse(String(SERVER_CORE_MAP.sync(player.getMCEntity(), JSON.stringify(markers))))
    if (!result.ok) throw new Error(String(result.message || "Marker synchronization failed"))
}

function isMapAdmin(player) {
    return SERVER_CORE_MAP.canAdmin(player.getMCEntity()) === true
}

function buildQuestMapPlayerState(player) {
    var world = player.getWorld()
    var dimension = world.getDimension()
    return {
        name: String(player.getDisplayName()),
        x: Math.floor(player.getX()),
        y: Math.floor(player.getY()),
        z: Math.floor(player.getZ()),
        yaw: Number(player.getRotation()),
        dimensionId: String(SERVER_CORE_MAP.dimensionId(player.getMCEntity())),
        dimension: Number(dimension.getId()),
        dimensionName: String(world.getName())
    }
}

function getActiveQuestIdLookup(player) {
    var activeQuests = getPlayerQuestList(player, false)
    var lookup = {}
    for (var i = 0; i < activeQuests.length; i++) {
        var quest = activeQuests[i]
        if (quest) lookup[String(Number(quest.getId()))] = true
    }
    return lookup
}

function questMapMarkerMatchesDimension(marker, world, dimensionId) {
    if (marker.dimensionId) return String(marker.dimensionId) === String(dimensionId)
    var markerName = String(marker.dimensionName || "")
    var worldName = String(world.getName() || "")
    if (markerName && worldName) return markerName === worldName
    var markerId = Number(marker.dimension)
    var worldId = Number(world.getDimension().getId())
    if (!isNaN(markerId) && !isNaN(worldId)) return markerId === worldId
    return true
}

function buildQuestMapMarkers(player, adminMode) {
    var world = player.getWorld()
    var registry = getQuestMapRegistry(world)
    var ids = Object.keys(registry).sort()
    var markers = []
    var activeQuestIds = adminMode ? null : getActiveQuestIdLookup(player)
    var readyQuests = {}
    for (var i = 0; i < ids.length; i++) {
        var marker = registry[ids[i]]
        if (!marker) continue
        if (!adminMode && marker.mode === "QUEST") {
            var questKey = String(Number(marker.questId))
            if (!activeQuestIds[questKey] || !isQuestTracked(player, marker.questId)) continue
            if (!Object.prototype.hasOwnProperty.call(readyQuests, questKey)) {
                readyQuests[questKey] = playerMenuQuest(API.getQuests().get(Number(marker.questId)), false, player).ready
            }
            if ((marker.turnin === true) !== readyQuests[questKey]) continue
        }
        markers.push({
            markerId: String(marker.markerId),
            mode: String(marker.mode),
            questId: Number(marker.questId),
            name: String(marker.name || (marker.mode === "QUEST" ? getQuestMapName(marker.questId, "") : "Point of Interest")),
            symbol: String(marker.symbol || (marker.mode === "QUEST" ? "!" : "◆")),
            showOutside: marker.showOutside !== false,
            turnin: marker.turnin === true,
            x: Number(marker.x),
            y: marker.y === null || marker.y === undefined || !isFinite(Number(marker.y))
                ? Math.floor(player.getY()) : Math.floor(Number(marker.y)),
            z: Number(marker.z),
            dimensionId: String(marker.dimensionId || ""),
            dimension: Number(marker.dimension),
            dimensionName: String(marker.dimensionName || "")
        })
    }
    return markers
}

function openQuestMapHtml(player, adminMode) {
    if (!adminMode) {
        syncJourneyMapMarkers(player, true)
        var result
        try {
            // JourneyMap 6 refuses fullscreen opening while a CNPC screen is active.
            // Send the close packet first so the client processes the handoff in order.
            player.closeGui()
            result = JSON.parse(String(SERVER_CORE_MAP.openMap(player.getMCEntity())))
        } catch (error) {
            result = { ok: false, message: "JourneyMap could not be opened. Check the client and server versions." }
        }
        if (!result.ok) player.message("§c" + String(result.message || "JourneyMap is unavailable."))
        return result
    }
    if (!isMapAdmin(player)) {
        player.message("§cServer administrator access is required.")
        return
    }
    if (player.getCustomGui()) {
        var transitions = player.getTempdata().has(ADM_GUI_TRANSITION_KEY)
            ? Number(player.getTempdata().get(ADM_GUI_TRANSITION_KEY)) : 0
        player.getTempdata().put(ADM_GUI_TRANSITION_KEY, transitions + 1)
    }
    player.getTempdata().put(HTML_ACTIVE_SESSION_KEY, "MAP_ADMIN")
    cnpcext.openHtmlGui(player, QUEST_MAP_HTML_FILE, 0, 0, JSON.stringify({
        admin: true, player: buildQuestMapPlayerState(player), markers: [], ok: true, message: ""
    }))
}

function pushQuestMapMarkers(player, adminMode, batchId) {
    var bridge = cnpcext.getClientBridge(player.getMCEntity())
    var markers = buildQuestMapMarkers(player, adminMode)
    var chunkSize = 48
    if (markers.length === 0) {
        bridge.sendToBrowser("quest_map_markers", JSON.stringify({ batchId: String(batchId || ""), reset: true, markers: [] }))
        return
    }
    for (var index = 0; index < markers.length; index += chunkSize) {
        bridge.sendToBrowser("quest_map_markers", JSON.stringify({
            batchId: String(batchId || ""), reset: index === 0, markers: markers.slice(index, index + chunkSize)
        }))
    }
}

function pushQuestMapMeta(player, adminMode, message, ok, actionRequestId, action, markerId) {
    var bridge = cnpcext.getClientBridge(player.getMCEntity())
    bridge.sendToBrowser("quest_map_meta", JSON.stringify({
        admin: adminMode === true, ok: ok !== false, message: String(message || ""),
        actionRequestId: String(actionRequestId || ""), action: String(action || ""),
        markerId: String(markerId || ""), player: buildQuestMapPlayerState(player)
    }))
    if (action !== "mypos") pushQuestMapMarkers(player, adminMode, actionRequestId)
}

function handleQuestMapHtmlEvent(e) {
    var player = e.player
    var temp = player.getTempdata()
    var session = temp.has(HTML_ACTIVE_SESSION_KEY) ? String(temp.get(HTML_ACTIVE_SESSION_KEY)) : ""
    if (session !== "MAP_ADMIN" || !isMapAdmin(player)) return
    var data = parseClassSkillHtmlData(e.data)
    var action = String(data.action || "")
    if (action === "back") {
        showAdminGui(player, "Tools")
        return
    }
    if (action === "open_map") {
        var openResult = openQuestMapHtml(player, false)
        if (openResult && !openResult.ok) pushQuestMapMeta(player, true, openResult.message, false, data.actionRequestId, action)
        return
    }
    if (action === "ready" || action === "refresh" || action === "mypos") {
        pushQuestMapMeta(player, true, "", true, data.actionRequestId, action)
        return
    }
    if (action !== "save" && action !== "delete") return
    if (isArvanPersistenceFrozen(player)) {
        pushQuestMapMeta(player, true, "Player data is temporarily locked. Try again after the transfer.", false, data.actionRequestId, action)
        return
    }
    var registry
    try {
        registry = getQuestMapRegistry(player.getWorld(), true)
    } catch (error) {
        pushQuestMapMeta(player, true, "Marker data is unreadable; no changes were saved.", false, data.actionRequestId, action)
        return
    }
    var markerId = String(data.markerId || "")
    if (markerId && (!/^[A-Za-z0-9_.:-]{1,64}$/.test(markerId) || !Object.prototype.hasOwnProperty.call(registry, markerId))) {
        pushQuestMapMeta(player, true, "That marker no longer exists. Refresh the list.", false, data.actionRequestId, action)
        return
    }
    if (action === "delete") {
        if (!markerId) {
            pushQuestMapMeta(player, true, "Select a marker before deleting it.", false, data.actionRequestId, action)
            return
        }
        delete registry[markerId]
        saveQuestMapRegistry(player.getWorld(), registry)
        queueJourneyMapSync()
        pushQuestMapMeta(player, true, "Marker removed.", true, data.actionRequestId, action, markerId)
        return
    }
    var mode = String(data.mode || "").toUpperCase()
    var questId = Number(data.questId)
    var x = Number(data.x)
    var y = Number(data.y)
    var z = Number(data.z)
    var name = String(data.name || "").trim()
    var symbol = String(data.symbol || "").trim()
    if ((mode !== "QUEST" && mode !== "ALWAYS") ||
        (mode === "QUEST" && (!isFinite(questId) || questId < 1 || questId !== Math.floor(questId))) ||
        String(data.x === undefined ? "" : data.x).trim() === "" ||
        String(data.y === undefined ? "" : data.y).trim() === "" ||
        String(data.z === undefined ? "" : data.z).trim() === "" ||
        !isFinite(x) || !isFinite(y) || y !== Math.floor(y) || y < -2048 || y > 2047 ||
        !isFinite(z) || Math.abs(x) > 29999984 || Math.abs(z) > 29999984 ||
        name.length > 64 || symbol.length > 4 || /[\u0000-\u001f\u007f]/.test(name + symbol)) {
        pushQuestMapMeta(player, true, "Check the quest ID, name, symbol and X/Y/Z coordinates.", false, data.actionRequestId, action)
        return
    }
    var quest = mode === "QUEST" ? API.getQuests().get(questId) : null
    if (mode === "QUEST" && !quest) {
        pushQuestMapMeta(player, true, "CustomNPCs quest #" + questId + " does not exist.", false, data.actionRequestId, action)
        return
    }
    if (!markerId && Object.keys(registry).length >= QUEST_MAP_MARKER_LIMIT) {
        pushQuestMapMeta(player, true, "The marker limit is " + QUEST_MAP_MARKER_LIMIT + ".", false, data.actionRequestId, action)
        return
    }
    if (!markerId) {
        var baseId = "marker:" + String(new Date().getTime())
        markerId = baseId
        var sequence = 1
        while (Object.prototype.hasOwnProperty.call(registry, markerId)) markerId = baseId + ":" + sequence++
    }
    var state = buildQuestMapPlayerState(player)
    var dimensionName = String(data.dimensionName || state.dimensionName)
    var dimensionId = String(data.dimensionId || (dimensionName === state.dimensionName ? state.dimensionId : ""))
    if (dimensionId && !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(dimensionId)) {
        pushQuestMapMeta(player, true, "Use My Pos to select a valid dimension.", false, data.actionRequestId, action)
        return
    }
    registry[markerId] = {
        markerId: markerId, mode: mode, questId: mode === "QUEST" ? questId : 0,
        name: String(name || (quest ? quest.getName() : "Point of Interest")).substring(0, 64),
        symbol: symbol || (mode === "QUEST" ? "!" : "◆"),
        showOutside: data.showOutside === true || String(data.showOutside) === "true",
        turnin: mode === "QUEST" && (data.turnin === true || String(data.turnin) === "true"),
        x: Math.floor(x), y: y, z: Math.floor(z), dimensionId: dimensionId,
        dimension: data.dimension === undefined ? state.dimension : Number(data.dimension),
        dimensionName: dimensionName
    }
    saveQuestMapRegistry(player.getWorld(), registry)
    queueJourneyMapSync()
    pushQuestMapMeta(player, true, "Marker saved.", true, data.actionRequestId, action, markerId)
}

function getSelfQuestMode(player) {
    return player.getTempdata().has("selfQuestMode")
        ? String(player.getTempdata().get("selfQuestMode")) : "ACTIVE"
}

function getQuestCategoryName(quest) {
    try {
        var category = quest.getCategory()
        return category ? String(category.getName()) : "Uncategorized"
    } catch (err) {
        return "Uncategorized"
    }
}

function addWrappedGuiText(gui, idStart, text, x, y, width, maxLines, color) {
    var plain = String(text || "No quest details available.").replace(/\r/g, "")
    var words = plain.replace(/\n/g, " \n ").split(/\s+/)
    var lines = []
    var line = ""
    var maxChars = Math.max(12, Math.floor(width / 6))
    for (var i = 0; i < words.length && lines.length < maxLines; i++) {
        if (words[i] === "\n") {
            if (line) lines.push(line)
            line = ""
        } else if (!line || line.length + words[i].length + 1 <= maxChars) {
            line += (line ? " " : "") + words[i]
        } else {
            lines.push(line)
            line = words[i]
        }
    }
    if (line && lines.length < maxLines) lines.push(line)
    for (var j = 0; j < lines.length; j++) {
        var suffix = j === maxLines - 1 && i < words.length ? "..." : ""
        gui.addLabel(idStart + j, (color || "§7") + lines[j] + suffix, x, y + j * 11, width, 10)
    }
}

var PLAYER_MENU_SESSION_KEY = "admPlayerMenuSession"
var PLAYER_MENU_VIEW_KEY = "admPlayerMenuView"
var PLAYER_MENU_TRANSITION_KEY = "admPlayerMenuTransition"
var PLAYER_MENU_NAV_KEY = "admPlayerMenuNavigation"
var PLAYER_MENU_HTML_FILE = "player_menu.html"
var playerMenuSequence = 0

function playerNotificationSettings(player) {
    var stored = getPlayerStoreddata(player), settings = {}
    var keys = ["levelUp", "skills", "choices", "upgrades", "points", "exp", "spirit", "gold"]
    for (var i = 0; i < keys.length; i++) settings[keys[i]] = String(storeddataGet(stored, "admNotify_" + keys[i], 1)) !== "0"
    return settings
}

function notifyResourceGain(player, key, amount, label, color) {
    if (Number(amount) > 0 && String(storeddataGet(getPlayerStoreddata(player), "admNotify_" + key, 1)) !== "0") player.message(color + "+" + amount + " " + label)
}

function tickPlayerNotifications(player) {
    var temp = player.getTempdata(), now = Date.now()
    if (!temp.has("admNotifyNext")) {
        temp.put("admNotifyNext", now + 30000)
        temp.put("admNotifyPointsAt", now + 300000)
        return
    }
    if (now < Number(temp.get("admNotifyNext"))) return
    temp.put("admNotifyNext", now + 30000)
    var settings = playerNotificationSettings(player)
    if (now >= Number(temp.get("admNotifyPointsAt") || 0)) {
        temp.put("admNotifyPointsAt", now + 300000)
        var points = getAvailablePoints(player)
        if (settings.points && points > 0) player.message("§e[Character] §fYou have " + points + " unspent attribute points. Open Character > Attributes.")
    }
    if (!getPlayerClassId(player)) return
    var snapshot = getSelfSkillSnapshot(player)
    if (!snapshot.ok) return
    var definitions = getSelfSkillVisibilityDefinitions(player, snapshot.classId)
    var previous = JSON.parse(String(temp.get("admNotifyAvailable") || "{}"))
    var current = {}, counts = { skills: 0, choices: 0, upgrades: 0 }, routes = {}
    for (var i = 0; i < snapshot.nodes.length; i++) {
        var node = snapshot.nodes[i]
        if (!node.learnable || node.learned || node.learnedWithNode || node.replaced) continue
        if (!isSnapshotNodeVisible(snapshot, node, routes, {})) continue
        if (getSelfSkillNodeVisibility(player, node, definitions[node.id], snapshot) !== "SHOW") continue
        var category = node.statNode ? (node.upgradeFrom ? "upgrades" : "skills")
            : node.type === "MILESTONE" || node.choiceGroupId ? "choices" : node.upgradeFrom ? "upgrades" : "skills"
        var key = snapshot.classId + ":" + category + ":" + node.id
        current[key] = true
        if (!previous[key]) counts[category]++
    }
    temp.put("admNotifyAvailable", JSON.stringify(current))
    var labels = { skills: "New skills available", choices: "Path choices available", upgrades: "Skill upgrades available" }
    for (var categoryKey in counts) {
        if (settings[categoryKey] && counts[categoryKey] > 0) player.message("§e[Skills] §f" + labels[categoryKey] + " (" + counts[categoryKey] + "). Open Character > Skills.")
    }
}

function playerMenuText(value, limit) {
    return String(value || "").replace(/§./g, "").substring(0, limit || 256)
}

function migrateWarriorRollRegistry(player) {
    var key = "admWarriorRollRegistryFix20260911"
    var temp = player.getTempdata()
    if (temp.has(key) || !isAdmin(player)) return
    temp.put(key, true)
    var world = player.getWorld(), stored = world.getStoreddata()
    if (stored.has(key)) return
    var registry = getClassRegistry(world), warrior = registry.warrior
    if (!warrior || !Array.isArray(warrior.skillNodes)) return
    var roll = null
    for (var i = 0; i < warrior.skillNodes.length; i++) {
        var node = warrior.skillNodes[i]
        if (node.id === "roll" && node.type === "EPIC_FIGHT" && node.registryId === "epicfight:step" && String(node.title).toLowerCase() === "roll") roll = node
    }
    if (!roll) return
    var before = JSON.stringify(roll)
    roll.registryId = "epicfight:roll"
    var result = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.saveTree(player.getMCEntity(), "warrior", JSON.stringify({ nodes: buildClassSkillRuntimeNodes(warrior.skillNodes), choiceGroups: warrior.choiceGroups || [] }))
    })
    if (!result.ok) { log("[Skills] Roll registry correction failed: " + result.message); return }
    stored.put(key + "Backup", before)
    saveClassRegistry(world, registry)
    stored.put(key, true)
    refreshOnlinePlayersForClass(world, "warrior")
    log("[Skills] Corrected warrior/roll from epicfight:step to epicfight:roll.")
}

function isQuestTracked(player, questId) {
    return String(storeddataGet(getPlayerStoreddata(player), "admQuestTracked_" + Number(questId), 1)) !== "0"
}

function playerMenuQuest(quest, completed, player) {
    var objectives = []
    var nativeObjectives = completed ? [] : quest.getObjectives(player)
    var ready = completed || nativeObjectives.length > 0
    for (var i = 0; i < nativeObjectives.length; i++) {
        var objective = nativeObjectives[i]
        var done = objective.isCompleted()
        if (!done) ready = false
        objectives.push({
            text: playerMenuText(objective.getText()).replace(/\s*[:(]?\s*\d+\s*\/\s*\d+\)?\s*$/, ""),
            progress: Number(objective.getProgress()), maximum: Number(objective.getMaxProgress()), complete: done
        })
    }
    return {
        id: Number(quest.getId()), name: playerMenuText(quest.getName()),
        category: playerMenuText(getQuestCategoryName(quest)),
        description: playerMenuText(completed ? quest.getCompleteText() : quest.getLogText(), 16384),
        objectives: objectives, ready: ready, tracked: !completed && isQuestTracked(player, quest.getId())
    }
}

function syncQuestTracker(player) {
    var active = getPlayerQuestList(player, false), quests = [], lines = []
    for (var i = 0; i < active.length; i++) {
        var quest = playerMenuQuest(active[i], false, player)
        quests.push(quest)
        if (!quest.tracked) continue
        for (var j = 0; j < quest.objectives.length; j++) {
            var objective = quest.objectives[j]
            lines.push((objective.complete ? "§a" : "§f") + quest.name + " §e(" + objective.progress + "/" + objective.maximum + ")")
        }
        if (!quest.objectives.length) lines.push("§f" + quest.name)
    }
    if (lines.length) {
        var overlay = API.createOverlay(QUEST_TRACKER_OVERLAY_ID)
        overlay.setLinkSide(0)
        overlay.addLabel(1, "§6§lTracker:", 8, 76).setScale(0.85)
        for (var row = 0; row < lines.length; row++) overlay.addLabel(row + 2, lines[row], 8, 92 + row * 12).setScale(0.72)
        player.showOverlay(overlay)
    } else player.hideOverlay(QUEST_TRACKER_OVERLAY_ID)
    var signature = JSON.stringify(quests)
    if (signature !== questTrackerLastState) {
        questTrackerLastState = signature
        var temp = player.getTempdata()
        if (String(temp.get(HTML_ACTIVE_SESSION_KEY) || "") === "PLAYER" && String(temp.get(PLAYER_MENU_VIEW_KEY)) === "quests") pushPlayerMenu(player)
    }
}

function buildPlayerMenuPayload(player) {
    var world = player.getWorld()
    loadConfigFromWorld(world)
    refreshStatKeys()
    var temp = player.getTempdata()
    var data = getPlayerData(player)
    var classId = getPlayerClassId(player)
    var active = getPlayerQuestList(player, false)
    var completed = getPlayerQuestList(player, true)
    var payload = {
        session: String(temp.get(PLAYER_MENU_SESSION_KEY) || ""),
        view: String(temp.get(PLAYER_MENU_VIEW_KEY) || "home"),
        name: playerMenuText(player.getDisplayName()),
        creative: typeof player.getGamemode === "function" && player.getGamemode() === 1,
        className: playerMenuText(classId ? getClassDisplayName(world, classId) : "Unbound"),
        level: data.level, exp: data.exp, expNeeded: getExpForLevel(data.level),
        maxLevel: data.level >= CONFIG.maxLevel,
        points: getAvailablePoints(player) - getTotalPendingStatPoints(player),
        spiritBalance: getSpiritBalance(player),
        spirit: getSpiritBalance(player),
        spiritDisplayName: "Spirit",
        moneyBalance: getNormalMoneyBalance(player),
        money: getNormalMoneyBalance(player),
        currency: getCurrencyConfig(world),
        pending: getTotalPendingStatPoints(player), activeCount: active.length,
        completedCount: completed.length,
        notifications: playerNotificationSettings(player),
        featuredQuest: active.length ? playerMenuQuest(active[0], false, player) : null
    }
    if (payload.view === "attributes") {
        var page = getSelfStatPage(player)
        var keys = getSelfVisibleStatKeys(player)
        temp.put("selfVisibleStatIds", JSON.stringify(keys))
        payload.page = page.page
        payload.pages = page.maxPage + 1
        payload.resetItem = playerMenuText(ATTR_CONFIG.resetItemName)
        payload.stats = []
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i]
            var stat = ATTR_CONFIG.stats[key]
            var effects = []
            for (var attribute in stat.affects) {
                if (Object.prototype.hasOwnProperty.call(stat.affects, attribute)) {
                    effects.push({ name: attribute, value: calculateMcAttributeWithPending(player, attribute) })
                }
            }
            payload.stats.push({ key: key, name: playerMenuText(stat.name),
                description: playerMenuText(stat.description, 2048),
                allocated: getStatPoints(player, key), pending: getPendingStatPoints(player, key),
                base: getClassBaseStatPoints(player, key), bonus: getLearnedNodeStatValue(player, key, "statBonuses"),
                effectiveness: Math.round(getStatEffectivenessMultiplier(player, key) * 10000) / 100,
                effects: effects })
        }
    }
    if (payload.view === "quests") {
        payload.mode = getSelfQuestMode(player)
        var quests = payload.mode === "COMPLETED" ? completed : active
        payload.pages = Math.max(1, Math.ceil(quests.length / SELF_QUEST_PAGE_SIZE))
        payload.page = Math.max(0, Math.min(payload.pages - 1, Number(temp.get("selfQuestPage")) || 0))
        temp.put("selfQuestPage", payload.page)
        payload.quests = []
        var start = payload.page * SELF_QUEST_PAGE_SIZE
        for (var j = start; j < Math.min(quests.length, start + SELF_QUEST_PAGE_SIZE); j++) {
            payload.quests.push(playerMenuQuest(quests[j], payload.mode === "COMPLETED", player))
        }
    }
    return payload
}

function openPlayerMenu(player, view, forceOpen) {
    var temp = player.getTempdata()
    if (forceOpen && temp.has(PLAYER_MENU_NAV_KEY)) {
        queuePlayerMenuNavigation(player, view, true)
        return
    }
    if (String(temp.get(HTML_ACTIVE_SESSION_KEY) || "") === "SELF") {
        queuePlayerMenuNavigation(player, view, forceOpen)
        return
    }
    var alreadyOpen = String(temp.get(HTML_ACTIVE_SESSION_KEY) || "") === "PLAYER" && temp.has(PLAYER_MENU_SESSION_KEY)
    temp.put(PLAYER_MENU_VIEW_KEY, view)
    if (alreadyOpen && forceOpen) {
        queuePlayerMenuNavigation(player, view, true)
        return
    }
    if (alreadyOpen && !forceOpen) {
        pushPlayerMenu(player)
        return
    }
    if (temp.has(HTML_ACTIVE_SESSION_KEY)) temp.put(PLAYER_MENU_TRANSITION_KEY, player.getWorld().getTotalTime())
    if (player.getCustomGui()) {
        temp.put(ADM_GUI_TRANSITION_KEY, Number(temp.get(ADM_GUI_TRANSITION_KEY) || 0) + 1)
    }
    temp.put(PLAYER_MENU_SESSION_KEY, String(Date.now()) + ":" + String(++playerMenuSequence))
    temp.put(HTML_ACTIVE_SESSION_KEY, "PLAYER")
    var initial = { session: String(temp.get(PLAYER_MENU_SESSION_KEY)), view: view,
        overlayEntities: [{ slot: 0, entityId: cnpcext.entityId(player), followCursor: true, animate: false }] }
    cnpcext.openHtmlGui(player, PLAYER_MENU_HTML_FILE, 0, 0, JSON.stringify(initial))
}

function pushPlayerMenu(player) {
    sendSkillHtmlPayload(cnpcext.getClientBridge(player.getMCEntity()), "player_menu", buildPlayerMenuPayload(player))
}

function showSelfGui(player, forceOpen) { openPlayerMenu(player, "home", forceOpen) }
function showSelfAttributesGui(player, forceOpen) { openPlayerMenu(player, "attributes", forceOpen) }
function showSelfQuestGui(player, forceOpen) { openPlayerMenu(player, "quests", forceOpen) }

function queuePlayerMenuNavigation(player, destination, replaceNavigation) {
    var temp = player.getTempdata()
    if (temp.has(PLAYER_MENU_NAV_KEY) && !replaceNavigation) return
    if (temp.has(PLAYER_MENU_NAV_KEY)) temp.remove(PLAYER_MENU_NAV_KEY)
    temp.put(PLAYER_MENU_NAV_KEY, destination)
    temp.put(PLAYER_MENU_TRANSITION_KEY, player.getWorld().getTotalTime())
    temp.remove(PLAYER_MENU_SESSION_KEY)
    temp.remove(SELF_SKILL_HTML_SESSION_KEY)
    temp.remove(SELF_SKILL_HTML_VIEW_KEY)
    temp.remove(HTML_ACTIVE_SESSION_KEY)
    player.getTimers().forceStart(PLAYER_MENU_NAV_TIMER_ID, 1, false)
    cnpcext.getClientBridge(player.getMCEntity()).closeHtmlGui()
}

function handlePlayerMenuHtmlEvent(e) {
    var player = e.player
    var temp = player.getTempdata()
    var data = parseClassSkillHtmlData(e.data)
    if (String(temp.get(HTML_ACTIVE_SESSION_KEY) || "") !== "PLAYER" ||
        !temp.has(PLAYER_MENU_SESSION_KEY) || data.session !== String(temp.get(PLAYER_MENU_SESSION_KEY))) return
    var action = String(data.action || "")
    if (action === "ready" || action === "refresh") { pushPlayerMenu(player); return }
    if (action === "close") {
        clearPendingStatPoints(player)
        if (String(temp.get(PLAYER_MENU_VIEW_KEY) || "home") !== "home") {
            openPlayerMenu(player, "home")
            return
        }
        temp.remove(PLAYER_MENU_SESSION_KEY)
        temp.remove(HTML_ACTIVE_SESSION_KEY)
        cnpcext.getClientBridge(player.getMCEntity()).closeHtmlGui()
        return
    }
    if (isArvanPersistenceFrozen(player)) {
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("player_menu_notice", JSON.stringify({ message: "Your character is being saved. Try again in a moment." }))
        return
    }
    if (["home", "attributes", "quests", "settings"].indexOf(action) >= 0) {
        if (action !== "attributes") clearPendingStatPoints(player)
        openPlayerMenu(player, action)
        return
    }
    if (action === "skills" || action === "map" || action === "admin") {
        if (action === "admin" && (typeof player.getGamemode !== "function" || player.getGamemode() !== 1)) return
        clearPendingStatPoints(player)
        queuePlayerMenuNavigation(player, action)
        return
    }
    var view = String(temp.get(PLAYER_MENU_VIEW_KEY))
    if (view === "settings" && action === "notification") {
        var notificationKey = String(data.key || "")
        if (["levelUp", "skills", "choices", "upgrades", "points", "exp", "spirit", "gold"].indexOf(notificationKey) < 0 || typeof data.amount !== "boolean") return
        storeddataPut(getPlayerStoreddata(player), "admNotify_" + notificationKey, data.amount ? 1 : 0)
        pushPlayerMenu(player)
        return
    }
    if (view === "quests") {
        if (action === "track") {
            var trackedQuestId = Number(data.key)
            if (!isFinite(trackedQuestId) || trackedQuestId < 1 || Math.floor(trackedQuestId) !== trackedQuestId || !player.hasActiveQuest(trackedQuestId)) return
            storeddataPut(getPlayerStoreddata(player), "admQuestTracked_" + trackedQuestId, isQuestTracked(player, trackedQuestId) ? 0 : 1)
            queueJourneyMapSync()
        } else if (action === "active" || action === "completed") {
            temp.put("selfQuestMode", action === "active" ? "ACTIVE" : "COMPLETED")
            temp.put("selfQuestPage", 0)
        } else if (action === "previous" || action === "next") {
            temp.put("selfQuestPage", (Number(temp.get("selfQuestPage")) || 0) + (action === "next" ? 1 : -1))
        } else return
        pushPlayerMenu(player)
        return
    }
    if (view !== "attributes") return
    var buttonId = -1
    var buttons = { apply: 252, undo: 254, reset: 250, sync: 251, previous: SELF_STAT_PREVIOUS_BUTTON, next: SELF_STAT_NEXT_BUTTON }
    if (Object.prototype.hasOwnProperty.call(buttons, action)) buttonId = buttons[action]
    if (action === "plus" || action === "minus") {
        var keys = JSON.parse(String(temp.get("selfVisibleStatIds") || "[]"))
        var index = keys.indexOf(String(data.key || ""))
        if (index < 0 || index >= SELF_STAT_PAGE_SIZE) return
        var statKey = keys[index]
        var pending = getPendingStatPoints(player, statKey)
        var limit = action === "plus" ? getAvailablePoints(player) - getTotalPendingStatPoints(player) : pending
        var amount = boundedAttributeAmount(data.amount, limit)
        if (amount > 0) setPendingStatPoints(player, statKey, pending + (action === "plus" ? amount : -amount))
        pushPlayerMenu(player)
        return
    }
    if (buttonId < 0) return
    // Route only allowlisted actions into the existing server-authoritative allocation path.
    _self_customGuiButton({ player: player, gui: { getID: function() { return SELF_ATTRIBUTES_GUI_ID } }, buttonId: buttonId })
    pushPlayerMenu(player)
}

// Retained native views for compatibility with existing native event IDs.
function showSelfGuiNative(player) {
    var world = player.getWorld()
    loadConfigFromWorld(world)
    refreshStatKeys()
    var gui = API.createCustomGui(SELF_GUI_ID, SELF_GUI_WIDTH, SELF_GUI_HEIGHT, false, player)

    var data = getPlayerData(player)
    var level = data.level
    var expNeeded = getExpForLevel(level)
    var expProgress = Math.max(0, Math.min(100, Math.floor((data.exp / expNeeded) * 100)))
    var classId = getPlayerClassId(player)
    var className = classId ? getClassDisplayName(world, classId) : "Unbound"
    var availablePoints = getAvailablePoints(player)
    var activeQuests = getPlayerQuestList(player, false)
    var completedQuests = getPlayerQuestList(player, true)

    gui.addTexturedRect(LAYER.BG_MAIN, SELF_TEXTURES.frame, 0, 0, SELF_GUI_WIDTH, SELF_GUI_HEIGHT)
    gui.addTexturedRect(LAYER.BG_HEADER, SELF_TEXTURES.base, 4, 4, SELF_GUI_WIDTH - 8, SELF_GUI_HEIGHT - 8)
    gui.addTexturedRect(LAYER.BG_FOOTER, SELF_TEXTURES.chrome, 4, 4, SELF_GUI_WIDTH - 8, 30)
    gui.addTexturedRect(4, SELF_TEXTURES.gold, 4, 4, SELF_GUI_WIDTH - 8, 2)
    gui.addTexturedRect(5, SELF_TEXTURES.gold, 4, 32, SELF_GUI_WIDTH - 8, 2)
    gui.addTexturedRect(6, SELF_TEXTURES.chrome, 4, 234, SELF_GUI_WIDTH - 8, 30)
    gui.addTexturedRect(7, SELF_TEXTURES.gold, 4, 234, SELF_GUI_WIDTH - 8, 2)

    addRpgPanel(gui, 20, 10, 40, 126, 186, SELF_TEXTURES.cyan)
    addRpgPanel(gui, 22, 142, 40, 208, 72, SELF_TEXTURES.gold)
    addRpgPanel(gui, 24, 142, 118, 208, 108, SELF_TEXTURES.cyan)
    gui.addTexturedRect(26, SELF_TEXTURES.chrome, 146, 122, 200, 18)
    gui.addTexturedRect(27, SELF_TEXTURES.base, 150, 91, 192, 8)
    var fillWidth = Math.floor(192 * expProgress / 100)
    if (fillWidth > 0) gui.addTexturedRect(28, SELF_TEXTURES.xp, 150, 121, fillWidth, 8)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§6§l✦ PLAYER MENU ✦", SelfGuiMath.centerX(160), 9, 160, 12)
    gui.addLabel(labelId++, "§f" + player.getDisplayName() + " §8• §7" + className, SelfGuiMath.centerX(220), 21, 220, 10)
    gui.addLabel(labelId++, "§b§lCHARACTER", 18, 46, 100, 12)
    gui.addLabel(labelId++, "§7Live player preview", 18, 59, 106, 10)
    try {
        gui.addEntityDisplay(SELF_ENTITY_DISPLAY_ID, 72, 195, player).setScale(1.55)
    } catch (entityDisplayError) {
        gui.addLabel(labelId++, "§8Preview unavailable", 22, 150, 102, 10)
    }

    gui.addLabel(labelId++, "§6§lLEVEL §e" + level, 152, 48, 92, 12)
    gui.addLabel(labelId++, "§7Class §f" + shortGuiText(className, 20), 152, 63, 184, 10)
    gui.addLabel(labelId++, "§b" + formatCompactExp(data.exp) + "§7 / §3" + formatCompactExp(expNeeded) + " EXP", 152, 76, 184, 10)
    gui.addLabel(labelId++, level >= CONFIG.maxLevel ? "§6§lMAXIMUM RANK" : "§8" + expProgress + "% TO NEXT LEVEL", 152, 102, 184, 10)

    gui.addLabel(labelId++, "§6§lQUICK ACCESS", 152, 126, 100, 12)
    gui.addLabel(labelId++, "§b" + availablePoints + " §7attribute point" + (availablePoints === 1 ? "" : "s") + " available", 152, 148, 184, 10)
    gui.addLabel(labelId++, "§e" + activeQuests.length + " §7active quest" + (activeQuests.length === 1 ? "" : "s"), 152, 166, 184, 10)
    gui.addLabel(labelId++, "§a" + completedQuests.length + " §7completed quest" + (completedQuests.length === 1 ? "" : "s"), 152, 184, 184, 10)
    gui.addLabel(labelId++, "§8Choose a section below.", 152, 207, 184, 10)

    gui.addButton(SELF_ATTRIBUTES_BUTTON, "§b§lATTR §8[§f" + availablePoints + "§8]", 8, 240, 72, 20)
    gui.addButton(SELF_SKILLS_BUTTON, "§d§lSKILLS", 84, 240, 64, 20)
    gui.addButton(SELF_QUESTS_BUTTON, "§e§lQUESTS §8[§f" + activeQuests.length + "§8]", 152, 240, 76, 20)
    gui.addButton(SELF_MAP_BUTTON, "§a§lMAP", 232, 240, 54, 20)
    gui.addButton(253, "§f§lCLOSE", 290, 240, 62, 20)

    showManagedGui(player, gui)
}

// Dedicated attribute allocation branch
function showSelfAttributesGuiNative(player) {
    var world = player.getWorld()
    loadConfigFromWorld(world)
    refreshStatKeys()
    var gui = API.createCustomGui(SELF_ATTRIBUTES_GUI_ID, SELF_GUI_WIDTH, SELF_GUI_HEIGHT, false, player)

    var data = getPlayerData(player)
    var level = data.level
    var exp = data.exp
    var expNeeded = getExpForLevel(level)
    var expProgress = Math.max(0, Math.min(100, Math.floor((exp / expNeeded) * 100)))
    var passiveHP = ATTR_CONFIG.passivePerLevel.health * (level - 1)
    var tempdata = player.getTempdata()
    var totalPending = getTotalPendingStatPoints(player)
    var pageData = getSelfStatPage(player)
    var visibleStatKeys = getSelfVisibleStatKeys(player)
    tempdata.put("selfVisibleStatIds", JSON.stringify(visibleStatKeys))
    var baseAvailable = getAvailablePoints(player)
    var availablePoints = baseAvailable - totalPending
    var hasUnsavedChanges = totalPending > 0
    var playerClassId = getPlayerClassId(player)
    var playerClassName = playerClassId ? getClassDisplayName(world, playerClassId) : "Unbound"

    gui.addTexturedRect(LAYER.BG_MAIN, SELF_TEXTURES.frame, 0, 0, SELF_GUI_WIDTH, SELF_GUI_HEIGHT)
    gui.addTexturedRect(LAYER.BG_HEADER, SELF_TEXTURES.base, 4, 4, SELF_GUI_WIDTH - 8, SELF_GUI_HEIGHT - 8)
    gui.addTexturedRect(LAYER.BG_FOOTER, SELF_TEXTURES.chrome, 4, SELF_LAYOUT.headerY, SELF_GUI_WIDTH - 8, SELF_LAYOUT.headerHeight)
    gui.addTexturedRect(4, SELF_TEXTURES.gold, 4, SELF_LAYOUT.headerY, SELF_GUI_WIDTH - 8, 2)
    gui.addTexturedRect(5, SELF_TEXTURES.gold, 4, SELF_LAYOUT.headerY + SELF_LAYOUT.headerHeight - 2, SELF_GUI_WIDTH - 8, 2)
    gui.addTexturedRect(6, SELF_TEXTURES.chrome, 4, SELF_LAYOUT.footerY, SELF_GUI_WIDTH - 8, SELF_LAYOUT.footerHeight)
    gui.addTexturedRect(7, SELF_TEXTURES.gold, 4, SELF_LAYOUT.footerY, SELF_GUI_WIDTH - 8, 2)

    gui.addTexturedRect(LAYER.BG_PANELS, SELF_TEXTURES.panel, SELF_LAYOUT.levelX, SELF_LAYOUT.summaryY, SELF_LAYOUT.levelWidth, SELF_LAYOUT.summaryHeight)
    gui.addTexturedRect(LAYER.BG_PANELS + 1, SELF_TEXTURES.gold, SELF_LAYOUT.levelX, SELF_LAYOUT.summaryY, 4, SELF_LAYOUT.summaryHeight)
    gui.addTexturedRect(LAYER.BG_PANELS + 2, SELF_TEXTURES.panel, SELF_LAYOUT.pointsX, SELF_LAYOUT.summaryY, SELF_LAYOUT.pointsWidth, SELF_LAYOUT.summaryHeight)
    gui.addTexturedRect(LAYER.BG_PANELS + 3, SELF_TEXTURES.cyan, SELF_LAYOUT.pointsX, SELF_LAYOUT.summaryY, 4, SELF_LAYOUT.summaryHeight)

    var xpBarWidth = 116
    var xpFillWidth = Math.floor(xpBarWidth * expProgress / 100)
    gui.addTexturedRect(LAYER.BG_PANELS + 4, SELF_TEXTURES.base, 18, 80, xpBarWidth, 8)
    if (xpFillWidth > 0) gui.addTexturedRect(LAYER.BG_PANELS + 5, SELF_TEXTURES.xp, 18, 80, xpFillWidth, 8)

    gui.addTexturedRect(LAYER.BG_PANELS + 6, SELF_TEXTURES.panel, 10, SELF_LAYOUT.statsY, SELF_GUI_WIDTH - 20, SELF_LAYOUT.statsHeight)
    gui.addTexturedRect(LAYER.BG_PANELS + 7, SELF_TEXTURES.chrome, 10, SELF_LAYOUT.statsY, SELF_GUI_WIDTH - 20, 18)
    gui.addTexturedRect(LAYER.BG_PANELS + 8, SELF_TEXTURES.gold, 10, SELF_LAYOUT.statsY + 17, SELF_GUI_WIDTH - 20, 2)

    var labelId = LAYER.CONTENT_LABELS

    gui.addLabel(labelId++, "§6§l✦ ATTRIBUTES ✦", SelfGuiMath.centerX(180), 8, 180, 12)
    gui.addLabel(labelId++, "§f" + player.getDisplayName() + " §8• §7" + playerClassName, SelfGuiMath.centerX(220), 20, 220, 10)
    if (hasUnsavedChanges) gui.addLabel(labelId++, "§c§lUNSAVED", 246, 245, 42, 10)

    gui.addLabel(labelId++, "§6§lLEVEL", 18, 43, 70, 12)
    gui.addLabel(labelId++, "§e§l" + level, 20, 57, 34, 18).setScale(1.5)
    gui.addLabel(labelId++, "§8ADVENTURER RANK", 55, 61, 78, 10)
    gui.addLabel(labelId++, "§7" + formatCompactExp(exp) + " / " + formatCompactExp(expNeeded) + " EXP §8(" + expProgress + "%)", 18, 90, 116, 10)
    var remainingExp = expNeeded - exp
    gui.addLabel(labelId++, level >= CONFIG.maxLevel ? "§6§lMAXIMUM RANK" : "§8" + formatCompactExp(remainingExp) + " EXP TO NEXT RANK", 18, 100, 116, 10)

    gui.addLabel(labelId++, "§b§lATTRIBUTE POINTS", 156, 43, 130, 12)
    var pointsColor = availablePoints > 0 ? "§b" : "§7"
    gui.addLabel(labelId++, pointsColor + "§l" + availablePoints, 158, 57, 34, 18).setScale(1.5)
    gui.addLabel(labelId++, "§8READY TO SPEND", 192, 61, 90, 10)
    gui.addLabel(labelId++, "§8Earned §f" + getTotalEarnedPoints(player) + " §8• Spent §f" + (getTotalSpentPoints(player) + totalPending), 156, 79, 184, 10)
    gui.addLabel(labelId++, "§8Passive vigor §a+" + passiveHP + " HP", 156, 96, 150, 10)

    gui.addLabel(labelId++, "§6§lATTRIBUTES", 18, 120, 90, 12)
    if (pageData.maxPage > 0) {
        gui.addLabel(labelId++, "§8" + STAT_KEYS.length + " total §7• §fPage " + (pageData.page + 1) + "/" + (pageData.maxPage + 1), 202, 120, 92, 10)
        gui.addButton(SELF_STAT_PREVIOUS_BUTTON, "§6<", 300, 116, 22, 18).setEnabled(pageData.page > 0)
        gui.addButton(SELF_STAT_NEXT_BUTTON, "§6>", 326, 116, 22, 18).setEnabled(pageData.page < pageData.maxPage)
    } else {
        gui.addLabel(labelId++, "§8" + STAT_KEYS.length + " attributes", 260, 120, 88, 10)
    }

    var accentTextures = [TEXTURES.strRow, TEXTURES.vitRow, TEXTURES.dexRow]

    for (var i = 0; i < visibleStatKeys.length; i++) {
        var statKey = visibleStatKeys[i]
        var stat = ATTR_CONFIG.stats[statKey]
        var savedPoints = getStatPoints(player, statKey)
        var pending = getPendingStatPoints(player, statKey)
        var classBase = getClassBaseStatPoints(player, statKey)
        var nodeBonus = getLearnedNodeStatValue(player, statKey, "statBonuses")
        var effectiveness = getStatEffectivenessMultiplier(player, statKey)
        var y = SelfGuiMath.rowY(i)
        var statOrderIndex = STAT_KEYS.indexOf(statKey)
        gui.addTexturedRect(LAYER.BG_ROW_BASE + i, i % 2 === 0 ? SELF_TEXTURES.row : SELF_TEXTURES.rowAlt, 12, y, 336, SELF_LAYOUT.rowHeight - 2)
        gui.addTexturedRect(LAYER.BG_ROW_ACCENT_BASE + i, accentTextures[statOrderIndex % accentTextures.length], 12, y, 4, SELF_LAYOUT.rowHeight - 2)

        gui.addLabel(labelId++, stat.icon || ("§7[" + statKey + "]"), 20, y + 5, 38, 12)
        gui.addLabel(labelId++, stat.color + "§l" + stat.name, 58, y + 2, 122, 12)
        var pointsText = "§7" + savedPoints + " pts"
        if (pending > 0) pointsText = "§7" + savedPoints + " pts §a+" + pending
        if (classBase || nodeBonus) pointsText += " §8(§f" + (savedPoints + classBase + nodeBonus) + " total§8)"
        gui.addLabel(labelId++, pointsText, 58, y + 12, 122, 10).setHoverText([
            "§fAllocated: §e" + savedPoints,
            "§fClass base: §d" + classBase,
            "§fLearned-node bonus: §b" + nodeBonus,
            "§fEffectiveness: §a" + Math.round(effectiveness * 10000) / 100 + "%"
        ])

        var effectText = ""
        var effectHover = ["§6§l" + stat.name, "§7" + (stat.description || "No description"), "", "§8Configured effects:"]
        for (var mcAttr in stat.affects) {
            if (stat.affects.hasOwnProperty(mcAttr)) {
                var previewValue = calculateMcAttributeWithPending(player, mcAttr)
                if (!effectText) effectText = mcAttr.indexOf("speed") !== -1
                    ? "§6◆ §f" + (previewValue * 100).toFixed(0) + "%"
                    : "§6◆ §f" + previewValue.toFixed(1)
                effectHover.push("§7" + mcAttr + " §8= §f" + previewValue.toFixed(3))
            }
        }
        if (!effectText) effectText = "§8No effect"
        var effectLabel = gui.addLabel(labelId++, effectText, 184, y + 5, 106, 12)
        if (effectHover.length > 0) effectLabel.setHoverText(effectHover)

        var minusId = LAYER.BUTTONS + 10 + i
        if (pending > 0) {
            gui.addButton(minusId, "§c§l-", 298, y + 1, 22, 18)
        } else {
            gui.addButton(minusId, "§8-", 298, y + 1, 22, 18).setEnabled(false)
        }

        var plusId = LAYER.BUTTONS + i
        if (availablePoints > 0) {
            gui.addButton(plusId, "§e§l+", 326, y + 1, 22, 18)
        } else {
            gui.addButton(plusId, "§8+", 326, y + 1, 22, 18).setEnabled(false)
        }
    }

    gui.addButton(250, "§7§lRESET", 10, 240, 58, 20)
    gui.addButton(251, "§b§lSYNC", 72, 240, 48, 20)
    if (hasUnsavedChanges) {
        gui.addButton(252, "§a§lAPPLY", 124, 240, 56, 20)
    } else {
        gui.addButton(252, "§8§lAPPLY", 124, 240, 56, 20).setEnabled(false)
    }
    if (hasUnsavedChanges) {
        gui.addButton(254, "§c§lUNDO", 184, 240, 58, 20)
    } else {
        gui.addButton(254, "§8§lUNDO", 184, 240, 58, 20).setEnabled(false)
    }
    gui.addButton(SELF_BACK_BUTTON, "§f§lBACK", 246, 240, 48, 20)
    gui.addButton(253, "§f§lCLOSE", 298, 240, 52, 20)

    showManagedGui(player, gui)
}

function showSelfQuestGuiNative(player) {
    var mode = getSelfQuestMode(player)
    var allQuests = getPlayerQuestList(player, mode === "COMPLETED")
    var maxPage = Math.max(0, Math.ceil(allQuests.length / SELF_QUEST_PAGE_SIZE) - 1)
    var page = player.getTempdata().has("selfQuestPage") ? Number(player.getTempdata().get("selfQuestPage")) : 0
    if (isNaN(page) || page < 0) page = 0
    if (page > maxPage) page = maxPage
    player.getTempdata().put("selfQuestPage", page)
    var pageStart = page * SELF_QUEST_PAGE_SIZE
    var quests = allQuests.slice(pageStart, pageStart + SELF_QUEST_PAGE_SIZE)
    var selectedIndex = player.getTempdata().has("selfQuestIndex")
        ? Number(player.getTempdata().get("selfQuestIndex")) : -1
    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= quests.length) selectedIndex = -1
    var gui = API.createCustomGui(SELF_QUEST_GUI_ID, SELF_GUI_WIDTH, SELF_GUI_HEIGHT, false, player)

    gui.addTexturedRect(LAYER.BG_MAIN, SELF_TEXTURES.frame, 0, 0, SELF_GUI_WIDTH, SELF_GUI_HEIGHT)
    gui.addTexturedRect(LAYER.BG_HEADER, SELF_TEXTURES.base, 4, 4, SELF_GUI_WIDTH - 8, SELF_GUI_HEIGHT - 8)
    gui.addTexturedRect(LAYER.BG_FOOTER, SELF_TEXTURES.chrome, 4, 4, SELF_GUI_WIDTH - 8, 30)
    gui.addTexturedRect(4, SELF_TEXTURES.gold, 4, 4, SELF_GUI_WIDTH - 8, 2)
    gui.addTexturedRect(5, SELF_TEXTURES.gold, 4, 32, SELF_GUI_WIDTH - 8, 2)
    gui.addTexturedRect(6, SELF_TEXTURES.chrome, 4, 234, SELF_GUI_WIDTH - 8, 30)
    gui.addTexturedRect(7, SELF_TEXTURES.gold, 4, 234, SELF_GUI_WIDTH - 8, 2)
    addRpgPanel(gui, 20, 10, 68, 158, 158, mode === "ACTIVE" ? SELF_TEXTURES.gold : SELF_TEXTURES.cyan)
    addRpgPanel(gui, 22, 174, 68, 176, 158, SELF_TEXTURES.cyan)

    var labelId = LAYER.CONTENT_LABELS
    gui.addLabel(labelId++, "§6§l✦ QUEST JOURNAL ✦", SelfGuiMath.centerX(180), 9, 180, 12)
    gui.addLabel(labelId++, "§7Track your current and completed adventures", SelfGuiMath.centerX(240), 21, 240, 10)
    gui.addButton(SELF_QUEST_ACTIVE_BUTTON, mode === "ACTIVE" ? "§e§lACTIVE" : "§7ACTIVE", 10, 42, 76, 20)
    gui.addButton(SELF_QUEST_COMPLETED_BUTTON, mode === "COMPLETED" ? "§b§lCOMPLETED" : "§7COMPLETED", 92, 42, 92, 20)
    gui.addButton(SELF_QUEST_PREVIOUS_BUTTON, "§6<", 292, 42, 26, 20).setEnabled(page > 0)
    gui.addButton(SELF_QUEST_NEXT_BUTTON, "§6>", 324, 42, 26, 20).setEnabled(page < maxPage)
    gui.addLabel(labelId++, "§6§l" + mode + " §8• §f" + allQuests.length, 18, 75, 92, 10)
    gui.addLabel(labelId++, "§7Page §f" + (page + 1) + "§7/§f" + (maxPage + 1), 110, 75, 50, 10)

    var names = []
    for (var i = 0; i < quests.length; i++) names.push(shortGuiText(String(quests[i].getName() || ("Quest #" + quests[i].getId())), 30))
    if (names.length === 0) names.push("(No " + mode.toLowerCase() + " quests)")
    var scroll = gui.addScroll(SELF_QUEST_SCROLL_ID, 18, 90, 142, 126, names)
    if (selectedIndex >= 0) scroll.setDefaultSelection(selectedIndex)

    if (selectedIndex >= 0) {
        var quest = quests[selectedIndex]
        gui.addLabel(labelId++, "§e§l" + shortGuiText(quest.getName(), 27), 184, 76, 156, 12).setHoverText("§f" + quest.getName())
        gui.addLabel(labelId++, "§8" + getQuestCategoryName(quest) + " §7• §8#" + quest.getId(), 184, 91, 156, 10)
        gui.addLabel(labelId++, mode === "COMPLETED" ? "§a§lCOMPLETED" : "§6§lIN PROGRESS", 184, 108, 156, 10)
        addWrappedGuiText(gui, labelId, mode === "COMPLETED" ? quest.getCompleteText() : quest.getLogText(), 184, 127, 156, 7, "§7")
    } else {
        gui.addLabel(labelId++, quests.length ? "§7Select a quest to inspect." : "§8Nothing here yet.", 184, 82, 156, 10)
    }

    gui.addButton(SELF_BACK_BUTTON, "§f§lBACK", 228, 240, 58, 20)
    gui.addButton(253, "§f§lCLOSE", 292, 240, 58, 20)
    showManagedGui(player, gui)
}

// Check if player is holding a Reset Stone (uses configured name)
function hasResetStone(player) {
    var heldItem = player.getMainhandItem()
    if (heldItem && !heldItem.isEmpty()) {
        if (heldItem.hasCustomName()) {
            var itemName = heldItem.getDisplayName()
            var requiredName = ATTR_CONFIG.resetItemName
            // Check for exact match or match without color codes
            var cleanRequired = requiredName.replace(/§./g, "")
            var cleanItem = itemName.replace(/§./g, "")
            if (itemName === requiredName || cleanItem === cleanRequired) {
                return true
            }
        }
    }
    return false
}

// Consume the Reset Stone from player's hand
function consumeResetStone(player) {
    var heldItem = player.getMainhandItem()
    if (heldItem && !heldItem.isEmpty()) {
        var stackSize = heldItem.getStackSize()
        if (stackSize > 1) {
            heldItem.setStackSize(stackSize - 1)
        } else {
            player.setMainhandItem(null)
        }
    }
}

// GUI button handler for /self
function _self_customGuiButton(e) {
    var player = e.player
    if (rejectFrozenCustomGuiMutation(player)) return
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()

    if (guiId === SELF_GUI_ID) {
        if (buttonId === SELF_ATTRIBUTES_BUTTON) {
            showSelfAttributesGui(player)
        } else if (buttonId === SELF_SKILLS_BUTTON) {
            showSelfSkillTreeGui(player)
        } else if (buttonId === SELF_QUESTS_BUTTON) {
            player.getTempdata().put("selfQuestMode", "ACTIVE")
            player.getTempdata().remove("selfQuestIndex")
            player.getTempdata().put("selfQuestPage", 0)
            showSelfQuestGui(player)
        } else if (buttonId === SELF_MAP_BUTTON) {
            openQuestMapHtml(player, false)
        } else if (buttonId === 253) {
            player.closeGui()
        }
        return
    }

    if (guiId === SELF_QUEST_GUI_ID) {
        if (buttonId === SELF_QUEST_ACTIVE_BUTTON || buttonId === SELF_QUEST_COMPLETED_BUTTON) {
            player.getTempdata().put("selfQuestMode", buttonId === SELF_QUEST_ACTIVE_BUTTON ? "ACTIVE" : "COMPLETED")
            player.getTempdata().remove("selfQuestIndex")
            player.getTempdata().put("selfQuestPage", 0)
            showSelfQuestGui(player)
        } else if (buttonId === SELF_QUEST_PREVIOUS_BUTTON || buttonId === SELF_QUEST_NEXT_BUTTON) {
            var page = player.getTempdata().has("selfQuestPage") ? Number(player.getTempdata().get("selfQuestPage")) : 0
            player.getTempdata().put("selfQuestPage", page + (buttonId === SELF_QUEST_PREVIOUS_BUTTON ? -1 : 1))
            player.getTempdata().remove("selfQuestIndex")
            showSelfQuestGui(player)
        } else if (buttonId === SELF_BACK_BUTTON) {
            showSelfGui(player)
        } else if (buttonId === 253) {
            player.closeGui()
        }
        return
    }

    if (guiId !== SELF_ATTRIBUTES_GUI_ID) return

    var tempdata = player.getTempdata()
    var visibleStatKeys = []
    if (tempdata.has("selfVisibleStatIds")) {
        visibleStatKeys = JSON.parse(String(tempdata.get("selfVisibleStatIds")))
    }

    if (buttonId >= LAYER.BUTTONS && buttonId < LAYER.BUTTONS + SELF_STAT_PAGE_SIZE) {
        var statIndex = buttonId - LAYER.BUTTONS
        var statKey = visibleStatKeys[statIndex]
        if (!statKey) return
        var availablePoints = getAvailablePoints(player) - getTotalPendingStatPoints(player)
        if (availablePoints > 0) {
            setPendingStatPoints(player, statKey, getPendingStatPoints(player, statKey) + 1)
            showSelfAttributesGui(player)
        } else {
            player.message("§c[Stats] No points available!")
        }
        return
    }
    
    if (buttonId >= LAYER.BUTTONS + 10 && buttonId < LAYER.BUTTONS + 10 + SELF_STAT_PAGE_SIZE) {
        var statIndex = buttonId - (LAYER.BUTTONS + 10)
        var statKey = visibleStatKeys[statIndex]
        if (!statKey) return
        var currentPending = getPendingStatPoints(player, statKey)
        if (currentPending > 0) {
            setPendingStatPoints(player, statKey, currentPending - 1)
            showSelfAttributesGui(player)
        }
        return
    }

    if (buttonId === SELF_STAT_PREVIOUS_BUTTON || buttonId === SELF_STAT_NEXT_BUTTON) {
        var pageData = getSelfStatPage(player)
        var pageChange = buttonId === SELF_STAT_PREVIOUS_BUTTON ? -1 : 1
        tempdata.put("selfStatPage", pageData.page + pageChange)
        showSelfAttributesGui(player)
        return
    }

    switch(buttonId) {
        case 250:
            if (!hasResetStone(player)) {
                player.message("§c[Stats] You need a " + ATTR_CONFIG.resetItemName + " §cin your main hand to reset stats!")
                return
            }
            consumeResetStone(player)
            resetAllStatPoints(player)
            clearPendingStatPoints(player)
            player.message("§a[Stats] All points reset! Item consumed.")
            showSelfAttributesGui(player)
            break
        case 251:
            var repairResult = syncPlayerSkills(player, true)
            if (repairResult && !repairResult.ok) {
                player.message("§c[Stats] Sync failed: " + repairResult.message)
                return
            }
            applyAllAttributes(player)
            player.message("§a[Stats] Synced!")
            showSelfAttributesGui(player)
            break
        case 252:
            loadConfigFromWorld(player.getWorld())
            var totalSaved = getTotalPendingStatPoints(player)
            var validPending = isFinite(totalSaved) && totalSaved >= 0
                && totalSaved <= getAvailablePoints(player)
            for (var pendingIndex = 0; pendingIndex < STAT_KEYS.length; pendingIndex++) {
                var pendingValue = getPendingStatPoints(player, STAT_KEYS[pendingIndex])
                if (!isFinite(pendingValue) || pendingValue < 0 || Math.floor(pendingValue) !== pendingValue) validPending = false
            }
            if (!validPending) {
                player.message("§c[Stats] Your available points changed. Adjust the pending points before applying.")
                showSelfAttributesGui(player)
                return
            }
            for (var i = 0; i < STAT_KEYS.length; i++) {
                var statKey = STAT_KEYS[i]
                var pending = getPendingStatPoints(player, statKey)
                if (pending > 0) {
                    var currentPoints = getStatPoints(player, statKey)
                    setStatPoints(player, statKey, currentPoints + pending)
                }
            }
            clearPendingStatPoints(player)
            applyAllAttributes(player)
            player.message("§a[Stats] Saved " + totalSaved + " point(s)!")
            showSelfAttributesGui(player)
            break
        case 253:
            clearPendingStatPoints(player)
            player.closeGui()
            break
        case 254:
            clearPendingStatPoints(player)
            player.message("§7[Stats] Changes discarded.")
            showSelfAttributesGui(player)
            break
        case SELF_BACK_BUTTON:
            clearPendingStatPoints(player)
            showSelfGui(player)
            break
    }
}

function _self_customGuiScroll(e) {
    if (e.gui.getID() !== SELF_QUEST_GUI_ID || e.scrollId !== SELF_QUEST_SCROLL_ID) return
    var page = e.player.getTempdata().has("selfQuestPage") ? Number(e.player.getTempdata().get("selfQuestPage")) : 0
    var allQuests = getPlayerQuestList(e.player, getSelfQuestMode(e.player) === "COMPLETED")
    var quests = allQuests.slice(page * SELF_QUEST_PAGE_SIZE, (page + 1) * SELF_QUEST_PAGE_SIZE)
    if (e.scrollIndex < 0 || e.scrollIndex >= quests.length) return
    e.player.getTempdata().put("selfQuestIndex", e.scrollIndex)
    showSelfQuestGui(e.player)
}

function _self_customGuiClosed(e) {
    clearPendingStatPoints(e.player)
    e.player.getTempdata().remove("selfVisibleStatIds")
    e.player.getTempdata().remove("selfStatPage")
    e.player.getTempdata().remove("selfQuestMode")
    e.player.getTempdata().remove("selfQuestIndex")
    e.player.getTempdata().remove("selfQuestPage")
}

var SELF_SKILL_WIDTH = 480
var SELF_SKILL_HEIGHT = 320
var SELF_SKILL_HTML_FILE = "self_skill_tree.html"
var SELF_SKILL_HTML_SESSION_KEY = "admSelfSkillHtmlOpen"
var SELF_SKILL_HTML_VIEW_KEY = "admSelfSkillHtmlView"
var SELF_SKILL_HTML_REBIND_KEY = "admSelfSkillHtmlRebinding"
var SELF_SKILL_IDS = {
    SCROLL_LIBRARY: 151,
    BTN_LEARN: 270,
    BTN_SPELLS: 271,
    BTN_EPIC: 272,
    BTN_BACK: 273,
    BTN_PREV: 274,
    BTN_NEXT: 275,
    BTN_ASSIGN: 276,
    BTN_CLEAR: 277,
    SPELL_SLOT_BASE: 300,
    EPIC_SLOT_BASE: 340,
    TREE_NODE_BASE: 400
}

function managedUpgradeSnapshotMap(player, classId) {
    var classData = getClassById(player.getWorld(), classId)
    var map = {}
    var nodes = classData && Array.isArray(classData.skillNodes) ? classData.skillNodes : []
    for (var i = 0; i < nodes.length; i++) {
        var base = nodes[i]
        if (base.type === "MILESTONE") map[String(base.id || "")] = {
            statNode: isClassStatNode(base), statIconIndex: normalizeStatIconIndex(base.statIconIndex), title: base.title
        }
        var rows = classSkillUpgradeSchedule(base)
        if (!rows.length) continue
        var firstId = String(rows[0].id || "")
        if (!firstId) continue
        var baseId = String(base.id || "")
        map[baseId] = { baseId: baseId, seriesId: baseId, resetNodeId: "", title: base.title, rank: Number(base.rank || 1),
            statNode: isClassStatNode(base), statIconIndex: normalizeStatIconIndex(base.statIconIndex) }
        for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            var rowId = String(rows[rowIndex].id || "")
            if (!rowId) continue
            map[rowId] = { baseId: baseId, seriesId: baseId, resetNodeId: firstId, title: base.title, rank: Number(rows[rowIndex].rank),
                statNode: isClassStatNode(base), statIconIndex: normalizeStatIconIndex(base.statIconIndex) }
        }
    }
    return map
}

function decorateManagedUpgradeSnapshot(player, classId, snapshot) {
    var map = managedUpgradeSnapshotMap(player, classId)
    for (var i = 0; snapshot && snapshot.nodes && i < snapshot.nodes.length; i++) {
        var node = snapshot.nodes[i]
        var metadata = map[String(node.id || "")]
        if (!metadata) continue
        if (metadata.baseId) {
            node.rankSeriesId = metadata.seriesId
            node.managedUpgradeBaseId = metadata.baseId
        }
        node.statNode = metadata.statNode === true
        if (metadata.rank) node.rank = metadata.rank
        node.statIconIndex = normalizeStatIconIndex(metadata.statIconIndex)
        if (metadata.title) node.title = String(metadata.title)
        if (metadata.resetNodeId) node.resetNodeId = metadata.resetNodeId
    }
    return snapshot
}

function getSelfSkillSnapshot(player) {
    var classId = getPlayerClassId(player)
    if (!classId) return { ok: false, message: "Choose a class first." }
    var result = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.snapshot(player.getMCEntity(), classId, getPlayerData(player).level)
    })
    if (result.ok) result = applyLearnedWithNodeGrants(player, classId, getPlayerData(player).level, result)
    if (result.ok) result = decorateManagedUpgradeSnapshot(player, classId, result)
    if (result.ok) result = decorateSkillSnapshotEconomy(player, result)
    if (result.ok) cachePlayerSkillSnapshot(player, result)
    return result
}

function isLearnedWithNode(player, classId, nodeId) {
    var definitions = getSelfSkillVisibilityDefinitions(player, classId)
    return !!(definitions[nodeId] && definitions[nodeId].learnedWithNode)
}

function getSnapshotNode(snapshot, nodeId) {
    if (!snapshot || !snapshot.nodes) return null
    for (var i = 0; i < snapshot.nodes.length; i++) {
        if (snapshot.nodes[i].id === nodeId) return snapshot.nodes[i]
    }
    return null
}

function sortedSnapshotNodes(snapshot, type, learnedOnly) {
    var nodes = []
    for (var i = 0; snapshot.nodes && i < snapshot.nodes.length; i++) {
        var node = snapshot.nodes[i]
        if (type && node.type !== type) continue
        if (learnedOnly && (!node.learned || node.replaced === true)) continue
        nodes.push(node)
    }
    nodes.sort(function(left, right) {
        var levelDifference = Number(left.requiredLevel) - Number(right.requiredLevel)
        if (levelDifference !== 0) return levelDifference
        return String(left.title).toLowerCase().localeCompare(String(right.title).toLowerCase())
    })
    return nodes
}

function rememberSelfSkillSnapshot(player, snapshot) {
    player.getTempdata().put("admSelfSkillSnapshot", JSON.stringify(snapshot))
    cachePlayerSkillSnapshot(player, snapshot)
}

function calculateSkillNodeDepths(nodes) {
    var byId = {}
    var memo = {}
    for (var i = 0; i < nodes.length; i++) byId[nodes[i].id] = nodes[i]
    function depth(node, active) {
        if (memo.hasOwnProperty(node.id)) return memo[node.id]
        if (active[node.id]) return 0
        active[node.id] = true
        var value = 0
        var prerequisites = node.prerequisites || []
        for (var index = 0; index < prerequisites.length; index++) {
            var parent = byId[prerequisites[index]]
            if (parent) value = Math.max(value, depth(parent, active) + 1)
        }
        delete active[node.id]
        memo[node.id] = value
        return value
    }
    for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) depth(nodes[nodeIndex], {})
    return memo
}

function buildSkillTreePages(nodes, depths) {
    var groups = {}
    var maximumDepth = 0
    for (var i = 0; i < nodes.length; i++) {
        var nodeDepth = Number(depths[nodes[i].id] || 0)
        if (!groups[nodeDepth]) groups[nodeDepth] = []
        groups[nodeDepth].push(nodes[i])
        maximumDepth = Math.max(maximumDepth, nodeDepth)
    }
    for (var key in groups) {
        if (!groups.hasOwnProperty(key)) continue
        groups[key].sort(function(left, right) {
            var levelDifference = Number(left.requiredLevel || 1) - Number(right.requiredLevel || 1)
            if (levelDifference !== 0) return levelDifference
            return String(left.title).toLowerCase().localeCompare(String(right.title).toLowerCase())
        })
    }
    var pages = []
    for (var depthStart = 0; depthStart <= maximumDepth; depthStart += 3) {
        var largest = 0
        for (var column = 0; column < 3; column++) largest = Math.max(largest, (groups[depthStart + column] || []).length)
        var rowPages = Math.max(1, Math.ceil(largest / 5))
        for (var rowPage = 0; rowPage < rowPages; rowPage++) {
            pages.push({ depthStart: depthStart, rowOffset: rowPage * 5, groups: groups })
        }
    }
    if (pages.length === 0) pages.push({ depthStart: 0, rowOffset: 0, groups: groups })
    return pages
}

function selfSkillNodeState(node) {
    if (node.learned) return { color: "§a", mark: "✓", text: "§a§lLEARNED" }
    if (node.replaced) return { color: "§5", mark: "R", text: "§dReplaced by an upgraded skill" }
    if (node.blocked) return { color: "§4", mark: "×", text: "§cBlocked by another route" }
    if (!node.levelReady) return { color: "§8", mark: "L" + node.requiredLevel, text: "§cRequires level " + node.requiredLevel }
    if (!node.prerequisitesReady) return { color: "§6", mark: "◆", text: "§6Prerequisites locked" }
    if (!node.itemReady) return { color: "§e", mark: "▣", text: "§eRequired item missing" }
    return { color: "§b", mark: "+", text: "§bReady to learn" }
}

function selfSkillTypeMark(node) {
    return node.type === "EPIC_FIGHT" ? "◆" : node.type === "MILESTONE" ? "◈" : "✦"
}

function getSnapshotNodeTitles(snapshot, nodeIds) {
    var titles = []
    for (var i = 0; nodeIds && i < nodeIds.length; i++) {
        var node = getSnapshotNode(snapshot, nodeIds[i])
        titles.push(node ? node.title : nodeIds[i])
    }
    return titles
}

function getSnapshotExclusionIds(snapshot, node) {
    var ids = (node && node.blockedNodes ? node.blockedNodes : []).slice()
    for (var i = 0; snapshot && snapshot.nodes && i < snapshot.nodes.length; i++) {
        var candidate = snapshot.nodes[i]
        if ((candidate.blockedNodes || []).indexOf(node.id) >= 0 && ids.indexOf(candidate.id) < 0) ids.push(candidate.id)
    }
    return ids
}

function isSnapshotNodeVisible(snapshot, node, memo, active) {
    if (node.learned) return true
    if (memo.hasOwnProperty(node.id)) return memo[node.id]
    if (node.blocked || active[node.id]) return false
    active[node.id] = true
    var prerequisites = node.prerequisites || []
    var any = String(node.prerequisiteMode || "ALL") === "ANY"
    var ordinary = 0
    var passing = 0
    var mandatory = true
    for (var i = 0; i < prerequisites.length; i++) {
        var prerequisite = getSnapshotNode(snapshot, prerequisites[i])
        var visible = !prerequisite || isSnapshotNodeVisible(snapshot, prerequisite, memo, active)
        if (prerequisites[i] === node.upgradeFrom || prerequisites[i] === node.learnedWithNode) {
            if (!visible) mandatory = false
        } else {
            ordinary++
            if (visible) passing++
        }
    }
    delete active[node.id]
    memo[node.id] = mandatory && (any ? ordinary === 0 || passing > 0 : passing === ordinary)
    return memo[node.id]
}

function isSelfSkillNodeConcealed(node) {
    return !node.learned && (!node.levelReady || !node.prerequisitesReady)
}

function getSelfSkillVisibilityDefinitions(player, classId) {
    var classData = getClassById(player.getWorld(), classId)
    var definitions = {}
    var nodes = classData && Array.isArray(classData.skillNodes) ? classData.skillNodes : []
    for (var i = 0; i < nodes.length; i++) {
        var base = nodes[i]
        definitions[String(base.id || "")] = base
        var rows = classSkillUpgradeSchedule(base)
        var previousId = String(base.id || "")
        for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            var row = rows[rowIndex]
            var generated = JSON.parse(JSON.stringify(base))
            generated.id = String(row.id || "")
            generated.rank = row.rank
            generated.requiredLevel = row.requiredLevel
            generated.statNode = isClassStatNode(base)
            generated.statIconIndex = normalizeStatIconIndex(base.statIconIndex)
            generated.prerequisites = [previousId]
            generated.upgradeFrom = previousId
            generated.rankSeriesId = String(base.id || "")
            generated.requiredItemSnbt = row.requiredItemSnbt
            generated.consumeLearnItem = row.consumeLearnItem !== false
            generated.prelearned = false
            generated.learnedWithNode = ""
            generated.choiceGroupId = ""
            generated.blockedNodes = []
            if (generated.statNode) {
                generated.statBonuses = row.statBonuses === undefined
                    ? JSON.parse(JSON.stringify(base.statBonuses || {}))
                    : JSON.parse(JSON.stringify(row.statBonuses || {}))
                generated.statMultiplierBonuses = row.statMultiplierBonuses === undefined
                    ? JSON.parse(JSON.stringify(base.statMultiplierBonuses || {}))
                    : JSON.parse(JSON.stringify(row.statMultiplierBonuses || {}))
                generated.statMultiplierOverrides = JSON.parse(JSON.stringify(base.statMultiplierOverrides || {}))
            } else {
                generated.statBonuses = {}
                generated.statMultiplierBonuses = {}
                generated.statMultiplierOverrides = {}
            }
            generated.canUnlearn = true
            generated.unlearnItemSnbt = ""
            generated.consumeUnlearnItem = false
            definitions[generated.id] = generated
            previousId = generated.id
        }
    }
    return definitions
}

function getSelfSkillConditionalVisibility(snapshot, definition) {
    var rules = normalizeSkillVisibilityRules(definition && definition.visibilityRules)
    for (var i = 0; i < rules.length; i++) {
        var target = getSnapshotNode(snapshot, rules[i].nodeId)
        var hasNode = !!(target && target.learned)
        if ((rules[i].condition === "HAS_NODE" && hasNode) ||
            (rules[i].condition === "NOT_HAS_NODE" && !hasNode)) return rules[i].mode
    }
    return ""
}

function getSelfSkillNodeVisibility(player, node, definition, snapshot) {
    var conditional = getSelfSkillConditionalVisibility(snapshot, definition)
    if (conditional) return conditional
    var fallbackBefore = getLockedSkillVisibilityMode(player.getWorld())
    if (node.learned) return normalizeSkillVisibility(definition && definition.visibilityWhenLearned, "SHOW")
    if (node.levelReady && node.prerequisitesReady) {
        return normalizeSkillVisibility(definition && definition.visibilityWhenReady, "SHOW")
    }
    return normalizeSkillVisibility(definition && definition.visibilityBeforeRequirements, fallbackBefore)
}

function selfSkillPublicRelations(ids, publicIds) {
    var result = []
    for (var i = 0; ids && i < ids.length; i++) {
        var publicId = publicIds[String(ids[i])]
        if (publicId && result.indexOf(publicId) < 0) result.push(publicId)
    }
    return result
}

function applySelfSkillHtmlPosition(encoded, position) {
    if (position && isClassSkillTreeCoordinate(position.x) && isClassSkillTreeCoordinate(position.y)) {
        encoded.treeX = Number(position.x)
        encoded.treeY = Number(position.y)
    }
    return encoded
}

function selfSkillHtmlNode(snapshot, node, publicIds, concealed, definition, position) {
    var publicId = publicIds[node.id]
    if (concealed) {
        return applySelfSkillHtmlPosition({
            id: publicId,
            title: "???",
            type: "LOCKED",
            statNode: false,
            statIconIndex: 0,
            icon: "",
            concealedPath: node.type === "MILESTONE" && !isClassStatNode(node) || !!node.choiceGroupId,
            registryId: "",
            requiredLevel: 0,
            rank: 0,
            prerequisites: selfSkillPublicRelations(node.prerequisites, publicIds),
            upgradeFrom: publicIds[String(node.upgradeFrom || "")] || "",
            blockedNodes: [],
            learned: false,
            replaced: false,
            replacedBy: "",
            learnable: false,
            unlearnable: false,
            concealed: true
        }, position)
    }
    var encoded = applySelfSkillHtmlPosition({
        id: publicId,
        title: String(node.title || node.id || "Untitled"),
        description: String(node.description || ""),
        type: String(node.type || "MILESTONE"),
        statNode: isClassStatNode(node),
        statIconIndex: normalizeStatIconIndex(node.statIconIndex),
        icon: String(node.icon || ""),
        registryId: String(node.registryId || ""),
        requiredLevel: Number(node.requiredLevel || 1),
        rank: Number(node.rank || 1),
        prerequisites: selfSkillPublicRelations(node.prerequisites, publicIds),
        upgradeFrom: publicIds[String(node.upgradeFrom || "")] || "",
        choiceGroupId: String(node.choiceGroupId || ""),
        rankSeriesId: String(node.rankSeriesId || ""),
        managedUpgradeBaseId: publicIds[String(node.managedUpgradeBaseId || "")] || "",
        resetNodeId: publicIds[String(node.resetNodeId || "")] || "",
        prerequisiteMode: String(node.prerequisiteMode || "ALL"),
        learnedWithNode: publicIds[String(node.learnedWithNode || "")] || "",
        blockedNodes: selfSkillPublicRelations(getSnapshotExclusionIds(snapshot, node), publicIds),
        blockedBy: selfSkillPublicRelations(node.blockedBy, publicIds),
        unlearnBlockedBy: selfSkillPublicRelations(node.unlearnBlockedBy, publicIds),
        epicSlot: String(node.epicSlot || ""),
        prelearned: node.prelearned === true,
        hasItemCost: !!node.requiredItemSnbt,
        requiredItemSnbt: String(node.requiredItemSnbt || definition && definition.requiredItemSnbt || ""),
        unlearnItemSnbt: String(node.unlearnItemSnbt || definition && definition.unlearnItemSnbt || ""),
        consumeLearnItem: node.consumeLearnItem !== false,
        itemReady: node.itemReady === true,
        canUnlearn: node.canUnlearn === true,
        hasUnlearnCost: !!node.unlearnItemSnbt,
        consumeUnlearnItem: node.consumeUnlearnItem !== false,
        unlearnItemReady: node.unlearnItemReady === true,
        learned: node.learned === true,
        replaced: node.replaced === true,
        replacedBy: publicIds[String(node.replacedBy || "")] || "",
        levelReady: node.levelReady === true,
        prerequisitesReady: node.prerequisitesReady === true,
        blocked: node.blocked === true,
        learnable: node.learnable === true,
        unlearnable: node.unlearnable === true,
        removeUpgradeSource: node.removeUpgradeSource === true,
        statBonuses: node.statBonuses || {},
        statMultiplierBonuses: node.statMultiplierBonuses || {},
        statMultiplierOverrides: node.statMultiplierOverrides || {},
        concealed: false
    }, position)
    if (node.type === "EPIC_FIGHT") copyEpicSkillMetadata(node, encoded)
    return encoded
}

function buildSelfSkillTreeHtmlPayload(player, message, ok) {
    var snapshot = getSelfSkillSnapshot(player)
    if (!snapshot.ok) {
        return { ok: false, message: String(snapshot.message || "Skill tree unavailable"), nodes: [] }
    }
    rememberSelfSkillSnapshot(player, snapshot)
    var allNodes = sortedSnapshotNodes(snapshot, "", false)
    var included = []
    var concealedById = {}
    var definitions = getSelfSkillVisibilityDefinitions(player, snapshot.classId)
    var classData = getClassById(player.getWorld(), snapshot.classId)
    var treePositions = resolveClassSkillTreePositions(classData && classData.skillNodes)
    var routeVisibility = {}
    for (var i = 0; i < allNodes.length; i++) {
        var node = allNodes[i]
        var definition = definitions[node.id]
        var conditionalVisibility = getSelfSkillConditionalVisibility(snapshot, definition)
        if (!isSnapshotNodeVisible(snapshot, node, routeVisibility, {}) && !conditionalVisibility) continue
        var visibility = conditionalVisibility || getSelfSkillNodeVisibility(player, node, definition, snapshot)
        if (visibility === "HIDE") continue
        if (visibility === "OBFUSCATE" && node.managedUpgradeBaseId && node.id !== node.managedUpgradeBaseId && !node.learned) continue
        var concealed = visibility === "OBFUSCATE"
        included.push(node)
        concealedById[node.id] = concealed
    }
    var learnedUpgradeFamilies = {}
    for (var learnedIndex = 0; learnedIndex < included.length; learnedIndex++) {
        var learnedNode = included[learnedIndex]
        var familyId = String(learnedNode.managedUpgradeBaseId || "")
        if (!familyId || !learnedNode.learned || concealedById[learnedNode.id]) continue
        learnedUpgradeFamilies[familyId] = Math.max(learnedUpgradeFamilies[familyId] || 0, Number(learnedNode.rank || 1))
    }
    for (var learnedFamilyId in learnedUpgradeFamilies) {
        var nextUpgrade = null
        for (var upgradeIndex = 0; upgradeIndex < allNodes.length; upgradeIndex++) {
            var candidate = allNodes[upgradeIndex]
            if (candidate.managedUpgradeBaseId !== learnedFamilyId || candidate.learned || candidate.replaced) continue
            if (Number(candidate.rank) <= learnedUpgradeFamilies[learnedFamilyId]) continue
            if (!nextUpgrade || Number(candidate.rank) < Number(nextUpgrade.rank)) nextUpgrade = candidate
        }
        if (nextUpgrade) {
            if (concealedById[nextUpgrade.id] === undefined) included.push(nextUpgrade)
            concealedById[nextUpgrade.id] = false
        }
    }
    var publicIds = {}
    var hiddenIndex = 1
    for (var publicIndex = 0; publicIndex < included.length; publicIndex++) {
        var includedNode = included[publicIndex]
        publicIds[includedNode.id] = concealedById[includedNode.id]
            ? "locked_" + hiddenIndex++ : includedNode.id
    }
    var encoded = []
    var visibleIronSpells = []
    var visibleEpicSkills = []
    for (var encodedIndex = 0; encodedIndex < included.length; encodedIndex++) {
        var encodedNode = included[encodedIndex]
        var encodedHtmlNode = selfSkillHtmlNode(snapshot, encodedNode, publicIds, concealedById[encodedNode.id], definitions[encodedNode.id], treePositions[encodedNode.id])
        encoded.push(encodedHtmlNode)
        if (!concealedById[encodedNode.id] && encodedNode.type === "IRON_SPELL") visibleIronSpells.push(encodedNode)
        if (!concealedById[encodedNode.id] && encodedNode.type === "EPIC_FIGHT") visibleEpicSkills.push(encodedNode)
    }
    var selfSpellIcons = getSelfSpellIconMap(player, visibleIronSpells, snapshot.spellLoadout)
    var selfEpicIcons = getEpicSkillIconMap(visibleEpicSkills)
    for (var encodedIconIndex = 0; encodedIconIndex < encoded.length; encodedIconIndex++) {
        if (encoded[encodedIconIndex].type === "IRON_SPELL") {
            encoded[encodedIconIndex].icon = selfSpellIcons[encoded[encodedIconIndex].registryId] || ""
        } else if (encoded[encodedIconIndex].type === "EPIC_FIGHT") {
            encoded[encodedIconIndex].icon = selfEpicIcons[encoded[encodedIconIndex].registryId] || ""
        }
    }
    var className = getClassDisplayName(player.getWorld(), snapshot.classId)
    var rawGroups = classData && Array.isArray(classData.choiceGroups) ? classData.choiceGroups : (snapshot.choiceGroups || [])
    var groups = []
    for (var groupIndex = 0; groupIndex < rawGroups.length; groupIndex++) {
        var group = rawGroups[groupIndex]
        var visibleCount = 0
        var learnedCount = 0
        for (var memberIndex = 0; memberIndex < included.length; memberIndex++) {
            var member = included[memberIndex]
            if (String(member.choiceGroupId || "") !== String(group.id || "") || concealedById[member.id]) continue
            visibleCount++
            if (member.learned) learnedCount++
        }
        if (visibleCount) groups.push({ id: String(group.id || ""), title: String(group.title || group.id || "Path"),
            requiredLevel: Number(group.requiredLevel || 1), maxChoices: Number(group.maxChoices || 0), selectedCount: learnedCount })
    }
    return {
        ok: ok !== false,
        message: String(message || ""),
        view: "TREE",
        classId: String(snapshot.classId || ""),
        className: String(className || snapshot.classId || "Class"),
        level: Number(snapshot.level || 1),
        spiritBalance: Number(snapshot.spiritBalance || 0),
        spirit: Number(snapshot.spiritBalance || 0),
        moneyBalance: getNormalMoneyBalance(player),
        money: getNormalMoneyBalance(player),
        currency: getCurrencyConfig(player.getWorld()),
        permissionLabels: getPermissionCatalog(player.getWorld()),
        visibilityMode: "PER_NODE",
        ironAvailable: snapshot.ironAvailable === true,
        epicAvailable: snapshot.epicAvailable === true,
        nodes: encoded,
        choiceGroups: groups,
        spellIcons: selfSpellIcons,
        costItems: describeSkillCostItems(player.getWorld(), {nodes: encoded}),
        passiveIconNames: PASSIVE_ICON_NAMES.slice()
    }
}

function pushSelfSkillTreeHtml(player, message, ok) {
    var bridge = cnpcext.getClientBridge(player.getMCEntity())
    sendSkillHtmlPayload(bridge, "self_skill_tree", buildSelfSkillTreeHtmlPayload(player, message, ok))
}

function encodeSelfSkillHtmlPayload(payload) {
    // Nashorn does not escape lone surrogates. ASCII escapes also make chunk boundaries UTF-8 safe.
    var encoded = JSON.stringify(payload).replace(/[\uD800-\uDFFF]/g, function(character) {
        return "\\u" + ("0000" + character.charCodeAt(0).toString(16)).slice(-4)
    })
    if (encoded.length <= SKILL_HTML_MAX_CHARS) return encoded
    return JSON.stringify({ preserveState: true, ok: false, view: payload.view || "TREE", nodes: [],
        message: "This tree exceeds the GUI data limit. Reduce oversized node data and reopen the editor." })
}

function describeSkillCostItems(world, payload) {
    var items = skillCostOverlayItems(payload)
    for (var i = 0; i < items.length; i++) {
        var stack = createClassItemFromSnbt(world, items[i].nbt)
        if (stack && !stack.isEmpty()) {
            items[i].name = String(stack.getDisplayName())
            items[i].count = Number(stack.getStackSize())
        }
    }
    return items
}

function skillCostOverlayItems(payload) {
    var items = [], seen = {}
    function add(snbt) {
        snbt = String(snbt || "")
        if (!snbt || seen["$" + snbt]) return
        seen["$" + snbt] = true
        items.push({ slot: items.length, nbt: snbt })
    }
    function visit(node) {
        if (!node || node.concealed) return
        add(node.requiredItemSnbt)
        add(node.unlearnItemSnbt)
        var rows = node.upgradeSchedule || []
        for (var i = 0; i < rows.length; i++) add(rows[i].requiredItemSnbt)
    }
    var nodes = payload.nodes || []
    for (var i = 0; i < nodes.length; i++) visit(nodes[i])
    visit(payload.editorDraft)
    return items
}

function skillHtmlInitialPayload(payload, session, world) {
    var encoded = encodeSelfSkillHtmlPayload(payload)
    var initial = encoded.length <= 6000 ? JSON.parse(encoded) : {
        ok: true, view: payload.view || "TREE", nodes: [], message: "Loading..."
    }
    var costItems = payload.costItems || skillCostOverlayItems(payload)
    initial.overlayItems = []
    for (var i = 0; i < costItems.length; i++) {
        var preview = createClassItemFromSnbt(world, costItems[i].nbt)
        if (!preview || preview.isEmpty()) continue
        preview.setStackSize(1)
        initial.overlayItems.push({slot: costItems[i].slot, nbt: String(preview.getItemNbt().toJsonString())})
    }
    initial.transportSession = session || ""
    return encodeSelfSkillHtmlPayload(initial)
}

function sendSkillHtmlPayload(bridge, channel, payload) {
    var encoded = encodeSelfSkillHtmlPayload(payload)
    if (encoded.length <= 6000) {
        bridge.sendToBrowser(channel + "_update", encoded)
        return
    }
    var batchId = String(Date.now()) + ":" + String(++skillHtmlBatchSequence)
    var total = Math.ceil(encoded.length / SKILL_HTML_CHUNK_CHARS)
    for (var index = 0; index < total; index++) {
        bridge.sendToBrowser(channel + "_chunk", JSON.stringify({
            batchId: batchId, index: index, total: total,
            data: encoded.substring(index * SKILL_HTML_CHUNK_CHARS, (index + 1) * SKILL_HTML_CHUNK_CHARS)
        }))
    }
}

function receiveClassSkillHtmlRequest(player, packet) {
    var temp = player.getTempdata()
    var session = temp.has(CLASS_SKILL_HTML_SESSION_KEY) ? String(temp.get(CLASS_SKILL_HTML_SESSION_KEY)) : ""
    var now = Date.now()
    if (!isAdmin(player) || isArvanPersistenceFrozen(player) || !session ||
        String(temp.get(HTML_ACTIVE_SESSION_KEY) || "") !== "CLASS" || packet.session !== session) {
        skillHtmlRequestParts = null
        return null
    }
    if (typeof packet.batchId !== "string" || packet.batchId.length < 1 || packet.batchId.length > 80 ||
        typeof packet.index !== "number" || packet.index !== Math.floor(packet.index) || packet.index < 0 ||
        typeof packet.total !== "number" || packet.total !== Math.floor(packet.total) || packet.total < 1 || packet.total > 350 ||
        packet.index >= packet.total || typeof packet.data !== "string" || packet.data.length > SKILL_HTML_CHUNK_CHARS) {
        skillHtmlRequestParts = null
        return null
    }
    if (packet.index === 0) skillHtmlRequestParts = {
        session: session, batchId: packet.batchId, total: packet.total, next: 0, size: 0, started: now, parts: []
    }
    var pending = skillHtmlRequestParts
    if (!pending || pending.session !== session || pending.batchId !== packet.batchId || pending.total !== packet.total ||
        pending.next !== packet.index || now - pending.started > 15000 || pending.size + packet.data.length > SKILL_HTML_MAX_CHARS) {
        skillHtmlRequestParts = null
        return null
    }
    pending.parts.push(packet.data)
    pending.size += packet.data.length
    pending.next++
    if (pending.next !== pending.total) return null
    skillHtmlRequestParts = null
    try {
        var request = JSON.parse(pending.parts.join(""))
        if (!request || typeof request !== "object" || Array.isArray(request) || request.action === "request_chunk") return null
        return request
    } catch (ignored) {
        return null
    }
}

function getSelfSpellIconMap(player, spells, loadout) {
    var registryIds = []
    for (var slot = 0; loadout && slot < loadout.length && registryIds.length < 128; slot++) {
        var nodeId = String(loadout[slot] || "")
        for (var match = 0; nodeId && match < spells.length; match++) {
            if (String(spells[match].id || "") !== nodeId) continue
            var assignedRegistryId = String(spells[match].registryId || "")
            if (assignedRegistryId && registryIds.indexOf(assignedRegistryId) < 0) registryIds.push(assignedRegistryId)
            break
        }
    }
    for (var i = 0; i < spells.length; i++) {
        var registryId = String(spells[i].registryId || "")
        if (registryId && registryIds.indexOf(registryId) < 0 && registryIds.length < 128) registryIds.push(registryId)
    }
    if (!registryIds.length) return {}
    var result = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.ironIcons(player.getMCEntity(), JSON.stringify(registryIds))
    })
    return result.ok && result.icons && typeof result.icons === "object" ? result.icons : {}
}

function buildSelfSkillLoadoutHtmlPayload(player, view, message, ok, includeIcons) {
    var snapshot = getSelfSkillSnapshot(player)
    if (!snapshot.ok) {
        return { ok: false, message: String(snapshot.message || "Loadout unavailable"), view: view, nodes: [] }
    }
    rememberSelfSkillSnapshot(player, snapshot)
    var visibilityDefinitions = getSelfSkillVisibilityDefinitions(player, snapshot.classId)
    var payload = {
        ok: ok !== false,
        message: String(message || ""),
        view: view,
        classId: String(snapshot.classId || ""),
        className: String(getClassDisplayName(player.getWorld(), snapshot.classId) || snapshot.classId || "Class"),
        level: Number(snapshot.level || 1),
        visibilityMode: "PER_NODE",
        ironAvailable: snapshot.ironAvailable === true,
        epicAvailable: snapshot.epicAvailable === true,
        nodes: [],
        passiveIconNames: PASSIVE_ICON_NAMES.slice()
    }
    if (view === "SPELLS") {
        var spells = sortedSnapshotNodes(snapshot, "IRON_SPELL", true)
        spells = spells.filter(function(spell) {
            return !spell.managedUpgradeBaseId || highestLearnedSelfSpell(snapshot, spell).id === spell.id
        })
        payload.spells = []
        for (var spellIndex = 0; spellIndex < spells.length; spellIndex++) {
            payload.spells.push({
                id: String(spells[spellIndex].id || ""),
                title: String(spells[spellIndex].title || spells[spellIndex].id || "Spell"),
                description: getSelfSkillNodeVisibility(player, spells[spellIndex], visibilityDefinitions[spells[spellIndex].id], snapshot) === "SHOW"
                    ? String(spells[spellIndex].description || "") : "",
                registryId: String(spells[spellIndex].registryId || ""),
                rank: Number(spells[spellIndex].rank || 1),
                rankSeriesId: String(spells[spellIndex].rankSeriesId || ""),
                managedUpgradeBaseId: String(spells[spellIndex].managedUpgradeBaseId || ""),
                resetNodeId: String(spells[spellIndex].resetNodeId || "")
            })
        }
        payload.spellIcons = getSelfSpellIconMap(player, spells, snapshot.spellLoadout)
        for (var spellIconIndex = 0; spellIconIndex < payload.spells.length; spellIconIndex++) {
            payload.spells[spellIconIndex].icon = payload.spellIcons[payload.spells[spellIconIndex].registryId] || ""
        }
        payload.spellSlots = []
        for (var spellSlot = 0; spellSlot < 12; spellSlot++) {
            var spellAssignedId = snapshot.spellLoadout && snapshot.spellLoadout[spellSlot]
                ? String(snapshot.spellLoadout[spellSlot]) : ""
            var spellAssigned = getSnapshotNode(snapshot, spellAssignedId)
            payload.spellSlots.push({
                slot: spellSlot,
                nodeId: spellAssigned ? String(spellAssigned.id || "") : "",
                title: spellAssigned ? String(spellAssigned.title || spellAssigned.id || "Spell") : "",
                registryId: spellAssigned ? String(spellAssigned.registryId || "") : "",
                icon: spellAssigned ? (payload.spellIcons[String(spellAssigned.registryId || "")] || "") : "",
                rank: spellAssigned ? Number(spellAssigned.rank || 1) : 0,
                rankSeriesId: spellAssigned ? String(spellAssigned.rankSeriesId || "") : "",
                managedUpgradeBaseId: spellAssigned ? String(spellAssigned.managedUpgradeBaseId || "") : "",
                resetNodeId: spellAssigned ? String(spellAssigned.resetNodeId || "") : ""
            })
        }
    } else if (view === "EPIC") {
        var epicSkills = sortedSnapshotNodes(snapshot, "EPIC_FIGHT", true)
        payload.epicSkills = []
        for (var epicIndex = 0; epicIndex < epicSkills.length; epicIndex++) {
            var epicPayloadNode = copyEpicSkillMetadata(epicSkills[epicIndex], {
                id: String(epicSkills[epicIndex].id || ""),
                title: String(epicSkills[epicIndex].title || epicSkills[epicIndex].id || "Epic skill"),
                description: getSelfSkillNodeVisibility(player, epicSkills[epicIndex], visibilityDefinitions[epicSkills[epicIndex].id], snapshot) === "SHOW"
                    ? String(epicSkills[epicIndex].description || "") : "",
                registryId: String(epicSkills[epicIndex].registryId || ""),
                epicSlot: String(epicSkills[epicIndex].epicSlot || ""),
                icon: getEpicSkillIconDataUri(epicSkills[epicIndex].registryId)
            })
            payload.epicSkills.push(epicPayloadNode)
        }
        payload.epicSlots = []
        var slotDefinitions = snapshot.epicSlots || []
        for (var epicSlotIndex = 0; epicSlotIndex < slotDefinitions.length; epicSlotIndex++) {
            var epicSlot = String(slotDefinitions[epicSlotIndex].id || "")
            if (!epicSlot) continue
            var epicAssignedId = snapshot.epicLoadout && snapshot.epicLoadout[epicSlot]
                ? String(snapshot.epicLoadout[epicSlot]) : ""
            var epicAssigned = getSnapshotNode(snapshot, epicAssignedId)
            payload.epicSlots.push({
                slot: epicSlot,
                category: String(slotDefinitions[epicSlotIndex].category || ""),
                displayName: String(slotDefinitions[epicSlotIndex].displayName || epicSlot),
                nodeId: epicAssigned ? String(epicAssigned.id || "") : "",
                title: epicAssigned ? String(epicAssigned.title || epicAssigned.id || "Epic skill") : "",
                registryId: epicAssigned ? String(epicAssigned.registryId || "") : "",
                icon: epicAssigned ? getEpicSkillIconDataUri(epicAssigned.registryId) : "",
                actualRegistryId: String(snapshot.epicEquipped && snapshot.epicEquipped[epicSlot] || "").replace(/^empty$/, ""),
                weaponOverrideRegistryId: String(snapshot.epicWeaponOverrides && snapshot.epicWeaponOverrides[epicSlot] || "")
            })
        }
    }
    return payload
}

function pushSelfSkillLoadoutHtml(player, view, message, ok, includeIcons) {
    var bridge = cnpcext.getClientBridge(player.getMCEntity())
    sendSkillHtmlPayload(bridge, "self_skill_tree", buildSelfSkillLoadoutHtmlPayload(player, view, message, ok, includeIcons))
}

function getSelfLoadoutNode(snapshot, nodeId, type, epicSlot) {
    var node = getSnapshotNode(snapshot, nodeId)
    if (!node || node.learned !== true || node.replaced === true || node.type !== type) return null
    if (epicSlot && (node.assignable !== true || !node.compatibleSlots || node.compatibleSlots.indexOf(epicSlot) < 0)) return null
    return node
}

function highestLearnedSelfSpell(snapshot, node) {
    if (!node || node.type !== "IRON_SPELL") return node
    var best = node
    for (var i = 0; snapshot && snapshot.nodes && i < snapshot.nodes.length; i++) {
        var candidate = snapshot.nodes[i]
        if (candidate.type !== "IRON_SPELL" || candidate.learned !== true || candidate.replaced === true) continue
        if (String(candidate.registryId || "") !== String(node.registryId || "")) continue
        if (node.managedUpgradeBaseId && String(candidate.managedUpgradeBaseId || "") !== String(node.managedUpgradeBaseId)) continue
        if (Number(candidate.rank || 1) > Number(best.rank || 1)) best = candidate
    }
    return best
}

function hasSelfEpicSlot(snapshot, slot) {
    for (var i = 0; snapshot.epicSlots && i < snapshot.epicSlots.length; i++) {
        if (String(snapshot.epicSlots[i].id) === slot) return true
    }
    return false
}

function selfUnlearnRouteNodeId(snapshot, nodeId) {
    var node = getSnapshotNode(snapshot, nodeId)
    if (node && node.managedUpgradeBaseId && node.resetNodeId) return String(node.resetNodeId)
    return String(nodeId || "")
}

function handleSelfUnlearnBranch(player, request, snapshot) {
    var temp = player.getTempdata()
    var key = "admPendingUnlearnBranch"
    var nodeId = String(request.nodeId || "")
    var requestedNode = getSnapshotNode(snapshot, nodeId)
    var isManagedUpgradeReset = !!(requestedNode && requestedNode.managedUpgradeBaseId && requestedNode.resetNodeId)
    if (isManagedUpgradeReset) {
        temp.remove(key)
        pushSelfSkillTreeHtml(player, requestedNode.statNode
            ? "Passive upgrades cannot be reset individually. Unlearn the passive branch to clear its ranks."
            : "Spell upgrades cannot be reset individually.", false)
        return
    }
    var routeNodeId = selfUnlearnRouteNodeId(snapshot, nodeId)
    var classId = getPlayerClassId(player)
    var level = getPlayerData(player).level
    if (request.action === "unlearn") {
        temp.remove(key)
        var preview = callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.previewUnlearnBranch(player.getMCEntity(), classId, level, routeNodeId)
        })
        if (!preview.ok) {
            pushSelfSkillTreeHtml(player, String(preview.message || "This branch cannot be unlearned."), false)
            return
        }
        var nodeIds = []
        for (var i = 0; i < preview.nodes.length; i++) nodeIds.push(String(preview.nodes[i].id))
        var token = String(Date.now()) + ":" + String(Math.random())
        temp.put(key, JSON.stringify({ nodeId: nodeId, nodeIds: nodeIds, classId: classId,
            routeNodeId: routeNodeId, revision: snapshot.revision, token: token, expires: Date.now() + 60000 }))
        var visibleRemoval = []
        var removalFamilies = Object.create(null)
        var upgradeMap = managedUpgradeSnapshotMap(player, classId)
        for (var removalIndex = 0; removalIndex < preview.nodes.length; removalIndex++) {
            var removed = preview.nodes[removalIndex]
            var family = upgradeMap[String(removed.id)]
            var familyId = family ? family.baseId : String(removed.id)
            var existingRemoval = removalFamilies[familyId]
            if (!existingRemoval) {
                existingRemoval = { id: familyId, title: family ? family.title : removed.title, rank: Number(removed.rank || 1), type: removed.type }
                removalFamilies[familyId] = existingRemoval
                visibleRemoval.push(existingRemoval)
            } else existingRemoval.rank = Math.max(existingRemoval.rank, Number(removed.rank || 1))
        }
        var unlearnPreview = { nodeId: nodeId, token: token, nodes: visibleRemoval, costs: preview.costs || [] }
        sendSkillHtmlPayload(cnpcext.getClientBridge(player.getMCEntity()), "self_skill_tree", {
            ok: true, preserveState: true, unlearnPreview: unlearnPreview
        })
        return
    }
    var pending = temp.has(key) ? JSON.parse(String(temp.get(key))) : null
    temp.remove(key)
    if (!pending || pending.nodeId !== nodeId || pending.classId !== classId || pending.revision !== snapshot.revision
        || pending.token !== String(request.token || "") || Date.now() > pending.expires) {
        pushSelfSkillTreeHtml(player, "The unlearn confirmation expired or changed. Review the list again.", false)
        return
    }
    var result = callSkillBridge(player, function() {
        return SERVER_CORE_SKILLS.unlearnBranch(player.getMCEntity(), classId, level,
            String(pending.routeNodeId || nodeId), JSON.stringify(pending.nodeIds))
    })
    if (result.ok) {
        cachePlayerSkillSnapshot(player, result)
        applyAllAttributes(player)
    }
    pushSelfSkillTreeHtml(player, result.ok ? "Branch unlearned." : String(result.message || "Unlearn failed."), result.ok)
}

function handleSelfSkillTreeHtmlEvent(e) {
    var player = e.player
    var temp = player.getTempdata()
    var data = parseClassSkillHtmlData(e.data)
    var action = String(data.action || "")
    if (action === "unlearn_cancel") {
        temp.remove("admPendingUnlearnBranch")
        return
    }
    if (action === "ready") {
        var readyView = temp.has(SELF_SKILL_HTML_VIEW_KEY) ? String(temp.get(SELF_SKILL_HTML_VIEW_KEY)).toUpperCase() : "TREE"
        if (readyView === "SPELLS") pushSelfSkillLoadoutHtml(player, readyView, "", true, true)
        else if (readyView === "EPIC") pushSelfSkillLoadoutHtml(player, readyView, "", true)
        else pushSelfSkillTreeHtml(player, "", true)
        return
    }
    if (action === "character") {
        temp.remove(SELF_SKILL_HTML_SESSION_KEY)
        showSelfGui(player)
        return
    }
    if (action === "spells") {
        temp.put(SELF_SKILL_HTML_VIEW_KEY, "SPELLS")
        pushSelfSkillLoadoutHtml(player, "SPELLS", "", true, true)
        return
    }
    if (action === "epic") {
        temp.put(SELF_SKILL_HTML_VIEW_KEY, "EPIC")
        pushSelfSkillLoadoutHtml(player, "EPIC", "", true)
        return
    }
    if (action === "tree") {
        temp.put(SELF_SKILL_HTML_VIEW_KEY, "TREE")
        pushSelfSkillTreeHtml(player, "", true)
        return
    }
    if (action === "close") {
        temp.remove(SELF_SKILL_HTML_SESSION_KEY)
        return
    }
    if (["learn", "unlearn", "unlearn_confirm", "spell_assign", "spell_clear", "spell_move", "epic_assign", "epic_clear", "epic_sync"].indexOf(action) < 0) {
        var unknownView = temp.has(SELF_SKILL_HTML_VIEW_KEY) ? String(temp.get(SELF_SKILL_HTML_VIEW_KEY)).toUpperCase() : "TREE"
        if (unknownView === "SPELLS" || unknownView === "EPIC") pushSelfSkillLoadoutHtml(player, unknownView, "That action is not available. Reopen this screen if it continues.", false)
        else pushSelfSkillTreeHtml(player, "That action is not available. Reopen this screen if it continues.", false)
        return
    }
    if (isArvanPersistenceFrozen(player)) {
        if (action.indexOf("spell_") === 0) pushSelfSkillLoadoutHtml(player, "SPELLS", "Your character is being saved. Try again in a moment.", false)
        else if (action.indexOf("epic_") === 0) pushSelfSkillLoadoutHtml(player, "EPIC", "Your character is being saved. Try again in a moment.", false)
        else pushSelfSkillTreeHtml(player, "Your character is being saved. Try again in a moment.", false)
        return
    }
    if (action === "epic_sync") {
        var syncResult = callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.repair(player.getMCEntity())
        })
        if (syncResult.ok) cachePlayerSkillSnapshot(player, syncResult)
        pushSelfSkillLoadoutHtml(player, "EPIC", syncResult.ok ? "Loadout synchronized." : String(syncResult.message || "Loadout sync failed."), syncResult.ok)
        return
    }
    if (action === "spell_move") {
        var sourceSpellSlot = Math.floor(Number(data.sourceSlot))
        var targetSpellSlot = Math.floor(Number(data.targetSlot))
        if (isNaN(sourceSpellSlot) || isNaN(targetSpellSlot) || sourceSpellSlot < 0 || sourceSpellSlot > 11 || targetSpellSlot < 0 || targetSpellSlot > 11 || sourceSpellSlot === targetSpellSlot) {
            pushSelfSkillLoadoutHtml(player, "SPELLS", "Choose two different valid spell slots.", false)
            return
        }
        var moveSnapshot = getSelfSkillSnapshot(player)
        var sourceSpellId = moveSnapshot.ok && moveSnapshot.spellLoadout && moveSnapshot.spellLoadout[sourceSpellSlot]
            ? String(moveSnapshot.spellLoadout[sourceSpellSlot]) : ""
        var targetSpellId = moveSnapshot.ok && moveSnapshot.spellLoadout && moveSnapshot.spellLoadout[targetSpellSlot]
            ? String(moveSnapshot.spellLoadout[targetSpellSlot]) : ""
        if (!moveSnapshot.ok || !sourceSpellId || !getSelfLoadoutNode(moveSnapshot, sourceSpellId, "IRON_SPELL", "") ||
            (targetSpellId && !getSelfLoadoutNode(moveSnapshot, targetSpellId, "IRON_SPELL", ""))) {
            pushSelfSkillLoadoutHtml(player, "SPELLS", "That spell loadout changed. Try the move again.", false)
            return
        }
        var moveClassId = getPlayerClassId(player)
        var moveResult = callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.moveSpellSlot(player.getMCEntity(), moveClassId, getPlayerData(player).level, sourceSpellSlot, targetSpellSlot)
        })
        if (moveResult.ok) cachePlayerSkillSnapshot(player, moveResult)
        pushSelfSkillLoadoutHtml(player, "SPELLS", moveResult.ok
            ? (targetSpellId ? "Spell slots swapped." : "Spell moved.")
            : String(moveResult.message || "Spell move failed"), moveResult.ok)
        return
    }
    if (action === "spell_assign" || action === "spell_clear") {
        var spellSlot = Math.floor(Number(data.slot))
        if (isNaN(spellSlot) || spellSlot < 0 || spellSlot > 11) {
            pushSelfSkillLoadoutHtml(player, "SPELLS", "That spell slot is invalid. Reopen the loadout and try again.", false)
            return
        }
        var spellSnapshot = getSelfSkillSnapshot(player)
        var spellNodeId = action === "spell_clear" ? "" : String(data.nodeId || "")
        var spellNode = spellNodeId ? getSelfLoadoutNode(spellSnapshot, spellNodeId, "IRON_SPELL", "") : null
        if (!spellSnapshot.ok || (spellNodeId && !spellNode)) {
            pushSelfSkillLoadoutHtml(player, "SPELLS", "Choose a learned spell before assigning it.", false)
            return
        }
        if (spellNode) spellNodeId = String(highestLearnedSelfSpell(spellSnapshot, spellNode).id || spellNodeId)
        var spellClassId = getPlayerClassId(player)
        var spellResult = callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.setSpellSlot(player.getMCEntity(), spellClassId, getPlayerData(player).level, spellSlot, spellNodeId)
        })
        if (spellResult.ok) cachePlayerSkillSnapshot(player, spellResult)
        pushSelfSkillLoadoutHtml(player, "SPELLS", spellResult.ok ? (spellNodeId ? "Spell assigned." : "Spell slot cleared.") : String(spellResult.message || "Spell loadout update failed"), spellResult.ok)
        return
    }
    if (action === "epic_assign" || action === "epic_clear") {
        var epicSlot = String(data.slot || "")
        var epicSnapshot = getSelfSkillSnapshot(player)
        if (!epicSnapshot.ok || !hasSelfEpicSlot(epicSnapshot, epicSlot)) {
            pushSelfSkillLoadoutHtml(player, "EPIC", "That Epic Fight slot is unavailable. Reopen the loadout and try again.", false)
            return
        }
        var epicNodeId = action === "epic_clear" ? "" : String(data.nodeId || "")
        if (action === "epic_assign" && (!epicNodeId || !getSelfLoadoutNode(epicSnapshot, epicNodeId, "EPIC_FIGHT", epicSlot))) {
            pushSelfSkillLoadoutHtml(player, "EPIC", "Choose a learned skill compatible with that slot.", false)
            return
        }
        var epicClassId = getPlayerClassId(player)
        var epicResult = callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.setEpicSlot(player.getMCEntity(), epicClassId, getPlayerData(player).level, epicSlot, epicNodeId)
        })
        if (epicResult.ok) cachePlayerSkillSnapshot(player, epicResult)
        pushSelfSkillLoadoutHtml(player, "EPIC", epicResult.ok ? (epicNodeId ? "Epic skill assigned." : "Epic slot cleared.") : String(epicResult.message || "Epic loadout update failed"), epicResult.ok)
        return
    }
    var nodeId = String(data.nodeId || "")
    var snapshot = getSelfSkillSnapshot(player)
    var selectedNode = getSnapshotNode(snapshot, nodeId)
    var routeVisibility = {}
    if (!snapshot.ok || !selectedNode || isSelfSkillNodeConcealed(selectedNode) ||
        !isSnapshotNodeVisible(snapshot, selectedNode, routeVisibility, {})) {
        pushSelfSkillTreeHtml(player, "That skill is still locked.", false)
        return
    }
    var unlearning = action === "unlearn" || action === "unlearn_confirm"
    if (isLearnedWithNode(player, snapshot.classId, nodeId)) {
        pushSelfSkillTreeHtml(player, "This skill is granted automatically with its linked node and cannot be learned or unlearned manually.", false)
        return
    }
    if (selectedNode.learned !== unlearning) {
        pushSelfSkillTreeHtml(player, "That skill changed on the server. Review its current state and try again.", false)
        return
    }
    if (!unlearning) {
        var permissionCheck = skillNodePermissionCheck(player, selectedNode, snapshot)
        var spiritCost = nodeSpiritCost(selectedNode)
        var spiritBalance = getSpiritBalance(player)
        if (!permissionCheck.passed) {
            pushSelfSkillTreeHtml(player, "Missing skill permission: " + friendlyPermissionLabel(permissionCheck.missing[0]) + ".", false)
            return
        }
        if (spiritCost > spiritBalance) {
            pushSelfSkillTreeHtml(player, "You need " + spiritCost + " Spirit to learn this skill (you have " + spiritBalance + ").", false)
            return
        }
    }
    if (unlearning) {
        handleSelfUnlearnBranch(player, data, snapshot)
        return
    }
    var classId = getPlayerClassId(player)
    var result = unlearning
        ? callSkillBridge(player, function() {
            return SERVER_CORE_SKILLS.unlearn(player.getMCEntity(), classId, getPlayerData(player).level, nodeId)
        })
        : learnSkillWithSpirit(player, classId, getPlayerData(player).level, nodeId, selectedNode)
    if (result.ok) {
        result = applyLearnedWithNodeGrants(player, classId, getPlayerData(player).level, result)
        if (result.ok) {
            cachePlayerSkillSnapshot(player, result)
            applyAllAttributes(player)
        }
    }
    pushSelfSkillTreeHtml(
        player,
        result.ok ? (unlearning ? "Skill unlearned." : "Skill learned.") : String(result.message || "Skill update failed"),
        result.ok
    )
}

function showSelfSkillHtmlView(player, requestedView) {
    var view = String(requestedView || "TREE").toUpperCase()
    if (["TREE", "SPELLS", "EPIC"].indexOf(view) < 0) view = "TREE"
    var payload = view === "TREE" ? buildSelfSkillTreeHtmlPayload(player, "", true)
        : buildSelfSkillLoadoutHtmlPayload(player, view, "", true, false)
    if (!payload.ok) {
        player.message("§c[Skills] " + payload.message)
        showSelfGui(player)
        return
    }
    if (player.getCustomGui()) {
        var temp = player.getTempdata()
        var transitions = temp.has(ADM_GUI_TRANSITION_KEY) ? Number(temp.get(ADM_GUI_TRANSITION_KEY)) : 0
        temp.put(ADM_GUI_TRANSITION_KEY, transitions + 1)
    }
    var selfHtmlTemp = player.getTempdata()
    if (selfHtmlTemp.has(CLASS_SKILL_HTML_SESSION_KEY)) {
        persistClassSkillDraft(player)
        selfHtmlTemp.remove(CLASS_SKILL_HTML_SESSION_KEY)
    }
    if (selfHtmlTemp.has(CLASS_SKILL_HTML_REBIND_KEY)) selfHtmlTemp.remove(CLASS_SKILL_HTML_REBIND_KEY)
    selfHtmlTemp.put(SELF_SKILL_HTML_SESSION_KEY, 1)
    selfHtmlTemp.put(SELF_SKILL_HTML_VIEW_KEY, view)
    selfHtmlTemp.put(HTML_ACTIVE_SESSION_KEY, "SELF")
    skillHtmlRequestParts = null
    cnpcext.openHtmlGui(player, SELF_SKILL_HTML_FILE, 0, 0, skillHtmlInitialPayload(payload, "", player.getWorld()))
}

function showSelfSkillTreeGui(player) {
    showSelfSkillHtmlView(player, "TREE")
}

function showSelfSpellLoadoutGui(player) {
    var snapshot = getSelfSkillSnapshot(player)
    if (!snapshot.ok) {
        player.message("§c[Skills] " + snapshot.message)
        showSelfSkillTreeGui(player)
        return
    }
    rememberSelfSkillSnapshot(player, snapshot)
    var spells = sortedSnapshotNodes(snapshot, "IRON_SPELL", true)
    var labels = []
    var ids = []
    for (var i = 0; i < spells.length; i++) {
        labels.push("§b✦ §f" + spells[i].title + " §8R" + spells[i].rank)
        ids.push(spells[i].id)
    }
    if (labels.length === 0) labels.push("(No learned spells)")
    player.getTempdata().put("admSelfSpellLibraryIds", JSON.stringify(ids))
    var selectedNodeId = player.getTempdata().has("admSelfSelectedSpellId") ? String(player.getTempdata().get("admSelfSelectedSpellId")) : ""
    if (ids.indexOf(selectedNodeId) === -1 && ids.length > 0) selectedNodeId = ids[0]
    if (selectedNodeId) player.getTempdata().put("admSelfSelectedSpellId", selectedNodeId)
    var selectedSlot = player.getTempdata().has("admSelfSelectedSpellSlot") ? Number(player.getTempdata().get("admSelfSelectedSpellSlot")) : 0
    selectedSlot = Math.max(0, Math.min(11, selectedSlot))
    player.getTempdata().put("admSelfSelectedSpellSlot", selectedSlot)

    var gui = API.createCustomGui(SELF_SPELL_LOADOUT_GUI_ID, SELF_SKILL_WIDTH, SELF_SKILL_HEIGHT, false, player)
    addRpgFrame(gui, SELF_SKILL_WIDTH, SELF_SKILL_HEIGHT, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS, 10, 40, 250, 236, RPG_UI.cyan)
    addRpgPanel(gui, LAYER.BG_PANELS + 2, 268, 40, 202, 236, RPG_UI.gold)
    gui.addLabel(LAYER.CONTENT_LABELS, "§b§lBOUND GRIMOIRE LOADOUT", 148, 10, 220, 14)
    gui.addLabel(LAYER.CONTENT_LABELS + 1, "§7Choose a learned spell, choose a slot, then assign.", 110, 26, 300, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 2, "§b§lLEARNED SPELLS", 20, 50, 160, 10)
    var library = gui.addScroll(SELF_SKILL_IDS.SCROLL_LIBRARY, 18, 66, 234, 182, labels)
    if (selectedNodeId && ids.indexOf(selectedNodeId) >= 0) library.setDefaultSelection(ids.indexOf(selectedNodeId))
    gui.addLabel(LAYER.CONTENT_LABELS + 3, "§7" + spells.length + " learned", 188, 252, 60, 10)
    gui.addLabel(LAYER.CONTENT_LABELS + 4, "§6§lTWELVE ACTIVE SLOTS", 282, 50, 172, 10)
    for (var slot = 0; slot < 12; slot++) {
        var column = slot % 3
        var row = Math.floor(slot / 3)
        var assignedId = snapshot.spellLoadout[slot]
        var assigned = getSnapshotNode(snapshot, assignedId)
        var title = assigned ? shortGuiText(assigned.title, 11) : "Empty"
        var color = slot === selectedSlot ? "§e§l" : (assigned ? "§b" : "§8")
        gui.addButton(SELF_SKILL_IDS.SPELL_SLOT_BASE + slot, color + (slot + 1) + ": " + title, 278 + column * 62, 70 + row * 42, 58, 34)
    }
    var selectedSpell = getSnapshotNode(snapshot, selectedNodeId)
    gui.addLabel(LAYER.CONTENT_LABELS + 5, selectedSpell ? "§f" + shortGuiText(selectedSpell.title, 28) : "§7Select a learned spell", 282, 244, 172, 18).setHoverText(selectedSpell ? "§f" + selectedSpell.title : "§7No spell selected")
    gui.addButton(SELF_SKILL_IDS.BTN_ASSIGN, "§a§lASSIGN", 92, 292, 82, 20).setEnabled(!!selectedSpell)
    gui.addButton(SELF_SKILL_IDS.BTN_CLEAR, "§c§lCLEAR SLOT", 180, 292, 96, 20)
    gui.addButton(SELF_SKILL_IDS.BTN_BACK, "§f§lSKILL TREE", 282, 292, 102, 20)
    showManagedGui(player, gui)
}

function showSelfEpicLoadoutGui(player) {
    showSelfSkillHtmlView(player, "EPIC")
}

function _selfSkill_customGuiButton(e) {
    var player = e.player
    var guiId = e.gui.getID()
    var buttonId = e.buttonId
    if (guiId === SELF_SKILL_TREE_GUI_ID) {
        if (buttonId >= SELF_SKILL_IDS.TREE_NODE_BASE && buttonId < SELF_SKILL_IDS.TREE_NODE_BASE + 15) {
            var treeIds = JSON.parse(String(player.getTempdata().get("admSelfSkillIds") || "[]"))
            var treeIndex = buttonId - SELF_SKILL_IDS.TREE_NODE_BASE
            if (treeIndex >= 0 && treeIndex < treeIds.length) {
                player.getTempdata().put("admSelfSelectedSkillId", treeIds[treeIndex])
                showSelfSkillTreeGui(player)
            }
        } else if (buttonId === SELF_SKILL_IDS.BTN_BACK) {
            showSelfGui(player)
        } else if (buttonId === SELF_SKILL_IDS.BTN_SPELLS) {
            showSelfSpellLoadoutGui(player)
        } else if (buttonId === SELF_SKILL_IDS.BTN_EPIC) {
            showSelfEpicLoadoutGui(player)
        } else if (buttonId === SELF_SKILL_IDS.BTN_PREV || buttonId === SELF_SKILL_IDS.BTN_NEXT) {
            var page = player.getTempdata().has("admSelfSkillPage") ? Number(player.getTempdata().get("admSelfSkillPage")) : 0
            player.getTempdata().put("admSelfSkillPage", page + (buttonId === SELF_SKILL_IDS.BTN_PREV ? -1 : 1))
            showSelfSkillTreeGui(player)
        } else if (buttonId === SELF_SKILL_IDS.BTN_LEARN) {
            var nodeId = player.getTempdata().has("admSelfSelectedSkillId") ? String(player.getTempdata().get("admSelfSelectedSkillId")) : ""
            var classId = getPlayerClassId(player)
            var remembered = player.getTempdata().has("admSelfSkillSnapshot")
                ? JSON.parse(String(player.getTempdata().get("admSelfSkillSnapshot"))) : null
            var selectedNode = getSnapshotNode(remembered, nodeId)
            if (isLearnedWithNode(player, classId, nodeId)) {
                player.message("§c[Skills] This skill is granted automatically with its linked node and cannot be learned or unlearned manually.")
                showSelfSkillTreeGui(player)
                return
            }
            var unlearning = selectedNode && selectedNode.learned === true
            var upgradeInfo = managedUpgradeSnapshotMap(player, classId)[nodeId]
            if (unlearning && upgradeInfo && upgradeInfo.resetNodeId) {
                player.message(upgradeInfo.statNode
                    ? "§c[Skills] Passive upgrades cannot be reset individually. Unlearn the passive branch to clear its ranks."
                    : "§c[Skills] Spell upgrades cannot be reset individually.")
                showSelfSkillTreeGui(player)
                return
            }
            var result = callSkillBridge(player, function() {
                return SERVER_CORE_SKILLS.unlearn(player.getMCEntity(), classId, getPlayerData(player).level, nodeId)
            })
            if (!unlearning) result = learnSkillWithSpirit(player, classId, getPlayerData(player).level, nodeId, selectedNode)
            if (result.ok) {
                result = applyLearnedWithNodeGrants(player, classId, getPlayerData(player).level, result)
                if (result.ok) {
                    cachePlayerSkillSnapshot(player, result)
                    applyAllAttributes(player)
                }
            }
            player.message(result.ok ? (unlearning ? "§e[Skills] Skill unlearned." : "§a[Skills] Skill learned.") : "§c[Skills] " + result.message)
            showSelfSkillTreeGui(player)
        }
        return
    }
    if (guiId === SELF_SPELL_LOADOUT_GUI_ID) {
        if (buttonId >= SELF_SKILL_IDS.SPELL_SLOT_BASE && buttonId < SELF_SKILL_IDS.SPELL_SLOT_BASE + 12) {
            player.getTempdata().put("admSelfSelectedSpellSlot", buttonId - SELF_SKILL_IDS.SPELL_SLOT_BASE)
            showSelfSpellLoadoutGui(player)
        } else if (buttonId === SELF_SKILL_IDS.BTN_BACK) {
            showSelfSkillTreeGui(player)
        } else if (buttonId === SELF_SKILL_IDS.BTN_ASSIGN || buttonId === SELF_SKILL_IDS.BTN_CLEAR) {
            var selectedSlot = Number(player.getTempdata().get("admSelfSelectedSpellSlot") || 0)
            var selectedNode = buttonId === SELF_SKILL_IDS.BTN_CLEAR ? "" : String(player.getTempdata().get("admSelfSelectedSpellId") || "")
            var classId = getPlayerClassId(player)
            if (selectedNode) {
                var loadoutSnapshot = getSelfSkillSnapshot(player)
                var loadoutNode = getSelfLoadoutNode(loadoutSnapshot, selectedNode, "IRON_SPELL", "")
                if (loadoutNode) selectedNode = String(highestLearnedSelfSpell(loadoutSnapshot, loadoutNode).id || selectedNode)
            }
            var result = callSkillBridge(player, function() {
                return SERVER_CORE_SKILLS.setSpellSlot(player.getMCEntity(), classId, getPlayerData(player).level, selectedSlot, selectedNode)
            })
            if (result.ok) cachePlayerSkillSnapshot(player, result)
            if (!result.ok) player.message("§c[Skills] " + result.message)
            showSelfSpellLoadoutGui(player)
        }
        return
    }
    if (guiId === SELF_EPIC_LOADOUT_GUI_ID) {
        showSelfEpicLoadoutGui(player)
    }
}

function _selfSkill_customGuiScroll(e) {
    if (!e.selection || e.selection.length === 0) return
    if (e.gui.getID() === SELF_SPELL_LOADOUT_GUI_ID && e.scrollId === SELF_SKILL_IDS.SCROLL_LIBRARY) {
        var ids = JSON.parse(String(e.player.getTempdata().get("admSelfSpellLibraryIds") || "[]"))
        if (e.scrollIndex >= 0 && e.scrollIndex < ids.length) {
            e.player.getTempdata().put("admSelfSelectedSpellId", ids[e.scrollIndex])
            showSelfSpellLoadoutGui(e.player)
        }
    } else if (e.gui.getID() === SELF_EPIC_LOADOUT_GUI_ID && e.scrollId === SELF_SKILL_IDS.SCROLL_LIBRARY) {
        var ids = JSON.parse(String(e.player.getTempdata().get("admSelfEpicLibraryIds") || "[]"))
        if (e.scrollIndex >= 0 && e.scrollIndex < ids.length) {
            e.player.getTempdata().put("admSelfSelectedEpicId", ids[e.scrollIndex])
            showSelfEpicLoadoutGui(e.player)
        }
    }
}

function _selfSkill_customGuiClosed(e) {
    var temp = e.player.getTempdata()
    temp.remove("admSelfSkillSnapshot")
}

// BEGIN REGISTERED ITEM SYSTEM
// BEGIN REGISTERED ITEM SYSTEM
// Embedded in ADMsLevelingSystem.js. Registry templates are shared world data.
var ARVAN_ITEMS = (function() {
    var KEY = "arvanItemRegistryV1"
    var TAG = "arvanRegisteredItem"
    var GUI = 112
    var IDENTIFY_GUI = 113
    var MATERIAL_GUI = 5812
    var TIMER = 914112
    var SESSION_KEY = "arvanItemRegistryEditorSessionV1"
    var PAGE = 12
    var sessions = {}
    var totals = {}
    var checking = false
    var cacheText = null
    var cache = null
    var slots = ["none", "mainhand", "offhand", "feet", "legs", "chest", "head"]
    var rarities = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Quest"]
    var colors = ["§f", "§a", "§9", "§5", "§6", "§e"]
    var defaultLore = "{rarity} {item_type}\n{description}\n\n{rolled_stats}\n{requirements}\n\n{set_name}\n{set_bonuses}"
    var MAX_SAFE_INTEGER = 9007199254740991
    var MAX_HONE_LEVEL = 100
    var HONE_VERSION = 1
    var REROLL_VERSION = 1
    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }
    function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key) }
    function fail(message) { throw new Error(message) }
    function clean(value, max) { return String(value || "").trim().substring(0, max || 120) }
    function plainLore(stack) {
        var source = stack && stack.getLore ? stack.getLore() : null
        var out = []
        if (!source) return out
        for (var i = 0; i < Number(source.length || 0); i++) out.push(String(source[i]))
        return out
    }
    function itemSnbt(stack) {
        var itemNbt = stack && !stack.isEmpty() ? stack.getItemNbt() : null
        var text = itemNbt ? String(itemNbt.toJsonString()) : ""
        if (text && text !== "undefined" && text !== "null") {
            try { API.stringToNbt(text); return text } catch (ignored) {}
        }
        var rebuilt = API.stringToNbt("{}")
        rebuilt.putString("id", String(stack.getName()))
        rebuilt.setByte("Count", Number(stack.getStackSize()))
        var tag = stack.getNbt()
        if (tag && !tag.isEmpty()) rebuilt.setCompound("tag", tag)
        text = String(rebuilt.toJsonString())
        if (!text || text === "undefined" || text === "null") fail("Could not serialize the held base item.")
        API.stringToNbt(text)
        return text
    }
    function defaultRarityWeights() {
        var out = {}
        for (var i = 0; i < rarities.length; i++) out[rarities[i]] = 1
        return out
    }
    function normalizeRarityWeights(value) {
        var source = value && typeof value === "object" ? value : defaultRarityWeights()
        var out = {}, positive = false
        for (var i = 0; i < rarities.length; i++) {
            var rarity = rarities[i]
            var raw = own(source, rarity) ? source[rarity] : 1
            if (String(raw).trim() === "" || !isFinite(Number(raw)) || Number(raw) < 0) fail(rarity + " rarity weight must be a finite number at least 0.")
            out[rarity] = Number(raw)
            if (out[rarity] > 0) positive = true
        }
        if (!positive) fail("At least one rarity weight must be greater than 0.")
        return out
    }
    function rarityPercentages(value) {
        var weights = normalizeRarityWeights(value)
        var maximum = 0, scaledTotal = 0, out = {}
        for (var i = 0; i < rarities.length; i++) maximum = Math.max(maximum, weights[rarities[i]])
        for (var j = 0; j < rarities.length; j++) scaledTotal += weights[rarities[j]] / maximum
        for (var k = 0; k < rarities.length; k++) out[rarities[k]] = Math.round((weights[rarities[k]] / maximum) / scaledTotal * 10000) / 100
        return out
    }
    function previewRarityPercentages(value) {
        var weights = {}, maximum = 0, scaledTotal = 0, out = {}
        for (var i = 0; i < rarities.length; i++) {
            var rarity = rarities[i]
            var raw = value && own(value, rarity) ? value[rarity] : 1
            if (String(raw).trim() === "" || !isFinite(Number(raw)) || Number(raw) < 0) return null
            weights[rarity] = Number(raw)
            maximum = Math.max(maximum, weights[rarity])
        }
        if (maximum <= 0) return null
        for (var j = 0; j < rarities.length; j++) scaledTotal += weights[rarities[j]] / maximum
        for (var k = 0; k < rarities.length; k++) out[rarities[k]] = Math.round((weights[rarities[k]] / maximum) / scaledTotal * 10000) / 100
        return out
    }
    function randomUnit(random) {
        var value = Number(random())
        if (!isFinite(value) || value < 0 || value > 1) fail("Random source must return a number between 0 and 1.")
        return value
    }
    function selectRarity(value, random) {
        var weights = normalizeRarityWeights(value)
        var maximum = 0, total = 0
        for (var i = 0; i < rarities.length; i++) maximum = Math.max(maximum, weights[rarities[i]])
        for (var j = 0; j < rarities.length; j++) total += weights[rarities[j]] / maximum
        var target = randomUnit(random) * total, cumulative = 0, last = "Common"
        for (var k = 0; k < rarities.length; k++) {
            var rarity = rarities[k]
            if (weights[rarity] <= 0) continue
            last = rarity
            cumulative += weights[rarity] / maximum
            if (target < cumulative) return rarity
        }
        return last
    }
    function comparableId(value) { return clean(value, 120).toLowerCase().replace(/^minecraft:/, "") }
    function normalizedBonusLabel(label, bonusId) {
        var value = clean(label, 60)
        return !value || comparableId(value) === comparableId(bonusId) ? "" : value
    }
    function fallbackBonusName(value) {
        var key = clean(value, 120).replace(/^.*:/, "").replace(/^generic\./, "").replace(/[._\/-]+/g, " ")
        return key.replace(/(^|\s)([a-z])/g, function(all, gap, letter) { return gap + letter.toUpperCase() }) || "Stat"
    }
    function bonusDisplayName(value) {
        var custom = normalizedBonusLabel(value.label, value.id)
        if (custom) return custom
        if (typeof ADM_ITEM_EDITOR !== "undefined" && ADM_ITEM_EDITOR.registeredStatDisplayName) return ADM_ITEM_EDITOR.registeredStatDisplayName(value)
        if (value.type !== "attribute") {
            var definition = getStatDefinition(value.id)
            if (definition && definition.name) return definition.name + (value.type === "effectiveness" ? " Effectiveness" : "")
        }
        return fallbackBonusName(value.id) + (value.type === "effectiveness" ? " Effectiveness" : "")
    }
    function id(value) {
        value = clean(value, 64).toLowerCase()
        if (!/^[a-z0-9][a-z0-9_.:-]*$/.test(value) || ["constructor", "prototype", "__proto__"].indexOf(value) >= 0) fail("Use a permanent ID containing letters, numbers, _, -, . or :.")
        return value
    }
    function automaticId(entries, value, fallback) {
        var base = clean(value, 64).replace(/§./g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback
        if (["constructor", "prototype", "__proto__"].indexOf(base) >= 0) base = fallback + "_" + base
        var candidate = base, suffix = 2
        while (own(entries, candidate)) { candidate = base + "_" + suffix; suffix++ }
        return candidate
    }
    function number(value, min, max, label) {
        if (String(value).trim() === "" || !isFinite(Number(value)) || Number(value) < min || Number(value) > max) fail(label + " must be between " + min + " and " + max + ".")
        return Number(value)
    }
    function optionalNumber(value, fallback, label) {
        if (value === undefined || value === null || String(value).trim() === "") return fallback
        if (!isFinite(Number(value))) fail(label + " must be a finite number.")
        return Number(value)
    }
    function wholeNumber(value, fallback, label) {
        var result = optionalNumber(value, fallback, label)
        if (result < 0 || result > MAX_SAFE_INTEGER || result % 1) fail(label + " must be a nonnegative whole number.")
        return result
    }
    function rowIdentity(value, occurrence) {
        var explicit = value && (value.rowId !== undefined ? value.rowId : value.statRowId !== undefined ? value.statRowId : value.stableId)
        if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
            explicit = String(explicit).trim().substring(0, 80)
            if (!/^[A-Za-z0-9_.:-]+$/.test(explicit) || ["constructor", "prototype", "__proto__"].indexOf(explicit.toLowerCase()) >= 0) fail("Stat row ID must contain letters, numbers, _, -, . or :.")
            return explicit
        }
        var type = clean(value && value.type, 24).toLowerCase() || "attribute"
        var stat = clean(value && value.id, 120).toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_") || "stat"
        var operation = Number(value && value.operation || 0)
        var suffix = occurrence > 1 ? "_" + occurrence : ""
        return "stat_" + type + "_" + stat + "_" + operation + suffix
    }
    function rowKey(value) {
        return String(value && value.type || "attribute").toLowerCase() + "|" + String(value && value.id || "").toLowerCase() + "|" + Number(value && value.operation || 0)
    }
    function normalizeRows(rows, fixed) {
        var source = Array.isArray(rows) ? rows : []
        var counts = {}, out = []
        for (var i = 0; i < source.length; i++) {
            var raw = source[i] || {}
            var key = rowKey(raw)
            counts[key] = (counts[key] || 0) + 1
            var row = normalizeBonus(raw, fixed)
            row.rowId = rowIdentity(raw, counts[key])
            if (raw.value !== undefined) {
                row.value = preciseNumber(raw.value, -1000000, 1000000, "Bonus value")
                row.min = row.value
                row.max = row.value
            }
            out.push(row)
        }
        return out
    }
    function normalizeCost(value, label) {
        var source = value && typeof value === "object" ? value : {}
        return {spirit: wholeNumber(source.spirit !== undefined ? source.spirit : source.spiritCost, 0, label + " Spirit"), money: wholeNumber(source.money !== undefined ? source.money : source.moneyCost !== undefined ? source.moneyCost : source.currency, 0, label + " money")}
    }
    function costFrom(value, label) {
        var source = value && typeof value === "object" ? value : {}
        var nested = source.cost && typeof source.cost === "object" ? source.cost : {}
        var spirit = source.spiritCost !== undefined ? source.spiritCost : source.spirit !== undefined ? source.spirit : nested.spirit !== undefined ? nested.spirit : nested.spiritCost
        var money = source.moneyCost !== undefined ? source.moneyCost : source.currencyCost !== undefined ? source.currencyCost : source.money !== undefined ? source.money : nested.money !== undefined ? nested.money : nested.moneyCost !== undefined ? nested.moneyCost : nested.currency
        return {spirit: wholeNumber(spirit, 0, label + " Spirit"), money: wholeNumber(money, 0, label + " money")}
    }
    function normalizeMaterial(value, label) {
        var source = value && typeof value === "object" ? clone(value) : {id: value}
        var materialId = source.templateId !== undefined ? source.templateId : source.registeredItemId !== undefined ? source.registeredItemId : source.materialId !== undefined ? source.materialId : source.id
        materialId = id(materialId)
        if (!materialId) fail(label + " needs an item.")
        var role = clean(source.role !== undefined ? source.role : source.type !== undefined ? source.type : source.tier, 40).toLowerCase().replace(/[ _-]+/g, "")
        if (role === "rerollstone" || role === "ordinary" || role === "normal") role = "reroll"
        if (role === "refinedrerollstone") role = "refined"
        if (role === "perfectrerollstone") role = "perfect"
        var qualityFloor = source.qualityFloor !== undefined ? source.qualityFloor : source.minimumQuality
        if (qualityFloor !== undefined && (optionalNumber(qualityFloor, 0, label + " quality floor") < 0 || Number(qualityFloor) > 1)) fail(label + " quality floor must be between 0 and 1.")
        var chancePoints = optionalNumber(source.chancePoints !== undefined ? source.chancePoints : source.chance, 0, label + " chance")
        if (chancePoints < 0) fail(label + " chance must be nonnegative.")
        var material = {id: materialId, name: clean(source.name !== undefined ? source.name : source.label, 80), role: role || "ordinary", chancePoints: chancePoints, qualityFloor: qualityFloor === undefined ? undefined : Number(qualityFloor), minTarget: wholeNumber(source.minTarget !== undefined ? source.minTarget : source.minLevel, 0, label + " minimum target"), maxTarget: wholeNumber(source.maxTarget !== undefined ? source.maxTarget : source.maxLevel, MAX_HONE_LEVEL, label + " maximum target"), maxQuantity: wholeNumber(source.maxQuantity !== undefined ? source.maxQuantity : source.maxCount, 9999, label + " maximum quantity"), required: !!source.required, requiredQuantity: wholeNumber(source.requiredQuantity !== undefined ? source.requiredQuantity : source.requiredCount, source.required ? 1 : 0, label + " required quantity"), consumeOnSuccess: source.consumeOnSuccess !== false, consumeOnFailure: source.consumeOnFailure !== false, guarantee: !!(source.guarantee || source.perfect || role === "perfect"), category: clean(source.category, 80), rarity: clean(source.rarity, 40)}
        if (source.snbt) material.snbt = String(source.snbt)
        material.maxQuantity = 1
        material.required = false
        material.requiredQuantity = 0
        if (label.indexOf("Reroll") === 0) material.consumeOnSuccess = material.consumeOnFailure = true
        if (material.minTarget > material.maxTarget) fail(label + " minimum target cannot exceed maximum target.")
        if (material.requiredQuantity > material.maxQuantity) fail(label + " required quantity cannot exceed maximum quantity.")
        return material
    }
    function materialList(value, label) {
        var source = Array.isArray(value) ? value : []
        if (!Array.isArray(value) && value && typeof value === "object") {
            source = []
            var keys = Object.keys(value)
            for (var i = 0; i < keys.length; i++) {
                var entry = clone(value[keys[i]])
                if (!entry || typeof entry !== "object") entry = {}
                if (entry.id === undefined && entry.templateId === undefined && entry.registeredItemId === undefined) entry.id = keys[i]
                source.push(entry)
            }
        }
        var out = [], seen = {}
        for (var j = 0; j < source.length; j++) {
            var material = normalizeMaterial(source[j], label + " material " + (j + 1))
            if (seen[material.id]) fail(label + " repeats material ID: " + material.id)
            seen[material.id] = true
            out.push(material)
        }
        return out
    }
    function normalizeHoneBonus(value, level, index, counts, rowIds) {
        var source = clone(value || {})
        if (source.value === undefined && source.amount !== undefined) source.value = source.amount
        if (source.min === undefined && source.value !== undefined) source.min = source.value
        if (source.min === undefined) source.min = 0
        var row = normalizeBonus(source, true)
        if (source.value !== undefined) row.value = preciseNumber(source.value, -1000000, 1000000, "Hone bonus value")
        else row.value = row.min
        row.min = row.value
        row.max = row.value
        var key = rowKey(source)
        counts[key] = (counts[key] || 0) + 1
        row.rowId = source.rowId !== undefined || source.statRowId !== undefined || source.stableId !== undefined ? rowIdentity(source, counts[key]) : "hone_" + level + "_" + rowIdentity(source, counts[key])
        if (rowIds && rowIds[row.rowId]) fail("Duplicate hone stat row ID: " + row.rowId)
        if (rowIds) rowIds[row.rowId] = true
        row.honeLevel = level
        row.honeIndex = index
        return row
    }
    function normalizeHoning(value) {
        var source = value === true ? {enabled: true} : value && typeof value === "object" ? clone(value) : {}
        var rawLevels = source.levels !== undefined ? source.levels : source.rows !== undefined ? source.rows : source.levelTable
        rawLevels = Array.isArray(rawLevels) ? rawLevels : []
        var rawMax = source.maxLevel !== undefined ? source.maxLevel : source.maximum !== undefined ? source.maximum : source.maxHone !== undefined ? source.maxHone : rawLevels.length
        if (source.enabled === true && Number(rawMax || 0) === 0 && rawLevels.length === 0) {
            rawMax = 1
            rawLevels = [{level: 1, baseChance: 100, cost: {spirit: 0, money: 0}, bonuses: [], materials: []}]
        }
        var maxLevel = wholeNumber(rawMax, 0, "Maximum hone level")
        if (maxLevel > MAX_HONE_LEVEL) fail("Maximum hone level must be at most " + MAX_HONE_LEVEL + ".")
        if (rawLevels.length > maxLevel) fail("Hone level rows exceed maximum hone level.")
        var enabled = source.enabled === false ? false : source.enabled === true || maxLevel > 0 || rawLevels.length > 0
        var levels = [], seen = {}, sorted = [], honeRowIds = {}
        for (var i = 0; i < rawLevels.length; i++) {
            var raw = rawLevels[i] || {}
            var level = wholeNumber(raw.level !== undefined ? raw.level : raw.target !== undefined ? raw.target : i + 1, 0, "Hone level")
            if (!level || level > maxLevel) fail("Hone level must be between 1 and maximum hone level.")
            if (seen[level]) fail("Duplicate hone level: " + level)
            seen[level] = true
            sorted.push({raw: raw, level: level})
        }
        sorted.sort(function(a, b) { return a.level - b.level })
        if (enabled && maxLevel > 0) for (var expected = 1; expected <= maxLevel; expected++) if (!seen[expected]) fail("Missing hone level row: " + expected)
        for (var s = 0; s < sorted.length; s++) {
            var entry = sorted[s], rowSource = entry.raw
            var counts = {}, bonusSource = rowSource.bonuses !== undefined ? rowSource.bonuses : rowSource.bonus !== undefined ? rowSource.bonus : rowSource.statBonuses
            var bonuses = Array.isArray(bonusSource) ? bonusSource : bonusSource ? [bonusSource] : []
            var normalizedBonuses = []
            for (var b = 0; b < bonuses.length; b++) normalizedBonuses.push(normalizeHoneBonus(bonuses[b], entry.level, b, counts, honeRowIds))
            var chance = optionalNumber(rowSource.baseChance !== undefined ? rowSource.baseChance : rowSource.successChance !== undefined ? rowSource.successChance : rowSource.chance, 0, "Hone level " + entry.level + " chance")
            if (chance < 0 || chance > 100) fail("Hone level " + entry.level + " chance must be between 0 and 100.")
            var cost = costFrom(rowSource, "Hone level " + entry.level)
            var levelMaterials = rowSource.materials !== undefined ? rowSource.materials : rowSource.materialPolicies !== undefined ? rowSource.materialPolicies : rowSource.requiredMaterials
            levels.push({level: entry.level, baseChance: chance, chance: chance, cost: cost, spiritCost: cost.spirit, moneyCost: cost.money, onFailure: ["keep", "destroy", "reset"].indexOf(rowSource.onFailure) >= 0 ? rowSource.onFailure : "keep", bonuses: normalizedBonuses, materials: materialList(levelMaterials, "Hone level " + entry.level)})
        }
        return {version: Number(source.version || HONE_VERSION), enabled: enabled, maxLevel: maxLevel, levels: levels, materials: materialList(source.materials !== undefined ? source.materials : source.materialPolicies, "Hone"), policyRevision: clean(source.policyRevision !== undefined ? source.policyRevision : source.revision, 64)}
    }
    function normalizeReroll(value) {
        var source = value === true ? {enabled: true} : value && typeof value === "object" ? clone(value) : {}
        var configured = Object.keys(source).length > 0
        var enabled = source.enabled === true || (source.enabled === undefined && configured && (source.cost || source.defaultCost || source.materials || source.materialPolicies || source.costByRarity || source.itemCosts))
        var rawByRarity = source.costByRarity !== undefined ? source.costByRarity : source.rarityCosts
        var byRarity = {}
        if (rawByRarity && typeof rawByRarity === "object") {
            var rarityKeys = Object.keys(rawByRarity)
            for (var i = 0; i < rarityKeys.length; i++) byRarity[rarityKeys[i]] = normalizeCost(rawByRarity[rarityKeys[i]], "Reroll " + rarityKeys[i])
        }
        var rawByItem = source.costByItem !== undefined ? source.costByItem : source.itemCosts
        var byItem = {}
        if (rawByItem && typeof rawByItem === "object") {
            var itemKeys = Object.keys(rawByItem)
            for (var j = 0; j < itemKeys.length; j++) byItem[itemKeys[j]] = normalizeCost(rawByItem[itemKeys[j]], "Reroll " + itemKeys[j])
        }
        var floor = source.minimumQuality !== undefined ? source.minimumQuality : source.qualityFloor !== undefined ? source.qualityFloor : source.refinedFloor
        if (floor !== undefined && (optionalNumber(floor, 0, "Reroll quality floor") < 0 || Number(floor) > 1)) fail("Reroll quality floor must be between 0 and 1.")
        return {version: Number(source.version || REROLL_VERSION), enabled: enabled, allowPerfect: source.allowPerfect === true, cost: costFrom(source.defaultCost !== undefined ? {cost: source.defaultCost} : source, "Reroll"), costByRarity: byRarity, costByItem: byItem, materials: materialList(source.materials !== undefined ? source.materials : source.materialPolicies, "Reroll"), minimumQuality: floor === undefined ? 0 : Number(floor), policyRevision: clean(source.policyRevision !== undefined ? source.policyRevision : source.revision, 64)}
    }
    function normalizeInstance(value) {
        var data = value && typeof value === "object" ? value : null
        if (!data || data.invalid) return data
        if (data.honeLevel === undefined) data.honeLevel = data.honingLevel === undefined ? data.hone : data.honingLevel
        if (data.honeLevel === undefined) data.honeLevel = 0
        if (!isFinite(Number(data.honeLevel)) || Number(data.honeLevel) < 0 || Number(data.honeLevel) % 1) data.invalid = true
        else data.honeLevel = Number(data.honeLevel)
        if (data.stateRevision === undefined) data.stateRevision = data.itemStateRevision === undefined ? 1 : Number(data.itemStateRevision)
        if (!isFinite(Number(data.stateRevision)) || Number(data.stateRevision) < 1 || Number(data.stateRevision) > MAX_SAFE_INTEGER || Number(data.stateRevision) % 1) data.stateRevision = 1
        data.stateRevision = Number(data.stateRevision)
        return data
    }
    function bumpStateRevision(data) {
        var current = Number(data && data.stateRevision || 1)
        if (!isFinite(current) || current < 1 || current >= MAX_SAFE_INTEGER) fail("Item state revision is exhausted.")
        data.stateRevision = current + 1
        return data.stateRevision
    }
    function stableUuid(key) {
        return String(Java.type("java.util.UUID").nameUUIDFromBytes(new (Java.type("java.lang.String"))(String(key)).getBytes("UTF-8")))
    }
    function uuidParts(key) {
        var value = stableUuid(key).replace(/-/g, "")
        return [parseInt(value.substring(0, 8), 16) | 0, parseInt(value.substring(8, 16), 16) | 0, parseInt(value.substring(16, 24), 16) | 0, parseInt(value.substring(24, 32), 16) | 0]
    }
    function stripNativeAttributes(stack) {
        var nbt = stack.getNbt()
        if (!nbt.has("AttributeModifiers")) return []
        var existing = nbt.getList("AttributeModifiers", 10)
        var kept = []
        for (var i = 0; existing && i < existing.length; i++) {
            var name = String(existing[i].getString("Name") || "")
            if (name.indexOf("arvan.registry.item.") !== 0 && name.indexOf("arvan.registry.hone.") !== 0) kept.push(existing[i])
        }
        if (kept.length) nbt.setList("AttributeModifiers", kept)
        else nbt.remove("AttributeModifiers")
        return kept
    }
    function honeRows(template, level) {
        var policy = normalizeHoning(template && template.honing)
        var target = Math.max(0, Math.floor(Number(level) || 0)), out = []
        for (var i = 0; i < policy.levels.length; i++) {
            var entry = policy.levels[i]
            if (entry.level > target) break
            for (var j = 0; j < entry.bonuses.length; j++) {
                var row = clone(entry.bonuses[j])
                row.value = Number(row.value === undefined ? row.min : row.value)
                row.honeLevel = entry.level
                row.label = bonusDisplayName(row) + " (+" + entry.level + ")"
                out.push(row)
            }
        }
        return out
    }
    function projectionRows(data, template) {
        var rolls = data.rolls || [], hone = honeRows(template, data.honeLevel), rows = []
        for (var i = 0; i < rolls.length; i++) {
            var roll = clone(rolls[i])
            if (!roll.rowId) roll.rowId = rowIdentity(roll, i + 1)
            rows.push({layer: "roll", row: roll})
        }
        for (var j = 0; j < hone.length; j++) rows.push({layer: "hone", row: hone[j]})
        return rows
    }
    function migrateRollRows(template, data) {
        var source = Array.isArray(data.rolls) ? data.rolls : [], out = []
        for (var i = 0; i < source.length; i++) {
            var row = clone(source[i]), wanted = template.bonuses && template.bonuses[i] ? template.bonuses[i] : null
            if (row.rowId || row.statRowId || row.stableId) out.push(row)
            else {
                if (wanted) row.rowId = wanted.rowId || rowIdentity(wanted, i + 1)
                else row.rowId = rowIdentity(row, i + 1)
                out.push(row)
            }
        }
        return out
    }
    function writeModifier(modifiers, data, template, layer, row, index) {
        var amount = Number(row.value === undefined ? row.min : row.value)
        if (row.type !== "attribute" || !isFinite(amount) || amount === 0) return
        var attributeId = String(row.id)
        if (attributeId.indexOf("minecraft:") === 0) attributeId = attributeId.substring(10)
        var rowId = String(row.rowId || row.statRowId || row.stableId || rowIdentity(row, index + 1))
        var key = "arvan.registry." + (layer === "roll" ? "item" : layer) + "." + data.serial + "." + rowId
        var modifier = API.stringToNbt("{}")
        modifier.putString("AttributeName", attributeId)
        modifier.putString("Name", key)
        modifier.setDouble("Amount", amount)
        modifier.setInteger("Operation", Number(row.operation || 0))
        modifier.setIntegerArray("UUID", uuidParts(key))
        modifier.putString("Slot", template.slot)
        modifiers.push(modifier)
    }
    function applyNativeAttributes(stack, template, data) {
        var modifiers = stripNativeAttributes(stack)
        if (!data.identified || template.slot === "none") return false
        var itemTag = stack.getNbt()
        itemTag.setInteger("HideFlags", Number(itemTag.getInteger("HideFlags") || 0) | 2)
        var serialChanged = false
        if (!data.serial) {
            data.serial = String(Java.type("java.util.UUID").randomUUID())
            serialChanged = true
        }
        var projection = projectionRows(data, template), rollRows = [], honeProjection = []
        for (var i = 0; i < projection.length; i++) {
            var entry = projection[i]
            writeModifier(modifiers, data, template, entry.layer, entry.row, i)
            if (entry.layer === "roll") rollRows.push({rowId: String(entry.row.rowId), value: Number(entry.row.value === undefined ? entry.row.min : entry.row.value)})
            else honeProjection.push({rowId: String(entry.row.rowId), value: Number(entry.row.value === undefined ? entry.row.min : entry.row.value), level: Number(entry.row.honeLevel || 0)})
        }
        if (modifiers.length) stack.getNbt().setList("AttributeModifiers", modifiers)
        var layers = data.layers && typeof data.layers === "object" ? data.layers : {}
        var nextRoll = {version: 1, revision: Number(data.revision || 0), rows: rollRows}
        var nextHone = {version: 1, level: Number(data.honeLevel || 0), rows: honeProjection}
        var changed = JSON.stringify(layers.roll || null) !== JSON.stringify(nextRoll) || JSON.stringify(layers.hone || null) !== JSON.stringify(nextHone)
        data.layers = layers
        data.layers.roll = nextRoll
        data.layers.hone = nextHone
        return changed || serialChanged
    }
    function load(world) {
        var raw = String(world.getStoreddata().get(KEY) || "")
        if (raw === cacheText && cache) return cache
        var data = raw ? JSON.parse(raw) : {version: 1, templates: {}, revisions: {}, sets: {}}
        if (data.version !== 1 || !data.templates || !data.revisions || !data.sets) fail("Unsupported or damaged item registry. Existing data was preserved.")
        cacheText = raw
        cache = data
        return data
    }
    function store(world, data) {
        world.getStoreddata().put(KEY, JSON.stringify(data))
        cacheText = null
    }
    function meta(stack) {
        if (!stack || stack.isEmpty()) return null
        var tag = stack.getNbt()
        if (!tag.has(TAG)) return null
        try {
            var value = JSON.parse(String(tag.getString(TAG)))
            return value && value.schema === 1 && value.template ? normalizeInstance(value) : {invalid: true}
        } catch (error) { return {invalid: true} }
    }
    function fromSnbt(world, snbt) {
        if (!snbt) return null
        try { return meta(world.createItemFromNbt(API.stringToNbt(String(snbt)))) } catch (error) { return null }
    }
    function stamp(stack, data) { stack.getNbt().putString(TAG, JSON.stringify(data)) }
    function snapshot(world, data) {
        var db = load(world)
        return data && !data.invalid ? db.revisions[data.template + "@" + data.revision] : null
    }
    function serviceTemplate(world, data) {
        var historical = snapshot(world, data)
        if (!historical) return null
        var latest = load(world).templates[data.template]
        if (!latest || Number(latest.revision || 0) <= Number(data.revision || 0)) return historical
        var merged = clone(historical)
        merged.honing = clone(latest.honing)
        merged.reroll = clone(latest.reroll)
        return merged
    }
    function rule(world, templateId) {
        var rules = getEquipmentRegistry(world)
        var keys = Object.keys(rules)
        for (var i = 0; i < keys.length; i++) if (String(rules[keys[i]].registryItemId || "") === templateId) return {key: keys[i], value: rules[keys[i]]}
        return null
    }
    function normalizeBonus(value, fixed) {
        var type = ["points", "effectiveness", "attribute"].indexOf(value.type) >= 0 ? value.type : "attribute"
        var key = type === "attribute" ? clean(value.id).toLowerCase() : normalizeStatKey(value.id)
        if (type === "attribute") {
            if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(key)) fail("Choose a registered Minecraft/mod attribute.")
            var catalog = ensureStatAttributesScanned()
            var exists = false
            for (var c = 0; c < catalog.length; c++) if (catalog[c].id === key) exists = true
            if (!exists) fail("Attribute is not registered: " + key)
        } else if (!getStatDefinition(key)) fail("Character stat is not registered: " + key)
        var min = preciseNumber(value.min, -1000000, 1000000, "Minimum")
        var max = fixed ? min : preciseNumber(value.max, min, 1000000, "Maximum")
        var op = Number(value.operation || 0)
        if ([0, 1, 2].indexOf(op) < 0) fail("Invalid attribute operation.")
        return {type: type, id: key, label: normalizedBonusLabel(value.label, key), min: min, max: max, operation: type === "attribute" ? op : 0}
    }
    function rarityBonus(value, rarity) {
        var b = clone(value)
        var range = b.ranges && b.ranges[rarity] ? b.ranges[rarity] : b
        b.min = range.min
        b.max = range.max
        delete b.ranges
        return b
    }
    function normalizeItemBonus(value, occurrenceMap) {
        var ranges = value.ranges && typeof value.ranges === "object" ? value.ranges : {}
        var base = normalizeBonus(rarityBonus(value, "Common"), false)
        var counts = occurrenceMap || {}
        var key = rowKey(value)
        counts[key] = (counts[key] || 0) + 1
        base.rowId = rowIdentity(value, counts[key])
        base.ranges = {}
        for (var i = 0; i < rarities.length; i++) {
            var rarity = rarities[i]
            var source = own(ranges, rarity) ? ranges[rarity] : value
            var min = preciseNumber(source.min, -1000000, 1000000, rarity + " minimum")
            var max = preciseNumber(source.max, min, 1000000, rarity + " maximum")
            base.ranges[rarity] = {min: min, max: max}
        }
        base.min = base.ranges.Common.min
        base.max = base.ranges.Common.max
        return base
    }
    function saveTemplate(world, input) {
        var t = clone(input)
        t.name = clean(t.name, 90)
        if (!t.name || !t.baseSnbt) fail("Capture a base item and enter its name.")
        var db = clone(load(world))
        t.id = id(t.id || automaticId(db.templates, t.name, "item"))
        if (db.templates[t.id] && Number(t.revision || 0) !== Number(db.templates[t.id].revision || 0)) fail("This item changed in another editor. Refresh before saving again.")
        if (slots.indexOf(t.slot) < 0) fail("Choose an equipment slot or None for ordinary items.")
        t.rarityWeights = normalizeRarityWeights(t.rarityWeights)
        delete t.rarity
        t.category = clean(t.category || "Misc", 40)
        t.description = String(t.description || "").substring(0, 1800)
        t.lore = String(t.lore || loreDefaults(world).lore).substring(0, 3000)
        t.unknownLore = String(t.unknownLore || "Unidentified {item_type}\nVisit an Identifier to reveal this item.").substring(0, 1500)
        t.unknownName = clean(t.unknownName || "???", 90)
        t.identification = t.identification !== false
        delete t.showRarity
        t.showRanges = t.showRanges !== false
        t.archived = !!t.archived
        t.setId = clean(t.setId, 64)
        if (t.setId && (!db.sets[t.setId] || ["feet", "legs", "chest", "head"].indexOf(t.slot) < 0)) fail("Sets require a registered set and an armor slot.")
        if (!Array.isArray(t.bonuses) || t.bonuses.length > 32) fail("At most 32 stat rows per item.")
        var rowCounts = {}, rowIds = {}
        t.bonuses = t.bonuses.map(function(row) {
            var normalized = normalizeItemBonus(row, rowCounts)
            if (rowIds[normalized.rowId]) fail("Duplicate stat row ID: " + normalized.rowId)
            rowIds[normalized.rowId] = true
            return normalized
        })
        t.honing = normalizeHoning(t.honing !== undefined ? t.honing : t.hone !== undefined ? t.hone : t.honingPolicy)
        t.reroll = normalizeReroll(t.reroll !== undefined ? t.reroll : t.rerollPolicy !== undefined ? t.rerollPolicy : t.rerolling)
        delete t.hone
        delete t.honingPolicy
        delete t.rerollPolicy
        delete t.rerolling
        if (String(t.baseSnbt) === "undefined" || String(t.baseSnbt) === "null") fail("Capture the held appearance again before saving.")
        var base = world.createItemFromNbt(API.stringToNbt(String(t.baseSnbt)))
        if (!base || base.isEmpty()) fail("Base item no longer exists.")
        base.setStackSize(1)
        base.getNbt().remove(TAG)
        stripNativeAttributes(base)
        if (t.slot !== "none") base.getNbt().setBoolean("Unbreakable", true)
        t.baseSnbt = itemSnbt(base)
        if (db.templates[t.id]) {
            var previous = clone(db.templates[t.id]), candidate = clone(t)
            delete previous.revision
            delete candidate.revision
            if (JSON.stringify(previous) === JSON.stringify(candidate)) return clone(db.templates[t.id])
        }
        t.revision = db.templates[t.id] ? Number(db.templates[t.id].revision) + 1 : 1
        db.templates[t.id] = t
        db.revisions[t.id + "@" + t.revision] = clone(t)
        store(world, db)
        return t
    }
    function saveSet(world, input) {
        var s = clone(input)
        s.name = clean(s.name, 90)
        if (!s.name) fail("Enter a set name.")
        var db = clone(load(world))
        s.id = id(s.id || automaticId(db.sets, s.name, "set"))
        if (!Array.isArray(s.bonuses) || s.bonuses.length > 32) fail("At most 32 set bonus rows.")
        s.bonuses = s.bonuses.map(function(row) {
            var b = normalizeBonus(row, true)
            b.pieces = number(row.pieces, 1, 4, "Pieces")
            if (b.pieces % 1) fail("Pieces must be a whole number.")
            return b
        })
        db.sets[s.id] = s
        store(world, db)
        return s
    }
    function rounded(value) {
        var result = Math.round(Number(value) * 1000000) / 1000000
        return result === 0 ? 0 : result
    }
    function rollPrecision(value) {
        var parts = String(Math.abs(Number(value))).toLowerCase().split("e")
        var dot = parts[0].indexOf(".")
        var decimals = dot < 0 ? 0 : parts[0].length - dot - 1
        return Math.max(0, decimals - Number(parts[1] || 0))
    }
    function preciseNumber(value, min, max, label) {
        var result = number(value, min, max, label)
        if (rollPrecision(result) > 6) fail(label + " supports at most 6 decimal places.")
        return result === 0 ? 0 : result
    }
    function quantize(value, precision) {
        var scale = Math.pow(10, precision), result = Math.round(Number(value) * scale) / scale
        return result === 0 ? 0 : rounded(result)
    }
    function quantizeUp(value, precision) {
        var scale = Math.pow(10, precision), result = Math.ceil((Number(value) - 1e-12) * scale) / scale
        return result === 0 ? 0 : rounded(result)
    }
    function canonicalRange(row, rarity) {
        var b = rarityBonus(row, rarity), min = Number(b.min), max = Number(b.max)
        if (!isFinite(min) || !isFinite(max) || min > max) fail("Saved stat range is invalid.")
        var precision = Math.max(rollPrecision(min), rollPrecision(max))
        if (precision > 6) fail("Saved stat range supports at most 6 decimal places.")
        return {min: min, max: max, precision: precision}
    }
    function sampledRange(row, rarity, random, floor) {
        var range = canonicalRange(row, rarity), min = range.min
        if (range.min === range.max) return range.min === 0 ? 0 : range.min
        if (floor !== undefined) min = Math.min(range.max, Math.max(range.min, quantizeUp(floor, range.precision)))
        var value = min + randomUnit(random) * (range.max - min)
        value = quantize(value, range.precision)
        if (value < min) value = min
        if (value > range.max) value = range.max
        return value === 0 ? 0 : rounded(value)
    }
    function roll(rows, random, rarity) {
        var source = Array.isArray(rows) ? rows : [], counts = {}, out = [], rng = random || Math.random
        for (var i = 0; i < source.length; i++) {
            var row = source[i], b = rarityBonus(row, rarity), key = rowKey(row)
            counts[key] = (counts[key] || 0) + 1
            var range = canonicalRange(row, rarity)
            b.rowId = row.rowId || row.statRowId || row.stableId || rowIdentity(row, counts[key])
            b.value = sampledRange(row, rarity, rng)
            b.min = range.min
            b.max = range.max
            b.label = normalizedBonusLabel(b.label, b.id)
            out.push(b)
        }
        return out
    }
    function bonusText(b, ranges) {
        var value = b.value === undefined ? b.min : b.value
        var suffix = b.type === "effectiveness" ? " percentage points" : b.type === "attribute" && b.operation ? " (" + (b.operation === 1 ? "multiply base" : "multiply total") + ")" : ""
        return bonusDisplayName(b) + ": " + (value >= 0 ? "+" : "") + rounded(value) + suffix + (ranges && b.min !== b.max ? " [" + b.min + "–" + b.max + "]" : "")
    }
    function loreBonusRows(rows) {
        return (rows || []).map(function(row) {
            var value = clone(row)
            value.label = normalizedBonusLabel(value.label, value.id)
            return value
        })
    }
    function loreDefaults(world) {
        var source = load(world).loreDefaults || {}, defaults = {lore: defaultLore, statHeader: "&8═╬══&7✦ &fStats &7✦&8══╬═", statLine: " {icon} {value_color}{value} {name_color}{name}{hone}{range}", honeStat: " &6{value}", honeName: " &6+{level}"}
        Object.keys(defaults).forEach(function(key) { if (source[key] !== undefined) defaults[key] = String(source[key]) })
        return defaults
    }
    function combinedStats(template, data) {
        var rows = loreBonusRows(data.rolls || []), additions = honeRows(template, data.honeLevel)
        for (var i = 0; i < additions.length; i++) {
            var bonus = additions[i], target = null
            for (var j = 0; j < rows.length; j++) if (rows[j].type === bonus.type && rows[j].id === bonus.id && Number(rows[j].operation || 0) === Number(bonus.operation || 0)) { target = rows[j]; break }
            if (!target) { target = clone(bonus); target.label = bonusDisplayName(bonus).replace(/ \(\+\d+\)$/, ""); target.value = 0; target.min = target.max = 0; rows.push(target) }
            target.value = Number(target.value === undefined ? target.min : target.value) + Number(bonus.value)
            target.hone = Number(target.hone || 0) + Number(bonus.value)
        }
        return rows
    }
    function statsLore(rows, showRanges, slot, formats) {
        if (typeof ADM_ITEM_EDITOR !== "undefined" && ADM_ITEM_EDITOR.registeredStatsLore) return ADM_ITEM_EDITOR.registeredStatsLore(loreBonusRows(rows), showRanges, slot, formats)
        return (rows || []).map(function(row) { return bonusText(row, showRanges) }).join("\n")
    }
    function replaceOwnedLore(current, previous, next) {
        var source = Array.isArray(current) ? current.slice() : [], oldRows = Array.isArray(previous) ? previous : [], nextRows = Array.isArray(next) ? next : []
        var insertAt = -1
        function removeBlocks(rows) {
            if (!rows.length) return
            for (var i = 0; i <= source.length - rows.length;) {
                var matches = true
                for (var j = 0; j < rows.length; j++) if (String(source[i + j]) !== String(rows[j])) { matches = false; break }
                if (!matches) { i++; continue }
                if (insertAt < 0 || i < insertAt) insertAt = i
                source.splice(i, rows.length)
            }
        }
        removeBlocks(oldRows)
        if (JSON.stringify(oldRows) !== JSON.stringify(nextRows)) removeBlocks(nextRows)
        if (insertAt >= 0) {
            if (nextRows.length) source.splice.apply(source, [Math.min(insertAt, source.length), 0].concat(nextRows))
            return source
        }
        if (oldRows.length) {
            for (var old = 0; old < oldRows.length; old++) {
                var found = -1
                for (var fromEnd = source.length - 1; fromEnd >= 0; fromEnd--) if (String(source[fromEnd]) === String(oldRows[old])) { found = fromEnd; break }
                if (found >= 0) source.splice(found, 1)
            }
        }
        if (!nextRows.length) return source
        return source.concat(nextRows)
    }
    function ownedName(stack, template, data, color, formats) {
        var current = String(stack.getDisplayName() || ""), previous = data.generatedName ? String(data.generatedName) : "", oldSuffix = data.honeSuffix ? String(data.honeSuffix) : "", suffix = Number(data.honeLevel || 0) > 0 ? String(formats.honeName).replace(/\{level\}/g, String(data.honeLevel)).replace(/&([0-9a-fk-or])/gi, "§$1") : ""
        var stem, fallback = ADM_ITEM_EDITOR.rarityName(template.name, data.rarity), untouched = !current || (stack.getName && current === String(stack.getName()))
        if (data.nameStem === color + template.name) data.nameStem = fallback
        if (data.nameOwned === false) return current
        if (!previous || current === previous) stem = data.nameStem ? String(data.nameStem) : data.nameOwned === true || untouched ? fallback : current
        else {
            stem = current
            if (oldSuffix && data.nameStem && stem.indexOf(String(data.nameStem)) === 0 && stem.substring(stem.length - oldSuffix.length) === oldSuffix) stem = stem.substring(0, stem.length - oldSuffix.length)
        }
        var next = stem + suffix
        var changed = current !== next || data.generatedName !== next || data.nameStem !== stem || data.honeSuffix !== suffix || data.nameOwned !== true
        data.nameStem = stem
        data.honeSuffix = suffix
        data.generatedName = next
        data.nameOwned = true
        if (changed) stack.setCustomName(next)
        return next
    }
    function layoutLore(layout, replacements) {
        var lore = []
        String(layout).split(/\r?\n/).forEach(function(line) {
            var text = line.replace(/\{([a-z_]+)\}/g, function(token, key) { return own(replacements, key) ? replacements[key] : token })
            if (line.trim() && !text.trim()) return
            text.split("\n").forEach(function(part) { lore.push(part.replace(/&([0-9a-fk-or])/gi, "§$1")) })
        })
        return lore
    }
    function honeLore(template, level) {
        var rows = honeRows(template, level), lines = []
        if (Number(level || 0) <= 0) return lines
        lines.push("§6Honing +" + Number(level))
        for (var i = 0; i < rows.length; i++) lines.push("§7" + bonusText(rows[i], false))
        return lines
    }
    function render(world, stack, options) {
        var m = meta(stack)
        var t = snapshot(world, m)
        if (!t) fail("Item template revision is unavailable.")
        options = options || {}
        var rarity = m.identified && rarities.indexOf(m.rarity) >= 0 ? m.rarity : m.identified && rarities.indexOf(t.rarity) >= 0 ? t.rarity : "Common"
        var color = colors[rarities.indexOf(rarity)] || "§f"
        var types = {mainhand: "Weapon", offhand: "Offhand", feet: "Boots", legs: "Leggings", chest: "Chestplate", head: "Helmet"}
        var formats = loreDefaults(world)
        stack.getNbt().setInteger("HideFlags", Number(stack.getNbt().getInteger("HideFlags") || 0) | 4)
        var replacements = {rarity: color + rarity, item_type: types[t.slot] || t.category, description: t.description, rolled_stats: "", hone_bonuses: "", requirements: "", set_name: "", set_bonuses: ""}
        var generated = []
        if (!m.identified) {
            var changed = false
            if (own(m, "rarity")) { delete m.rarity; changed = true }
            if (own(m, "rolls")) { delete m.rolls; changed = true }
            if (own(m, "serial")) { delete m.serial; changed = true }
            if (own(m, "layers") && m.layers && m.layers.roll) { delete m.layers.roll; changed = true }
            if (changed) stamp(stack, m)
            stripNativeAttributes(stack)
            replacements.rarity = ""
            replacements.description = ""
            stack.setCustomName("§7" + t.unknownName)
            generated = layoutLore(t.unknownLore, replacements)
            stack.setLore(generated)
            m.generatedLore = generated
            stamp(stack, m)
        } else {
            var migratedRolls = migrateRollRows(t, m)
            if (JSON.stringify(migratedRolls) !== JSON.stringify(m.rolls || [])) m.rolls = migratedRolls
            if (m.rarity !== rarity) m.rarity = rarity
            ownedName(stack, t, m, color, formats)
            applyNativeAttributes(stack, t, m)
            replacements.rolled_stats = statsLore(combinedStats(t, m), t.showRanges, t.slot, formats)
            replacements.hone_bonuses = honeLore(t, m.honeLevel).join("\n")
            var found = rule(world, t.id)
            if (found) {
                var r = found.value
                var lines = ["§7Requires Level " + (r.level || 1)]
                if (normalizeEquipmentClassIds(r).length) lines.push("§7Classes: " + formatEquipmentClassNames(world, r))
                var stats = normalizeEquipmentStatRequirements(r)
                Object.keys(stats).sort().forEach(function(key) { lines.push("§7Requires " + stats[key] + " " + key) })
                replacements.requirements = lines.join("\n")
            }
            var set = t.setId ? load(world).sets[t.setId] : null
            if (set) {
                replacements.set_name = "§6" + set.name + " Set"
                replacements.set_bonuses = set.bonuses.map(function(b) { return "§8" + b.pieces + " pieces: " + bonusText(b, false) }).join("\n")
            }
            if (t.slot !== "none") stack.getNbt().setBoolean("Unbreakable", true)
            generated = layoutLore(t.lore, replacements)
            var preservedLore = Array.isArray(m.foreignLore) ? m.foreignLore.slice() : []
            if (!Array.isArray(m.foreignLore)) {
                try { preservedLore = plainLore(world.createItemFromNbt(API.stringToNbt(t.baseSnbt))) }
                catch (ignored) { preservedLore = [] }
            }
            var mergedLore = preservedLore.concat(generated)
            stack.setLore(mergedLore)
            m.foreignLore = preservedLore
            m.generatedLore = generated
            stamp(stack, m)
        }
        return stack
    }
    function create(world, templateId, identified, random, revision) {
        var db = load(world)
        var t = revision ? db.revisions[templateId + "@" + revision] : db.templates[templateId]
        if (!t) fail("Item is missing: " + templateId)
        if (!revision && t.archived) fail("Item is archived: " + templateId)
        identified = identified === undefined ? !t.identification : !!identified
        var data = {schema: 1, template: t.id, revision: t.revision, identified: identified, honeLevel: 0, stateRevision: 1}
        if (identified) {
            var source = random || Math.random
            data.rarity = selectRarity(t.rarityWeights, source)
            data.serial = String(Java.type("java.util.UUID").randomUUID())
            data.rolls = roll(t.bonuses || [], source, data.rarity)
        }
        // A plain placeholder cannot expose enchantments, native attributes or pFeatures.
        var stack = identified ? world.createItemFromNbt(API.stringToNbt(t.baseSnbt)) : world.createItem("minecraft:paper", 1)
        if (!stack || stack.isEmpty()) fail("Cannot create the base item.")
        stack.setStackSize(1)
        if (identified) {
            data.nameStem = ADM_ITEM_EDITOR.rarityName(t.name, data.rarity)
            data.nameOwned = true
            data.honeSuffix = ""
        }
        if (identified) data.foreignLore = plainLore(stack)
        stamp(stack, data)
        return render(world, stack)
    }
    function createSaved(world, templateId, identified) {
        var t = load(world).templates[templateId]
        if (!t) fail("Saved item is missing: " + templateId)
        if (t.archived) fail("Item is archived: " + templateId)
        return create(world, t.id, identified, Math.random, t.revision)
    }
    function validation(player, stack) {
        var m = meta(stack)
        if (!m) return null
        if (m.invalid || !snapshot(player.getWorld(), m)) return {passed: false, failures: ["Registered item data is unavailable."]}
        if (!m.identified) return {passed: true, failures: []}
        return null
    }
    function eligible(player, stack) {
        return validateEquipment(player, stack).passed
    }
    function check(player, requirements) {
        var previous = checking
        checking = true
        try { return checkRequirements(player, requirements) } finally { checking = previous }
    }
    function collect(player) {
        var out = {points: {}, effectiveness: {}, attributes: {}, sets: {}}
        function add(b, includeAttribute) {
            var value = Number(b.value === undefined ? b.min : b.value)
            if (!isFinite(value)) return
            if (b.type === "attribute" && !includeAttribute) return
            var target = b.type === "attribute" ? out.attributes : out[b.type]
            if (!target) return
            var key = b.type === "attribute" ? b.id + "|" + Number(b.operation || 0) : b.id
            // Multiply-total rows compose instead of incorrectly summing percentages.
            target[key] = b.type === "attribute" && b.operation === 2 ? (1 + (target[key] || 0)) * (1 + value) - 1 : (target[key] || 0) + value
        }
        var equipped = [{slot: "mainhand", stack: player.getMainhandItem()}, {slot: "offhand", stack: player.getOffhandItem()}]
        for (var i = 0; i < 4; i++) equipped.push({slot: slots[i + 3], stack: player.getArmor(i)})
        for (var j = 0; j < equipped.length; j++) {
            var entry = equipped[j]
            var m = meta(entry.stack)
            var t = snapshot(player.getWorld(), m)
            if (!t || !m.identified || t.slot !== entry.slot || !eligible(player, entry.stack)) continue
            var rolls = m.rolls || []
            rolls.forEach(function(b) { add(b, false) })
            honeRows(t, m.honeLevel).forEach(function(b) { add(b, false) })
            if (j >= 2 && t.setId) out.sets[t.setId] = (out.sets[t.setId] || 0) + 1
        }
        var sets = load(player.getWorld()).sets
        Object.keys(out.sets).forEach(function(key) {
            if (sets[key]) sets[key].bonuses.forEach(function(b) { if (out.sets[key] >= b.pieces) add(b, true) })
        })
        return out
    }
    function bonus(player, key, type) {
        if (checking) return 0
        var current = totals[String(player.getName())]
        return current && current[type] ? Number(current[type][key] || 0) : 0
    }
    function modifierId(key) {
        return stableUuid("arvan.registry." + key)
    }
    function sync(player, force) {
        var name = String(player.getName())
        var next = collect(player)
        var previous = totals[name]
        totals[name] = next
        var stored = player.getStoreddata()
        var old = JSON.parse(String(stored.get("arvanRegistryModifiers") || "{}"))
        var all = Object.keys(old)
        Object.keys(next.attributes).forEach(function(key) { if (all.indexOf(key) < 0) all.push(key) })
        for (var i = 0; i < all.length; i++) {
            var key = all[i]
            if (!force && previous && old[key] === next.attributes[key]) continue
            var bits = key.split("|")
            var uuid = modifierId(key)
            var command = "attribute " + name + " " + bits[0] + " modifier "
            if (own(old, key)) API.executeCommand(player.getWorld(), command + "remove " + uuid)
            var value = next.attributes[key]
            if (value) API.executeCommand(player.getWorld(), command + "add " + uuid + " arvan_registry " + rounded(value) + " " + ["add", "multiply_base", "multiply"][Number(bits[1])])
        }
        if (JSON.stringify(old) !== JSON.stringify(next.attributes)) stored.put("arvanRegistryModifiers", JSON.stringify(next.attributes))
        if (force || !previous || JSON.stringify(previous.points) !== JSON.stringify(next.points) || JSON.stringify(previous.effectiveness) !== JSON.stringify(next.effectiveness)) applyAllAttributes(player)
    }
    function inventorySignature(stack) { return !stack || stack.isEmpty() ? "" : itemSnbt(stack) }
    function identify(player, selectedSlot, expected, fee) {
        selectedSlot = Number(selectedSlot)
        if (!isFinite(selectedSlot) || selectedSlot % 1 || selectedSlot < 0 || selectedSlot > 8) fail("Selected item changed. Select it again.")
        var inv = player.getInventory()
        var source = inv.getSlot(selectedSlot)
        if (inventorySignature(source) !== expected) fail("Selected item changed. Select it again.")
        var m = meta(source)
        if (!m || m.invalid || m.identified) fail("Select an unidentified registered item.")
        var cost = normalizeCost(fee, "Identification"), spiritBefore = getSpiritBalance(player), moneyBefore = getNormalMoneyBalance(player)
        if (spiritBefore < cost.spirit || moneyBefore < cost.money) fail("Not enough Spirit or Gold to identify this item.")
        var outputSlot = selectedSlot
        if (source.getStackSize() > 1) {
            outputSlot = -1
            for (var i = 0; i < 9; i++) if (!inv.getSlot(i) || inv.getSlot(i).isEmpty()) { outputSlot = i; break }
            if (outputSlot < 0) fail("Leave one empty hotbar slot for the identified item.")
        }
        var changes = []
        if (fee && fee.snbt) {
            var required = player.getWorld().createItemFromNbt(API.stringToNbt(fee.snbt))
            var remaining = number(fee.count, 1, 9999, "Identification cost")
            if (remaining % 1) fail("Identification cost must be a whole number.")
            for (var slot = 0; slot < 9 && remaining > 0; slot++) {
                if (slot === selectedSlot || slot === outputSlot) continue
                var costStack = inv.getSlot(slot)
                if (!costStack || costStack.isEmpty() || !equipmentStacksMatch(costStack, required)) continue
                var take = Math.min(remaining, costStack.getStackSize())
                var after = costStack.copy()
                after.setStackSize(costStack.getStackSize() - take)
                changes.push({slot: slot, before: costStack.copy(), after: after})
                remaining -= take
            }
            if (remaining > 0) fail("Required payment is missing from your hotbar.")
        }
        // Build and validate the result before touching payment or the source stack.
        var result = create(player.getWorld(), m.template, true, Math.random, m.revision)
        var resultData = meta(result), resultTemplate = snapshot(player.getWorld(), resultData), hiddenLevel = Number(m.honeLevel || 0)
        if (hiddenLevel > 0 && resultTemplate && normalizeHoning(resultTemplate.honing).enabled && hiddenLevel <= normalizeHoning(resultTemplate.honing).maxLevel) {
            resultData.honeLevel = hiddenLevel
            resultData.stateRevision = Number(m.stateRevision || 1)
            stamp(result, resultData)
            render(player.getWorld(), result)
        }
        var remainder = source.copy()
        remainder.setStackSize(source.getStackSize() - 1)
        changes.push({slot: selectedSlot, before: source.copy(), after: outputSlot === selectedSlot ? result : remainder})
        if (outputSlot !== selectedSlot) changes.push({slot: outputSlot, before: inv.getSlot(outputSlot) ? inv.getSlot(outputSlot).copy() : player.getWorld().createItem("minecraft:air", 1), after: result})
        var spiritPaid = false, moneyPaid = false
        try {
            if (cost.spirit) { if (!setSpiritBalance(player, spiritBefore - cost.spirit).ok) fail("Could not charge Spirit."); spiritPaid = true }
            if (cost.money) { if (!setNormalMoneyBalance(player, moneyBefore - cost.money).ok) fail("Could not charge Gold."); moneyPaid = true }
            for (var c = 0; c < changes.length; c++) inv.setSlot(changes[c].slot, changes[c].after)
            player.updatePlayerInventory()
            for (var v = 0; v < changes.length; v++) if (inventorySignature(inv.getSlot(changes[v].slot)) !== inventorySignature(changes[v].after)) fail("Inventory rejected the change.")
        } catch (error) {
            if (spiritPaid) setSpiritBalance(player, spiritBefore)
            if (moneyPaid) setNormalMoneyBalance(player, moneyBefore)
            for (var r = changes.length - 1; r >= 0; r--) inv.setSlot(changes[r].slot, changes[r].before)
            player.updatePlayerInventory()
            throw error
        }
        return result
    }
    function itemSignature(stack) { return inventorySignature(stack) }
    function serviceItem(world, stack, operation) {
        if (!stack || stack.isEmpty()) fail("Select a registered item.")
        if (stack.getStackSize() !== 1) fail("Service equipment must have a quantity of one.")
        var data = meta(stack), template = serviceTemplate(world, data)
        if (!data || data.invalid || !template) fail("Registered item data is unavailable.")
        if (!data.identified) fail("Unidentified items cannot be used for " + operation + ".")
        if (template.slot === "none") fail("Only registered equipment can be used for " + operation + ".")
        if (!data.serial) fail("Registered item has no instance serial.")
        return {data: data, template: template}
    }
    function itemRows(template, data) {
        var rows = [], source = template.bonuses || [], current = data.rolls || [], used = {}
        for (var i = 0; i < source.length; i++) {
            var wanted = source[i], row = null
            for (var j = 0; j < current.length; j++) {
                var candidate = current[j]
                if (used[j]) continue
                if ((wanted.rowId && candidate.rowId === wanted.rowId) || (!wanted.rowId && j === i) || (wanted.rowId && candidate.statRowId === wanted.rowId)) { row = candidate; used[j] = true; break }
            }
            if (!row && wanted.rowId && current[i] && !used[i] && !current[i].rowId && !current[i].statRowId && !current[i].stableId) { row = current[i]; used[i] = true }
            if (!row) row = rarityBonus(wanted, data.rarity)
            row = clone(row)
            row.rowId = wanted.rowId || row.rowId || row.statRowId || rowIdentity(wanted, i + 1)
            row.type = wanted.type
            row.id = wanted.id
            row.label = normalizedBonusLabel(wanted.label, wanted.id)
            row.operation = Number(wanted.operation || 0)
            var range = canonicalRange(wanted, data.rarity)
            row.min = range.min
            row.max = range.max
            row.value = Number(row.value === undefined ? row.min : row.value)
            if (!isFinite(row.value) || row.value < range.min || row.value > range.max) fail("Saved stat value is outside its configured range.")
            row.value = quantize(row.value, range.precision)
            rows.push(row)
        }
        return rows
    }
    function qualityDetails(template, data) {
        var rows = itemRows(template, data), variable = [], all = [], total = 0
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i], min = Number(row.min), max = Number(row.max), value = Number(row.value)
            if (min === max) { all.push({rowId: String(row.rowId), label: bonusDisplayName(row), type: row.type, id: row.id, value: value, min: min, max: max, quality: null, fixed: true}); continue }
            var quality = (value - min) / (max - min)
            quality = Math.max(0, Math.min(1, quality))
            var detail = {rowId: String(row.rowId), label: bonusDisplayName(row), type: row.type, id: row.id, value: value, min: min, max: max, quality: rounded(quality), fixed: false}
            variable.push(detail)
            all.push(detail)
            total += quality
        }
        return {rows: variable, allRows: all, variableCount: variable.length, quality: variable.length ? rounded(total / variable.length) : null, perfect: !!variable.length && variable.every(function(row) { return row.value >= row.max }), noStats: !variable.length}
    }
    function findLevel(policy, level) {
        for (var i = 0; i < policy.levels.length; i++) if (policy.levels[i].level === level) return policy.levels[i]
        return null
    }
    function submittedMaterial(value) {
        if (value && typeof value.getItemNbt === "function") {
            var data = meta(value)
            return {id: data && data.template ? data.template : String(value.getName()), quantity: Number(value.getStackSize() || 1)}
        }
        if (typeof value === "string") return {id: value, quantity: 1}
        var source = value && typeof value === "object" ? value : {}
        return {id: clean(source.templateId !== undefined ? source.templateId : source.registeredItemId !== undefined ? source.registeredItemId : source.materialId !== undefined ? source.materialId : source.id, 120), quantity: wholeNumber(source.quantity !== undefined ? source.quantity : source.count, 1, "Material quantity"), role: clean(source.role !== undefined ? source.role : source.type, 40).toLowerCase().replace(/[ _-]+/g, ""), chancePoints: source.chancePoints !== undefined ? Number(source.chancePoints) : undefined, qualityFloor: source.qualityFloor !== undefined ? Number(source.qualityFloor) : undefined}
    }
    function materialPolicy(policies, materialId) {
        for (var i = 0; i < policies.length; i++) if (String(policies[i].id) === String(materialId)) return policies[i]
        return null
    }
    function materialPlan(policies, submitted, target, label) {
        var values = Array.isArray(submitted) ? submitted : submitted ? [submitted] : []
        if (!policies.length) { if (values.length) fail("No stone is configured for this item."); return [] }
        if (values.length !== 1) fail("Choose one stone.")
        var entry = submittedMaterial(values[0]), policy = materialPolicy(policies, id(entry.id))
        if (!policy || Number(entry.quantity) !== 1) fail("Choose exactly one configured stone.")
        if (target < policy.minTarget || target > policy.maxTarget) fail((policy.name || policy.id) + " cannot be used at this hone level.")
        var reroll = label === "Reroll material"
        return [{id: policy.id, snbt: policy.snbt, name: policy.name || policy.id, quantity: 1, chancePoints: Number(policy.chancePoints || 0), contribution: rounded(Number(policy.chancePoints || 0)), role: policy.role, qualityFloor: policy.qualityFloor, guarantee: !!policy.guarantee, consumeOnSuccess: reroll || policy.consumeOnSuccess, consumeOnFailure: reroll || policy.consumeOnFailure, required: true}]
    }
    function roundCurrency(value, unitScale) {
        var unit = optionalNumber(unitScale, 1, "Currency unit")
        if (unit <= 0 || unit > MAX_SAFE_INTEGER) fail("Currency unit must be greater than 0.")
        var result = Math.ceil((Number(value) - 1e-12) / unit) * unit
        if (!isFinite(result) || result < 0 || result > MAX_SAFE_INTEGER) fail("Currency cost exceeds supported range.")
        return result === 0 ? 0 : result
    }
    function feePart(base, multiplier, flat, unitScale) {
        var value = optionalNumber(base, 0, "Currency cost"), factor = optionalNumber(multiplier, 1, "NPC multiplier"), extra = optionalNumber(flat, 0, "NPC fee")
        if (value < 0 || factor < 0 || extra < 0) fail("Currency cost and NPC fees must be nonnegative.")
        return {base: wholeNumber(value, 0, "Currency base"), multiplier: factor, flatFee: wholeNumber(extra, 0, "NPC flat fee"), total: roundCurrency(value * factor, unitScale) + wholeNumber(extra, 0, "NPC flat fee")}
    }
    function quoteCost(baseCost, npcPolicy, unitScale) {
        var base = baseCost && typeof baseCost === "object" ? baseCost : {money: baseCost}
        var npc = npcPolicy && typeof npcPolicy === "object" ? npcPolicy : {}, spiritMultiplier = npc.spiritMultiplier !== undefined ? npc.spiritMultiplier : npc.multiplier, moneyMultiplier = npc.moneyMultiplier !== undefined ? npc.moneyMultiplier : npc.multiplier, spiritFlat = npc.spiritFlatFee !== undefined ? npc.spiritFlatFee : npc.flatFee, moneyFlat = npc.moneyFlatFee !== undefined ? npc.moneyFlatFee : npc.flatFee
        return {spirit: feePart(base.spirit !== undefined ? base.spirit : base.spiritCost, spiritMultiplier, spiritFlat, unitScale), money: feePart(base.money !== undefined ? base.money : base.moneyCost !== undefined ? base.moneyCost : base.currency, moneyMultiplier, moneyFlat, unitScale)}
    }
    function resolveRerollCost(policy, template, rarity, options) {
        options = options || {}
        var base = policy.cost
        if (own(policy.costByItem, template.id)) base = policy.costByItem[template.id]
        else if (own(policy.costByRarity, rarity)) base = policy.costByRarity[rarity]
        var quoted = quoteCost(base, options.npc || options.npcFee, options.unitScale)
        return {spirit: quoted.spirit.total, money: quoted.money.total, breakdown: quoted}
    }
    function quoteId(value) { return stableUuid("arvan.registry.quote." + JSON.stringify(value)) }
    function quoteDigest(value) {
        var copy = clone(value)
        delete copy.quoteId
        return quoteId(copy)
    }
    function quoteHone(world, stack, materials, options) {
        options = options || {}
        if (materials && !Array.isArray(materials) && typeof materials === "object" && typeof materials.getItemNbt !== "function" && (materials.materials !== undefined || materials.npc || materials.npcFee || materials.unitScale || materials.allowZero !== undefined)) { options = materials; materials = options.materials }
        var item = serviceItem(world, stack, "honing"), data = item.data, template = item.template, policy = normalizeHoning(template.honing)
        if (!policy.enabled || !policy.maxLevel) fail("Honing is disabled for this item.")
        if (data.honeLevel > policy.maxLevel) fail("Item hone level exceeds its configured maximum.")
        var target = data.honeLevel + 1, level = findLevel(policy, target)
        if (!level) fail("Hone level " + target + " is not configured.")
        var policies = level.materials.length ? level.materials : policy.materials, plan = materialPlan(policies, materials, target, "Honing material"), contribution = 0, guaranteed = false, floor = null
        for (var i = 0; i < plan.length; i++) { contribution += plan[i].contribution; if (plan[i].guarantee) guaranteed = true }
        contribution = rounded(contribution)
        var chance = guaranteed ? 100 : rounded(Math.min(100, level.baseChance + contribution))
        if (chance <= 0 && !guaranteed && options.allowZero !== true) fail("A 0% hone attempt is disabled.")
        var costs = quoteCost(level.cost, options.npc || options.npcFee, options.unitScale), signature = itemSignature(stack)
        var quote = {version: HONE_VERSION, operation: "hone", template: data.template, revision: data.revision, serial: data.serial, stateRevision: data.stateRevision, signature: signature, currentLevel: data.honeLevel, targetLevel: target, maxLevel: policy.maxLevel, baseChance: level.baseChance, materialContribution: contribution, finalChance: chance, guaranteed: guaranteed, materials: plan, cost: {spirit: costs.spirit.total, money: costs.money.total}, costBreakdown: costs, failure: {action: level.onFailure, rule: equipmentServiceFailureRule(level.onFailure), level: level.onFailure === "reset" ? 0 : data.honeLevel, consumes: plan.filter(function(material) { return material.consumeOnFailure }).map(function(material) { return material.id })}, success: {level: target, consumes: plan.filter(function(material) { return material.consumeOnSuccess }).map(function(material) { return material.id })}, policyRevision: policy.policyRevision || String(policy.version)}
        quote.quoteId = quoteId(quote)
        return quote
    }
    function verifyQuote(world, stack, quote, operation) {
        var expectedVersion = operation === "hone" ? HONE_VERSION : REROLL_VERSION
        if (!quote || quote.operation !== operation || Number(quote.version) !== expectedVersion || !quote.quoteId) fail("Service quote is unavailable.")
        var item = serviceItem(world, stack, operation)
        if ((quote.quoteId && String(quote.quoteId) !== String(quoteDigest(quote))) || String(quote.template) !== String(item.data.template) || Number(quote.revision) !== Number(item.data.revision) || String(quote.serial) !== String(item.data.serial) || Number(quote.stateRevision) !== Number(item.data.stateRevision) || String(quote.signature) !== itemSignature(stack)) fail("Service quote is stale. Request a new quote.")
        return item
    }
    function applyHone(world, stack, level) {
        var item = serviceItem(world, stack, "honing"), policy = normalizeHoning(item.template.honing), target = wholeNumber(level, 0, "Hone level")
        if (target > policy.maxLevel || (!policy.enabled && target > 0)) fail("Hone level must be between 0 and " + policy.maxLevel + ".")
        var copy = stack.copy(), data = meta(copy)
        if (Number(data.honeLevel || 0) !== target) {
            data.honeLevel = target
            bumpStateRevision(data)
        }
        stamp(copy, data)
        return render(world, copy)
    }
    function resolveHone(world, stack, quote, random) {
        var item = verifyQuote(world, stack, quote, "hone"), rng = random || Math.random, chance = Number(quote.finalChance), value = quote.guaranteed || chance >= 100 ? null : randomUnit(rng), success = quote.guaranteed || chance >= 100 || value * 100 < chance
        var copy = stack.copy()
        if (success) copy = applyHone(world, copy, quote.targetLevel)
        else if (quote.failure && quote.failure.action === "destroy") copy = world.createItem("minecraft:air", 1)
        else if (quote.failure && quote.failure.action === "reset") copy = applyHone(world, copy, 0)
        return {operation: "hone", quoteId: quote.quoteId, success: success, randomValue: value, item: copy, stack: copy, beforeSignature: quote.signature, afterSignature: itemSignature(copy), currentLevel: quote.currentLevel, resultingLevel: success ? quote.targetLevel : quote.failure && quote.failure.action !== "keep" ? 0 : quote.currentLevel}
    }
    function hone(world, stack, materials, random, options) {
        if (random && typeof random !== "function" && !options) { options = random; random = null }
        var quote = materials && materials.operation === "hone" ? materials : quoteHone(world, stack, materials, options)
        if (typeof random !== "function") random = Math.random
        return resolveHone(world, stack, quote, random)
    }
    function rerollPolicies(policy, submitted) {
        var source = Array.isArray(submitted) ? submitted : submitted ? [submitted] : []
        if (!policy.materials.length) {
            if (source.length) fail("No reroll stone is configured for this item.")
            return []
        }
        return materialPlan(policy.materials, source, 0, "Reroll material")
    }
    function rerollMode(plan, policy, options) {
        options = options || {}
        var floor = policy.minimumQuality
        for (var i = 0; i < plan.length; i++) {
            if (plan[i].guarantee || plan[i].role === "perfect") return {mode: "perfect", floor: 1}
            if (plan[i].role === "refined" || plan[i].qualityFloor !== undefined) floor = Math.max(floor, Number(plan[i].qualityFloor || 0))
        }
        if (floor > 0) return {mode: "refined", floor: Math.min(1, floor)}
        return {mode: "normal", floor: 0}
    }
    function quoteReroll(world, stack, materials, options) {
        options = options || {}
        if (materials && !Array.isArray(materials) && typeof materials === "object" && typeof materials.getItemNbt !== "function" && (materials.materials !== undefined || materials.npc || materials.npcFee || materials.unitScale || materials.mode || materials.allowPerfect !== undefined)) { options = materials; materials = options.materials }
        var item = serviceItem(world, stack, "rerolling"), data = item.data, template = item.template, policy = normalizeReroll(template.reroll)
        if (!policy.enabled) fail("Rerolling is disabled for this item.")
        var quality = qualityDetails(template, data)
        if (quality.noStats) fail("No rerollable stats.")
        if (quality.perfect && !policy.allowPerfect) fail("Item already has a Perfect Roll.")
        var plan = rerollPolicies(policy, materials), mode = rerollMode(plan, policy, options), costs = resolveRerollCost(policy, template, data.rarity, options)
        var quote = {version: REROLL_VERSION, operation: "reroll", template: data.template, revision: data.revision, serial: data.serial, stateRevision: data.stateRevision, signature: itemSignature(stack), rarity: data.rarity, honeLevel: data.honeLevel, currentRolls: clone(data.rolls || []), current: quality, ranges: (quality.allRows || quality.rows).map(function(row) { return {rowId: row.rowId, label: row.label, min: row.min, max: row.max, fixed: !!row.fixed} }), materials: plan, mode: mode.mode, qualityFloor: mode.floor, cost: {spirit: costs.spirit, money: costs.money}, costBreakdown: costs.breakdown, policyRevision: policy.policyRevision || String(policy.version)}
        quote.quoteId = quoteId(quote)
        return quote
    }
    function rerollRows(template, data, quote, random) {
        var current = itemRows(template, data), out = [], floor = quote.mode === "refined" ? quote.qualityFloor : undefined
        for (var i = 0; i < current.length; i++) {
            var row = current[i], source = template.bonuses[i], range = canonicalRange(source, data.rarity)
            if (range.min === range.max) { row.value = row.value; out.push(row); continue }
            if (quote.mode === "perfect") row.value = range.max
            else row.value = sampledRange(source, data.rarity, random || Math.random, floor === undefined ? undefined : range.min + floor * (range.max - range.min))
            row.min = range.min
            row.max = range.max
            out.push(row)
        }
        return out
    }
    function resolveReroll(world, stack, quote, random) {
        verifyQuote(world, stack, quote, "reroll")
        var copy = stack.copy(), data = meta(copy), rows = rerollRows(snapshot(world, data), data, quote, random || Math.random)
        data.rolls = rows
        bumpStateRevision(data)
        stamp(copy, data)
        copy = render(world, copy)
        return {operation: "reroll", quoteId: quote.quoteId, item: copy, stack: copy, beforeSignature: quote.signature, afterSignature: itemSignature(copy), current: quote.current, proposed: qualityDetails(snapshot(world, meta(copy)), meta(copy)), mode: quote.mode, honePreserved: Number(meta(copy).honeLevel || 0) === Number(quote.honeLevel || 0)}
    }
    function reroll(world, stack, quoteOrMaterials, random, options) {
        if (random && typeof random !== "function" && !options) { options = random; random = null }
        var quote = quoteOrMaterials && quoteOrMaterials.operation === "reroll" ? quoteOrMaterials : quoteReroll(world, stack, quoteOrMaterials, options)
        if (typeof random !== "function") random = Math.random
        return resolveReroll(world, stack, quote, random)
    }
    function migrateInstance(world, stack) {
        if (!stack || stack.isEmpty()) fail("Select a registered item.")
        var data = meta(stack), template = snapshot(world, data)
        if (!data || data.invalid || !template) fail("Registered item data is unavailable.")
        var copy = stack.copy(), migrated = meta(copy)
        migrated.rolls = migrateRollRows(template, migrated)
        if (!migrated.serial && migrated.identified) migrated.serial = String(Java.type("java.util.UUID").randomUUID())
        migrated.stateRevision = Number(migrated.stateRevision || 1)
        stamp(copy, migrated)
        return render(world, copy)
    }
    function layers(stack) {
        var data = meta(stack)
        return data && data.layers ? clone(data.layers) : {roll: null, hone: {version: 1, level: Number(data && data.honeLevel || 0), rows: []}}
    }
    function project(world, stack, patch) {
        if (!stack || stack.isEmpty()) fail("Select a registered item.")
        var copy = stack.copy(), data = meta(copy), changes = patch && typeof patch === "object" ? patch : {}
        if (!data || data.invalid) fail("Registered item data is unavailable.")
        if (changes.honeLevel !== undefined) data.honeLevel = wholeNumber(changes.honeLevel, 0, "Hone level")
        if (changes.rolls !== undefined) data.rolls = clone(changes.rolls)
        if (changes.rarity !== undefined) data.rarity = String(changes.rarity)
        if (changes.stateRevision !== undefined) data.stateRevision = wholeNumber(changes.stateRevision, 1, "Item state revision")
        else if (changes.honeLevel !== undefined || changes.rolls !== undefined || changes.rarity !== undefined) bumpStateRevision(data)
        stamp(copy, data)
        return render(world, copy)
    }
    function recover(player) {
        var stored = player.getStoreddata()
        var pending = JSON.parse(String(stored.get("arvanRegistryReturnedItems") || "[]"))
        if (!pending.length) return
        var stack = player.getWorld().createItemFromNbt(API.stringToNbt(pending[0]))
        if (player.giveItem(stack)) { pending.shift(); stored.put("arvanRegistryReturnedItems", JSON.stringify(pending)) }
    }
    function refreshLore(player) {
        function refresh(stack, setter) {
            if (!meta(stack) || !snapshot(player.getWorld(), meta(stack))) return
            var updated = stack.copy()
            render(player.getWorld(), updated)
            if (inventorySignature(updated) !== inventorySignature(stack)) setter(updated)
        }
        refresh(player.getMainhandItem(), function(stack) { player.setMainhandItem(stack) })
        refresh(player.getOffhandItem(), function(stack) { player.setOffhandItem(stack) })
        for (var slot = 0; slot < 4; slot++) (function(index) { refresh(player.getArmor(index), function(stack) { player.setArmor(index, stack) }) })(slot)
    }
    function enforce(player) {
        function remove(stack, setter) {
            var m = meta(stack)
            if (!m || eligible(player, stack)) return
            // Persistent escrow prevents lost equipment when the inventory is full.
            var stored = player.getStoreddata()
            var pending = JSON.parse(String(stored.get("arvanRegistryReturnedItems") || "[]"))
            pending.push(itemSnbt(stack))
            stored.put("arvanRegistryReturnedItems", JSON.stringify(pending))
            setter(player.getWorld().createItem("minecraft:air", 1))
            player.message("§eRegistered equipment removed: requirements not met. It will return when inventory space is available.")
        }
        for (var i = 0; i < 4; i++) (function(slot) { remove(player.getArmor(slot), function(empty) { player.setArmor(slot, empty) }) })(i)
        // Unidentified placeholders remain ordinary paper until identification.
        var main = player.getMainhandItem(), off = player.getOffhandItem()
        if (meta(main) && meta(main).identified) remove(main, function(empty) { player.setMainhandItem(empty) })
        if (meta(off) && meta(off).identified) remove(off, function(empty) { player.setOffhandItem(empty) })
    }
    function reset(player) { delete totals[String(player.getName())] }
    function start(player) { reset(player); player.getTimers().forceStart(TIMER, 1, true) }
    function tick(player) {
        enforce(player)
        var temp = player.getTempdata()
        var now = Number(player.getWorld().getTotalTime())
        materialPickerTick(player, now)
        if (now % 10 === 0) recover(player)
        if (now % 20 === 0) refreshLore(player)
        // Bonuses are reconciled every tick; commands only run when totals change.
        sync(player, !totals[String(player.getName())])
        if (temp.has("arvanRegistryIdentifyRequest")) {
            var request = JSON.parse(String(temp.get("arvanRegistryIdentifyRequest")))
            temp.remove("arvanRegistryIdentifyRequest")
            if (Date.now() - Number(request.at || 0) < 3000) {
                temp.put("arvanRegistryIdentifySession", JSON.stringify({until: Date.now() + 60000, fee: request.fee || null}))
                openIdentifier(player)
            }
        }
        var rewards = player.getStoreddata()
        if (rewards.has("arvanRegistryGiveQueue")) {
            var queue = JSON.parse(String(rewards.get("arvanRegistryGiveQueue")))
            if (queue.length) {
                var next = queue[0]
                if (!next.snbt) {
                try { next.snbt = itemSnbt(create(player.getWorld(), String(next.id), next.identified)) }
                    catch (error) { queue.shift(); rewards.put("arvanRegistryGiveQueue", JSON.stringify(queue)); player.message("§cReward unavailable: " + error.message); return }
                    rewards.put("arvanRegistryGiveQueue", JSON.stringify(queue))
                }
                if (player.giveItem(player.getWorld().createItemFromNbt(API.stringToNbt(next.snbt)))) {
                    queue.shift()
                    if (queue.length) rewards.put("arvanRegistryGiveQueue", JSON.stringify(queue))
                    else rewards.remove("arvanRegistryGiveQueue")
                }
            }
        }
    }
    function state(player) {
        var name = String(player.getName())
        if (!sessions[name]) {
            var saved = player.getStoreddata().get(SESSION_KEY)
            try { sessions[name] = saved ? JSON.parse(String(saved)) : null } catch (ignored) { sessions[name] = null }
            if (!sessions[name] || !sessions[name].view) sessions[name] = {view: "list", kind: "items", page: 0, query: "", selected: "", tab: "Template", row: -1}
        }
        return sessions[name]
    }
    function remember(player, value) { player.getStoreddata().put(SESSION_KEY, JSON.stringify(value)) }
    function fresh(player) {
        var stack = player.getMainhandItem()
        if (!stack || stack.isEmpty()) fail("Hold the base item you designed in the pFeatures editor.")
        if (meta(stack) && !meta(stack).identified) fail("Use an identified item as the base.")
        var copy = stack.copy()
        copy.setStackSize(1)
        copy.getNbt().remove(TAG)
        var slot = "none"
        try { if (copy.isWearable()) slot = ["feet", "legs", "chest", "head"][Number(copy.getArmorSlot())] || "none" } catch (ignored) {}
        if (slot === "none" && /sword|axe|bow|trident|spear|staff/.test(String(copy.getName()))) slot = "mainhand"
        var lore = copy.getLore() || []
        var name = String(copy.getDisplayName()).replace(/§./g, "")
        return {id: automaticId(load(player.getWorld()).templates, name, "item"), name: name, category: "Misc", rarityWeights: defaultRarityWeights(), slot: slot, description: Array.prototype.join.call(lore, "\n"), identification: true, showRanges: true, unknownName: "???", unknownLore: "Unidentified {item_type}\nVisit an Identifier to reveal this item.", lore: loreDefaults(player.getWorld()).lore, setId: "", bonuses: [], baseSnbt: itemSnbt(copy)}
    }
    function text(gui, component, fallback) { var field = gui.getComponent(component); return field ? String(field.getText()) : fallback }
    function label(gui, component, value, x, y, width) { gui.addLabel(component, String(value), x, y, width || 220, 12) }
    function field(gui, component, title, value, x, y, width, height) {
        label(gui, component + 1000, "§f" + title, x, y, width)
        var input = height ? gui.addTextArea(component, x, y + 14, width, height) : gui.addTextField(component, x, y + 14, width, 20)
        input.setText(String(value === undefined ? "" : value))
        return input
    }
    function button(gui, component, title, x, y, width) { return gui.addButton(component, title, x, y, width || 100, 20) }
    function rarityButtons(gui, firstId, y, selected) {
        for (var i = 0; i < rarities.length; i++) {
            var rarity = rarities[i]
            button(gui, firstId + i, colors[i] + (rarity === selected ? "[" + rarity + "]" : rarity), 12 + i * 79, y, 74)
        }
    }
    function shell(player, guiId, title, backTitle) {
        var gui = API.createCustomGui(guiId, 500, 330, false, player)
        gui.addTexturedRect(1, "minecraft:textures/block/gray_concrete.png", 0, 0, 500, 330)
        gui.addTexturedRect(2, "minecraft:textures/block/gray_concrete.png", 3, 3, 494, 324)
        gui.addTexturedRect(3, "minecraft:textures/block/gold_block.png", 3, 3, 494, 2)
        label(gui, 4, "§6§l" + title, 12, 12, 430)
        button(gui, 5, backTitle || "Back", 428, 8, 60)
        return gui
    }
    function capture(player, gui) {
        var s = state(player), d = s.draft
        if (s.view === "list") { s.query = text(gui, 10, s.query); return }
        if (!d) return
        if (s.view === "edit" && s.tab === "Template") {
            d.id = text(gui, 10, d.id); d.name = text(gui, 11, d.name)
            if (s.kind === "items") { d.category = text(gui, 12, d.category); d.description = text(gui, 13, d.description); d.unknownName = text(gui, 14, d.unknownName) }
        }
        if (s.view === "edit" && s.tab === "Lore") { d.lore = text(gui, 10, d.lore); d.unknownLore = text(gui, 11, d.unknownLore) }
        if (s.view === "rarity") {
            if (!s.rarityDraft) s.rarityDraft = clone(d.rarityWeights || defaultRarityWeights())
            for (var i = 0; i < rarities.length; i++) s.rarityDraft[rarities[i]] = text(gui, 80 + i, s.rarityDraft[rarities[i]])
        }
        if (s.view === "bonus") {
            s.bonus.label = text(gui, 12, s.bonus.label)
            s.bonus.min = text(gui, 13, s.bonus.min); s.bonus.max = text(gui, 14, s.bonus.max)
            s.bonus.pieces = text(gui, 16, s.bonus.pieces)
        }
    }
    function ensureBonusRanges(bonus) {
        var ranges = bonus.ranges && typeof bonus.ranges === "object" ? bonus.ranges : {}
        var out = {}
        for (var i = 0; i < rarities.length; i++) {
            var rarity = rarities[i]
            var source = own(ranges, rarity) ? ranges[rarity] : bonus
            out[rarity] = {min: source.min, max: source.max}
        }
        bonus.ranges = out
    }
    function saveBonusRange(s) {
        if (s.kind !== "items") return
        ensureBonusRanges(s.bonus)
        s.bonus.ranges[s.rangeRarity] = {min: s.bonus.min, max: s.bonus.max}
    }
    function loadBonusRange(s) {
        if (s.kind !== "items") return
        ensureBonusRanges(s.bonus)
        var b = rarityBonus(s.bonus, s.rangeRarity)
        s.bonus.min = b.min
        s.bonus.max = b.max
    }
    function choose(player, kind, title, values, labels) {
        var s = state(player)
        s.returnView = s.view
        s.view = "choose"; s.pick = kind; s.pickTitle = title; s.values = values; s.labels = labels || values; s.pickPage = 0
        open(player)
    }
    function plain(value) { return String(value || "").replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "") }
    function registryClientDraft(s, input) {
        var current = s.draft && typeof s.draft === "object" ? clone(s.draft) : s.kind === "sets" ? {id: "", name: "", bonuses: []} : null
        if (!current) fail("Create or select an item first.")
        var source = input && typeof input === "object" ? input : {}
        var fields = s.kind === "sets" ? ["id", "name", "bonuses"] : ["id", "name", "category", "rarityWeights", "slot", "description", "identification", "showRanges", "unknownName", "unknownLore", "lore", "setId", "bonuses", "honing", "reroll", "archived"]
        for (var i = 0; i < fields.length; i++) if (own(source, fields[i])) current[fields[i]] = clone(source[fields[i]])
        if (s.editingId) current.id = s.editingId
        return current
    }
    function registryState(player, message) {
        var s = state(player), db = load(player.getWorld()), entries = s.kind === "sets" ? db.sets : db.templates
        var list = Object.keys(entries).sort().map(function(key) {
            var row = entries[key]
            return {id: key, name: plain(row.name), category: plain(row.category || (s.kind === "sets" ? "Armor Set" : "Misc")), archived: !!row.archived}
        })
        var draft = s.draft && s.draftKind === s.kind ? clone(s.draft) : null
        if (draft) delete draft.baseSnbt
        var overlayItems = JSON.parse(String(player.getTempdata().get("admRegistryOverlays") || "[]")), iconSlots = {}
        overlayItems.forEach(function(item) { iconSlots[item.nbt] = item.slot })
        function icon(snbt) { if (snbt && iconSlots[snbt] === undefined) { iconSlots[snbt] = overlayItems.length; overlayItems.push({slot: overlayItems.length, nbt: snbt}) } }
        function preload(item) {
            if (!item) return
            icon(item.baseSnbt)
            var honing = item.honing || {}, reroll = item.reroll || {}, materials = (honing.materials || []).concat(reroll.materials || [])
            ;(honing.levels || []).forEach(function(level) { materials = materials.concat(level.materials || []) })
            materials.forEach(function(material) { icon(material.snbt || (db.templates[material.id] || {}).baseSnbt) })
        }
        Object.keys(db.templates).forEach(function(key) { preload(db.templates[key]) })
        preload(s.draft)
        player.getTempdata().put("admRegistryOverlays", JSON.stringify(overlayItems))
        var statCatalog = []
        var attributes = ensureStatAttributesScanned()
        for (var a = 0; a < attributes.length; a++) statCatalog.push({type: "attribute", id: String(attributes[a].id), name: fallbackBonusName(attributes[a].id)})
        for (var k = 0; k < STAT_KEYS.length; k++) {
            var definition = getStatDefinition(STAT_KEYS[k])
            var statName = definition && definition.name ? String(definition.name) : String(STAT_KEYS[k])
            statCatalog.push({type: "points", id: String(STAT_KEYS[k]), name: statName})
            statCatalog.push({type: "effectiveness", id: String(STAT_KEYS[k]), name: statName + " Effectiveness"})
        }
        return {
            kind: s.kind,
            tab: s.htmlTab || "Template",
            honeLevel: s.honeLevel || 1,
            loreDefaults: loreDefaults(player.getWorld()),
            overlayItems: overlayItems,
            entries: list,
            selected: String(s.editingId || s.selected || ""),
            draft: draft,
            hasTemplate: !!(s.draft && s.draft.baseSnbt && String(s.draft.baseSnbt) !== "undefined"),
            sets: Object.keys(db.sets).sort().map(function(key) { return {id: key, name: plain(db.sets[key].name)} }),
            materials: Object.keys(db.templates).sort().filter(function(key) { return !db.templates[key].archived && db.templates[key].slot === "none" }).map(function(key) { return {id: key, name: plain(db.templates[key].name), slot: iconSlots[db.templates[key].baseSnbt]} }),
            rarities: rarities.slice(),
            slots: slots.slice(),
            statCatalog: statCatalog,
            message: String(message || s.message || ""),
            error: String(s.error || "")
        }
    }
    function registryPush(player, message) {
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("item_registry_update", JSON.stringify(registryState(player, message)))
    }
    function registryMaterialRows(draft, scope, level) {
        if (scope === "reroll") return draft.reroll && draft.reroll.materials
        if (scope === "shared") return draft.honing && draft.honing.materials
        return scope === "level" && draft.honing && draft.honing.levels[level] ? draft.honing.levels[level].materials : null
    }
    function materialPickerTick(player, now) {
        var temp = player.getTempdata(), raw = temp.get("admRegistryPicker")
        if (!raw) return
        var picker = JSON.parse(String(raw))
        if (!picker.at || now < picker.at) return
        delete picker.at
        if (picker.phase === "open_wait") {
            picker.phase = "slot"
            temp.put("admRegistryPicker", JSON.stringify(picker))
            var gui = API.createCustomGui(MATERIAL_GUI, 360, 240, false, player)
            addRpgFrame(gui, 360, 240, RPG_UI.gold)
            addRpgSlotFrame(gui, 8, 170, 69, RPG_UI.gold)
            addRpgInventorySlotFrames(gui, 10, 100, 105, RPG_UI.chrome)
            gui.addLabel(101, "§6§lSERVICE MATERIAL", 22, 14, 300, 16)
            gui.addLabel(102, "§7Place an item. Its full SNBT is copied.", 22, 43, 320, 12)
            gui.addItemSlot(170, 69)
            gui.showPlayerInventory(100, 105)
            gui.addButton(200, "§aUSE ITEM", 28, 210, 145, 20)
            gui.addButton(201, "§7CANCEL", 187, 210, 145, 20)
            player.showCustomGui(gui)
        } else if (picker.phase === "return_wait") {
            var s = state(player)
            s.draft = picker.draft
            s.draftKind = "items"
            remember(player, s)
            temp.remove("admRegistryPicker")
            open(player)
        }
    }
    function materialPickerClose(player, gui, save) {
        var temp = player.getTempdata(), raw = temp.get("admRegistryPicker")
        if (!raw) return
        var picker = JSON.parse(String(raw))
        if (picker.phase !== "slot") return
        var slot = gui.getSlots().get(0), stack = slot.getStack()
        if (save && (!stack || stack.isEmpty())) { player.message("§ePlace an item first."); return false }
        if (save) {
            var material = registryMaterialRows(picker.draft, picker.scope, picker.level)[picker.index], copy = stack.copy()
            copy.setStackSize(1)
            material.id = "material_" + stableUuid(itemSnbt(copy)).replace(/-/g, "")
            material.snbt = itemSnbt(copy)
            material.name = String(copy.getDisplayName())
        }
        if (stack && !stack.isEmpty()) { player.giveItem(stack); slot.setStack(player.getWorld().createItem("minecraft:air", 1)) }
        picker.phase = "return_wait"
        picker.at = Number(player.getWorld().getTotalTime()) + 10
        temp.put("admRegistryPicker", JSON.stringify(picker))
        return true
    }
    function registryHtml(player, data) {
        if (!isAdmin(player) || isArvanPersistenceFrozen(player)) return
        var action = String(data.action || "")
        if (["ready", "switch_kind", "select", "new", "capture", "save", "give", "archive", "requirements", "pick_material", "save_defaults", "close"].indexOf(action) < 0) return
        var s = state(player)
        if (data.tab) s.htmlTab = String(data.tab)
        if (data.honeLevel) s.honeLevel = Number(data.honeLevel)
        try {
            s.error = ""
            if (action === "save_defaults") {
                var dbDefaults = clone(load(player.getWorld())), formats = loreDefaults(player.getWorld())
                Object.keys(formats).forEach(function(key) { if (data.formats && data.formats[key] !== undefined) formats[key] = String(data.formats[key]).substring(0, key === "lore" ? 3000 : 300) })
                dbDefaults.loreDefaults = formats
                store(player.getWorld(), dbDefaults)
                if (data.draft) s.draft = registryClientDraft(s, data.draft)
                remember(player, s)
                registryPush(player, "Lore defaults saved.")
                return
            }
            if (action === "close") {
                remember(player, s)
                player.getTempdata().remove(HTML_ACTIVE_SESSION_KEY)
                cnpcext.getClientBridge(player.getMCEntity()).closeHtmlGui()
                return
            }
            if (action === "ready") { remember(player, s); registryPush(player, ""); return }
            if (action === "switch_kind") {
                s.kind = String(data.kind) === "sets" ? "sets" : "items"
                s.selected = ""
                s.editingId = ""
                delete s.draft
                delete s.draftKind
            } else if (action === "select") {
                var db = load(player.getWorld()), idValue = clean(data.id, 90), entry = (s.kind === "sets" ? db.sets : db.templates)[idValue]
                if (!entry) fail("That registry entry no longer exists.")
                s.selected = idValue
                s.editingId = idValue
                s.draft = clone(entry)
                s.draftKind = s.kind
            } else if (action === "new") {
                s.editingId = ""
                s.selected = ""
                s.draft = s.kind === "sets" ? {id: "", name: "", bonuses: []} : fresh(player)
                s.draftKind = s.kind
            } else {
                s.draft = registryClientDraft(s, data.draft)
                s.draftKind = s.kind
                if (action === "pick_material") {
                    var scope = String(data.scope), index = Number(data.index), levelIndex = Number(s.honeLevel || 1) - 1
                    var rows = registryMaterialRows(s.draft, scope, levelIndex)
                    if (!rows || !rows[index] || index % 1) fail("Select a material row first.")
                    player.getTempdata().put("admRegistryPicker", JSON.stringify({phase: "open_wait", at: Number(player.getWorld().getTotalTime()) + 10, draft: clone(s.draft), scope: scope, index: index, level: levelIndex}))
                    remember(player, s)
                    cnpcext.getClientBridge(player.getMCEntity()).closeHtmlGui()
                    return
                } else if (action === "capture") {
                    s.draft.baseSnbt = fresh(player).baseSnbt
                    s.message = "Held appearance captured."
                } else if (action === "save") {
                    persist(player)
                } else if (action === "archive") {
                    s.draft.archived = !s.draft.archived
                    persist(player)
                } else if (action === "give") {
                    if (!s.editingId) fail("Save this item before giving it.")
                    var identified = String(data.mode) !== "drop"
                    if (!player.giveItem(createSaved(player.getWorld(), s.editingId, identified))) fail("Inventory is full.")
                    s.message = identified ? "Identified item given." : "Drop template given."
                } else if (action === "requirements") {
                    editRequirements(player)
                    return
                }
            }
            remember(player, s)
            registryPush(player, "")
        } catch (error) {
            s.error = String(error.message || error)
            remember(player, s)
            registryPush(player, "")
        }
    }
    function open(player) {
        if (!isAdmin(player)) return
        if (typeof cnpcext === "undefined") { openNative(player); return }
        var s = state(player)
        if (s.kind !== "sets") s.kind = "items"
        s.error = ""
        s.message = ""
        remember(player, s)
        player.getTempdata().put(HTML_ACTIVE_SESSION_KEY, "ITEM_REGISTRY")
        cnpcext.openHtmlGui(player, ITEM_REGISTRY_HTML_FILE, 0, 0, JSON.stringify(registryState(player, "")))
    }
    function openNative(player) {
        if (!isAdmin(player)) return
        var s = state(player), d = s.draft
        var gui = shell(player, GUI, s.view === "list" ? "Item Registry" : s.view === "choose" ? s.pickTitle : s.view === "rarity" ? "Rarity Odds" : s.kind === "sets" ? "Armor Set" : "Registered Item", s.view === "bonus" || s.view === "rarity" ? "Cancel" : "Back")
        if (s.view === "list") {
            button(gui, 20, s.kind === "items" ? "[Items]" : "Items", 12, 38, 80); button(gui, 21, s.kind === "sets" ? "[Sets]" : "Sets", 98, 38, 80)
            field(gui, 10, "Search name / ID / category", s.query, 194, 27, 212)
            button(gui, 22, "Find", 414, 41, 74)
            var db = load(player.getWorld()), entries = s.kind === "sets" ? db.sets : db.templates
            s.list = Object.keys(entries).sort().filter(function(key) { var e = entries[key]; return (key + " " + e.name + " " + (e.category || "")).toLowerCase().indexOf(s.query.toLowerCase()) >= 0 })
            var listPages = Math.max(1, Math.ceil(s.list.length / PAGE))
            s.page = Math.max(0, Math.min(s.page, listPages - 1))
            var visible = s.list.slice(s.page * PAGE, (s.page + 1) * PAGE)
            var listScroll = gui.addScroll(30, 12, 72, 476, 186, visible.map(function(key) { var e = entries[key]; return (e.archived ? "§8[Archived] " : "§f") + e.name + " §7[" + key + "]" }))
            var listSelection = s.list.indexOf(s.selected) - s.page * PAGE
            if (listSelection >= 0 && listSelection < visible.length) listScroll.setDefaultSelection(listSelection)
            else s.selected = ""
            button(gui, 23, "<", 12, 268, 40).setEnabled(s.page > 0); button(gui, 24, ">", 56, 268, 40).setEnabled(s.page < listPages - 1)
            label(gui, 6, "§f" + s.list.length + " entries · page " + (s.page + 1) + " / " + listPages, 106, 273, 230)
            if (!s.list.length) label(gui, 7, "§eNo matches. Clear the search or register a new entry.", 90, 150, 330)
            if (s.draft && s.draftKind) button(gui, 29, "Resume draft", 350, 268, 138)
            button(gui, 25, s.kind === "sets" ? "New set" : "Register held", 12, 302, 126)
            button(gui, 26, "Edit", 146, 302, 78).setEnabled(!!s.selected)
            if (s.kind === "items") button(gui, 28, "Give selected", 232, 302, 112).setEnabled(!!s.selected && !entries[s.selected].archived)
            button(gui, 27, "pFeatures", s.kind === "items" ? 352 : 232, 302, s.kind === "items" ? 136 : 112)
        } else if (s.view === "choose") {
            var start = s.pickPage * PAGE
            gui.addScroll(30, 12, 40, 476, 242, s.labels.slice(start, start + PAGE))
            var pickPages = Math.max(1, Math.ceil(s.values.length / PAGE))
            button(gui, 23, "<", 12, 302, 50).setEnabled(s.pickPage > 0); button(gui, 24, ">", 68, 302, 50).setEnabled(s.pickPage < pickPages - 1)
            label(gui, 6, "§fPage " + (s.pickPage + 1) + " / " + pickPages, 130, 307)
        } else if (s.view === "rarity") {
            if (!s.rarityDraft) s.rarityDraft = clone(d.rarityWeights || defaultRarityWeights())
            var percentages = previewRarityPercentages(s.rarityDraft)
            for (var rarityIndex = 0; rarityIndex < rarities.length; rarityIndex++) {
                var rarity = rarities[rarityIndex]
                var column = rarityIndex < 3 ? 0 : 1
                var row = rarityIndex % 3
                var x = column ? 254 : 12
                var y = 44 + row * 70
                field(gui, 80 + rarityIndex, rarity + " weight", s.rarityDraft[rarity], x, y, 220)
                label(gui, 90 + rarityIndex, percentages ? colors[rarityIndex] + percentages[rarity] + "% chance" : "§cFix weights to calculate", x, y + 40, 220)
            }
            label(gui, 6, "§7Relative weights. 0 disables a rarity; at least one must be positive.", 12, 265, 476)
            if (s.error) label(gui, 7, "§c" + s.error, 12, 282, 476)
            button(gui, 86, "Apply to draft", 12, 302, 150)
            button(gui, 87, "Recalculate chances", 170, 302, 180)
        } else if (s.view === "bonus") {
            var b = s.bonus
            if (s.kind === "items" && rarities.indexOf(s.rangeRarity) < 0) s.rangeRarity = "Common"
            var typeNames = {attribute: "Item attribute", points: "Character points", effectiveness: "Stat effectiveness"}
            button(gui, 40, "Type: " + typeNames[b.type], 12, 42, 188)
            button(gui, 41, "Choose stat", 210, 42, 130)
            label(gui, 6, b.id ? "§f" + bonusDisplayName(b) + " §8[" + b.id + "]" : "§eSelect an attribute or character stat", 12, 70, 476)
            if (s.kind === "items") {
                rarityButtons(gui, 80, 90, s.rangeRarity)
                field(gui, 12, "Lore label (blank = automatic)", b.label, 12, 116, 300)
                field(gui, 13, s.rangeRarity + " minimum", b.min, 12, 164, 140)
                field(gui, 14, s.rangeRarity + " maximum", b.max, 254, 164, 234)
            } else {
                field(gui, 12, "Lore label (blank = automatic)", b.label, 12, 96, 300)
                field(gui, 13, "Bonus amount", b.min, 12, 144, 140)
                field(gui, 16, "Equipped pieces (1–4)", b.pieces, 170, 144, 140)
            }
            if (b.type === "attribute") button(gui, 42, "Operation: " + ["Add", "Multiply base", "Multiply total"][b.operation], 12, s.kind === "items" ? 214 : 206, 240)
            label(gui, 7, b.type === "effectiveness" ? "§7Amount adds percentage points: 50% + 5 = 55%." : "§7Random rounded value between min and max. Equal values stay fixed.", 12, 250, 476)
            if (s.error) label(gui, 8, "§c" + s.error, 12, 280, 476)
            button(gui, 43, "Apply to draft", 12, 302, 150)
        } else {
            var tabs = s.kind === "sets" ? ["Template", "Stats"] : ["Template", "Stats", "Lore", "Equipment", "Give"]
            tabs.forEach(function(tab, i) { button(gui, 50 + i, s.tab === tab ? "§a[" + tab + "]" : "§7" + tab, 12 + i * 96, 38, 90) })
            if (s.tab === "Template") {
                field(gui, 10, "Automatic ID", d.id || "Generated when saved", 12, 70, 226).setEnabled(false)
                field(gui, 11, "Name", d.name, 254, 70, 234)
                if (s.kind === "items") {
                    field(gui, 12, "Category", d.category, 12, 115, 226)
                    field(gui, 14, "Unidentified name", d.unknownName, 254, 115, 234)
                    button(gui, 60, "Rarity odds...", 12, 163, 150)
                    button(gui, 61, "Slot: " + d.slot, 174, 163, 150)
                    button(gui, 62, "Requires ID: " + (d.identification ? "Yes" : "No"), 336, 163, 152)
                    field(gui, 13, "Description / flavor text", d.description, 12, 191, 476, 52)
                    button(gui, 63, "Capture held appearance", 12, 268, 205)
                    label(gui, 6, "§7Equipment is always unbreakable.", 230, 272, 258)
                } else label(gui, 6, "§7Add bonuses by piece count. Thresholds accumulate.", 12, 130, 476)
            } else if (s.tab === "Stats") {
                if (rarities.indexOf(s.rangeRarity) < 0) s.rangeRarity = "Common"
                var rows = d.bonuses.slice(s.page * 8, (s.page + 1) * 8)
                var statPages = Math.max(1, Math.ceil(d.bonuses.length / 8))
                var actionY = s.kind === "items" ? 226 : 250
                var statsScroll = gui.addScroll(30, 12, 72, 476, s.kind === "items" ? 148 : 170, rows.map(function(b) { return "§f" + (s.kind === "sets" ? b.pieces + " pieces: " : "") + bonusText(s.kind === "items" ? rarityBonus(b, s.rangeRarity) : b, true) }))
                var statsSelection = s.row - s.page * 8
                if (statsSelection >= 0 && statsSelection < rows.length) statsScroll.setDefaultSelection(statsSelection)
                else s.row = -1
                button(gui, 23, "<", 12, actionY, 40).setEnabled(s.page > 0); button(gui, 24, ">", 56, actionY, 40).setEnabled(s.page < statPages - 1)
                button(gui, 64, "Add", 112, actionY, 90); button(gui, 65, "Edit", 208, actionY, 70).setEnabled(s.row >= 0); button(gui, 66, "Remove", 284, actionY, 80).setEnabled(s.row >= 0)
                if (s.kind === "items") rarityButtons(gui, 80, 252, s.rangeRarity)
                label(gui, 6, "§f" + (s.kind === "items" ? "Rarity stats" : "Set bonuses") + " · page " + (s.page + 1) + " / " + statPages, 12, 278, 280)
            } else if (s.tab === "Lore") {
                field(gui, 10, "Identified lore layout", d.lore, 12, 66, 232, 133)
                field(gui, 11, "Unidentified lore layout", d.unknownLore, 256, 66, 232, 133)
                label(gui, 6, "§7{rarity} {item_type} {description} {rolled_stats}", 12, 225, 476)
                label(gui, 7, "§7{requirements} {set_name} {set_bonuses} · & colors supported", 12, 241, 476)
                button(gui, 67, "Roll ranges: " + (d.showRanges ? "Show" : "Hide"), 12, 266, 226)
                label(gui, 8, "§7Rarity is revealed only after identification.", 254, 271, 234)
            } else if (s.tab === "Equipment") {
                button(gui, 69, "Set: " + (d.setId || "None"), 12, 82, 350)
                button(gui, 70, "Save & edit requirements", 12, 130, 350)
                label(gui, 6, "§7Uses the existing equipment registry, linked by item ID.", 12, 166, 476)
                label(gui, 7, "§7Requirements use character points before equipment bonuses.", 12, 186, 476)
                var linked = d.id ? rule(player.getWorld(), d.id) : null
                label(gui, 8, linked ? "§aRegistered · Level " + linked.value.level + " · " + formatEquipmentClassNames(player.getWorld(), linked.value) : "§7No equipment rule yet. Rules are optional.", 12, 220, 476)
            } else if (s.tab === "Give") {
                var savedTemplate = s.editingId ? load(player.getWorld()).templates[s.editingId] : null
                var canGive = !!savedTemplate && !savedTemplate.archived
                label(gui, 6, "§fGives the saved version, never unsaved draft changes.", 12, 76, 476)
                button(gui, 71, "Give identified item", 12, 106, 230).setEnabled(canGive)
                button(gui, 72, "Give ??? drop template", 256, 106, 232).setEnabled(canGive)
                label(gui, 7, "§7Use ??? copies in native CNPC drops and rewards.", 12, 148, 476)
                label(gui, 8, "§7Identifier NPC rolls each copy once. Identified drops keep their stats.", 12, 170, 476)
                button(gui, 73, d.archived ? "Restore & save now" : "Archive & save now", 12, 210, 230)
                label(gui, 9, "§7Archived templates stop new generation; existing copies still identify.", 12, 250, 476)
            }
            button(gui, 74, "Save " + (s.kind === "sets" ? "set" : "item"), 12, 302, 130)
            label(gui, 100, (s.error ? "§c" + s.error : "§7" + (s.message || "Changes stay in this draft until saved.")), 154, 307, 332)
        }
        remember(player, s)
        player.showCustomGui(gui)
    }
    function persist(player) {
        var s = state(player)
        if (s.editingId && s.draft.id !== s.editingId) fail("An existing registry ID cannot be changed.")
        if (!s.editingId) s.draft.id = ""
        s.draft = s.kind === "sets" ? saveSet(player.getWorld(), s.draft) : saveTemplate(player.getWorld(), s.draft)
        s.draftKind = s.kind
        s.editingId = s.draft.id
        s.message = "Saved " + s.draft.id
        remember(player, s)
    }
    function editRequirements(player) {
        persist(player)
        var s = state(player), t = s.draft
        var found = rule(player.getWorld(), t.id)
        if (!found) {
            var sample = create(player.getWorld(), t.id, true)
            var key = t.name + " [" + t.id + "]"
            registerEquipment(player.getWorld(), key, {registryItemId: t.id, itemId: String(sample.getName()), itemSnbt: itemSnbt(sample), matchMode: "REGISTRY", category: t.category, level: 1, stats: {}, classIds: []})
            found = rule(player.getWorld(), t.id)
        }
        clearEditEquipmentEditorState(player)
        showEquipmentEditorGui(player, "edit", found.key)
    }
    function handleButton(e) {
        if (Number(e.gui.getID()) === IDENTIFY_GUI) { identifierButton(e); return }
        if (!isAdmin(e.player)) return
        var p = e.player, s = state(p), n = Number(e.buttonId)
        try {
            s.error = ""
            if (s.view === "edit") s.message = ""
            capture(p, e.gui)
            if (n === 5) {
                if (s.view === "list") { ADM_ITEM_EDITOR.open({player: p}); return }
                if (s.view === "choose") s.view = s.returnView
                else if (s.view === "bonus") s.view = "edit"
                else if (s.view === "rarity") { delete s.rarityDraft; s.view = "edit" }
                else { s.view = "list"; s.page = 0; s.selected = "" }
            } else if (n === 23 || n === 24) {
                var delta = n === 23 ? -1 : 1
                if (s.view === "choose") s.pickPage = Math.max(0, Math.min(Math.ceil(s.values.length / PAGE) - 1, s.pickPage + delta))
                else {
                    s.page = Math.max(0, Math.min(Math.max(0, Math.ceil((s.view === "list" ? s.list.length : s.draft.bonuses.length) / (s.view === "list" ? PAGE : 8)) - 1), s.page + delta))
                    if (s.view === "list") s.selected = ""
                    if (s.view === "edit" && s.tab === "Stats") s.row = -1
                }
            } else if (s.view === "list") {
                if (n === 20 || n === 21) { s.kind = n === 20 ? "items" : "sets"; s.selected = ""; s.page = 0 }
                if (n === 22) { s.page = 0; s.selected = "" }
                if (n === 25) { s.draft = s.kind === "sets" ? {id: "", name: "", bonuses: []} : fresh(p); s.draftKind = s.kind; s.editingId = ""; s.view = "edit"; s.tab = "Template"; s.page = 0; s.row = -1; s.rangeRarity = "Common"; s.message = "" }
                if (n === 26) {
                    var db = load(p.getWorld()), entry = (s.kind === "sets" ? db.sets : db.templates)[s.selected]
                    if (!entry) fail("Select an entry first.")
                    s.draft = clone(entry); s.draftKind = s.kind; s.editingId = entry.id; s.view = "edit"; s.tab = "Template"; s.page = 0; s.row = -1; s.rangeRarity = "Common"; s.message = ""
                }
                if (n === 29) {
                    if (!s.draft || !s.draftKind) fail("No draft to resume.")
                    s.kind = s.draftKind
                    s.view = "edit"
                    s.page = 0
                    s.row = -1
                }
                if (n === 28 && s.kind === "items") {
                    var selected = load(p.getWorld()).templates[s.selected]
                    if (!selected) fail("Select an item first.")
                    if (!p.giveItem(createSaved(p.getWorld(), selected.id, true))) fail("Inventory is full.")
                    p.message("§aGiven: " + selected.name)
                }
                if (n === 27) { ADM_ITEM_EDITOR.open({player: p}); return }
            } else if (s.view === "rarity") {
                if (n === 86) { s.draft.rarityWeights = normalizeRarityWeights(s.rarityDraft); delete s.rarityDraft; s.view = "edit"; s.tab = "Template" }
            } else if (s.view === "bonus") {
                var b = s.bonus
                if (n === 40) { b.type = ["attribute", "points", "effectiveness"][( ["attribute", "points", "effectiveness"].indexOf(b.type) + 1) % 3]; b.id = ""; b.label = "" }
                if (n === 41) {
                    if (b.type === "attribute") {
                        var mods = []
                        ensureStatAttributesScanned().forEach(function(a) { var mod = a.id.split(":")[0]; if (mods.indexOf(mod) < 0) mods.push(mod) })
                        choose(p, "attributeMod", "Choose attribute mod", mods.sort())
                    } else {
                        var statValues = STAT_KEYS.slice()
                        choose(p, "bonusId", "Choose character stat", statValues, statValues.map(function(key) { return bonusDisplayName({type: b.type, id: key, label: ""}) + " §8[" + key + "]" }))
                    }
                    return
                }
                if (n === 42) b.operation = (Number(b.operation) + 1) % 3
                if (n >= 80 && n < 80 + rarities.length && s.kind === "items") {
                    saveBonusRange(s)
                    s.rangeRarity = rarities[n - 80]
                    loadBonusRange(s)
                }
                if (n === 43) {
                    saveBonusRange(s)
                    var row = s.kind === "items" ? normalizeItemBonus(b) : normalizeBonus(b, true)
                    if (s.kind === "sets") { row.pieces = number(b.pieces, 1, 4, "Pieces"); if (row.pieces % 1) fail("Pieces must be whole.") }
                    if (s.row < 0) { if (s.draft.bonuses.length >= 32) fail("At most 32 bonuses."); s.draft.bonuses.push(row) } else s.draft.bonuses[s.row] = row
                    s.view = "edit"
                }
            } else if (s.view === "edit") {
                if (n >= 50 && n <= 54) { s.tab = (s.kind === "sets" ? ["Template", "Stats"] : ["Template", "Stats", "Lore", "Equipment", "Give"])[n - 50] || "Template"; s.page = 0; s.row = -1 }
                if (n === 60 && s.kind === "items" && s.tab === "Template") { s.rarityDraft = clone(normalizeRarityWeights(s.draft.rarityWeights)); s.view = "rarity" }
                if (n >= 80 && n < 80 + rarities.length && s.kind === "items" && s.tab === "Stats") s.rangeRarity = rarities[n - 80]
                if (n === 61) s.draft.slot = slots[(slots.indexOf(s.draft.slot) + 1) % slots.length]
                if (n === 62) s.draft.identification = !s.draft.identification
                if (n === 63) s.draft.baseSnbt = fresh(p).baseSnbt
                if (n === 64 || n === 65) {
                    if (n === 65 && !s.draft.bonuses[s.row]) fail("Select a bonus first.")
                    if (n === 64) s.row = -1
                    s.bonus = s.row >= 0 ? clone(s.draft.bonuses[s.row]) : {type: "attribute", id: "", label: "", min: 1, max: 1, operation: 0, pieces: 2}
                    if (rarities.indexOf(s.rangeRarity) < 0) s.rangeRarity = "Common"
                    if (s.kind === "items") ensureBonusRanges(s.bonus)
                    loadBonusRange(s)
                    s.view = "bonus"
                }
                if (n === 66 && s.row >= 0) { s.draft.bonuses.splice(s.row, 1); s.row = -1 }
                if (n === 67) s.draft.showRanges = !s.draft.showRanges
                if (n === 69) {
                    var sets = load(p.getWorld()).sets, keys = [""].concat(Object.keys(sets).sort())
                    choose(p, "setId", "Armor set", keys, keys.map(function(k) { return k ? sets[k].name + " [" + k + "]" : "None" })); return
                }
                if (n === 70) { editRequirements(p); return }
                if (n === 71 || n === 72) {
                    var savedId = String(s.editingId || "")
                    if (!savedId) fail("Save this item before giving it.")
                    if (!p.giveItem(createSaved(p.getWorld(), savedId, n === 71))) fail("Inventory is full.")
                    s.message = "Item given. " + (n === 72 ? "Ready for native drops." : "Stats rolled.")
                }
                if (n === 73) { s.draft.archived = !s.draft.archived; persist(p) }
                if (n === 74) persist(p)
            }
            open(p)
        } catch (error) {
            s.error = String(error.message)
            remember(p, s)
            p.message("§c[Item Registry] " + error.message)
            try { open(p) } catch (ignored) {}
        }
    }
    function handleScroll(e) {
        if (Number(e.gui.getID()) === IDENTIFY_GUI) { identifierScroll(e); return }
        if (!isAdmin(e.player) || Number(e.scrollId) !== 30) return
        var s = state(e.player), index = Number(e.scrollIndex)
        if (index < 0 || index % 1) return
        capture(e.player, e.gui)
        if (s.view === "choose") {
            var selected = s.values[s.pickPage * PAGE + index]
            if (selected === undefined) return
            if (s.pick === "attributeMod") {
                s.view = s.returnView
                var values = ensureStatAttributesScanned().filter(function(a) { return a.id.split(":")[0] === selected }).map(function(a) { return a.id }).sort()
                choose(e.player, "bonusId", selected + " attributes", values, values.map(function(value) { return bonusDisplayName({type: "attribute", id: value, label: ""}) + " §8[" + value + "]" }))
                return
            }
            if (s.pick === "bonusId") { s.bonus.id = selected; s.bonus.label = "" }
            if (s.pick === "setId") s.draft.setId = selected
            s.view = s.returnView
            open(e.player)
        } else if (s.view === "list") { s.selected = s.list[s.page * PAGE + index] || ""; remember(e.player, s); open(e.player) }
        else if (s.view === "edit" && s.tab === "Stats") { s.row = s.page * 8 + index; open(e.player) }
    }
    function identifierSession(player) {
        var raw = player.getTempdata().get("arvanRegistryIdentifySession")
        if (!raw) fail("Talk to an Identifier NPC first.")
        var session = JSON.parse(String(raw))
        if (Date.now() > session.until) fail("Identification session expired. Talk to the NPC again.")
        return session
    }
    function openIdentifier(player) {
        if (typeof cnpcext === "undefined") fail("Item identification requires CNPCExtended.")
        player.getTempdata().put(HTML_ACTIVE_SESSION_KEY, "ITEM_IDENTIFIER")
        cnpcext.openHtmlGui(player, ITEM_IDENTIFIER_HTML_FILE, 0, 0, JSON.stringify(identifierState(player, "")))
    }
    function identifierState(player, message) {
        var session = identifierSession(player)
        var available = [], overlayItems = []
        for (var i = 0; i < 9; i++) {
            var stack = player.getInventory().getSlot(i), m = meta(stack)
            if (m && !m.invalid && !m.identified && snapshot(player.getWorld(), m)) {
                var overlaySlot = available.length
                available.push({slot: i, signature: inventorySignature(stack), name: String(stack.getDisplayName()), overlaySlot: overlaySlot})
                overlayItems.push({slot: overlaySlot, nbt: itemSnbt(stack)})
            }
        }
        var selected = null
        if (session.selected && typeof session.selected === "object") {
            for (var selectedRow = 0; selectedRow < available.length; selectedRow++) {
                if (available[selectedRow].slot === session.selected.slot && available[selectedRow].signature === session.selected.signature) { selected = available[selectedRow]; break }
            }
            if (!selected) { delete session.selected; session.error = "Item changed. Select it again." }
        } else if (session.selected !== undefined) delete session.selected
        session.items = available
        player.getTempdata().put("arvanRegistryIdentifySession", JSON.stringify(session))
        var fee = session.fee ? {spirit: Number(session.fee.spirit || 0), money: Number(session.fee.money || 0)} : null
        if (session.fee && session.fee.snbt) {
            var feeStack = player.getWorld().createItemFromNbt(API.stringToNbt(session.fee.snbt))
            fee.name = String(feeStack.getDisplayName())
            fee.count = Number(session.fee.count || 1)
        }
        return {
            items: available.map(function(item) { return {slot: item.slot, name: plain(item.name), overlaySlot: item.overlaySlot} }),
            selected: selected ? {slot: selected.slot, name: plain(selected.name), overlaySlot: selected.overlaySlot} : null,
            overlayItems: overlayItems,
            fee: fee,
            message: String(message || ""),
            error: String(session.error || "")
        }
    }
    function identifierPush(player, message) {
        cnpcext.getClientBridge(player.getMCEntity()).sendToBrowser("item_identify_update", JSON.stringify(identifierState(player, message)))
    }
    function identifierHtml(player, data) {
        var action = String(data.action || "")
        if (["ready", "select", "identify", "close"].indexOf(action) < 0) return
        try {
            if (action === "close") {
                player.getTempdata().remove("arvanRegistryIdentifySession")
                player.getTempdata().remove(HTML_ACTIVE_SESSION_KEY)
                cnpcext.getClientBridge(player.getMCEntity()).closeHtmlGui()
                return
            }
            if (action === "ready") { identifierPush(player, ""); return }
            var session = identifierSession(player)
            if (action === "select") {
                identifierState(player, "")
                session = identifierSession(player)
                var slot = Number(data.slot), chosen = null
                if (!isFinite(slot) || slot % 1 || slot < 0 || slot > 8) fail("Invalid hotbar slot.")
                for (var i = 0; i < session.items.length; i++) if (session.items[i].slot === slot) { chosen = session.items[i]; break }
                if (!chosen) fail("That item is no longer available.")
                session.selected = {slot: chosen.slot, signature: chosen.signature}
                delete session.error
                player.getTempdata().put("arvanRegistryIdentifySession", JSON.stringify(session))
                identifierPush(player, "")
                return
            }
            var selected = session.selected
            if (!selected || typeof selected !== "object") fail("Select an item first.")
            delete session.selected
            delete session.error
            player.getTempdata().put("arvanRegistryIdentifySession", JSON.stringify(session))
            var result = identify(player, selected.slot, selected.signature, session.fee)
            identifierPush(player, "Identified: " + String(result.getDisplayName()))
        } catch (error) {
            try {
                var retry = identifierSession(player)
                retry.error = String(error.message || error)
                player.getTempdata().put("arvanRegistryIdentifySession", JSON.stringify(retry))
                identifierPush(player, "")
            } catch (ignored) { player.message("§c[Identifier] " + String(error.message || error)) }
        }
    }
    function identifierScroll(e) {
        if (Number(e.scrollId) !== 30) return
        try {
            var s = identifierSession(e.player), index = Number(e.scrollIndex)
            if (!s.items[index]) return
            s.selected = {slot: s.items[index].slot, signature: s.items[index].signature}
            delete s.error
            e.player.getTempdata().put("arvanRegistryIdentifySession", JSON.stringify(s))
            openIdentifier(e.player)
        } catch (error) { e.player.message("§c" + error.message) }
    }
    function identifierButton(e) {
        if (Number(e.buttonId) === 5) { e.player.getTempdata().remove("arvanRegistryIdentifySession"); e.player.closeGui(); return }
        if (Number(e.buttonId) !== 40) return
        try {
            var s = identifierSession(e.player), chosen = s.selected
            if (!chosen || typeof chosen !== "object") fail("Select an item first.")
            // Clear selection before processing, so repeated GUI packets cannot identify twice.
            delete s.selected
            e.player.getTempdata().put("arvanRegistryIdentifySession", JSON.stringify(s))
            var result = identify(e.player, chosen.slot, chosen.signature, s.fee)
            e.player.message("§aIdentified: " + result.getDisplayName())
            openIdentifier(e.player)
        } catch (error) {
            e.player.message("§c[Identifier] " + error.message)
            try {
                var retry = identifierSession(e.player)
                retry.error = String(error.message)
                e.player.getTempdata().put("arvanRegistryIdentifySession", JSON.stringify(retry))
                openIdentifier(e.player)
            } catch (ignored) {}
        }
    }
    return {MATERIAL_GUI: MATERIAL_GUI, materialPickerClose: materialPickerClose, GUI: GUI, IDENTIFY_GUI: IDENTIFY_GUI, TIMER: TIMER, load: load, meta: meta, fromSnbt: fromSnbt, snapshot: snapshot, serviceTemplate: serviceTemplate, create: create, createSaved: createSaved, render: render, saveTemplate: saveTemplate, saveSet: saveSet, roll: roll, selectRarity: selectRarity, normalizeRarityWeights: normalizeRarityWeights, normalizeBonus: normalizeBonus, normalizeItemBonus: normalizeItemBonus, normalizeHoning: normalizeHoning, normalizeReroll: normalizeReroll, identify: identify, validation: validation, check: check, collect: collect, bonus: bonus, sync: sync, enforce: enforce, reset: reset, start: start, tick: tick, open: open, button: handleButton, scroll: handleScroll, fresh: fresh, state: state, remember: remember, registryHtml: registryHtml, openIdentifier: openIdentifier, identifierHtml: identifierHtml, itemSignature: itemSignature, signature: itemSignature, layers: layers, getLayers: layers, honeRows: honeRows, getHoneRows: honeRows, qualityDetails: qualityDetails, getQuality: qualityDetails, quoteCost: quoteCost, quoteHone: quoteHone, honingQuote: quoteHone, quoteHoning: quoteHone, buildHoneQuote: quoteHone, resolveHone: resolveHone, resolveHoning: resolveHone, hone: hone, attemptHone: hone, performHone: hone, applyHone: applyHone, setHone: applyHone, project: project, projectItem: project, quoteReroll: quoteReroll, rerollQuote: quoteReroll, buildRerollQuote: quoteReroll, resolveReroll: resolveReroll, rerollResult: resolveReroll, reroll: reroll, attemptReroll: reroll, performReroll: reroll, migrateInstance: migrateInstance}
})()
// END REGISTERED ITEM SYSTEM
// END REGISTERED ITEM SYSTEM
