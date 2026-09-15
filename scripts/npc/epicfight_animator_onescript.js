//@ts-ignore
// ============================================================================
// EPIC FIGHT NPC ANIMATOR - ONESCRIPT (CNPC + Epic Fight) - MINECRAFT 1.20.1
// ============================================================================
// A universal NPC combat script with IN-GAME GUI configuration for Epic Fight.
// Hold BEDROCK + SNEAK + CREATIVE MODE and interact with NPC to open config GUI.
// All settings are saved per-NPC using NPC storeddata.
//
// Features:
//   - Attack animation system (sequential/random, configurable list)
//   - Dodge system (on damaged, configurable chance & animations)
//   - Block/parry system (damage cancellation, sounds, particles)
//   - Dash attack (long-range gap closer with cooldown)
//   - Death effects (particles, sounds, body hide)
//   - Boss state system (HP threshold, timed, manual transitions)
//   - Animation browser (scans mod .jar files for Epic Fight animations)
//   - Sound browser (scans mod .jar files for all registered sounds)
//
// Dependencies: CustomNPCs + Epic Fight mod (+ any EF addon mods)
// Config stored in NPC storeddata under key "efAnimatorConfig"
// ============================================================================

var API = Java.type("noppes.npcs.api.NpcAPI").Instance()

// ============================================================================
// ========================== DEFAULT CONFIGURATION ===========================
// ============================================================================

var CONFIG = {
    // ==================== MAIN ANIMATIONS ====================
    main: {
        idle: "",
        walk: ""
    },

    // ==================== ATTACK SYSTEM ====================
    attacks: {
        enabled: true,
        range: 3,
        speed: 1.3,
        random: false,
        animations: [
            "epicfight:biped/combat/sword_auto1",
            "epicfight:biped/combat/sword_auto2",
            "epicfight:biped/combat/sword_auto3"
        ],
        animationTicks: [0, 0, 0]
    },

    // ==================== DASH SYSTEM ====================
    dash: {
        enabled: true,
        range: 8,
        cooldown: 10,
        animation: "epicfight:biped/combat/sword_dual_dash"
    },

    // ==================== DODGE SYSTEM ====================
    dodge: {
        enabled: true,
        chance: 30,
        random: true,
        cooldown: 2,
        animations: [
            "epicfight:biped/skill/step_right",
            "epicfight:biped/skill/step_left"
        ]
    },

    // ==================== BLOCK SYSTEM ====================
    block: {
        enabled: true,
        chance: 50,
        random: true,
        duration: 2.0,
        damageReduction: 1.0,
        sound: "epicfight:entity.hit.clash",
        particle: "epicfight:hit_blunt",
        animations: [
            "epicfight:biped/skill/guard_sword"
        ]
    },

    // ==================== DEATH SYSTEM ====================
    death: {
        enabled: true,
        particle: "end_rod",
        particleCount: 100,
        sound: "minecraft:entity.allay.hurt",
        soundVolume: 1.0,
        soundPitch: 0,
        hideBody: true,
        hideOffset: 5
    },

    // ==================== BOSS STATE SYSTEM ====================
    states: {
        enabled: false,
        changeMode: "manual",
        stateList: []
    }
}

// ============================================================================
// ========================== GUI IDS =========================================
// ============================================================================

var GUI_ID_MAIN = 600
var GUI_ID_ATTACKS = 601
var GUI_ID_DASH = 602
var GUI_ID_DODGE = 603
var GUI_ID_BLOCK = 604
var GUI_ID_DEATH = 605
var GUI_ID_STATES = 606
var GUI_ID_STATE_EDIT = 607
var GUI_ID_ANIM_BROWSER = 608
var GUI_ID_SOUND_BROWSER = 609
var GUI_ID_CONFIRM = 610
var GUI_ID_MAIN_ANIMS = 611
var GUI_ID_ATTACK_EDIT = 612

// ============================================================================
// ========================== GUI COMPONENT IDS ===============================
// ============================================================================

var LAYER = {
    BG_MAIN: 1,
    BG_HEADER: 2,
    BG_FOOTER: 3,
    BG_PANEL: 10,
    BG_ACCENT: 15,
    CONTENT: 50,
    SCROLL: 100,
    TEXT_FIELDS: 150,
    BUTTONS: 200
}

var TEX = {
    bgMain: "minecraft:textures/block/gray_concrete.png",
    bgDark: "minecraft:textures/block/black_concrete.png",
    bgLight: "minecraft:textures/block/light_gray_concrete.png",
    accent: "minecraft:textures/block/purple_concrete.png",
    accentYellow: "minecraft:textures/block/yellow_concrete.png",
    accentRed: "minecraft:textures/block/red_concrete.png",
    accentBlue: "minecraft:textures/block/cyan_concrete.png",
    accentGreen: "minecraft:textures/block/lime_concrete.png"
}

// Button IDs
var BTN_ATTACKS = 31
var BTN_DASH = 32
var BTN_DODGE = 33
var BTN_BLOCK = 34
var BTN_DEATH = 35
var BTN_STATES = 36
var BTN_MAIN_ANIMS = 37
var BTN_SAVE = 40
var BTN_BACK = 41
var BTN_CLOSE = 42
var BTN_ADD = 250
var BTN_DELETE = 251
var BTN_EDIT = 252
var BTN_TOGGLE = 253
var BTN_TOGGLE_RANDOM = 254
var BTN_BROWSE_ANIM = 260
var BTN_BROWSE_SOUND = 261
var BTN_PLAY_SOUND = 262
var BTN_STATE_SWITCH = 270
var BTN_CONFIRM_YES = 280
var BTN_CONFIRM_NO = 281
var BTN_CLEAR_ALL = 282
var BTN_TEST_ANIM = 283
var BTN_BROWSER_PREV = 284
var BTN_BROWSER_NEXT = 285

// Scroll IDs
var SCROLL_LIST = 300
var SCROLL_STATE_LIST = 310
var SCROLL_STATE_MODE = 311
var SCROLL_ANIM_BROWSER = 315
var SCROLL_SOUND_BROWSER = 318

// Field IDs
var FIELD_BASE = 400
var FIELD_ANIM_SEARCH = 460
var FIELD_SOUND_SEARCH = 462
var FIELD_SOUND_VOLUME = 463
var FIELD_SOUND_PITCH = 464

// ============================================================================
// ========================== RUNTIME STATE ===================================
// ============================================================================

var CFG_STORAGE_KEY = "efAnimatorConfig"
var attackIndex = 0
var dodgeIndex = 0
var blockIndex = 0
var isBlocking = false
var lastBlockTime = 0
var dodgeCooldownUntil = 0
var mainAnimationLockedUntil = 0

// State system
var currentBossState = 0
var lastStateChangeTime = 0
var stateTransitioning = false
var STATE_CHANGE_MODES = ["manual", "hp_threshold", "timed", "sequential"]

// Active overrides from state (null = use CONFIG)
var activeAttacks = null
var activeDodge = null
var activeBlock = null
var activeDash = null

// GUI state
var configNpc = null
var configApi = API
var currentGuiId = null
var selectedScrollIndex = -1
var editingAttackIndex = -1
var editingStateIndex = -1
var selectedStateScrollIndex = -1
var selectedChangeModeIndex = 0

// Animation browser state
var animBrowserCache = null
var animBrowserFiltered = null
var selectedAnimBrowserIndex = -1
var animBrowserReturnGui = null
var animBrowserReturnField = null
var animBrowserSearchTerm = ""
var animBrowserPage = 0

// Sound browser state
var soundBrowserCache = null
var soundBrowserFiltered = null
var selectedSoundBrowserIndex = -1
var soundBrowserReturnGui = null
var soundBrowserReturnField = null
var soundBrowserSearchTerm = ""
var soundBrowserPage = 0
var BROWSER_PAGE_SIZE = 25

// Timer IDs
var TIMER_MAIN_ANIMATION = 19
var TIMER_ATTACK = 20
var TIMER_DASH_CD = 99
var TIMER_BLOCK_END = 98

// ============================================================================
// ========================== DATA FUNCTIONS ==================================
// ============================================================================

function loadConfigFromNpc(npc) {
    try {
        var data = npc.getStoreddata()
        if (data.has(CFG_STORAGE_KEY)) {
            var stored = JSON.parse(data.get(CFG_STORAGE_KEY))
            CONFIG = mergeDefaults(stored, getDefaultConfig())
            normalizeAttackTicks(CONFIG.attacks)
            // Restore state
            if (CONFIG.states && CONFIG.states.currentBossState !== undefined) {
                currentBossState = CONFIG.states.currentBossState
            }
        }
    } catch (ex) {
        // Use defaults
    }
}

function saveConfigToNpc(npc) {
    try {
        if (CONFIG.states) {
            CONFIG.states.currentBossState = currentBossState
        }
        normalizeAttackTicks(CONFIG.attacks)
        npc.getStoreddata().put(CFG_STORAGE_KEY, JSON.stringify(CONFIG))
    } catch (ex) {
        // Silent fail
    }
}

function getDefaultConfig() {
    return {
        main: {
            idle: "",
            walk: ""
        },
        attacks: {
            enabled: true,
            range: 3,
            speed: 1.3,
            random: false,
            animations: [
                "epicfight:biped/combat/sword_auto1",
                "epicfight:biped/combat/sword_auto2",
                "epicfight:biped/combat/sword_auto3"
            ],
            animationTicks: [0, 0, 0]
        },
        dash: {
            enabled: true,
            range: 8,
            cooldown: 10,
            animation: "epicfight:biped/combat/sword_dual_dash"
        },
        dodge: {
            enabled: true,
            chance: 30,
            random: true,
            cooldown: 2,
            animations: [
                "epicfight:biped/skill/step_right",
                "epicfight:biped/skill/step_left"
            ]
        },
        block: {
            enabled: true,
            chance: 50,
            random: true,
            duration: 2.0,
            damageReduction: 1.0,
            sound: "epicfight:entity.hit.clash",
            particle: "epicfight:hit_blunt",
            animations: [
                "indestructible:guard/guard_sword"
            ]
        },
        death: {
            enabled: true,
            particle: "end_rod",
            particleCount: 100,
            sound: "minecraft:entity.allay.hurt",
            soundVolume: 1.0,
            soundPitch: 0,
            hideBody: true,
            hideOffset: 5
        },
        states: {
            enabled: false,
            changeMode: "manual",
            stateList: []
        }
    }
}

function mergeDefaults(obj, defaults) {
    if (!obj) return defaults
    var keys = Object.keys(defaults)
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i]
        if (obj[key] === undefined) {
            obj[key] = defaults[key]
        } else if (typeof defaults[key] === "object" && defaults[key] !== null && !Array.isArray(defaults[key])) {
            obj[key] = mergeDefaults(obj[key], defaults[key])
        }
    }
    return obj
}

// ============================================================================
// ========================== ANIMATION BROWSER ===============================
// ============================================================================
// Scans all mod .jar files on the classpath for Epic Fight animation entries
// Epic Fight path: assets/<ns>/animmodels/animations/<path>.json
// Resource location: <ns>:<path> (used by playEFAnimation)
// Excludes /data/ subdirs (those are metadata, not playable animations)

function loadAllAnimationsFromJars() {
    if (animBrowserCache !== null) return animBrowserCache
    var animSet = {}
    try {
        var Thread = Java.type("java.lang.Thread")
        var classLoader = Thread.currentThread().getContextClassLoader()
        var JarFile = Java.type("java.util.jar.JarFile")
        var File = Java.type("java.io.File")

        // Scan classpath jars via classloader (finds all loaded mod jars)
        var urls = classLoader.getResources("assets")
        while (urls.hasMoreElements()) {
            var url = urls.nextElement()
            var protocol = String(url.getProtocol())

            if (protocol === "jar") {
                var jarPath = String(url.getPath())
                var bangIdx = jarPath.indexOf("!")
                if (bangIdx >= 0) {
                    var filePath = jarPath.substring(5, bangIdx)
                    try {
                        scanJarForAnimations(filePath, animSet)
                    } catch (ex) {}
                }
            } else if (protocol === "file") {
                try {
                    var assetsDir = new File(url.toURI())
                    scanFileDirForAnimations(assetsDir, animSet)
                } catch (ex) {}
            }
        }

        // Also scan mods/ directory directly (fallback for mod jars)
        try {
            var modsDir = new File("mods")
            if (modsDir.exists() && modsDir.isDirectory()) {
                var modFiles = modsDir.listFiles()
                if (modFiles) {
                    for (var m = 0; m < modFiles.length; m++) {
                        var modName = String(modFiles[m].getName())
                        if (modName.endsWith(".jar")) {
                            try {
                                scanJarForAnimations(modFiles[m].getAbsolutePath(), animSet)
                            } catch (ex) {}
                        }
                    }
                }
            }
        } catch (ex) {}

    } catch (e) {}

    var result = []
    for (var key in animSet) {
        result.push(key)
    }
    result.sort()
    animBrowserCache = result
    return result
}

