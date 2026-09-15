# CNPCExtended API Reference

`cnpcext` is auto-injected into every CNPC script engine. No imports needed.
Works on Forge 1.20.1 and Fabric 1.21.1.

---

## cnpcext — Global Object

Every method that takes a player accepts either a CNPC event object (`e`) or an `IPlayer` wrapper.

### HTML GUI

```javascript
cnpcext.openHtmlGui(e, "shop.html", 520, 400, JSON.stringify({gold: 100}))
cnpcext.openHtmlGui(player, "invite.html", 0, 0, JSON.stringify({}))  // target any player
// width=0, height=0 → fullscreen. One GUI at a time — opening a new one closes the previous.
// When opened with event: htmlGuiEvent routes back to this script with e.npc context.
// When opened with IPlayer: htmlGuiEvent routes back but e.npc is null.

// Returns a GuiHandle for chaining:
cnpcext.openHtmlGui(e, "dialogue.html", 0, 0, initData).setGuiEscapable(false)
// setGuiEscapable(false) = Escape won't close the GUI. Player must use window.cnpc.close() or a script button.
```

### Entity Data (for HTML entity/item overlays)

```javascript
cnpcext.entityId(e.npc)     // int — network entity ID (must be spawned in world)
cnpcext.entityId(e.player)
cnpcext.entityNbt(e.npc)    // string — full SNBT (works even if entity later despawns)
cnpcext.entityNbt(e.player)
```

### Overlays (HUD layer, non-blocking)

```javascript
cnpcext.openOverlay(e, "name", "hud.html", x, y, width, height, jsonData)
cnpcext.openOverlay(e, "name", "hud.html", x, y, w, h, jsonData, true)  // persistent (survives relog)
cnpcext.updateOverlay(e, "name", jsonData)   // auto-deduped — safe to call every tick
cnpcext.hideOverlay(e, "name")               // hidden but preserved in memory
cnpcext.showOverlay(e, "name")               // unhide
cnpcext.closeOverlay(e, "name")              // destroy
cnpcext.hasOverlay(e, "name")                // boolean
// x/y: 0.0–1.0 = screen percentage (0.5 = center), >1 = raw pixels
// width=0, height=0 → fullscreen overlay (position via CSS)
```

### HUD Element Visibility

```javascript
cnpcext.hideHudElement(e, "hotbar")
cnpcext.showHudElement(e, "hotbar")
cnpcext.hideHudElement(e, "all")
cnpcext.showHudElement(e, "all")
// Elements: hotbar, experience, health, armor, food, crosshair, effects, actionbar, chat, scoreboard, tablist
```

### GUI Escapable Control

