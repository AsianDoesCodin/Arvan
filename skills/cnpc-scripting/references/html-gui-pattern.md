# HTML GUI & Overlay Pattern (CNPCExtended + MCEF)

HTML files live in `<world>/customnpcs/scripts/ecmascript/`.

---

## Script Side — Opening a GUI

```javascript
function interact(e) {
    cnpcext.openHtmlGui(e, "shop.html", 0, 0, JSON.stringify({
        name: e.player.getDisplayName(),
        gold: 1250,
        overlayItems: [
            { slot: 0, item: "minecraft:diamond_sword", count: 1 },
            { slot: 1, nbt: someItem.getItemNbt().toJsonString() }
        ],
        overlayEntities: [
            { slot: 0, nbt: cnpcext.entityNbt(e.npc) },
            { slot: 1, nbt: cnpcext.entityNbt(e.player), rotation: 90, followCursor: false, animate: false },
            { slot: 2, entityId: cnpcext.entityId(e.npc) }
        ]
    }))
}

function htmlGuiEvent(e) {
    var data = JSON.parse(e.data)
    if (e.eventName === "__guiClosed") return

    if (e.eventName === "buy") {
        e.player.giveItem(data.itemId, 1)
        var bridge = cnpcext.getClientBridge(e.player.getMCEntity())
        bridge.sendToBrowser("updateGold", JSON.stringify({ gold: 1200 }))
    }
}
```

---

## Browser Side — window.cnpc

Auto-injected into every HTML file opened via CNPCExtended.

```javascript
window.cnpc.initData              // Object — parsed JSON from openHtmlGui/openOverlay
window.cnpc.assetUrl              // "cnpc://" — prefix for asset loading
window.cnpc.close()               // Close GUI (fires __guiClosed on server)
window.cnpc.sendEvent(name, data) // Send to server → htmlGuiEvent(e)
window.cnpc.setResult(data)       // Shorthand for sendEvent("__result", data)
window.cnpc.onEvent(name, fn)     // Listen for server pushes via bridge.sendToBrowser()
```

**Example — listening for server pushes:**
```javascript
window.cnpc.onEvent("updateGold", function(data) {
    document.getElementById("gold").textContent = data.gold
})
```

---

## Item Overlays (data-mc-slot)

Render real MC items on top of HTML — enchant glint, tooltips, stack counts all work.

**Script side:** items go in `overlayItems` array in initData.
```javascript
overlayItems: [
    { slot: 0, item: "minecraft:diamond_sword", count: 1 },           // simple ID
    { slot: 1, nbt: someItem.getItemNbt().toJsonString() },           // SNBT — preserves enchants/name/lore
    { slot: 2, item: "minecraft:golden_apple", count: 5 }
]
```

**HTML side:** empty divs as placeholders. CSS controls position and size.
```html
<div data-mc-slot="0" style="width:32px; height:32px; display:inline-block"></div>
<div data-mc-slot="1" style="width:32px; height:32px; display:inline-block"></div>

<!-- Scaled item (2x) -->
<div data-mc-slot="2" data-mc-scale="2" style="width:64px; height:64px"></div>
```

- `data-mc-scale="N"` scales the MC item render (default 1). Match CSS size accordingly.
- Items auto-track their HTML element positions — flexbox, grid, scroll all work.
- Hover shows vanilla item tooltip.

### Scroll Clipping

Add `data-mc-clip` to a scrollable container — items outside the visible scroll area are clipped:

```html
<div style="overflow-y: auto; height: 300px" data-mc-clip>
    <div><div data-mc-slot="0" style="width:32px; height:32px"></div> Sword</div>
    <div><div data-mc-slot="1" style="width:32px; height:32px"></div> Apple</div>
</div>
```

---

## Entity Overlays (data-mc-entity)

Render 3D entity models on HTML. Pass `overlayEntities` in initData.

**Two modes:**
- `nbt: cnpcext.entityNbt(entity)` — creates client-side entity from SNBT. Works for clones, despawned NPCs, `world.createEntity()` results.
- `entityId: cnpcext.entityId(entity)` — references live world entity. Disappears if entity unloads.

**Per-entity options:**
- `rotation` — Y rotation in degrees (default 180, facing viewer)
- `followCursor` — entity faces mouse cursor (default true)
- `animate` — play walk/attack animations (default true)

```html
<div data-mc-entity="0" style="width:150px; height:210px"></div>
```

Entity feet anchor at bottom-center of the div. To hide: set `width:0; height:0`.
Works in both HTML GUIs and HUD overlays.

---

## Minimal GUI Template

