# OneScript Design Pattern for CNPC Scripts

## Overview
OneScript is a plug-and-play design pattern for CustomNPCs scripts where a single script file is completely self-contained with all configuration done through in-game GUI interfaces. No file editing required after deployment.

## Core Rules

### 1. In-Game GUI Configuration (REQUIRED)
- **ALL configuration MUST be editable via ICustomGui**
- No editing of script files should ever be required after initial deployment
- Config access should be protected (Creative mode, Admin list, special item + sneak, etc.)

### 2. ICustomScroll is Preferred for Selection
- Use `addScroll()` for list-based selections (enums, options, items)
- Use `addTextField()` only for free-form text input
- Use `addButton()` for actions and toggles
- Use `addLabel()` for display-only information

### 3. Persistent Data Storage
Use appropriate storage based on scope:
```javascript
// World-wide data (shared across all players)
world.getStoreddata().put("key", JSON.stringify(data))
var data = JSON.parse(world.getStoreddata().get("key") || "{}")

// Per-player data
player.getStoreddata().put("key", JSON.stringify(data))
var data = JSON.parse(player.getStoreddata().get("key") || "{}")

// Per-NPC/Entity data (via tags for compatibility)
npc.addTag("CONFIG_PREFIX:" + JSON.stringify(config))
// Retrieve: parse tags starting with "CONFIG_PREFIX:"
```

### 4. Self-Contained Code
- **NO external dependencies** (no imports, no require, no external files)
- All code in a single script context
- All utility functions defined within the script
- All constants and lookup tables embedded

### 5. ES5 Compatible (CNPC Default)
- No semicolons (project style)
- Use `function` declarations (no arrow functions)
- Use `var` (no `let`/`const`)
- Use `for` loops (no `forEach`, `map`, etc.)
- String concatenation with `+` (no template literals)

### 6. Default Configuration Fallbacks
- Always provide sensible defaults in code
- If stored config missing, create and save defaults
- Never crash on missing configuration

---

## Script Structure

### Header Block

```javascript
// ============================================================================
// SCRIPT_NAME - DESCRIPTION
// ============================================================================
// Script Type: NpcEvent | PlayerEvent | BlockEvent | ItemEvent
// Style: ES5 | No Semicolons
// ============================================================================
// IN-GAME CONFIGURATION:
// [Describe how admin accesses config GUI]
// Example: Hold BEDROCK + SNEAK + CREATIVE and interact with NPC
// ============================================================================
```

### Configuration Section
```javascript
// ============================================================================
// CONFIGURATION (Defaults - Editable In-Game)
// ============================================================================
var CONFIG = {
    // GUI dimensions and IDs
    GUI_ID_MAIN: 1000,
    GUI_ID_CONFIG: 1001,
    WIDTH: 300,
    HEIGHT: 200,
    
    // Feature settings with sensible defaults
    featureEnabled: true,
    featureValue: 100,
    featureList: ["option1", "option2", "option3"]
}
```

### Component ID Registry
```javascript
// ============================================================================
// GUI COMPONENT IDS
// ============================================================================
var IDS = {
    // Backgrounds (1-49)
    BG_START: 1,
    
    // Tabs/Navigation (50-99)
    SCROLL_TABS: 50,
    
    // Labels (100-199)
    LABEL_TITLE: 100,
    LABEL_INFO: 101,
    
    // Inputs (200-299)
    INPUT_NAME: 200,
    INPUT_VALUE: 201,
    
    // Scrolls (250-299 or dedicated range)
    SCROLL_OPTIONS: 250,
    SCROLL_LIST: 251,
    
    // Buttons (300-399)
    BTN_CLOSE: 300,
    BTN_SAVE: 301,
    BTN_ADD: 302,
    BTN_REMOVE: 303
}
```

### State Tracking
```javascript
// ============================================================================
// RUNTIME STATE (in-memory, per-session)
// ============================================================================
var playerActiveTab = {}      // Track GUI tab per player
var playerSelection = {}      // Track scroll selections per player
var playerEditMode = {}       // Track edit states per player
```

---

## GUI Building Patterns