```javascript
// Chained on openHtmlGui — the only way to set escapable:
cnpcext.openHtmlGui(e, "dialogue.html", 0, 0, initData).setGuiEscapable(false)
// Default is true (Escape closes GUI). Set false for dialogues/cutscene UIs.
// Player must close via window.cnpc.close() or bridge.closeHtmlGui().
```
```

### Cutscenes (saved)

```javascript
cnpcext.startCutscene(player, "intro")
cnpcext.startCutscene(player, "intro", JSON.stringify({
    speed: 1.5,        // playback speed multiplier (default 1.0)
    hideHud: true,     // hide HUD during cutscene
    protect: true,     // freeze movement + invulnerable
    bars: true,        // cinematic letterbox bars
    keepPosition: true // teleport player to last keyframe pos on end (default true)
}))
cnpcext.stopCutscene(player)
cnpcext.pauseCutscene(player)
cnpcext.resumeCutscene(player)
cnpcext.isInCutscene(player)   // boolean
```

### Ad-hoc Camera (no saved cutscene needed)

```javascript
cnpcext.moveCamera(player, JSON.stringify({
    keyframes: [
        { x: 100, y: 70, z: -200, pitch: -15, yaw: 90, travelTicks: 0, holdTicks: 20 },
        { x: 120, y: 80, z: -180, pitch: -30, yaw: 45, travelTicks: 60, holdTicks: 0 },
        { x: 100, y: 70, z: -200, pitch: -15, yaw: 90, travelTicks: 60, holdTicks: 0,
          transition: "fade", fadeTicks: 20 }
    ],
    protect: true,
    speed: 1.0,
    bars: false,
    keepPosition: true
}))
// Keyframe fields:
//   x, y, z          — camera position
//   pitch, yaw       — camera rotation
//   travelTicks      — ticks to travel FROM previous keyframe (0 = instant snap)
//   holdTicks        — ticks to hold at this position before next travel
//   transition       — "travel" (smooth lerp, default) or "fade" (black screen transition)
//   fadeTicks        — fade duration in ticks (only used when transition="fade", default 20)
//   easing           — interpolation curve: "linear", "smoothstep" (default), "easeIn", "easeOut",
//                      "easeInOut", "sine", "expo", "circ", "bounce", "elastic", "back"
```

### Custom Commands

```javascript
cnpcext.registerCommand("shop", JSON.stringify({
    permission: 0,
    args: [
        { name: "action", type: "string", suggestions: ["open", "list"] },
        { name: "target", type: "player" },
        { name: "amount", type: "integer", min: 1, max: 10000 },
        { name: "enabled", type: "boolean" }
    ]
}))
// Runtime only — cleared on restart. Use /cnpcext command create for persistent commands.
// Arg types: string, string:name=a,b,c (with suggestions), integer:name=min-max, player, boolean
```

---

## Event Handlers

### htmlGuiEvent(e)

Fires when browser calls `window.cnpc.sendEvent()`. Routes to the script that called `openHtmlGui` **or `openOverlay`**.

```javascript
function htmlGuiEvent(e) {
    e.player      // IPlayer
    e.npc         // ICustomNpc (null if opened with IPlayer instead of event)
    e.API         // NpcAPI
    e.eventName   // string — the event name from sendEvent()
    e.data        // string — JSON string, use JSON.parse(e.data)

    if (e.eventName === "__guiClosed") return  // GUI closed (ESC or window.cnpc.close())

    // Overlay events include __overlayName in the parsed data:
    var data = JSON.parse(e.data)
    if (data.__overlayName === "my_overlay") { /* from overlay */ }
}
```

### customCommand(e)

Fires on **all player script tabs** when a registered command runs.

```javascript
function customCommand(e) {
    e.player    // IPlayer
    e.command   // string — command name
    e.args      // string — JSON, use JSON.parse(e.args)
}
```

**NOTE:** `customCommand` does **not** provide `e.API`. To use `createCustomGui` or other NpcAPI methods inside `customCommand`, get the API instance at the **top of the script** (outside all functions):

```javascript
var API = Java.type("noppes.npcs.api.NpcAPI").Instance()