```html
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box }
  body {
    background: transparent;
    color: #e8dcc8;
    font-family: sans-serif;
    width: 100vw; height: 100vh;
    display: flex; justify-content: center; align-items: center;
    user-select: none; overflow: hidden;
  }
  .panel {
    width: 400px; padding: 20px;
    background: rgba(15, 10, 25, 0.92);
    border: 2px solid #8b6914; border-radius: 6px;
  }
  button {
    cursor: pointer;
    background: linear-gradient(180deg, #5a2020, #3a1515);
    border: 1px solid #8b6914; color: #e8a0a0;
    padding: 4px 10px; border-radius: 3px;
  }
  button:hover { background: #8a3030; color: #ff6060 }
</style>
</head>
<body>
<div class="panel">
  <h2 id="title">Loading...</h2>
  <button onclick="window.cnpc.close()">Close</button>
</div>
<script>
  var d = window.cnpc.initData || {}
  document.getElementById("title").textContent = d.name || "Unknown"

  window.cnpc.onEvent("update", function(data) {
    // Handle server pushes
  })
</script>
</body>
</html>
```

---

## Overlay (HUD) Patterns

Same `window.cnpc` bridge. Key differences: transparent background, no input capture by default.

### Opening an overlay

```javascript
// Full-screen (position via CSS)
bridge.openOverlay("hud", "my_hud.html", 0, 0, 0, 0, jsonData)

// Fixed-size at screen position
bridge.openOverlay("hp_bar", "hp.html", 0.5, 0.9, 200, 30, jsonData)  // centered near bottom
```

### Updating overlay data (tick-safe)

```javascript
function tick(e) {
    var player = e.player
    cnpcext.updateOverlay(e, "hud", JSON.stringify({
        hp: player.getHealth(),
        maxHp: player.getMaxHealth()
    }))
    // Only sends packet when data changes — safe every tick
}
```

### Interactive overlays (cursor unlock)

```javascript
bridge.setOverlayInteractive("menu", true)   // cursor unlocked — player can click HTML
// Escape re-locks cursor automatically
```

Events from interactive overlays fire `htmlGuiEvent` with `__overlayName` in the data:
```javascript
function htmlGuiEvent(e) {
    var data = JSON.parse(e.data)
    if (data.__overlayName === "menu" && e.eventName === "selectItem") {
        // Handle overlay button click
    }
}
```

**Important:** `sendEvent` second argument must be an **object**, not `JSON.stringify(...)`:
```javascript
// CORRECT:
window.cnpc.sendEvent("selectItem", { index: 3, name: "Fireball" })

// WRONG — double-encodes, server gets empty data:
window.cnpc.sendEvent("selectItem", JSON.stringify({ index: 3 }))
```

### Minimal HUD overlay template

```html
<!DOCTYPE html>
<html>
<head>
<style>
  body { background: transparent; margin: 0; font-family: sans-serif; overflow: hidden }
  .bar { background: rgba(0,0,0,0.6); border-radius: 8px; padding: 6px }
  .hp { height: 8px; background: linear-gradient(90deg, #f33, #f66); border-radius: 4px }
</style>
</head>
<body>
<div class="bar">
  <div class="hp" id="hpBar" style="width: 100%"></div>
</div>
<script>
  var d = window.cnpc.initData || {}
  var hp = d.hp || 20, maxHp = d.maxHp || 20

  document.getElementById("hpBar").style.width = (hp / maxHp * 100) + "%"

  window.cnpc.onEvent("overlayUpdate", function(data) {
    if (data.hp !== undefined) hp = data.hp
    if (data.maxHp !== undefined) maxHp = data.maxHp
    document.getElementById("hpBar").style.width = (hp / maxHp * 100) + "%"
  })
</script>
</body>
</html>
```

---

## Gotchas

Observed with CNPCExtended/MCEF on 1.20.1 Forge; behavior may vary by build.

- **GUI handoffs:** HTML ↔ ICustomGUI transitions can fire multiple close events. Preserve drafts/session state in player tempdata; tolerate repeated transition closes before genuine-close cleanup.
- **HTML updates:** Reopening can disrupt event routing. Update the existing page locally or through `sendToBrowser` when possible.
- **Item displays:** Native items render above HTML regardless of `z-index` and can linger after DOM removal or hiding. Keep stable anchors and move inactive displays offscreen, including while HTML dialogs cover them.
- **Dropdowns:** Native `<select>` popups can stick. Explicit dismissal or custom controls such as inline searchable dropdowns are workarounds; preserve `change` handling when replacing selects.

## Rules

- **`body { background: transparent }`** — required for see-through. Use `rgba()` for containers.
- **initData must be a JSON string** via `JSON.stringify()`. Parsed object on HTML side.
- **ESC closes GUI** — always provide a visible close button too.
- **width=0, height=0** = fullscreen auto-size. Non-zero = fixed pixel viewport.
- **HTML GUI does not pause singleplayer.**
- **One GUI at a time** — opening new one closes previous.
- **Event names** must be `[a-zA-Z0-9_]+` only.
- **No localStorage** — data: URLs don't support it.
- **Fonts**: Google Fonts need internet. For offline, use system fonts or embedded base64 `@font-face`.
- **`nbt` key** in overlayItems for enchanted/custom items. `item` key for simple IDs.