// Scan a single .jar file for Epic Fight animation entries
function scanJarForAnimations(jarFilePath, animSet) {
    var JarFile = Java.type("java.util.jar.JarFile")
    var jar = new JarFile(jarFilePath)
    var entries = jar.entries()
    while (entries.hasMoreElements()) {
        var entry = entries.nextElement()
        var entryName = String(entry.getName())
        // Match: assets/<ns>/animmodels/animations/<path>.json
        // Exclude /data/ subdirectories (animation metadata, not playable)
        if (entryName.indexOf("assets/") === 0 &&
            entryName.indexOf("/animmodels/animations/") >= 0 &&
            entryName.endsWith(".json") &&
            entryName.indexOf("/data/") < 0) {

            var parts = entryName.split("/")
            // parts: [assets, <ns>, animmodels, animations, ...path..., file.json]
            if (parts.length >= 5) {
                var ns = parts[1]
                // Build the animation path (everything after "animations/")
                var animIdx = entryName.indexOf("/animmodels/animations/")
                var animPath = entryName.substring(animIdx + "/animmodels/animations/".length)
                // Strip .json
                animPath = animPath.substring(0, animPath.length - 5)
                animSet[ns + ":" + animPath] = true
            }
        }
    }
    jar.close()
}

// Scan a file-based assets directory for Epic Fight animation entries
function scanFileDirForAnimations(assetsDir, animSet) {
    var File = Java.type("java.io.File")
    var namespaces = assetsDir.listFiles()
    if (!namespaces) return
    for (var n = 0; n < namespaces.length; n++) {
        if (!namespaces[n].isDirectory()) continue
        var ns = String(namespaces[n].getName())
        var animModelsDir = new File(namespaces[n], "animmodels/animations")
        if (animModelsDir.exists() && animModelsDir.isDirectory()) {
            scanAnimDir(animModelsDir, ns, "", animSet)
        }
    }
}

function scanAnimDir(dir, namespace, prefix, animSet) {
    var File = Java.type("java.io.File")
    var files = dir.listFiles()
    if (!files) return
    for (var i = 0; i < files.length; i++) {
        var name = String(files[i].getName())
        // Skip "data" subdirectories (animation metadata)
        if (files[i].isDirectory()) {
            if (name !== "data") {
                scanAnimDir(files[i], namespace, prefix + name + "/", animSet)
            }
        } else if (name.endsWith(".json")) {
            var animName = prefix + name.substring(0, name.length - 5)
            animSet[namespace + ":" + animName] = true
        }
    }
}

function filterAnimations(searchTerm) {
    var all = loadAllAnimationsFromJars()
    if (!searchTerm || searchTerm.length === 0) return all
    var term = searchTerm.toLowerCase()
    var results = []
    for (var i = 0; i < all.length; i++) {
        if (all[i].toLowerCase().indexOf(term) >= 0) results.push(all[i])
    }
    return results
}

// ============================================================================
// ========================== SOUND BROWSER ===================================
// ============================================================================

function loadAllSoundsFromJars() {
    if (soundBrowserCache !== null) return soundBrowserCache
    var soundSet = {}
    try {
        var Thread = Java.type("java.lang.Thread")
        var classLoader = Thread.currentThread().getContextClassLoader()
        var InputStreamReader = Java.type("java.io.InputStreamReader")
        var BufferedReader = Java.type("java.io.BufferedReader")
        var StringBuilder = Java.type("java.lang.StringBuilder")
        var JsonParser = Java.type("com.google.gson.JsonParser")
        var JarFile = Java.type("java.util.jar.JarFile")
        var File = Java.type("java.io.File")

        var urls = classLoader.getResources("assets")
        while (urls.hasMoreElements()) {
            var url = urls.nextElement()
            var protocol = String(url.getProtocol())

            if (protocol === "jar") {
                var jarPath = String(url.getPath())
                var bangIdx = jarPath.indexOf("!")
                if (bangIdx >= 0) {
                    var filePath = jarPath.substring(5, bangIdx)
                    try {
                        var jar = new JarFile(filePath)
                        var entries = jar.entries()
                        while (entries.hasMoreElements()) {
                            var entry = entries.nextElement()
                            var entryName = String(entry.getName())
                            if (entryName.indexOf("assets/") === 0 && entryName.endsWith("/sounds.json")) {
                                var parts = entryName.split("/")
                                if (parts.length === 3) {
                                    var ns = parts[1]
                                    try {
                                        var stream = jar.getInputStream(entry)
                                        var reader = new BufferedReader(new InputStreamReader(stream))
                                        var sb = new StringBuilder()
                                        var line
                                        while ((line = reader.readLine()) !== null) {
                                            sb.append(line)
                                        }
                                        reader.close()
                                        var json = JsonParser.parseString(sb.toString())
                                        var root = json.getAsJsonObject()
                                        var iter = root.keySet().iterator()
                                        while (iter.hasNext()) {
                                            soundSet[ns + ":" + String(iter.next())] = true
                                        }
                                    } catch (ex) {}
                                }
                            }
                        }
                        jar.close()
                    } catch (ex) {}
                }
            } else if (protocol === "file") {
                try {
                    var assetsDir = new File(url.toURI())
                    var children = assetsDir.listFiles()
                    if (children) {
                        for (var i = 0; i < children.length; i++) {
                            if (children[i].isDirectory()) {
                                var soundsFile = new File(children[i], "sounds.json")
                                if (soundsFile.exists()) {
                                    var ns = String(children[i].getName())
                                    var FileReader = Java.type("java.io.FileReader")
                                    var reader = new BufferedReader(new FileReader(soundsFile))
                                    var sb = new StringBuilder()
                                    var line
                                    while ((line = reader.readLine()) !== null) {
                                        sb.append(line)
                                    }
                                    reader.close()
                                    var json = JsonParser.parseString(sb.toString())
                                    var root = json.getAsJsonObject()
                                    var iter = root.keySet().iterator()
                                    while (iter.hasNext()) {
                                        soundSet[ns + ":" + String(iter.next())] = true
                                    }
                                }
                            }
                        }
                    }
                } catch (ex) {}
            }
        }
    } catch (e) {}

    var sounds = []
    for (var key in soundSet) {
        sounds.push(key)
    }
    sounds.sort()
    soundBrowserCache = sounds
    return sounds
}

function filterSounds(searchTerm) {
    var all = loadAllSoundsFromJars()
    if (!searchTerm || searchTerm.length === 0) return all
    var term = searchTerm.toLowerCase()
    var results = []
    for (var i = 0; i < all.length; i++) {
        if (all[i].toLowerCase().indexOf(term) >= 0) results.push(all[i])
    }
    return results
}

function getBrowserPageCount(entries) {
    return Math.max(1, Math.ceil(entries.length / BROWSER_PAGE_SIZE))
}

function clampBrowserPage(page, entries) {
    return Math.max(0, Math.min(page, getBrowserPageCount(entries) - 1))
}

function getBrowserPageEntries(entries, page) {
    var start = page * BROWSER_PAGE_SIZE
    return entries.slice(start, start + BROWSER_PAGE_SIZE)
}

// ============================================================================
// ========================== GUI HELPERS =====================================
// ============================================================================

function buildBg(gui, W, H, accentTex) {
    gui.addTexturedRect(LAYER.BG_MAIN, TEX.bgMain, 0, 0, W, H)
    gui.addTexturedRect(LAYER.BG_HEADER, TEX.bgDark, 0, 0, W, 26)
    gui.addTexturedRect(LAYER.BG_FOOTER, TEX.bgDark, 0, H - 35, W, 35)
    gui.addTexturedRect(LAYER.BG_ACCENT, accentTex || TEX.accent, 0, 0, 4, 26)
}

function getActiveConfig() {
    // Returns the effective config based on active state overrides
    return {
        attacks: activeAttacks || CONFIG.attacks,
        dodge: activeDodge || CONFIG.dodge,
        block: activeBlock || CONFIG.block,
        dash: activeDash || CONFIG.dash
    }
}

// ============================================================================
// ========================== MAIN CONFIG GUI =================================
// ============================================================================