function customCommand(e) {
    if (e.command === "shop") {
        var player = e.player
        var gui = API.createCustomGui(1, 300, 200, false, player)
        gui.addLabel(1, "§eShop", 10, 10, 200, 20)
        player.showCustomGui(gui)
    }
}
```

### cutscene(e)

Fires at each keyframe arrival. Routes to the script that started the cutscene.

```javascript
function cutscene(e) {
    e.player         // IPlayer
    e.cutsceneName   // string — cutscene name (or "__adhoc__" for moveCamera)
    e.phase          // int — keyframe index (0-based), -1 = cutscene ended
}
```

**Pause/resume pattern (dialogue mid-cutscene):**
```javascript
function cutscene(e) {
    if (e.phase === 2) {
        cnpcext.pauseCutscene(e.player)
        cnpcext.openHtmlGui(e, "dialogue.html", 0, 0, JSON.stringify({ text: "Continue?" }))
    }
}
function htmlGuiEvent(e) {
    if (e.eventName === "continue") cnpcext.resumeCutscene(e.player)
}
```

---

## IClientBridge (via getClientBridge)

Direct bridge to a player's client. Use when you need per-player control outside an event context.

```javascript
var bridge = cnpcext.getClientBridge(player.getMCEntity())
```

### HTML GUI

```javascript
bridge.openHtmlGui("file.html", 0, 0, jsonData)  // no event routing — display only
bridge.sendToBrowser("eventName", jsonData)        // push data to open browser
bridge.closeHtmlGui()
```

### Overlays

```javascript
bridge.openOverlay("name", "file.html", x, y, w, h, jsonData)
bridge.openOverlay("name", "file.html", x, y, w, h, jsonData, true)  // persistent
bridge.updateOverlay("name", jsonData)
bridge.hideOverlay("name")
bridge.showOverlay("name")
bridge.closeOverlay("name")
bridge.hasOverlay("name")                    // boolean
bridge.setOverlayInteractive("name", true)   // unlock cursor — player can click overlay buttons
bridge.setOverlayInteractive("name", false)  // re-lock cursor (Escape also re-locks)
bridge.closeAllOverlays()
```

### Key State (server-side polling)

```javascript
bridge.isKeyHeld(keyCode)          // boolean — true if key is held, even with overlays/GUIs open
bridge.getKeyHoldDuration(keyCode) // int — approximate ticks held (0 if not held)
bridge.isInGui()                   // boolean — any screen/GUI is open on client
bridge.isTyping()                  // boolean — client is in chat input
bridge.getOpenScreen()             // string — screen class name or "" if none
// Uses GLFW key codes: 256=ESC, 258=TAB, 32=SPACE, 340=LSHIFT, 341=LCTRL
// Letter keys: A=65..Z=90. Digit keys: 48..57. F-keys: F1=290..F12=301
// GLFW keycodes ≠ CNPC keyPressed keycodes! Bridge uses GLFW.
```

**Hold-to-show overlay pattern (tick polling):**
```javascript
var wasHeld = false
function tick(e) {
    var bridge = cnpcext.getClientBridge(e.player.getMCEntity())
    if (bridge.isTyping()) return
    var held = bridge.isKeyHeld(86) // V
    if (held && !wasHeld) {
        cnpcext.openOverlay(e, "wheel", "radial.html", 0, 0, 0, 0, "{}")
        bridge.setOverlayInteractive("wheel", true)
    } else if (!held && wasHeld) {
        cnpcext.closeOverlay(e.player, "wheel")
    }
    wasHeld = held
}
```

### HUD

```javascript
bridge.hideHudElement("hotbar")
bridge.showHudElement("all")
```

### Async Queries

All queries are async — the callback fires when the client responds (typically <100ms).

```javascript
var Consumer = Java.type("java.util.function.Consumer")

bridge.queryVideoSettings(Java.extend(Consumer, {
    accept: function(tag) {
        // tag.getInt("fov"), tag.getInt("renderDistance"), tag.getInt("guiScale")
        // tag.getString("graphicsMode"), tag.getInt("maxFps")
        // tag.getBoolean("fullscreen"), tag.getBoolean("vsync")
    }
}))

bridge.queryKeybinds(Java.extend(Consumer, {
    accept: function(tag) {
        // tag.getString("key.<keyName>") — bound key
        // tag.getBoolean("down.<keyName>") — currently held
    }
}))

bridge.querySoundSettings(Java.extend(Consumer, {
    accept: function(tag) {
        // tag.getDouble("master"), tag.getDouble("music"), tag.getDouble("hostile"), etc.
    }
}))

bridge.queryPlayerState(Java.extend(Consumer, {
    accept: function(tag) {
        // tag.getDouble("x"), tag.getDouble("y"), tag.getDouble("z")
        // tag.getFloat("xRot"), tag.getFloat("yRot")
        // tag.getInt("screenWidth"), tag.getInt("screenHeight")
        // tag.getString("currentScreen")
    }
}))