### Background Builder (Reusable)
```javascript
function buildBackground(gui, width, height) {
    var id = IDS.BG_START
    // Outer border
    gui.addTexturedRect(id++, "minecraft:textures/block/blue_terracotta.png", 0, 0, width, height)
    // Inner fill
    gui.addTexturedRect(id++, "minecraft:textures/block/gray_concrete.png", 3, 3, width - 6, height - 6)
    // Title bar
    gui.addTexturedRect(id++, "minecraft:textures/block/orange_terracotta.png", 3, 3, width - 6, 22)
    // Content area
    gui.addTexturedRect(id++, "minecraft:textures/block/light_gray_concrete.png", 8, 28, width - 16, height - 60)
    // Footer
    gui.addTexturedRect(id++, "minecraft:textures/block/stone_bricks.png", 6, height - 28, width - 12, 22)
    return id
}
```

### Main GUI with Scroll Selection
```javascript
function openMainGui(e) {
    var player = e.player
    var API = e.API
    var world = player.getWorld()
    
    var gui = API.createCustomGui(CONFIG.GUI_ID_MAIN, CONFIG.WIDTH, CONFIG.HEIGHT, false, player)
    buildBackground(gui, CONFIG.WIDTH, CONFIG.HEIGHT)
    
    // Title
    gui.addLabel(IDS.LABEL_TITLE, "§6§lSystem Title", 90, 8, 150, 14)
    
    // Scroll list for selection
    var options = getOptionsFromStorage(world)
    var displayList = []
    for (var i = 0; i < options.length; i++) {
        displayList.push(options[i].displayName)
    }
    gui.addScroll(IDS.SCROLL_OPTIONS, 15, 35, 270, 100, displayList)
    
    // Action buttons
    gui.addButton(IDS.BTN_ADD, "§a+ Add", 15, 140, 60, 16)
    gui.addButton(IDS.BTN_REMOVE, "§c- Remove", 80, 140, 70, 16)
    gui.addButton(IDS.BTN_CLOSE, "§7Close", CONFIG.WIDTH - 55, CONFIG.HEIGHT - 24, 45, 16)
    
    player.showCustomGui(gui)
}
```

### Tab-Based Navigation (Complex GUIs)
```javascript
var TABS = {
    MAIN: 0,
    SETTINGS: 1,
    ADVANCED: 2
}
var TAB_NAMES = ["§e⚔ Main", "§b⚙ Settings", "§c✦ Advanced"]

function openTabbedGui(e, tabIndex) {
    var player = e.player
    var playerName = player.getName()
    playerActiveTab[playerName] = tabIndex || 0
    
    var gui = e.API.createCustomGui(CONFIG.GUI_ID_MAIN, CONFIG.WIDTH, CONFIG.HEIGHT, false, player)
    buildBackground(gui, CONFIG.WIDTH, CONFIG.HEIGHT)
    
    // Tab scroll (horizontal tab bar simulation via scroll)
    gui.addScroll(IDS.SCROLL_TABS, 10, 30, 80, 80, TAB_NAMES)
        .setDefaultSelection(playerActiveTab[playerName])
    
    // Content area based on active tab
    switch (playerActiveTab[playerName]) {
        case TABS.MAIN:
            buildMainTab(gui, player)
            break
        case TABS.SETTINGS:
            buildSettingsTab(gui, player)
            break
        case TABS.ADVANCED:
            buildAdvancedTab(gui, player)
            break
    }
    
    player.showCustomGui(gui)
}
```

---

## Data Management Patterns

### Load with Defaults
```javascript
function loadConfig(world) {
    var stored = world.getStoreddata().get("myscript_config")
    if (!stored) {
        return createDefaultConfig()
    }
    try {
        var config = JSON.parse(stored)
        // Merge with defaults to handle version upgrades
        return mergeWithDefaults(config, createDefaultConfig())
    } catch (e) {
        return createDefaultConfig()
    }
}

function createDefaultConfig() {
    return {
        version: 1,
        enabled: true,
        options: [],
        settings: {
            value1: 100,
            value2: "default"
        }
    }
}

function mergeWithDefaults(config, defaults) {
    var keys = Object.keys(defaults)
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i]
        if (config[key] === undefined) {
            config[key] = defaults[key]
        }
    }
    return config
}
```

### Save Configuration
```javascript
function saveConfig(world, config) {
    world.getStoreddata().put("myscript_config", JSON.stringify(config))
}
```