function showMainConfigGui(API, player, npc) {
    var W = 320, H = 230
    var gui = API.createCustomGui(GUI_ID_MAIN, W, H, false, player)

    buildBg(gui, W, H, TEX.accent)

    // Info panel
    gui.addTexturedRect(LAYER.BG_PANEL, TEX.bgLight, 10, 115, 200, 55)
    gui.addTexturedRect(LAYER.BG_ACCENT + 1, TEX.accentYellow, 10, 115, 4, 55)

    gui.addLabel(LAYER.CONTENT, "§5§lEpic Fight Animator", 10, 6, 200, 14)
    gui.addLabel(LAYER.CONTENT + 1, "§7NPC: §f" + npc.getDisplay().getName(), 150, 8, 160, 12)

    // Section buttons
    gui.addButton(BTN_MAIN_ANIMS, "§f↻ Main", 10, 35, 90, 20)
    gui.addButton(BTN_ATTACKS, "§c⚔ Attacks", 110, 35, 90, 20)
    gui.addButton(BTN_DASH, "§b⚡ Dash", 210, 35, 90, 20)
    gui.addButton(BTN_DODGE, "§a↔ Dodge", 10, 60, 90, 20)
    gui.addButton(BTN_BLOCK, "§3🛡 Block", 110, 60, 90, 20)
    gui.addButton(BTN_DEATH, "§7☠ Death", 210, 60, 90, 20)
    gui.addButton(BTN_STATES, "§6★ States", 10, 85, 90, 20)

    // Info labels
    var idleInfo = CONFIG.main.idle ? "§a✓" : "§7-"
    var walkInfo = CONFIG.main.walk ? "§a✓" : "§7-"
    var atkInfo = CONFIG.attacks.enabled ? ("§a" + CONFIG.attacks.animations.length + " anims") : "§cOFF"
    var dashInfo = CONFIG.dash.enabled ? "§aON" : "§cOFF"
    var dodgeInfo = CONFIG.dodge.enabled ? ("§a" + CONFIG.dodge.chance + "%") : "§cOFF"
    var blockInfo = CONFIG.block.enabled ? ("§a" + CONFIG.block.chance + "%") : "§cOFF"
    var stateInfo = CONFIG.states.enabled ? ("§aON §7(" + CONFIG.states.stateList.length + ")") : "§cOFF"

    gui.addLabel(LAYER.CONTENT + 2, "§7Idle: " + idleInfo + "  §7Walk: " + walkInfo + "  §7Attacks: " + atkInfo, 18, 123, 270, 12)
    gui.addLabel(LAYER.CONTENT + 3, "§7Dash: " + dashInfo + "  §7Dodge: " + dodgeInfo + "  §7Block: " + blockInfo, 18, 138, 190, 12)
    gui.addLabel(LAYER.CONTENT + 4, "§7States: " + stateInfo, 18, 153, 190, 12)

    gui.addLabel(LAYER.CONTENT + 5, "§8Bedrock + Sneak + Creative to access", 18, 200, 220, 12)

    gui.addButton(BTN_CLOSE, "§cClose", 250, H - 30, 60, 20)

    currentGuiId = GUI_ID_MAIN
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== MAIN ANIMATIONS GUI =============================
// ============================================================================

function showMainAnimsGui(API, player) {
    var W = 300, H = 160
    var gui = API.createCustomGui(GUI_ID_MAIN_ANIMS, W, H, false, player)

    buildBg(gui, W, H, TEX.bgLight)
    gui.addLabel(LAYER.CONTENT, "§f§l↻ Main Animations", 10, 6, 200, 14)

    gui.addLabel(LAYER.CONTENT + 10, "§eIdle:", 10, 36, 30, 12)
    gui.addTextField(FIELD_BASE, 40, 34, 200, 14).setText(CONFIG.main.idle || "")
    gui.addButton(BTN_BROWSE_ANIM, "§b...", 245, 34, 30, 14)

    gui.addLabel(LAYER.CONTENT + 11, "§eWalk:", 10, 58, 30, 12)
    gui.addTextField(FIELD_BASE + 1, 40, 56, 200, 14).setText(CONFIG.main.walk || "")
    gui.addButton(BTN_BROWSE_ANIM + 1, "§b...", 245, 56, 30, 14)

    gui.addLabel(LAYER.CONTENT + 12, "§8Leave blank to use default EF anims", 10, 80, 250, 12)

    gui.addButton(BTN_SAVE, "§aSave", 180, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Back", 235, H - 30, 55, 20)

    currentGuiId = GUI_ID_MAIN_ANIMS
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== ATTACKS GUI =====================================
// ============================================================================

function showAttacksGui(API, player) {
    var W = 340, H = 260
    var gui = API.createCustomGui(GUI_ID_ATTACKS, W, H, false, player)
    normalizeAttackTicks(CONFIG.attacks)

    buildBg(gui, W, H, TEX.accentRed)
    gui.addLabel(LAYER.CONTENT, "§c§l⚔ Attack Animations", 10, 6, 200, 14)

    // Toggle enabled
    gui.addButton(BTN_TOGGLE, CONFIG.attacks.enabled ? "§aEnabled" : "§cDisabled", 220, 5, 80, 16)

    // Settings row
    gui.addLabel(LAYER.CONTENT + 10, "§eRange:", 10, 32, 40, 12)
    gui.addTextField(FIELD_BASE, 50, 30, 40, 14).setText(String(CONFIG.attacks.range))
    gui.addLabel(LAYER.CONTENT + 11, "§eSpeed(s):", 100, 32, 55, 12)
    gui.addTextField(FIELD_BASE + 1, 155, 30, 40, 14).setText(String(CONFIG.attacks.speed))
    gui.addButton(BTN_TOGGLE_RANDOM, CONFIG.attacks.random ? "§aRandom" : "§bSequential", 210, 30, 80, 14)

    // Animation list
    gui.addLabel(LAYER.CONTENT + 12, "§fAnimations §7(" + CONFIG.attacks.animations.length + "):", 10, 52, 150, 12)
    var list = []
    for (var i = 0; i < CONFIG.attacks.animations.length; i++) {
        list.push("§7" + i + ": §f" + CONFIG.attacks.animations[i])
    }
    if (list.length === 0) list.push("§8(none)")
    gui.addScroll(SCROLL_LIST, 10, 65, 320, 120, list)

    // Buttons
    gui.addButton(BTN_ADD, "§a+ Add", 10, 190, 55, 18)
    gui.addButton(BTN_DELETE, "§c- Del", 70, 190, 55, 18)
    gui.addButton(BTN_TEST_ANIM, "§dTest", 130, 190, 55, 18)
    gui.addButton(BTN_EDIT, "§eEdit", 190, 190, 55, 18)
    gui.addButton(BTN_CLEAR_ALL, "§4Clear All", 250, 190, 80, 18)

    gui.addButton(BTN_SAVE, "§aSave", 220, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Back", 275, H - 30, 55, 20)

    currentGuiId = GUI_ID_ATTACKS
    selectedScrollIndex = -1
    player.showCustomGui(gui)
}

function showAttackEditGui(API, player, idx) {
    if (idx < 0 || idx >= CONFIG.attacks.animations.length) return
    normalizeAttackTicks(CONFIG.attacks)
    editingAttackIndex = idx

    var W = 320, H = 150
    var gui = API.createCustomGui(GUI_ID_ATTACK_EDIT, W, H, false, player)

    buildBg(gui, W, H, TEX.accentRed)
    gui.addLabel(LAYER.CONTENT, "§e§lEdit Attack " + idx, 10, 6, 180, 14)
    gui.addLabel(LAYER.CONTENT + 10, "§eAnimation:", 10, 38, 60, 12)
    gui.addTextField(FIELD_BASE, 75, 36, 235, 14).setText(String(CONFIG.attacks.animations[idx]))
    gui.addLabel(LAYER.CONTENT + 11, "§eExtra ticks:", 10, 64, 70, 12)
    gui.addTextField(FIELD_BASE + 1, 85, 62, 45, 14).setText(String(CONFIG.attacks.animationTicks[idx]))
    gui.addLabel(LAYER.CONTENT + 12, "§7Added to the attack speed wait", 10, 84, 220, 12)

    gui.addButton(BTN_SAVE, "§aSave", 205, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Cancel", 260, H - 30, 55, 20)

    currentGuiId = GUI_ID_ATTACK_EDIT
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== DASH GUI ========================================
// ============================================================================

function showDashGui(API, player) {
    var W = 300, H = 180
    var gui = API.createCustomGui(GUI_ID_DASH, W, H, false, player)

    buildBg(gui, W, H, TEX.accentBlue)
    gui.addLabel(LAYER.CONTENT, "§b§l⚡ Dash Settings", 10, 6, 200, 14)

    gui.addButton(BTN_TOGGLE, CONFIG.dash.enabled ? "§aEnabled" : "§cDisabled", 200, 5, 80, 16)

    gui.addLabel(LAYER.CONTENT + 10, "§eMin Range:", 10, 36, 65, 12)
    gui.addTextField(FIELD_BASE, 80, 34, 50, 14).setText(String(CONFIG.dash.range))

    gui.addLabel(LAYER.CONTENT + 11, "§eCooldown(s):", 10, 58, 70, 12)
    gui.addTextField(FIELD_BASE + 1, 80, 56, 50, 14).setText(String(CONFIG.dash.cooldown))

    gui.addLabel(LAYER.CONTENT + 12, "§eAnimation:", 10, 80, 60, 12)
    gui.addTextField(FIELD_BASE + 2, 70, 78, 170, 14).setText(CONFIG.dash.animation)
    gui.addButton(BTN_BROWSE_ANIM, "§b...", 245, 78, 30, 14)

    gui.addButton(BTN_SAVE, "§aSave", 180, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Back", 235, H - 30, 55, 20)

    currentGuiId = GUI_ID_DASH
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== DODGE GUI =======================================
// ============================================================================

function showDodgeGui(API, player) {
    var W = 340, H = 260
    var gui = API.createCustomGui(GUI_ID_DODGE, W, H, false, player)

    buildBg(gui, W, H, TEX.accentGreen)
    gui.addLabel(LAYER.CONTENT, "§a§l↔ Dodge Animations", 10, 6, 200, 14)

    gui.addButton(BTN_TOGGLE, CONFIG.dodge.enabled ? "§aEnabled" : "§cDisabled", 220, 5, 80, 16)

    gui.addLabel(LAYER.CONTENT + 10, "§eChance(%):", 10, 32, 60, 12)
    gui.addTextField(FIELD_BASE, 75, 30, 40, 14).setText(String(CONFIG.dodge.chance))
    gui.addButton(BTN_TOGGLE_RANDOM, CONFIG.dodge.random ? "§aRandom" : "§bSequential", 210, 30, 80, 14)

    gui.addLabel(LAYER.CONTENT + 11, "§eCooldown(s):", 10, 52, 70, 12)
    gui.addTextField(FIELD_BASE + 1, 85, 50, 45, 14).setText(String(CONFIG.dodge.cooldown))

    gui.addLabel(LAYER.CONTENT + 12, "§fAnimations §7(" + CONFIG.dodge.animations.length + "):", 10, 72, 150, 12)
    var list = []
    for (var i = 0; i < CONFIG.dodge.animations.length; i++) {
        list.push("§7" + i + ": §f" + CONFIG.dodge.animations[i])
    }
    if (list.length === 0) list.push("§8(none)")
    gui.addScroll(SCROLL_LIST, 10, 85, 320, 100, list)

    gui.addButton(BTN_ADD, "§a+ Add", 10, 190, 55, 18)
    gui.addButton(BTN_DELETE, "§c- Del", 70, 190, 55, 18)
    gui.addButton(BTN_TEST_ANIM, "§dTest", 130, 190, 55, 18)
    gui.addButton(BTN_CLEAR_ALL, "§4Clear All", 190, 190, 65, 18)

    gui.addButton(BTN_SAVE, "§aSave", 220, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Back", 275, H - 30, 55, 20)

    currentGuiId = GUI_ID_DODGE
    selectedScrollIndex = -1
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== BLOCK GUI =======================================
// ============================================================================

function showBlockGui(API, player) {
    var W = 340, H = 310
    var gui = API.createCustomGui(GUI_ID_BLOCK, W, H, false, player)

    buildBg(gui, W, H, TEX.accentBlue)
    gui.addLabel(LAYER.CONTENT, "§3§l🛡 Block Settings", 10, 6, 200, 14)

    gui.addButton(BTN_TOGGLE, CONFIG.block.enabled ? "§aEnabled" : "§cDisabled", 220, 5, 80, 16)

    // Settings
    gui.addLabel(LAYER.CONTENT + 10, "§eChance(%):", 10, 32, 60, 12)
    gui.addTextField(FIELD_BASE, 75, 30, 40, 14).setText(String(CONFIG.block.chance))
    gui.addButton(BTN_TOGGLE_RANDOM, CONFIG.block.random ? "§aRandom" : "§bSequential", 210, 30, 80, 14)

    gui.addLabel(LAYER.CONTENT + 11, "§eDuration(s):", 10, 52, 70, 12)
    gui.addTextField(FIELD_BASE + 1, 80, 50, 40, 14).setText(String(CONFIG.block.duration))

    gui.addLabel(LAYER.CONTENT + 12, "§eDmg Reduce:", 10, 72, 70, 12)
    gui.addTextField(FIELD_BASE + 2, 80, 70, 40, 14).setText(String(CONFIG.block.damageReduction))
    gui.addLabel(LAYER.CONTENT + 22, "§7(1.0 = 100%)", 125, 72, 80, 12)

    gui.addLabel(LAYER.CONTENT + 13, "§eSound:", 10, 92, 40, 12)
    gui.addTextField(FIELD_BASE + 3, 50, 90, 200, 14).setText(CONFIG.block.sound || "")
    gui.addButton(BTN_BROWSE_SOUND, "§b...", 255, 90, 30, 14)

    gui.addLabel(LAYER.CONTENT + 14, "§eParticle:", 10, 112, 50, 12)
    gui.addTextField(FIELD_BASE + 4, 60, 110, 200, 14).setText(CONFIG.block.particle || "")

    // Block animation list
    gui.addLabel(LAYER.CONTENT + 15, "§fAnimations §7(" + CONFIG.block.animations.length + "):", 10, 132, 150, 12)
    var list = []
    for (var i = 0; i < CONFIG.block.animations.length; i++) {
        list.push("§7" + i + ": §f" + CONFIG.block.animations[i])
    }
    if (list.length === 0) list.push("§8(none)")
    gui.addScroll(SCROLL_LIST, 10, 145, 320, 90, list)

    gui.addButton(BTN_ADD, "§a+ Add", 10, 240, 55, 18)
    gui.addButton(BTN_DELETE, "§c- Del", 70, 240, 55, 18)
    gui.addButton(BTN_TEST_ANIM, "§dTest", 130, 240, 55, 18)

    gui.addButton(BTN_SAVE, "§aSave", 220, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Back", 275, H - 30, 55, 20)

    currentGuiId = GUI_ID_BLOCK
    selectedScrollIndex = -1
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== DEATH GUI =======================================
// ============================================================================

function showDeathGui(API, player) {
    var W = 300, H = 230
    var gui = API.createCustomGui(GUI_ID_DEATH, W, H, false, player)

    buildBg(gui, W, H, TEX.bgLight)
    gui.addLabel(LAYER.CONTENT, "§7§l☠ Death Settings", 10, 6, 200, 14)

    gui.addButton(BTN_TOGGLE, CONFIG.death.enabled ? "§aEnabled" : "§cDisabled", 200, 5, 80, 16)

    gui.addLabel(LAYER.CONTENT + 10, "§eParticle:", 10, 36, 50, 12)
    gui.addTextField(FIELD_BASE, 60, 34, 180, 14).setText(CONFIG.death.particle || "")

    gui.addLabel(LAYER.CONTENT + 11, "§eCount:", 10, 58, 40, 12)
    gui.addTextField(FIELD_BASE + 1, 50, 56, 50, 14).setText(String(CONFIG.death.particleCount))

    gui.addLabel(LAYER.CONTENT + 12, "§eSound:", 10, 80, 40, 12)
    gui.addTextField(FIELD_BASE + 2, 50, 78, 180, 14).setText(CONFIG.death.sound || "")
    gui.addButton(BTN_BROWSE_SOUND, "§b...", 235, 78, 30, 14)

    gui.addLabel(LAYER.CONTENT + 13, "§eVolume:", 10, 102, 45, 12)
    gui.addTextField(FIELD_BASE + 3, 55, 100, 40, 14).setText(String(CONFIG.death.soundVolume))
    gui.addLabel(LAYER.CONTENT + 14, "§ePitch:", 105, 102, 35, 12)
    gui.addTextField(FIELD_BASE + 4, 140, 100, 40, 14).setText(String(CONFIG.death.soundPitch))

    var hideText = CONFIG.death.hideBody ? "§a[ON]" : "§c[OFF]"
    gui.addLabel(LAYER.CONTENT + 15, "§eHide Body:", 10, 124, 60, 12)
    gui.addButton(BTN_TOGGLE_RANDOM, hideText, 70, 122, 40, 16)
    gui.addLabel(LAYER.CONTENT + 16, "§eOffset(Y):", 120, 124, 55, 12)
    gui.addTextField(FIELD_BASE + 5, 175, 122, 40, 14).setText(String(CONFIG.death.hideOffset))

    gui.addButton(BTN_SAVE, "§aSave", 180, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Back", 235, H - 30, 55, 20)

    currentGuiId = GUI_ID_DEATH
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== STATES GUI ======================================
// ============================================================================

function showStatesGui(API, player) {
    var W = 340, H = 290
    var gui = API.createCustomGui(GUI_ID_STATES, W, H, false, player)

    buildBg(gui, W, H, TEX.accentYellow)
    gui.addLabel(LAYER.CONTENT, "§6§l★ Boss States", 10, 6, 200, 14)

    gui.addButton(BTN_TOGGLE, CONFIG.states.enabled ? "§aEnabled" : "§cDisabled", 10, 32, 80, 18)

    // Current state display
    var currentName = CONFIG.states.stateList.length > 0 && currentBossState < CONFIG.states.stateList.length
        ? CONFIG.states.stateList[currentBossState].name : "(none)"
    gui.addLabel(LAYER.CONTENT + 1, "§7Active: §f" + currentName, 220, 35, 110, 12)

    // Change mode scroll
    gui.addLabel(LAYER.CONTENT + 2, "§eChange Mode:", 10, 56, 80, 12)
    selectedChangeModeIndex = STATE_CHANGE_MODES.indexOf(CONFIG.states.changeMode || "manual")
    if (selectedChangeModeIndex < 0) selectedChangeModeIndex = 0
    gui.addScroll(SCROLL_STATE_MODE, 10, 70, 130, 65, STATE_CHANGE_MODES).setDefaultSelection(selectedChangeModeIndex)

    // State list
    var list = []
    for (var i = 0; i < CONFIG.states.stateList.length; i++) {
        var s = CONFIG.states.stateList[i]
        var active = (i === currentBossState && CONFIG.states.enabled) ? "§a▶ " : "§7  "
        list.push(active + "§e" + s.name + " §7[atk:" + (s.attackAnims ? s.attackAnims.length : 0) + "]")
    }
    if (list.length === 0) list.push("§8(no states defined)")
    gui.addScroll(SCROLL_STATE_LIST, 10, 140, 320, 80, list)

    gui.addButton(BTN_ADD, "§a+Add", 10, 225, 50, 18)
    gui.addButton(BTN_EDIT, "§eEdit", 65, 225, 50, 18)
    gui.addButton(BTN_DELETE, "§c-Del", 120, 225, 50, 18)
    gui.addButton(BTN_STATE_SWITCH, "§dSwitch", 175, 225, 55, 18)

    gui.addButton(BTN_SAVE, "§aSave", 220, H - 30, 50, 20)
    gui.addButton(BTN_BACK, "§7Back", 275, H - 30, 55, 20)

    currentGuiId = GUI_ID_STATES
    selectedStateScrollIndex = -1
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== STATE EDIT GUI ==================================
// ============================================================================

function showStateEditGui(API, player, idx) {
    editingStateIndex = idx
    var isNew = idx < 0
    var s = isNew ? {
        name: "State " + CONFIG.states.stateList.length,
        attackAnims: [],
        attackRandom: false,
        attackRange: CONFIG.attacks.range,
        attackSpeed: CONFIG.attacks.speed,
        dodgeAnims: [],
        dodgeChance: CONFIG.dodge.chance,
        dodgeRandom: true,
        blockAnims: [],
        blockChance: CONFIG.block.chance,
        blockRandom: true,
        dashAnim: CONFIG.dash.animation,
        dashRange: CONFIG.dash.range,
        hpThreshold: 100,
        duration: 30
    } : CONFIG.states.stateList[idx]

    var W = 340, H = 380
    var gui = API.createCustomGui(GUI_ID_STATE_EDIT, W, H, false, player)

    buildBg(gui, W, H, TEX.accentYellow)
    gui.addLabel(LAYER.CONTENT, isNew ? "§a§lNew State" : "§e§lEdit State", 10, 6, 200, 14)

    // Row 1: Name
    gui.addLabel(LAYER.CONTENT + 10, "§eName:", 10, 32, 35, 12)
    gui.addTextField(FIELD_BASE, 50, 30, 140, 14).setText(s.name)

    // Row 2: HP Threshold + Duration
    gui.addLabel(LAYER.CONTENT + 11, "§cHP%:", 10, 52, 30, 12)
    gui.addTextField(FIELD_BASE + 1, 40, 50, 40, 14).setText(String(s.hpThreshold !== undefined ? s.hpThreshold : 100))
    gui.addLabel(LAYER.CONTENT + 12, "§6Dur(s):", 90, 52, 40, 12)
    gui.addTextField(FIELD_BASE + 2, 130, 50, 40, 14).setText(String(s.duration || 30))

    // Row 3: Attack settings
    gui.addLabel(LAYER.CONTENT + 13, "§c--- Attacks ---", 10, 72, 100, 12)
    gui.addLabel(LAYER.CONTENT + 14, "§eRange:", 10, 88, 40, 12)
    gui.addTextField(FIELD_BASE + 3, 50, 86, 40, 14).setText(String(s.attackRange !== undefined ? s.attackRange : CONFIG.attacks.range))
    gui.addLabel(LAYER.CONTENT + 15, "§eSpeed:", 100, 88, 40, 12)
    gui.addTextField(FIELD_BASE + 4, 140, 86, 40, 14).setText(String(s.attackSpeed !== undefined ? s.attackSpeed : CONFIG.attacks.speed))

    gui.addLabel(LAYER.CONTENT + 16, "§eAtk Anims §7(one per line, blank=inherit):", 10, 106, 250, 12)
    var atkStr = (s.attackAnims && s.attackAnims.length > 0) ? s.attackAnims.join("\n") : ""
    gui.addTextField(FIELD_BASE + 5, 10, 120, 250, 40).setText(atkStr)
    gui.addButton(BTN_BROWSE_ANIM, "§b+Anim", 265, 120, 55, 14)

    // Row 4: Dodge settings
    gui.addLabel(LAYER.CONTENT + 17, "§a--- Dodge ---", 10, 166, 100, 12)
    gui.addLabel(LAYER.CONTENT + 18, "§eChance%:", 10, 182, 55, 12)
    gui.addTextField(FIELD_BASE + 6, 65, 180, 40, 14).setText(String(s.dodgeChance !== undefined ? s.dodgeChance : CONFIG.dodge.chance))

    gui.addLabel(LAYER.CONTENT + 19, "§eDodge Anims §7(one per line, blank=inherit):", 10, 198, 250, 12)
    var dodgeStr = (s.dodgeAnims && s.dodgeAnims.length > 0) ? s.dodgeAnims.join("\n") : ""
    gui.addTextField(FIELD_BASE + 7, 10, 212, 250, 28).setText(dodgeStr)
    gui.addButton(BTN_BROWSE_ANIM + 1, "§a+Anim", 265, 212, 55, 14)

    // Row 5: Block settings
    gui.addLabel(LAYER.CONTENT + 20, "§3--- Block ---", 10, 248, 100, 12)
    gui.addLabel(LAYER.CONTENT + 21, "§eChance%:", 10, 264, 55, 12)
    gui.addTextField(FIELD_BASE + 8, 65, 262, 40, 14).setText(String(s.blockChance !== undefined ? s.blockChance : CONFIG.block.chance))

    gui.addLabel(LAYER.CONTENT + 22, "§eBlock Anims §7(one per line, blank=inherit):", 10, 280, 250, 12)
    var blockStr = (s.blockAnims && s.blockAnims.length > 0) ? s.blockAnims.join("\n") : ""
    gui.addTextField(FIELD_BASE + 9, 10, 294, 250, 28).setText(blockStr)
    gui.addButton(BTN_BROWSE_ANIM + 2, "§3+Anim", 265, 294, 55, 14)

    // Row 6: Dash
    gui.addLabel(LAYER.CONTENT + 23, "§bDash:", 10, 330, 30, 12)
    gui.addTextField(FIELD_BASE + 10, 40, 328, 180, 14).setText(s.dashAnim || "")
    gui.addButton(BTN_BROWSE_ANIM + 3, "§b...", 225, 328, 30, 14)
    gui.addLabel(LAYER.CONTENT + 24, "§eRng:", 260, 330, 25, 12)
    gui.addTextField(FIELD_BASE + 11, 285, 328, 40, 14).setText(String(s.dashRange !== undefined ? s.dashRange : CONFIG.dash.range))

    gui.addButton(BTN_SAVE, "§aSave", 215, H - 25, 50, 20)
    gui.addButton(BTN_BACK, "§7Cancel", 270, H - 25, 60, 20)

    currentGuiId = GUI_ID_STATE_EDIT
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== ANIMATION BROWSER GUI ===========================
// ============================================================================

var ENTITY_DISPLAY_ID = 500

function showAnimBrowserGui(API, player, search) {
    var animations = filterAnimations(search || "")
    animBrowserFiltered = animations
    animBrowserSearchTerm = search || ""
    animBrowserPage = clampBrowserPage(animBrowserPage, animations)
    var pageCount = getBrowserPageCount(animations)
    var pageStart = animBrowserPage * BROWSER_PAGE_SIZE
    var pageAnimations = getBrowserPageEntries(animations, animBrowserPage)

    var W = 320, H = 250
    var gui = API.createCustomGui(GUI_ID_ANIM_BROWSER, W, H, false, player)

    // No background - see NPC animating in world behind GUI
    gui.addLabel(LAYER.CONTENT, "§b§lAnimation Browser", 10, 6, 200, 14)
    gui.addLabel(LAYER.CONTENT + 1, "§7Found: §f" + animations.length + " animations", 160, 8, 150, 12)

    // Scroll list
    gui.addScroll(SCROLL_ANIM_BROWSER, 8, 28, 304, 134, pageAnimations)
    if (selectedAnimBrowserIndex >= pageStart && selectedAnimBrowserIndex < pageStart + pageAnimations.length) {
        gui.getComponent(SCROLL_ANIM_BROWSER).setDefaultSelection(selectedAnimBrowserIndex - pageStart)
    }
    var animPrev = gui.addButton(BTN_BROWSER_PREV, "§e< Prev", 8, 166, 55, 14)
    animPrev.setEnabled(animBrowserPage > 0)
    gui.addLabel(LAYER.CONTENT + 2, "§7Page §f" + (animBrowserPage + 1) + "§7/§f" + pageCount, 118, 168, 85, 12)
    var animNext = gui.addButton(BTN_BROWSER_NEXT, "§eNext >", 257, 166, 55, 14)
    animNext.setEnabled(animBrowserPage + 1 < pageCount)

    // Search
    gui.addLabel(LAYER.CONTENT + 5, "§7Search:", 10, H - 58, 40, 12)
    gui.addTextField(FIELD_ANIM_SEARCH, 52, H - 60, 150, 14).setText(search || "")
    gui.addButton(BTN_BROWSE_ANIM, "§eFilter", 208, H - 60, 45, 14)
    gui.addButton(BTN_TEST_ANIM, "§dTest", 258, H - 60, 45, 14)

    // Selected preview text
    if (selectedAnimBrowserIndex >= 0 && selectedAnimBrowserIndex < animations.length) {
        gui.addLabel(LAYER.CONTENT + 6, "§f" + animations[selectedAnimBrowserIndex], 10, H - 38, 300, 12).setScale(0.8)
    }

    gui.addButton(BTN_SAVE, "§aSelect", 200, H - 18, 55, 16)
    gui.addButton(BTN_BACK, "§7Cancel", 260, H - 18, 50, 16)

    currentGuiId = GUI_ID_ANIM_BROWSER
    player.showCustomGui(gui)
}

function openAnimBrowser(API, player, returnGui, returnField) {
    animBrowserReturnGui = returnGui
    animBrowserReturnField = returnField
    selectedAnimBrowserIndex = -1
    animBrowserPage = 0
    showAnimBrowserGui(API, player, "")
}

// ============================================================================
// ========================== SOUND BROWSER GUI ===============================
// ============================================================================

function showSoundBrowserGui(API, player, search) {
    var sounds = filterSounds(search || "")
    soundBrowserFiltered = sounds
    soundBrowserSearchTerm = search || ""
    soundBrowserPage = clampBrowserPage(soundBrowserPage, sounds)
    var pageCount = getBrowserPageCount(sounds)
    var pageStart = soundBrowserPage * BROWSER_PAGE_SIZE
    var pageSounds = getBrowserPageEntries(sounds, soundBrowserPage)

    var W = 320, H = 270
    var gui = API.createCustomGui(GUI_ID_SOUND_BROWSER, W, H, false, player)

    buildBg(gui, W, H, TEX.accentGreen)
    gui.addLabel(LAYER.CONTENT, "§a§lSound Browser", 10, 6, 200, 14)
    gui.addLabel(LAYER.CONTENT + 1, "§7Found: §f" + sounds.length + " sounds", 160, 8, 150, 12)

    gui.addScroll(SCROLL_SOUND_BROWSER, 8, 28, 304, 134, pageSounds)
    if (selectedSoundBrowserIndex >= pageStart && selectedSoundBrowserIndex < pageStart + pageSounds.length) {
        gui.getComponent(SCROLL_SOUND_BROWSER).setDefaultSelection(selectedSoundBrowserIndex - pageStart)
    }
    var soundPrev = gui.addButton(BTN_BROWSER_PREV, "§e< Prev", 8, 166, 55, 14)
    soundPrev.setEnabled(soundBrowserPage > 0)
    gui.addLabel(LAYER.CONTENT + 2, "§7Page §f" + (soundBrowserPage + 1) + "§7/§f" + pageCount, 118, 168, 85, 12)
    var soundNext = gui.addButton(BTN_BROWSER_NEXT, "§eNext >", 257, 166, 55, 14)
    soundNext.setEnabled(soundBrowserPage + 1 < pageCount)

    // Search
    gui.addLabel(LAYER.CONTENT + 5, "§7Search:", 10, H - 78, 40, 12)
    gui.addTextField(FIELD_SOUND_SEARCH, 52, H - 80, 150, 14).setText(search || "")
    gui.addButton(BTN_BROWSE_SOUND, "§eFilter", 208, H - 80, 45, 14)

    // Volume/Pitch + Play
    gui.addLabel(LAYER.CONTENT + 7, "§7Vol:", 10, H - 58, 25, 12)
    gui.addTextField(FIELD_SOUND_VOLUME, 35, H - 60, 35, 14).setText("1.0")
    gui.addLabel(LAYER.CONTENT + 8, "§7Pitch:", 80, H - 58, 30, 12)
    gui.addTextField(FIELD_SOUND_PITCH, 112, H - 60, 35, 14).setText("1.0")
    gui.addButton(BTN_PLAY_SOUND, "§d▶ Play", 155, H - 60, 50, 14)

    // Selected preview
    if (selectedSoundBrowserIndex >= 0 && selectedSoundBrowserIndex < sounds.length) {
        gui.addLabel(LAYER.CONTENT + 6, "§f" + sounds[selectedSoundBrowserIndex], 10, H - 38, 300, 12).setScale(0.8)
    }

    gui.addButton(BTN_SAVE, "§aSelect", 200, H - 18, 55, 16)
    gui.addButton(BTN_BACK, "§7Cancel", 260, H - 18, 50, 16)

    currentGuiId = GUI_ID_SOUND_BROWSER
    player.showCustomGui(gui)
}

function openSoundBrowser(API, player, returnGui, returnField) {
    soundBrowserReturnGui = returnGui
    soundBrowserReturnField = returnField
    selectedSoundBrowserIndex = -1
    soundBrowserPage = 0
    showSoundBrowserGui(API, player, "")
}

// ============================================================================
// ========================== CONFIRM DIALOG ==================================
// ============================================================================

var confirmAction = null
var confirmReturnGui = null

function showConfirmGui(API, player, message, action, returnGui) {
    confirmAction = action
    confirmReturnGui = returnGui

    var W = 220, H = 100
    var gui = API.createCustomGui(GUI_ID_CONFIRM, W, H, false, player)

    buildBg(gui, W, H, TEX.accentRed)
    gui.addLabel(LAYER.CONTENT, "§c§lConfirm", 10, 6, 100, 14)
    gui.addLabel(LAYER.CONTENT + 1, "§f" + message, 15, 35, 200, 20)

    gui.addButton(BTN_CONFIRM_YES, "§aYes", 40, H - 30, 60, 20)
    gui.addButton(BTN_CONFIRM_NO, "§cNo", 120, H - 30, 60, 20)

    currentGuiId = GUI_ID_CONFIRM
    player.showCustomGui(gui)
}

// ============================================================================
// ========================== EVENT HANDLERS ==================================
// ============================================================================

/**
 * @param {NpcEvent.InitEvent} e
 */
function init(e) {
    if (!e.npc) return
    var npc = e.npc
    loadConfigFromNpc(npc)
    dodgeCooldownUntil = 0
    npc.getTimers().forceStart(TIMER_MAIN_ANIMATION, 20, true)
    // Start attack timer
    if (CONFIG.attacks.enabled) {
        npc.getTimers().forceStart(TIMER_ATTACK, Math.max(1, Math.round(CONFIG.attacks.speed * 20)), false)
    }
    // Apply initial state if states enabled
    if (CONFIG.states.enabled && CONFIG.states.stateList.length > 0) {
        applyState(currentBossState)
    }
}

/**
 * @param {NpcEvent.TimerEvent} e
 */
function timer(e) {
    if (!e.npc) return
    if (e.id === TIMER_MAIN_ANIMATION) {
        enforceMainAnimation(e.npc)
    }
    if (e.id === TIMER_ATTACK) {
        handleAttackTimer(e)
    }
    if (e.id === TIMER_BLOCK_END) {
        isBlocking = false
    }
}

/**
 * @param {NpcEvent.InteractEvent} e
 */
function interact(e) {
    if (!e.npc) return
    var player = e.player
    var npc = e.npc

    var heldItem = player.getMainhandItem()
    var isHoldingBedrock = heldItem && heldItem.getName() === "minecraft:bedrock"

    if (isHoldingBedrock && player.isSneaking() && player.getGamemode() === 1) {
        e.setCanceled(true)
        configNpc = npc
        configApi = API
        loadConfigFromNpc(npc)
        showMainConfigGui(API, player, npc)
        return
    }
}

function normalizeAttackTicks(attackConfig) {
    if (!attackConfig || !attackConfig.animations || !Array.isArray(attackConfig.animations)) return

    var ticks = attackConfig.animationTicks
    var normalized = []
    for (var i = 0; i < attackConfig.animations.length; i++) {
        var value = ticks && ticks[i] !== undefined ? Number(ticks[i]) : 0
        if (isNaN(value) || value < 0) value = 0
        normalized.push(Math.round(value))
    }
    attackConfig.animationTicks = normalized
}

/**
 * @param {NpcEvent.DamagedEvent} e
 */
function damaged(e) {
    if (!e.npc) return
    if (e.damageSource && e.damageSource.getType() === "fall") {
        e.setCanceled(true)
        return
    }
    var npc = e.npc
    var cfg = getActiveConfig()

    // ===== BLOCK CHECK (priority over dodge) =====
    if (cfg.block.enabled && cfg.block.animations.length > 0 && !isBlocking) {
        var now = new Date().getTime()
        if (now - lastBlockTime >= (CONFIG.block.duration * 1000 + 500)) {
            var blockRoll = Math.random() * 100
            if (blockRoll <= cfg.block.chance) {
                lastBlockTime = now
                isBlocking = true

                // Play block animation
                var blockAnim
                if (cfg.block.random) {
                    blockAnim = cfg.block.animations[Math.floor(Math.random() * cfg.block.animations.length)]
                } else {
                    blockAnim = cfg.block.animations[blockIndex % cfg.block.animations.length]
                    blockIndex = (blockIndex + 1) % cfg.block.animations.length
                }
                lockMainAnimation(CONFIG.block.duration)
                try { npc.playEFAnimation(blockAnim) } catch (ex) {}

                // Cancel damage based on reduction
                if (cfg.block.damageReduction >= 1.0) {
                    e.setCanceled(true)
                } else {
                    e.damage = e.damage * (1.0 - cfg.block.damageReduction)
                }

                // Play sound
                if (CONFIG.block.sound) {
                    var pitch = 0.8 + Math.random() * 0.4
                    npc.getWorld().playSoundAt(npc.getPos(), CONFIG.block.sound, 1.0, pitch)
                }

                // Spawn particle
                if (CONFIG.block.particle) {
                    var pos = npc.getPos()
                    npc.getWorld().spawnParticle(CONFIG.block.particle, pos.getX(), pos.getY() + 1, pos.getZ(), 0, 0, 0, 1, 0)
                }

                // End block after duration
                npc.getTimers().forceStart(TIMER_BLOCK_END, Math.max(1, Math.round(CONFIG.block.duration * 20)), false)
                return
            }
        }
    }

    // ===== DODGE CHECK =====
    if (cfg.dodge.enabled && cfg.dodge.animations.length > 0 && !isBlocking && new Date().getTime() >= dodgeCooldownUntil) {
        var dodgeRoll = Math.random() * 100
        if (dodgeRoll <= cfg.dodge.chance) {
            var dodgeAnim
            if (cfg.dodge.random) {
                dodgeAnim = cfg.dodge.animations[Math.floor(Math.random() * cfg.dodge.animations.length)]
            } else {
                dodgeAnim = cfg.dodge.animations[dodgeIndex % cfg.dodge.animations.length]
                dodgeIndex = (dodgeIndex + 1) % cfg.dodge.animations.length
            }
            lockMainAnimation(0.75)
            var dodgePlayed = false
            try {
                npc.playEFAnimation(dodgeAnim)
                dodgePlayed = true
            } catch (ex) {}
            if (dodgePlayed) {
                dodgeCooldownUntil = new Date().getTime() + getDodgeCooldownSeconds(cfg) * 1000
            }
            return
        }
    }

    // State system: check HP threshold
    if (CONFIG.states.enabled && CONFIG.states.changeMode === "hp_threshold") {
        checkHpThresholdState(npc)
    }
}

/**
 * @param {NpcEvent.DiedEvent} e
 */
function died(e) {
    if (!e.npc) return
    var npc = e.npc

    if (CONFIG.death.enabled) {
        // Spawn particle
        if (CONFIG.death.particle) {
            npc.getWorld().spawnParticle(
                CONFIG.death.particle,
                npc.getX(), npc.getY() + 1.5, npc.getZ(),
                0.3, 0.5, 0.3,
                0, CONFIG.death.particleCount
            )
        }

        // Play sound
        if (CONFIG.death.sound) {
            npc.getWorld().playSoundAt(npc.getPos(), CONFIG.death.sound, CONFIG.death.soundVolume, CONFIG.death.soundPitch)
        }

        // Hide body
        if (CONFIG.death.hideBody) {
            npc.setPosition(npc.getX(), npc.getY() - CONFIG.death.hideOffset, npc.getZ())
        }
    }

    // Reset state on death
    if (CONFIG.states.enabled) {
        currentBossState = 0
        activeAttacks = null
        activeDodge = null
        activeBlock = null
        activeDash = null
    }
    attackIndex = 0
    dodgeIndex = 0
    dodgeCooldownUntil = 0
    blockIndex = 0
    isBlocking = false
}

/**
 * @param {NpcEvent.MeleeAttackEvent} e
 */
function kill(e) {
    // State system: timed transitions could trigger on kill
}

// ============================================================================
// ========================== ATTACK TIMER LOGIC ==============================
// ============================================================================

function getAttackDelayTicks(attackConfig, animationIndex) {
    var speed = attackConfig && attackConfig.speed !== undefined ? Number(attackConfig.speed) : 0
    if (isNaN(speed) || speed < 0) speed = 0
    var delay = Math.max(1, Math.round(speed * 20))

    if (animationIndex !== undefined && animationIndex >= 0) {
        normalizeAttackTicks(attackConfig)
        var extraTicks = Number(attackConfig.animationTicks[animationIndex])
        if (!isNaN(extraTicks) && extraTicks > 0) delay += Math.round(extraTicks)
    }
    return Math.max(1, delay)
}

function scheduleNextAttack(npc, cfg, animationIndex) {
    npc.getTimers().forceStart(TIMER_ATTACK, getAttackDelayTicks(cfg.attacks, animationIndex), false)
}

function handleAttackTimer(e) {
    var npc = e.npc
    if (!npc.isAlive()) return

    var cfg = getActiveConfig()
    var target = npc.getAttackTarget()
    if (target == null) {
        scheduleNextAttack(npc, cfg, -1)
        return
    }

    // Has target - check if walking toward them
    var targPos = target.getPos()
    var npcPos = npc.getPos()

    var dx = targPos.getX() - npcPos.getX()
    var dy = targPos.getY() - npcPos.getY()
    var dz = targPos.getZ() - npcPos.getZ()
    var distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

    // Melee range: play attack animation
    if (distance <= cfg.attacks.range) {
        var selectedAttackIndex = -1
        if (cfg.attacks.enabled && cfg.attacks.animations.length > 0) {
            var anim
            if (cfg.attacks.random) {
                selectedAttackIndex = Math.floor(Math.random() * cfg.attacks.animations.length)
                anim = cfg.attacks.animations[selectedAttackIndex]
            } else {
                selectedAttackIndex = attackIndex % cfg.attacks.animations.length
                anim = cfg.attacks.animations[selectedAttackIndex]
                attackIndex = (attackIndex + 1) % cfg.attacks.animations.length
            }
            lockMainAnimation(getAttackDelayTicks(cfg.attacks, selectedAttackIndex) / 20)
            try { npc.playEFAnimation(anim) } catch (ex) {}
        }
        scheduleNextAttack(npc, cfg, selectedAttackIndex)
        return
    }

    // Dash range: gap closer
    if (cfg.dash.enabled && cfg.dash.animation && distance >= cfg.dash.range) {
        if (!npc.getTimers().has(TIMER_DASH_CD)) {
            lockMainAnimation(1)
            try { npc.playEFAnimation(cfg.dash.animation) } catch (ex) {}
            npc.getTimers().start(TIMER_DASH_CD, Math.max(1, Math.round(cfg.dash.cooldown * 20)), false)
        }
    }

    // State system: timed transitions
    if (CONFIG.states.enabled && (CONFIG.states.changeMode === "timed" || CONFIG.states.changeMode === "sequential")) {
        checkTimedState(npc)
    }
    scheduleNextAttack(npc, cfg, -1)
}

// ============================================================================
// ========================== STATE SYSTEM ====================================
// ============================================================================

function applyState(stateIndex) {
    if (!CONFIG.states || !CONFIG.states.stateList || stateIndex >= CONFIG.states.stateList.length) return
    var state = CONFIG.states.stateList[stateIndex]
    currentBossState = stateIndex
    lastStateChangeTime = new Date().getTime()

    // Apply overrides (null means inherit from CONFIG)
    if (state.attackAnims && state.attackAnims.length > 0) {
        activeAttacks = {
            enabled: true,
            range: state.attackRange !== undefined ? state.attackRange : CONFIG.attacks.range,
            speed: state.attackSpeed !== undefined ? state.attackSpeed : CONFIG.attacks.speed,
            random: state.attackRandom !== undefined ? state.attackRandom : CONFIG.attacks.random,
            animations: state.attackAnims,
            animationTicks: state.attackAnimationTicks || state.animationTicks || []
        }
        normalizeAttackTicks(activeAttacks)
    } else {
        activeAttacks = null
    }

    if (state.dodgeAnims && state.dodgeAnims.length > 0) {
        activeDodge = {
            enabled: true,
            chance: state.dodgeChance !== undefined ? state.dodgeChance : CONFIG.dodge.chance,
            random: state.dodgeRandom !== undefined ? state.dodgeRandom : CONFIG.dodge.random,
            cooldown: state.dodgeCooldown !== undefined ? state.dodgeCooldown : CONFIG.dodge.cooldown,
            animations: state.dodgeAnims
        }
    } else {
        activeDodge = null
    }

    if (state.blockAnims && state.blockAnims.length > 0) {
        activeBlock = {
            enabled: true,
            chance: state.blockChance !== undefined ? state.blockChance : CONFIG.block.chance,
            random: state.blockRandom !== undefined ? state.blockRandom : CONFIG.block.random,
            duration: CONFIG.block.duration,
            damageReduction: CONFIG.block.damageReduction,
            sound: CONFIG.block.sound,
            particle: CONFIG.block.particle,
            animations: state.blockAnims
        }
    } else {
        activeBlock = null
    }

    if (state.dashAnim && state.dashAnim.length > 0) {
        activeDash = {
            enabled: true,
            range: state.dashRange !== undefined ? state.dashRange : CONFIG.dash.range,
            cooldown: CONFIG.dash.cooldown,
            animation: state.dashAnim
        }
    } else {
        activeDash = null
    }

    // Reset indices
    attackIndex = 0
    dodgeIndex = 0
    blockIndex = 0
}

function checkHpThresholdState(npc) {
    if (!CONFIG.states.stateList || CONFIG.states.stateList.length === 0) return
    var hpPercent = (npc.getHealth() / npc.getMaxHealth()) * 100

    // Check states from last to first (lower HP thresholds override higher ones)
    for (var i = CONFIG.states.stateList.length - 1; i >= 0; i--) {
        var s = CONFIG.states.stateList[i]
        if (hpPercent <= (s.hpThreshold || 100) && i !== currentBossState) {
            applyState(i)
            return
        }
    }
}

function checkTimedState(npc) {
    if (!CONFIG.states.stateList || CONFIG.states.stateList.length === 0) return
    var now = new Date().getTime()
    var state = CONFIG.states.stateList[currentBossState]
    var duration = (state.duration || 30) * 1000

    if (now - lastStateChangeTime >= duration) {
        var nextState
        if (CONFIG.states.changeMode === "sequential") {
            nextState = (currentBossState + 1) % CONFIG.states.stateList.length
        } else {
            nextState = Math.floor(Math.random() * CONFIG.states.stateList.length)
        }
        applyState(nextState)
    }
}

function enforceMainAnimation(npc) {
    if (!npc.isAlive() || isBlocking || new Date().getTime() < mainAnimationLockedUntil) return

    var target = npc.getAttackTarget()
    if (target != null) {
        var cfg = getActiveConfig()
        var targetPos = target.getPos()
        var npcPos = npc.getPos()
        var dx = targetPos.getX() - npcPos.getX()
        var dy = targetPos.getY() - npcPos.getY()
        var dz = targetPos.getZ() - npcPos.getZ()
        var distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (distance <= cfg.attacks.range) return
    }

    var animation = npc.isNavigating() ? CONFIG.main.walk : CONFIG.main.idle
    if (!animation) return
    try { npc.playEFAnimation(animation) } catch (ex) {}
}

function lockMainAnimation(seconds) {
    var until = new Date().getTime() + Math.max(0, seconds) * 1000
    if (until > mainAnimationLockedUntil) mainAnimationLockedUntil = until
}

function getDodgeCooldownSeconds(cfg) {
    var value = cfg && cfg.dodge && cfg.dodge.cooldown !== undefined
        ? Number(cfg.dodge.cooldown)
        : Number(CONFIG.dodge.cooldown)
    if (isNaN(value) || value < 0) value = 2
    return value
}

/**
 * Tests an Epic Fight animation and reports the real outcome.
 * @param {ICustomNpc} npc
 * @param {String} animation
 * @param {IPlayer} player
 * @returns {Boolean}
 */
function testAnimation(npc, animation, player) {
    try {
        lockMainAnimation(3)
        npc.playEFAnimation(animation)
        player.message("§dPlaying: §f" + animation)
        return true
    } catch (ex) {
        print("[Epic Fight Animator] Failed to play '" + animation + "': " + String(ex))
        player.message("§cCould not play animation. Check the ID and this NPC's Epic Fight config.")
        return false
    }
}

// ============================================================================
// ========================== GUI BUTTON HANDLER ==============================
// ============================================================================

/**
 * @param {CustomGuiEvent.ButtonEvent} e
 */
function customGuiButton(e) {
    var player = e.player
    var btnId = e.buttonId
    var gui = e.gui
    var guiId = gui.getID()

    // ===== MAIN MENU =====
    if (guiId === GUI_ID_MAIN) {
        if (btnId === BTN_MAIN_ANIMS) showMainAnimsGui(configApi, player)
        else if (btnId === BTN_ATTACKS) showAttacksGui(configApi, player)
        else if (btnId === BTN_DASH) showDashGui(configApi, player)
        else if (btnId === BTN_DODGE) showDodgeGui(configApi, player)
        else if (btnId === BTN_BLOCK) showBlockGui(configApi, player)
        else if (btnId === BTN_DEATH) showDeathGui(configApi, player)
        else if (btnId === BTN_STATES) showStatesGui(configApi, player)
        else if (btnId === BTN_CLOSE) player.closeGui()
        return
    }

    // ===== MAIN ANIMATIONS GUI =====
    if (guiId === GUI_ID_MAIN_ANIMS) {
        if (btnId === BTN_BROWSE_ANIM) {
            // Save idle field before opening browser
            var idleComp = gui.getComponent(FIELD_BASE)
            var walkComp = gui.getComponent(FIELD_BASE + 1)
            if (idleComp) CONFIG.main.idle = idleComp.getText() || ""
            if (walkComp) CONFIG.main.walk = walkComp.getText() || ""
            openAnimBrowser(configApi, player, "main_anims", "idle")
        }
        else if (btnId === BTN_BROWSE_ANIM + 1) {
            var idleComp = gui.getComponent(FIELD_BASE)
            var walkComp = gui.getComponent(FIELD_BASE + 1)
            if (idleComp) CONFIG.main.idle = idleComp.getText() || ""
            if (walkComp) CONFIG.main.walk = walkComp.getText() || ""
            openAnimBrowser(configApi, player, "main_anims", "walk")
        }
        else if (btnId === BTN_SAVE) {
            var idleComp = gui.getComponent(FIELD_BASE)
            var walkComp = gui.getComponent(FIELD_BASE + 1)
            if (idleComp) CONFIG.main.idle = idleComp.getText() || ""
            if (walkComp) CONFIG.main.walk = walkComp.getText() || ""
            if (configNpc) {
                saveConfigToNpc(configNpc)
                configNpc.getTimers().forceStart(TIMER_MAIN_ANIMATION, 20, true)
                enforceMainAnimation(configNpc)
            }
            player.message("§aMain animations saved!")
            showMainConfigGui(configApi, player, configNpc)
        }
        else if (btnId === BTN_BACK) showMainConfigGui(configApi, player, configNpc)
        return
    }

    // ===== ATTACKS GUI =====
    if (guiId === GUI_ID_ATTACKS) {
        if (btnId === BTN_TOGGLE) {
            CONFIG.attacks.enabled = !CONFIG.attacks.enabled
            showAttacksGui(configApi, player)
        }
        else if (btnId === BTN_TOGGLE_RANDOM) {
            CONFIG.attacks.random = !CONFIG.attacks.random
            showAttacksGui(configApi, player)
        }
        else if (btnId === BTN_ADD) {
            openAnimBrowser(configApi, player, "attacks", "add")
        }
        else if (btnId === BTN_DELETE) {
            if (selectedScrollIndex >= 0 && selectedScrollIndex < CONFIG.attacks.animations.length) {
                normalizeAttackTicks(CONFIG.attacks)
                CONFIG.attacks.animationTicks.splice(selectedScrollIndex, 1)
                CONFIG.attacks.animations.splice(selectedScrollIndex, 1)
                showAttacksGui(configApi, player)
            }
        }
        else if (btnId === BTN_TEST_ANIM) {
            if (selectedScrollIndex >= 0 && selectedScrollIndex < CONFIG.attacks.animations.length && configNpc) {
                testAnimation(configNpc, CONFIG.attacks.animations[selectedScrollIndex], player)
            }
        }
        else if (btnId === BTN_EDIT) {
            if (selectedScrollIndex >= 0 && selectedScrollIndex < CONFIG.attacks.animations.length) {
                showAttackEditGui(configApi, player, selectedScrollIndex)
            }
        }
        else if (btnId === BTN_CLEAR_ALL) {
            showConfirmGui(configApi, player, "Clear all attack animations?", "clear_attacks", "attacks")
        }
        else if (btnId === BTN_SAVE) {
            // Read fields
            var rangeComp = gui.getComponent(FIELD_BASE)
            var speedComp = gui.getComponent(FIELD_BASE + 1)
            if (rangeComp) CONFIG.attacks.range = parseFloat(rangeComp.getText()) || 3
            if (speedComp) CONFIG.attacks.speed = parseFloat(speedComp.getText()) || 1.3
            normalizeAttackTicks(CONFIG.attacks)
            // Update timer
            if (configNpc) {
                configNpc.getTimers().forceStart(TIMER_ATTACK, Math.max(1, Math.round(CONFIG.attacks.speed * 20)), false)
                saveConfigToNpc(configNpc)
            }
            player.message("§aAttack settings saved!")
            showMainConfigGui(configApi, player, configNpc)
        }
        else if (btnId === BTN_BACK) showMainConfigGui(configApi, player, configNpc)
        return
    }

    // ===== ATTACK EDIT GUI =====
    if (guiId === GUI_ID_ATTACK_EDIT) {
        if (btnId === BTN_SAVE) {
            if (editingAttackIndex >= 0 && editingAttackIndex < CONFIG.attacks.animations.length) {
                var animComp = gui.getComponent(FIELD_BASE)
                var ticksComp = gui.getComponent(FIELD_BASE + 1)
                if (animComp) {
                    var editedAnimation = animComp.getText().trim()
                    if (editedAnimation.length > 0) CONFIG.attacks.animations[editingAttackIndex] = editedAnimation
                }
                var editedTicks = ticksComp ? parseInt(ticksComp.getText(), 10) : 0
                if (isNaN(editedTicks) || editedTicks < 0) editedTicks = 0
                normalizeAttackTicks(CONFIG.attacks)
                CONFIG.attacks.animationTicks[editingAttackIndex] = editedTicks
                if (configNpc) saveConfigToNpc(configNpc)
            }
            editingAttackIndex = -1
            player.message("§aAttack saved!")
            showAttacksGui(configApi, player)
        }
        else if (btnId === BTN_BACK) {
            editingAttackIndex = -1
            showAttacksGui(configApi, player)
        }
        return
    }

    // ===== DASH GUI =====
    if (guiId === GUI_ID_DASH) {
        if (btnId === BTN_TOGGLE) {
            CONFIG.dash.enabled = !CONFIG.dash.enabled
            showDashGui(configApi, player)
        }
        else if (btnId === BTN_BROWSE_ANIM) {
            // Save current fields first
            var rangeComp = gui.getComponent(FIELD_BASE)
            var cdComp = gui.getComponent(FIELD_BASE + 1)
            var animComp = gui.getComponent(FIELD_BASE + 2)
            if (rangeComp) CONFIG.dash.range = parseFloat(rangeComp.getText()) || 8
            if (cdComp) CONFIG.dash.cooldown = parseFloat(cdComp.getText()) || 10
            if (animComp) CONFIG.dash.animation = animComp.getText() || ""
            openAnimBrowser(configApi, player, "dash", "animation")
        }
        else if (btnId === BTN_SAVE) {
            var rangeComp = gui.getComponent(FIELD_BASE)
            var cdComp = gui.getComponent(FIELD_BASE + 1)
            var animComp = gui.getComponent(FIELD_BASE + 2)
            if (rangeComp) CONFIG.dash.range = parseFloat(rangeComp.getText()) || 8
            if (cdComp) CONFIG.dash.cooldown = parseFloat(cdComp.getText()) || 10
            if (animComp) CONFIG.dash.animation = animComp.getText() || ""
            if (configNpc) saveConfigToNpc(configNpc)
            player.message("§aDash settings saved!")
            showMainConfigGui(configApi, player, configNpc)
        }
        else if (btnId === BTN_BACK) showMainConfigGui(configApi, player, configNpc)
        return
    }

    // ===== DODGE GUI =====
    if (guiId === GUI_ID_DODGE) {
        if (btnId === BTN_TOGGLE) {
            CONFIG.dodge.enabled = !CONFIG.dodge.enabled
            showDodgeGui(configApi, player)
        }
        else if (btnId === BTN_TOGGLE_RANDOM) {
            CONFIG.dodge.random = !CONFIG.dodge.random
            showDodgeGui(configApi, player)
        }
        else if (btnId === BTN_ADD) {
            openAnimBrowser(configApi, player, "dodge", "add")
        }
        else if (btnId === BTN_DELETE) {
            if (selectedScrollIndex >= 0 && selectedScrollIndex < CONFIG.dodge.animations.length) {
                CONFIG.dodge.animations.splice(selectedScrollIndex, 1)
                showDodgeGui(configApi, player)
            }
        }
        else if (btnId === BTN_TEST_ANIM) {
            if (selectedScrollIndex >= 0 && selectedScrollIndex < CONFIG.dodge.animations.length && configNpc) {
                testAnimation(configNpc, CONFIG.dodge.animations[selectedScrollIndex], player)
            }
        }
        else if (btnId === BTN_CLEAR_ALL) {
            showConfirmGui(configApi, player, "Clear all dodge animations?", "clear_dodge", "dodge")
        }
        else if (btnId === BTN_SAVE) {
            var chanceComp = gui.getComponent(FIELD_BASE)
            var cooldownComp = gui.getComponent(FIELD_BASE + 1)
            if (chanceComp) CONFIG.dodge.chance = parseFloat(chanceComp.getText()) || 30
            if (cooldownComp) {
                var cooldown = parseFloat(cooldownComp.getText())
                if (isNaN(cooldown) || cooldown < 0) cooldown = 2
                CONFIG.dodge.cooldown = cooldown
            }
            if (configNpc) saveConfigToNpc(configNpc)
            player.message("§aDodge settings saved!")
            showMainConfigGui(configApi, player, configNpc)
        }
        else if (btnId === BTN_BACK) showMainConfigGui(configApi, player, configNpc)
        return
    }

    // ===== BLOCK GUI =====
    if (guiId === GUI_ID_BLOCK) {
        if (btnId === BTN_TOGGLE) {
            CONFIG.block.enabled = !CONFIG.block.enabled
            showBlockGui(configApi, player)
        }
        else if (btnId === BTN_TOGGLE_RANDOM) {
            CONFIG.block.random = !CONFIG.block.random
            showBlockGui(configApi, player)
        }
        else if (btnId === BTN_ADD) {
            openAnimBrowser(configApi, player, "block", "add")
        }
        else if (btnId === BTN_DELETE) {
            if (selectedScrollIndex >= 0 && selectedScrollIndex < CONFIG.block.animations.length) {
                CONFIG.block.animations.splice(selectedScrollIndex, 1)
                showBlockGui(configApi, player)
            }
        }
        else if (btnId === BTN_TEST_ANIM) {
            if (selectedScrollIndex >= 0 && selectedScrollIndex < CONFIG.block.animations.length && configNpc) {
                testAnimation(configNpc, CONFIG.block.animations[selectedScrollIndex], player)
            }
        }
        else if (btnId === BTN_BROWSE_SOUND) {
            // Save current block fields
            saveBlockFields(gui)
            openSoundBrowser(configApi, player, "block", "sound")
        }
        else if (btnId === BTN_SAVE) {
            saveBlockFields(gui)
            if (configNpc) saveConfigToNpc(configNpc)
            player.message("§aBlock settings saved!")
            showMainConfigGui(configApi, player, configNpc)
        }
        else if (btnId === BTN_BACK) showMainConfigGui(configApi, player, configNpc)
        return
    }

    // ===== DEATH GUI =====
    if (guiId === GUI_ID_DEATH) {
        if (btnId === BTN_TOGGLE) {
            CONFIG.death.enabled = !CONFIG.death.enabled
            showDeathGui(configApi, player)
        }
        else if (btnId === BTN_TOGGLE_RANDOM) {
            CONFIG.death.hideBody = !CONFIG.death.hideBody
            showDeathGui(configApi, player)
        }
        else if (btnId === BTN_BROWSE_SOUND) {
            saveDeathFields(gui)
            openSoundBrowser(configApi, player, "death", "sound")
        }
        else if (btnId === BTN_SAVE) {
            saveDeathFields(gui)
            if (configNpc) saveConfigToNpc(configNpc)
            player.message("§aDeath settings saved!")
            showMainConfigGui(configApi, player, configNpc)
        }
        else if (btnId === BTN_BACK) showMainConfigGui(configApi, player, configNpc)
        return
    }

    // ===== STATES GUI =====
    if (guiId === GUI_ID_STATES) {
        if (btnId === BTN_TOGGLE) {
            CONFIG.states.enabled = !CONFIG.states.enabled
            showStatesGui(configApi, player)
        }
        else if (btnId === BTN_ADD) {
            showStateEditGui(configApi, player, -1)
        }
        else if (btnId === BTN_EDIT) {
            if (selectedStateScrollIndex >= 0 && selectedStateScrollIndex < CONFIG.states.stateList.length) {
                showStateEditGui(configApi, player, selectedStateScrollIndex)
            }
        }
        else if (btnId === BTN_DELETE) {
            if (selectedStateScrollIndex >= 0 && selectedStateScrollIndex < CONFIG.states.stateList.length) {
                CONFIG.states.stateList.splice(selectedStateScrollIndex, 1)
                if (currentBossState >= CONFIG.states.stateList.length) {
                    currentBossState = 0
                    applyState(0)
                }
                showStatesGui(configApi, player)
            }
        }
        else if (btnId === BTN_STATE_SWITCH) {
            if (selectedStateScrollIndex >= 0 && selectedStateScrollIndex < CONFIG.states.stateList.length) {
                applyState(selectedStateScrollIndex)
                if (configNpc) saveConfigToNpc(configNpc)
                player.message("§dSwitched to state: §f" + CONFIG.states.stateList[selectedStateScrollIndex].name)
                showStatesGui(configApi, player)
            }
        }
        else if (btnId === BTN_SAVE) {
            if (configNpc) saveConfigToNpc(configNpc)
            player.message("§aStates saved!")
            showMainConfigGui(configApi, player, configNpc)
        }
        else if (btnId === BTN_BACK) showMainConfigGui(configApi, player, configNpc)
        return
    }

    // ===== STATE EDIT GUI =====
    if (guiId === GUI_ID_STATE_EDIT) {
        if (btnId === BTN_BROWSE_ANIM || btnId === BTN_BROWSE_ANIM + 1 || btnId === BTN_BROWSE_ANIM + 2 || btnId === BTN_BROWSE_ANIM + 3) {
            // Save current fields to temp before opening browser
            saveStateEditToTemp(gui, player)
            var field = "state_atk"
            if (btnId === BTN_BROWSE_ANIM + 1) field = "state_dodge"
            else if (btnId === BTN_BROWSE_ANIM + 2) field = "state_block"
            else if (btnId === BTN_BROWSE_ANIM + 3) field = "state_dash"
            openAnimBrowser(configApi, player, "state_edit", field)
        }
        else if (btnId === BTN_SAVE) {
            saveStateFromGui(gui, player)
            showStatesGui(configApi, player)
        }
        else if (btnId === BTN_BACK) showStatesGui(configApi, player)
        return
    }

    // ===== ANIMATION BROWSER =====
    if (guiId === GUI_ID_ANIM_BROWSER) {
        if (btnId === BTN_BROWSE_ANIM) {
            // Filter button
            var searchComp = gui.getComponent(FIELD_ANIM_SEARCH)
            var search = searchComp ? searchComp.getText() : ""
            selectedAnimBrowserIndex = -1
            animBrowserPage = 0
            showAnimBrowserGui(configApi, player, search)
        }
        else if (btnId === BTN_BROWSER_PREV) {
            animBrowserPage = Math.max(0, animBrowserPage - 1)
            selectedAnimBrowserIndex = -1
            showAnimBrowserGui(configApi, player, animBrowserSearchTerm)
        }
        else if (btnId === BTN_BROWSER_NEXT) {
            animBrowserPage = Math.min(getBrowserPageCount(animBrowserFiltered || []) - 1, animBrowserPage + 1)
            selectedAnimBrowserIndex = -1
            showAnimBrowserGui(configApi, player, animBrowserSearchTerm)
        }
        else if (btnId === BTN_TEST_ANIM) {
            if (selectedAnimBrowserIndex >= 0 && animBrowserFiltered && selectedAnimBrowserIndex < animBrowserFiltered.length && configNpc) {
                testAnimation(configNpc, animBrowserFiltered[selectedAnimBrowserIndex], player)
            }
        }
        else if (btnId === BTN_SAVE) {
            // Apply selection
            if (selectedAnimBrowserIndex >= 0 && animBrowserFiltered && selectedAnimBrowserIndex < animBrowserFiltered.length) {
                var selected = animBrowserFiltered[selectedAnimBrowserIndex]
                applyAnimBrowserResult(selected, player)
            }
            returnFromAnimBrowser(configApi, player)
        }
        else if (btnId === BTN_BACK) {
            returnFromAnimBrowser(configApi, player)
        }
        return
    }

    // ===== SOUND BROWSER =====
    if (guiId === GUI_ID_SOUND_BROWSER) {
        if (btnId === BTN_BROWSE_SOUND) {
            var searchComp = gui.getComponent(FIELD_SOUND_SEARCH)
            var search = searchComp ? searchComp.getText() : ""
            selectedSoundBrowserIndex = -1
            soundBrowserPage = 0
            showSoundBrowserGui(configApi, player, search)
        }
        else if (btnId === BTN_BROWSER_PREV) {
            soundBrowserPage = Math.max(0, soundBrowserPage - 1)
            selectedSoundBrowserIndex = -1
            showSoundBrowserGui(configApi, player, soundBrowserSearchTerm)
        }
        else if (btnId === BTN_BROWSER_NEXT) {
            soundBrowserPage = Math.min(getBrowserPageCount(soundBrowserFiltered || []) - 1, soundBrowserPage + 1)
            selectedSoundBrowserIndex = -1
            showSoundBrowserGui(configApi, player, soundBrowserSearchTerm)
        }
        else if (btnId === BTN_PLAY_SOUND) {
            if (selectedSoundBrowserIndex >= 0 && soundBrowserFiltered && selectedSoundBrowserIndex < soundBrowserFiltered.length && configNpc) {
                var volComp = gui.getComponent(FIELD_SOUND_VOLUME)
                var pitchComp = gui.getComponent(FIELD_SOUND_PITCH)
                var vol = volComp ? parseFloat(volComp.getText()) || 1.0 : 1.0
                var pitch = pitchComp ? parseFloat(pitchComp.getText()) || 1.0 : 1.0
                configNpc.getWorld().playSoundAt(configNpc.getPos(), soundBrowserFiltered[selectedSoundBrowserIndex], vol, pitch)
            }
        }
        else if (btnId === BTN_SAVE) {
            if (selectedSoundBrowserIndex >= 0 && soundBrowserFiltered && selectedSoundBrowserIndex < soundBrowserFiltered.length) {
                var selected = soundBrowserFiltered[selectedSoundBrowserIndex]
                applySoundBrowserResult(selected)
            }
            returnFromSoundBrowser(configApi, player)
        }
        else if (btnId === BTN_BACK) {
            returnFromSoundBrowser(configApi, player)
        }
        return
    }

    // ===== CONFIRM DIALOG =====
    if (guiId === GUI_ID_CONFIRM) {
        if (btnId === BTN_CONFIRM_YES) {
            if (confirmAction === "clear_attacks") {
                CONFIG.attacks.animations = []
                CONFIG.attacks.animationTicks = []
            } else if (confirmAction === "clear_dodge") {
                CONFIG.dodge.animations = []
            }
        }
        // Return to previous GUI
        if (confirmReturnGui === "attacks") showAttacksGui(configApi, player)
        else if (confirmReturnGui === "dodge") showDodgeGui(configApi, player)
        else showMainConfigGui(configApi, player, configNpc)
        return
    }
}

// ============================================================================
// ========================== GUI SCROLL HANDLER ==============================
// ============================================================================

/**
 * @param {CustomGuiEvent.ScrollEvent} e
 */
function customGuiScroll(e) {
    var guiId = e.gui.getID()

    if (guiId === GUI_ID_ATTACKS || guiId === GUI_ID_DODGE || guiId === GUI_ID_BLOCK) {
        if (e.scrollId === SCROLL_LIST) {
            selectedScrollIndex = e.scrollIndex
        }
    }

    if (guiId === GUI_ID_STATES) {
        if (e.scrollId === SCROLL_STATE_LIST) {
            selectedStateScrollIndex = e.scrollIndex
        }
        else if (e.scrollId === SCROLL_STATE_MODE) {
            selectedChangeModeIndex = e.scrollIndex
            CONFIG.states.changeMode = STATE_CHANGE_MODES[selectedChangeModeIndex] || "manual"
        }
    }

    if (guiId === GUI_ID_ANIM_BROWSER) {
        if (e.scrollId === SCROLL_ANIM_BROWSER) {
            var animIndex = animBrowserPage * BROWSER_PAGE_SIZE + e.scrollIndex
            if (!animBrowserFiltered || e.scrollIndex < 0 || animIndex >= animBrowserFiltered.length) {
                selectedAnimBrowserIndex = -1
            } else {
                selectedAnimBrowserIndex = animIndex
                // Auto-preview: play animation on NPC when selected
                if (configNpc) {
                    lockMainAnimation(3)
                    try { configNpc.playEFAnimation(animBrowserFiltered[selectedAnimBrowserIndex]) } catch (ex) {}
                }
            }
        }
    }

    if (guiId === GUI_ID_SOUND_BROWSER) {
        if (e.scrollId === SCROLL_SOUND_BROWSER) {
            var soundIndex = soundBrowserPage * BROWSER_PAGE_SIZE + e.scrollIndex
            if (!soundBrowserFiltered || e.scrollIndex < 0 || soundIndex >= soundBrowserFiltered.length) {
                selectedSoundBrowserIndex = -1
            } else {
                selectedSoundBrowserIndex = soundIndex
            }
        }
    }
}

/**
 * @param {CustomGuiEvent.CloseEvent} e
 */
function customGuiClosed(e) {
    // Cleanup
}

// ============================================================================
// ========================== FIELD SAVE HELPERS ==============================
// ============================================================================

function saveBlockFields(gui) {
    var chanceComp = gui.getComponent(FIELD_BASE)
    var durComp = gui.getComponent(FIELD_BASE + 1)
    var reduceComp = gui.getComponent(FIELD_BASE + 2)
    var soundComp = gui.getComponent(FIELD_BASE + 3)
    var particleComp = gui.getComponent(FIELD_BASE + 4)

    if (chanceComp) CONFIG.block.chance = parseFloat(chanceComp.getText()) || 50
    if (durComp) CONFIG.block.duration = parseFloat(durComp.getText()) || 2.0
    if (reduceComp) CONFIG.block.damageReduction = parseFloat(reduceComp.getText()) || 1.0
    if (soundComp) CONFIG.block.sound = soundComp.getText() || ""
    if (particleComp) CONFIG.block.particle = particleComp.getText() || ""
}

function saveDeathFields(gui) {
    var particleComp = gui.getComponent(FIELD_BASE)
    var countComp = gui.getComponent(FIELD_BASE + 1)
    var soundComp = gui.getComponent(FIELD_BASE + 2)
    var volComp = gui.getComponent(FIELD_BASE + 3)
    var pitchComp = gui.getComponent(FIELD_BASE + 4)
    var offsetComp = gui.getComponent(FIELD_BASE + 5)

    if (particleComp) CONFIG.death.particle = particleComp.getText() || ""
    if (countComp) CONFIG.death.particleCount = parseInt(countComp.getText()) || 100
    if (soundComp) CONFIG.death.sound = soundComp.getText() || ""
    if (volComp) CONFIG.death.soundVolume = parseFloat(volComp.getText()) || 1.0
    if (pitchComp) CONFIG.death.soundPitch = parseFloat(pitchComp.getText()) || 0
    if (offsetComp) CONFIG.death.hideOffset = parseFloat(offsetComp.getText()) || 5
}

function saveStateEditToTemp(gui, player) {
    // Store current fields in player tempdata so they survive the browser round-trip
    var td = player.getTempdata()
    var comp
    comp = gui.getComponent(FIELD_BASE)
    if (comp) td.put("se_name", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 1)
    if (comp) td.put("se_hp", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 2)
    if (comp) td.put("se_dur", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 3)
    if (comp) td.put("se_atkRange", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 4)
    if (comp) td.put("se_atkSpeed", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 5)
    if (comp) td.put("se_atkAnims", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 6)
    if (comp) td.put("se_dodgeChance", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 7)
    if (comp) td.put("se_dodgeAnims", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 8)
    if (comp) td.put("se_blockChance", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 9)
    if (comp) td.put("se_blockAnims", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 10)
    if (comp) td.put("se_dashAnim", comp.getText())
    comp = gui.getComponent(FIELD_BASE + 11)
    if (comp) td.put("se_dashRange", comp.getText())
    td.put("se_index", String(editingStateIndex))
}

function saveStateFromGui(gui, player) {
    var state = {
        name: "",
        hpThreshold: 100,
        duration: 30,
        attackRange: CONFIG.attacks.range,
        attackSpeed: CONFIG.attacks.speed,
        attackAnims: [],
        attackRandom: false,
        dodgeChance: CONFIG.dodge.chance,
        dodgeAnims: [],
        dodgeRandom: true,
        blockChance: CONFIG.block.chance,
        blockAnims: [],
        blockRandom: true,
        dashAnim: "",
        dashRange: CONFIG.dash.range
    }

    var comp
    comp = gui.getComponent(FIELD_BASE)
    if (comp) state.name = comp.getText() || "State"
    comp = gui.getComponent(FIELD_BASE + 1)
    if (comp) state.hpThreshold = parseFloat(comp.getText()) || 100
    comp = gui.getComponent(FIELD_BASE + 2)
    if (comp) state.duration = parseFloat(comp.getText()) || 30
    comp = gui.getComponent(FIELD_BASE + 3)
    if (comp) state.attackRange = parseFloat(comp.getText()) || CONFIG.attacks.range
    comp = gui.getComponent(FIELD_BASE + 4)
    if (comp) state.attackSpeed = parseFloat(comp.getText()) || CONFIG.attacks.speed
    comp = gui.getComponent(FIELD_BASE + 5)
    if (comp) state.attackAnims = parseAnimLines(comp.getText())
    comp = gui.getComponent(FIELD_BASE + 6)
    if (comp) state.dodgeChance = parseFloat(comp.getText()) || CONFIG.dodge.chance
    comp = gui.getComponent(FIELD_BASE + 7)
    if (comp) state.dodgeAnims = parseAnimLines(comp.getText())
    comp = gui.getComponent(FIELD_BASE + 8)
    if (comp) state.blockChance = parseFloat(comp.getText()) || CONFIG.block.chance
    comp = gui.getComponent(FIELD_BASE + 9)
    if (comp) state.blockAnims = parseAnimLines(comp.getText())
    comp = gui.getComponent(FIELD_BASE + 10)
    if (comp) state.dashAnim = comp.getText() || ""
    comp = gui.getComponent(FIELD_BASE + 11)
    if (comp) state.dashRange = parseFloat(comp.getText()) || CONFIG.dash.range

    if (editingStateIndex >= 0 && editingStateIndex < CONFIG.states.stateList.length) {
        CONFIG.states.stateList[editingStateIndex] = state
    } else {
        CONFIG.states.stateList.push(state)
    }
    if (configNpc) saveConfigToNpc(configNpc)
    player.message("§aState saved: §f" + state.name)
}

function parseAnimLines(text) {
    if (!text || text.trim().length === 0) return []
    var lines = text.split("\n")
    var result = []
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim()
        if (line.length > 0) result.push(line)
    }
    return result
}

// ============================================================================
// ========================== BROWSER APPLY/RETURN ============================
// ============================================================================

function applyAnimBrowserResult(selected, player) {
    var field = animBrowserReturnField

    if (field === "add") {
        // Add to the appropriate list based on return GUI
        if (animBrowserReturnGui === "attacks") {
            normalizeAttackTicks(CONFIG.attacks)
            CONFIG.attacks.animations.push(selected)
            CONFIG.attacks.animationTicks.push(0)
        }
        else if (animBrowserReturnGui === "dodge") CONFIG.dodge.animations.push(selected)
        else if (animBrowserReturnGui === "block") CONFIG.block.animations.push(selected)
    }
    else if (field === "animation") {
        // Single animation field (dash)
        if (animBrowserReturnGui === "dash") CONFIG.dash.animation = selected
    }
    else if (field === "idle") {
        if (animBrowserReturnGui === "main_anims") CONFIG.main.idle = selected
    }
    else if (field === "walk") {
        if (animBrowserReturnGui === "main_anims") CONFIG.main.walk = selected
    }
    else if (field === "state_atk" || field === "state_dodge" || field === "state_block" || field === "state_dash") {
        // Append to tempdata for state edit
        player.getTempdata().put("animBrowserResult_" + field, selected)
    }
}

function returnFromAnimBrowser(API, player) {
    var gui = animBrowserReturnGui

    if (gui === "attacks") showAttacksGui(API, player)
    else if (gui === "dash") showDashGui(API, player)
    else if (gui === "dodge") showDodgeGui(API, player)
    else if (gui === "block") showBlockGui(API, player)
    else if (gui === "main_anims") showMainAnimsGui(API, player)
    else if (gui === "state_edit") {
        // Restore state edit from tempdata and append browser result
        var td = player.getTempdata()
        var idx = parseInt(td.get("se_index") || "-1")

        // If we have a browser result, append it to the appropriate field
        var field = animBrowserReturnField
        var result = td.get("animBrowserResult_" + field)
        if (result) {
            td.remove("animBrowserResult_" + field)
            var animKey = null
            if (field === "state_atk") animKey = "se_atkAnims"
            else if (field === "state_dodge") animKey = "se_dodgeAnims"
            else if (field === "state_block") animKey = "se_blockAnims"
            else if (field === "state_dash") animKey = "se_dashAnim"

            if (animKey) {
                var existing = td.get(animKey) || ""
                if (animKey === "se_dashAnim") {
                    td.put(animKey, result)
                } else {
                    if (existing.length > 0) {
                        td.put(animKey, existing + "\n" + result)
                    } else {
                        td.put(animKey, result)
                    }
                }
            }
        }

        // Rebuild state edit GUI using tempdata
        showStateEditFromTemp(API, player, idx)
    }
    else showMainConfigGui(API, player, configNpc)
}

function showStateEditFromTemp(API, player, idx) {
    editingStateIndex = idx
    var td = player.getTempdata()

    var s = {
        name: td.get("se_name") || "State",
        hpThreshold: parseFloat(td.get("se_hp") || "100"),
        duration: parseFloat(td.get("se_dur") || "30"),
        attackRange: parseFloat(td.get("se_atkRange") || String(CONFIG.attacks.range)),
        attackSpeed: parseFloat(td.get("se_atkSpeed") || String(CONFIG.attacks.speed)),
        attackAnims: parseAnimLines(td.get("se_atkAnims") || ""),
        dodgeChance: parseFloat(td.get("se_dodgeChance") || String(CONFIG.dodge.chance)),
        dodgeAnims: parseAnimLines(td.get("se_dodgeAnims") || ""),
        blockChance: parseFloat(td.get("se_blockChance") || String(CONFIG.block.chance)),
        blockAnims: parseAnimLines(td.get("se_blockAnims") || ""),
        dashAnim: td.get("se_dashAnim") || "",
        dashRange: parseFloat(td.get("se_dashRange") || String(CONFIG.dash.range))
    }

    // Temporarily put this into the state list so showStateEditGui reads it
    if (idx >= 0 && idx < CONFIG.states.stateList.length) {
        CONFIG.states.stateList[idx] = s
    }

    showStateEditGui(API, player, idx)
}

function applySoundBrowserResult(selected) {
    var field = soundBrowserReturnField
    var gui = soundBrowserReturnGui

    if (gui === "block" && field === "sound") {
        CONFIG.block.sound = selected
    }
    else if (gui === "death" && field === "sound") {
        CONFIG.death.sound = selected
    }
}

function returnFromSoundBrowser(API, player) {
    var gui = soundBrowserReturnGui

    if (gui === "block") showBlockGui(API, player)
    else if (gui === "death") showDeathGui(API, player)
    else showMainConfigGui(API, player, configNpc)
}