bridge.queryResourcePacks(Java.extend(Consumer, {
    accept: function(tag) {
        // tag.getString("pack.0"), tag.getString("pack.1"), ...
    }
}))
```

---

## Client-Side Scripting

Scripts in `config/cnpcextended/scripts/client/*.js` run in a client-only JS engine.
Globals: `client` (IClientScriptContext), `log` (log.info/warn/error).

**Available hooks (define as functions):**
```javascript
function clientTick(event) {}
function clientKeyPressed(event) {}    // GLFW key press (fires even with overlays open)
function clientKeyReleased(event) {}   // GLFW key release + holdDuration
function clientKeyHeld(event) {}       // GLFW key repeat + holdDuration
function screenOpen(event) {}
function screenClose(event) {}
function renderOverlay(event) {}
function clientChatReceived(event) {}
```

**Key event fields:**
```javascript
function clientKeyReleased(e) {
    e.key           // int — GLFW key code (65=A, 86=V, 256=ESC, etc.)
    e.scanCode      // int — platform scan code
    e.action        // int — 0=release, 1=press, 2=repeat
    e.holdDuration  // int — ticks held (only on release/repeat)
    e.isCtrlPressed  // boolean
    e.isShiftPressed // boolean
    e.isAltPressed   // boolean
}
```

**Client context polling:**
```javascript
client.isKeyHeld(keyCode)          // boolean — key held right now
client.getKeyHoldDuration(keyCode) // int — ticks held
client.closeOverlay("name")        // close overlay from client side
client.setOverlayInteractive("name", true)  // toggle overlay interactivity
```

`bridge.sendToClient(channel, data)` from server scripts triggers the client engine — listen via the event hooks above.

---

## Asset Loading (cnpc:// scheme)

HTML files are loaded from `<world>/customnpcs/scripts/ecmascript/`. Relative paths don't work in the browser (content is injected). Use `cnpc://` to reference assets:

```html
<img src="cnpc://assets/icon.png">
<link rel="stylesheet" href="cnpc://css/style.css">
```

`window.cnpc.assetUrl` returns `"cnpc://"`. Serves from the scripts folder. Path traversal blocked.

---

## Cutscene Commands

```
/cnpcext cutscene create <name>
/cnpcext cutscene edit <name>           — visual HTML editor
/cnpcext cutscene delete <name>
/cnpcext cutscene list
/cnpcext cutscene play <name> [player]
/cnpcext cutscene stop [player]
```

Cutscenes saved at `<world>/cnpcextended/cutscenes/<name>.json`.

**Persistent commands:**
```
/cnpcext command create shop string:action=open,list
/cnpcext command delete shop
/cnpcext command list
```

---

## Gotchas

1. **Always use JSON string overloads** — `CompoundTag.putString()` throws TypeError in GraalJS. Pass `JSON.stringify()` strings.
2. **Event names** must match `[a-zA-Z0-9_]+` — server silently rejects others.
3. **One HTML GUI at a time** — opening a new one closes the previous (it's a MC Screen).
4. **`__guiClosed`** fires when GUI closes — session is still valid at that point for cleanup.
5. **Overlay `sendEvent` must pass objects** — `window.cnpc.sendEvent("name", {key: val})` not `JSON.stringify(...)`. Strings get double-encoded.
6. **GLFW keycodes ≠ CNPC keycodes** — `bridge.isKeyHeld()` and client key events use GLFW codes (A=65, V=86). CNPC's `keyPressed` event uses LWJGL/scan codes (different numbering).
5. **No localStorage** in HTML — use `initData` and `sendEvent` for state.
6. **MCEF required** on client — no fallback for HTML GUIs/overlays.
7. **Don't `console.log` strings starting with `CNPC:`** — that's the internal bridge channel.
8. **Overlay dedup** — `updateOverlay` only sends a packet when data actually changes. Safe to call every tick.
9. **Query callbacks are async** — data arrives later, not synchronously.
10. **Interactive overlay events** include `__overlayName` in `e.data` — parse it to identify which overlay sent the event.