### Per-Entity Config (NPC Scripts)
```javascript
var CONFIG_TAG_PREFIX = "MYSCRIPT_CFG:"

function loadNpcConfig(npc) {
    var tags = npc.getTags()
    for (var i = 0; i < tags.length; i++) {
        if (tags[i].indexOf(CONFIG_TAG_PREFIX) === 0) {
            try {
                return JSON.parse(tags[i].substring(CONFIG_TAG_PREFIX.length))
            } catch (e) {
                break
            }
        }
    }
    return createDefaultNpcConfig()
}

function saveNpcConfig(npc, config) {
    // Remove old config tag
    var tags = npc.getTags()
    for (var i = 0; i < tags.length; i++) {
        if (tags[i].indexOf(CONFIG_TAG_PREFIX) === 0) {
            npc.removeTag(tags[i])
            break
        }
    }
    // Add new config tag
    npc.addTag(CONFIG_TAG_PREFIX + JSON.stringify(config))
}
```

---

## Admin Access Patterns

### Creative Mode Check
```javascript
function isAdmin(player) {
    return player.getGamemode() === 1
}
```

### Admin List Check
```javascript
var ADMINS = ["AdminPlayer1", "AdminPlayer2"]

function isAdmin(player) {
    var name = player.getName()
    for (var i = 0; i < ADMINS.length; i++) {
        if (ADMINS[i] === name) return true
    }
    return false
}
```

### Item + Condition Check (NPC Scripts)
```javascript
function interact(e) {
    var player = e.player
    var heldItem = player.getMainhandItem()
    
    // Config access: BEDROCK + SNEAKING + CREATIVE
    if (heldItem && heldItem.getName() === "minecraft:bedrock" &&
        player.isSneaking() && player.getGamemode() === 1) {
        openConfigGui(e)
        e.setCanceled(true)
        return
    }
    
    // Normal interaction
    handleNormalInteraction(e)
}
```

---

## Event Handlers

### GUI Button Handler
```javascript
function customGuiButton(e) {
    var player = e.player
    var gui = e.gui
    var buttonId = e.buttonId
    var guiId = gui.getID()
    
    // Route by GUI ID
    if (guiId === CONFIG.GUI_ID_MAIN) {
        handleMainGuiButton(e, buttonId)
    } else if (guiId === CONFIG.GUI_ID_CONFIG) {
        handleConfigGuiButton(e, buttonId)
    }
}

function handleMainGuiButton(e, buttonId) {
    var player = e.player
    
    switch (buttonId) {
        case IDS.BTN_CLOSE:
            player.closeGui()
            break
        case IDS.BTN_SAVE:
            saveCurrentConfig(e)
            player.message("§aConfiguration saved!")
            break
        case IDS.BTN_ADD:
            openAddItemGui(e)
            break
    }
}
```

### GUI Scroll Handler
```javascript
function customGuiScroll(e) {
    var player = e.player
    var gui = e.gui
    var scrollId = e.scrollId
    var selection = e.selection      // Array of selected strings
    var scrollIndex = e.scrollIndex  // Selected index
    var doubleClick = e.doubleClick
    
    var playerName = player.getName()
    
    if (scrollId === IDS.SCROLL_TABS) {
        // Tab change - reopen GUI with new tab
        openTabbedGui(e, scrollIndex)
        return
    }
    
    if (scrollId === IDS.SCROLL_OPTIONS) {
        // Track selection for later use
        if (!playerSelection[playerName]) playerSelection[playerName] = {}
        playerSelection[playerName].option = scrollIndex
        playerSelection[playerName].optionText = selection[0] || ""
        
        // Double-click to edit
        if (doubleClick) {
            openEditGui(e, scrollIndex)
        }
    }
}
```

### GUI Close Cleanup
```javascript
function customGuiClosed(e) {
    var playerName = e.player.getName()
    // Optional: cleanup player state
    // delete playerSelection[playerName]
}
```

---

## Best Practices Checklist

### Required
- [ ] All config editable via in-game GUI
- [ ] Uses ICustomScroll for list/enum selections
- [ ] Default config created if none exists
- [ ] No external file dependencies
- [ ] ES5 compatible, no semicolons
- [ ] Component IDs organized in registry
- [ ] Admin check for config access

### Recommended
- [ ] Reusable background builder function
- [ ] Tab-based navigation for complex systems
- [ ] Player state tracking for multi-step operations
- [ ] Confirmation dialogs for destructive actions
- [ ] Color-coded visual feedback (§a success, §c error, §e warning)
- [ ] Scroll selection tracking per-player
- [ ] Header comment block with usage instructions
- [ ] Version number in stored config for migrations

### Optional Enhancements
- [ ] Command triggers (e.g., `!config` in chat)
- [ ] Undo/reset to defaults button
- [ ] Export/import via clipboard/chat
- [ ] Multi-page scrolls for large datasets
- [ ] Search/filter functionality
- [ ] Drag-and-drop style reordering (simulated)

---

## Example: Minimal OneScript Template

```javascript
// ============================================================================
// MY_SYSTEM - Brief Description
// ============================================================================
// Script Type: PlayerEvent
// Style: ES5 | No Semicolons
// ============================================================================
// IN-GAME CONFIGURATION:
// Type !myconfig in chat (requires Creative mode)
// ============================================================================

var CONFIG = {
    GUI_ID: 5000,
    WIDTH: 280,
    HEIGHT: 180
}

var IDS = {
    BG_START: 1,
    LABEL_TITLE: 100,
    SCROLL_OPTIONS: 200,
    INPUT_VALUE: 210,
    BTN_SAVE: 300,
    BTN_CLOSE: 301
}

var playerSelection = {}

// ============================================================================
// DATA FUNCTIONS
// ============================================================================
function loadData(world) {
    var json = world.getStoreddata().get("mysystem_data")
    if (!json) return { options: ["Default Option"], value: 50 }
    return JSON.parse(json)
}

function saveData(world, data) {
    world.getStoreddata().put("mysystem_data", JSON.stringify(data))
}

// ============================================================================
// GUI FUNCTIONS
// ============================================================================
function buildBackground(gui, w, h) {
    gui.addTexturedRect(IDS.BG_START, "minecraft:textures/block/gray_concrete.png", 0, 0, w, h)
    gui.addTexturedRect(IDS.BG_START + 1, "minecraft:textures/block/black_concrete.png", 2, 2, w - 4, 20)
}

function openConfigGui(e) {
    var player = e.player
    var world = player.getWorld()
    var data = loadData(world)
    
    var gui = e.API.createCustomGui(CONFIG.GUI_ID, CONFIG.WIDTH, CONFIG.HEIGHT, false, player)
    buildBackground(gui, CONFIG.WIDTH, CONFIG.HEIGHT)
    
    gui.addLabel(IDS.LABEL_TITLE, "§6§lMy System Config", 80, 6, 150, 14)
    gui.addScroll(IDS.SCROLL_OPTIONS, 10, 30, 150, 80, data.options)
    
    var input = gui.addTextField(IDS.INPUT_VALUE, 170, 30, 100, 20)
    input.setText(String(data.value))
    
    gui.addButton(IDS.BTN_SAVE, "§aSave", 10, CONFIG.HEIGHT - 28, 60, 18)
    gui.addButton(IDS.BTN_CLOSE, "§7Close", CONFIG.WIDTH - 70, CONFIG.HEIGHT - 28, 60, 18)
    
    player.showCustomGui(gui)
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================
function chat(e) {
    var message = e.message
    var player = e.player
    
    if (message === "!myconfig") {
        if (player.getGamemode() !== 1) {
            player.message("§cRequires Creative mode")
            return
        }
        e.setCanceled(true)
        openConfigGui(e)
    }
}

function customGuiButton(e) {
    var buttonId = e.buttonId
    var player = e.player
    var gui = e.gui
    
    if (gui.getID() !== CONFIG.GUI_ID) return
    
    if (buttonId === IDS.BTN_CLOSE) {
        player.closeGui()
    } else if (buttonId === IDS.BTN_SAVE) {
        var world = player.getWorld()
        var data = loadData(world)
        
        // Get value from text field
        var valueComp = gui.getComponent(IDS.INPUT_VALUE)
        if (valueComp) {
            data.value = parseInt(valueComp.getText()) || 50
        }
        
        saveData(world, data)
        player.message("§aConfiguration saved!")
        player.closeGui()
    }
}

function customGuiScroll(e) {
    var playerName = e.player.getName()
    if (e.scrollId === IDS.SCROLL_OPTIONS) {
        playerSelection[playerName] = e.scrollIndex
    }
}

function customGuiClosed(e) {
    delete playerSelection[e.player.getName()]
}
```

---

## Version History
- v1.0 - Initial OneScript pattern documentation
