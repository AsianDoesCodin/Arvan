---
name: cnpc-scripting
description: 'Write CustomNPCs 1.20.1/1.21.1 scripts for Minecraft. Use when creating NPC scripts, player scripts, block scripts, item scripts, GUI systems, HTML GUIs, projectiles, overlays, or any CNPC scripting task. Covers API types, event handlers, GUI layout, HTML GUI via CNPCExtended/MCEF, delays, vectors, global script preloading, /cnpcext commands, and known gotchas.'
---

# CustomNPCs Scripting
**IMPORTANT: The ONLY reference material allowed is within this `cnpc-scripting` skill folder (SKILL.md and its `references/` subfolder). Do NOT use any other files, folders, or external sources as reference for CNPC scripting guidance.**

## Reference Isolation - Mandatory

When this skill is active, treat this skill directory as a sealed reference set.

- Allowed references: this `SKILL.md` file and files under this skill's own `references/` directory only
- Forbidden references: existing workspace scripts, project `@types`, old generated scripts, examples outside this skill folder, internet sources, memory of other CNPC projects, and any CNPCExtended/CNPC material outside this skill folder
- Do not inspect existing `.js` or `.html` scripts for patterns, helper functions, GUI structure, API guesses, or examples unless the user explicitly asks to edit that exact file
- If an API method, event name, or CNPCExtended behavior is not present in this skill folder, do not rely on it
- If more information is needed, ask the user or state the limitation instead of using outside references

**MUST READ when writing or editing scripts** — verify all method names and signatures against these before writing any CNPC API call:
- API type definitions: [api-types.md](./references/api-types.md)
- OneScript design pattern: [onescript-pattern.md](./references/onescript-pattern.md)

### API Receiver Verification - Mandatory

Before writing or changing any CNPC API call, verify the **receiver type** in `references/api-types.md`, not just the method name.

- Identify the exact expression receiving the call, such as `npc`, `npc.getDisplay()`, `npc.getStats()`, `player`, `world`, `e.gui`, or `e.npc.getTimers()`
- Confirm that receiver's declared interface/class contains the method, or inherits it through the documented type chain
- If a method name appears on another type, do not move it onto the current receiver by assumption; use the documented accessor chain instead
- For event fields, confirm the event class exposes the field before using it, such as `NpcEvent.TimerEvent.id`
- If the reference search only proves that a method exists somewhere, keep searching until the owning type is confirmed
- If the owning type cannot be confirmed in the skill references, do not write the call; state the limitation or ask the user

## Target Version
The user will specify their target version. If not stated, **ask which version** before writing code.
- **1.20.1** — Forge. `addItemSlot` + `setStack` works. NPC `getStoreddata()` works. Full GUI features.
- **1.21.1** — Forge or Fabric. Recent Fabric builds added `getMCUUID()` for entities, external data saving, personal visibility, and fixed projectile rendering plus scripted GUI slot errors. See GUI Gotchas for version-sensitive notes.

## CNPCExtended
Not all users have CNPCExtended installed. Before using **any** CNPCExtended feature, **ask the user if they have CNPCExtended**. CNPCExtended features include:
- HTML GUIs (`cnpcext.openHtmlGui`, `bridge.openHtmlGui`)
- HTML overlays (`bridge.openOverlay`, `bridge.updateOverlay`, `bridge.closeOverlay`, etc.)
- Client bridge (`cnpcext.getClientBridge`, query methods)
- HUD element hiding/showing (`bridge.hideHudElement`, `bridge.showHudElement`)
- Client scripting, `sendToClient`, `sendToBrowser`
- Custom commands (`cnpcext.registerCommand`)
- Item overlay rendering via SNBT in HTML

For HTML overlays, default to **fullscreen overlays** (`openOverlay(..., 0, 0, 0, 0, ...)`) and control size/position inside the HTML/CSS/JS itself. This gives full layout control and avoids viewport sizing surprises. Use fixed overlay width/height only when the user explicitly wants a small anchored widget.

If the user does **not** have CNPCExtended, use only vanilla CNPC APIs (`ICustomGui`, `addItemSlot`, `addItemRenderer`, etc.). Do not suggest CNPCExtended features as alternatives.
## Workspace Context
This workspace is a **script authoring workspace only** — it contains CNPC scripts, reference docs, and type definitions. The AI should **never** suggest where to place scripts, what folders to copy them into, or how to install them. Just write the code.

## When to Use
- Writing any CNPC script (NPC, Player, Block, Item, Dialog, Quest events)
- Building custom GUIs with `ICustomGui`
- Building HTML GUIs with CNPCExtended + MCEF (see `references/html-gui-pattern.md`)
- Building HTML overlays (HUD skill bars, HP bars, custom UI) with CNPCExtended (see `references/cnpcextended-api.md`)
- Hiding/showing vanilla HUD elements (hotbar, health, food, XP, armor, etc.)
- Using CNPCExtended features: client bridge, queries, client scripting (see `references/cnpcextended-api.md`)
- Creating projectiles, particles, or visual effects
- Working with stored/temp data, NBT, scoreboards
- Implementing delays or async patterns in scripts
- Debugging CNPC-specific issues

## Coding Rules
- **Before and after editing existing scripts, scan for UTF-8 mojibake/corruption markers like `Â§`, `â`, `ð`, `Ã`, `Âª`, `Â»`, `Â¢`; never save corrupted color codes or symbols.**
- **ES5** syntax (no let/const, no arrow functions, no template literals, use var and string concatenation)
- **No semicolons** — end lines without them
- Use `function` declarations for event handlers
- No modules/imports — all code in a single script context
- Standalone scripts — not related to other mods/plugins/libraries
- **Always use `var API = Java.type("noppes.npcs.api.NpcAPI").Instance()`** as a global variable at the top of the script for ALL API access — creating GUIs (`API.createCustomGui`), executing commands (`API.executeCommand(world, cmd)`), creating items (`API.createItem`), etc. Do NOT use `npc.executeCommand()` (deprecated) or rely on `e.API` (not available in all handlers).
- **Always add JSDoc `@param` type annotations** on event handlers for IntelliSense:
```javascript
/**
 * @param {NpcEvent.InteractEvent} event
 */
function interact(event) {
    // event.player, event.npc etc. will now autocomplete
}
```
The type should match the full namespace event class (e.g. `{PlayerEvent.ChatEvent}`, `{CustomGuiEvent.ButtonEvent}`, `{BlockEvent.TimerEvent}`). This enables VS Code autocomplete from the `@types/customnpcs.d.ts` definitions.

### Scripted Item Texture Pattern

For `ItemEvent.InitEvent`, scripted item textures should use a damage value slot.

```javascript
/**
 * @param {ItemEvent.InitEvent} e
 */
function init(e) {
    e.item.setTexture(0, "minecraft:ender_eye")
    e.item.setItemDamage(0)
    e.item.setDurabilityShow(false)
}
```

## Event Handler Naming

Handler names derive from the event class name:
1. Take event class (e.g. `ButtonEvent`, `TimerEvent`)
2. Remove the `Event` suffix
3. Convert to camelCase

| Namespace | Handlers |
|-----------|----------|
| BlockEvent | `init`, `tick`, `timer`, `interact`, `broken`, `clicked`, `redstone`, `collide`, `neighborChanged`, `fallenUpon`, `doorToggle`, `exploded`, `rainFilled`, `harvested` |
| PlayerEvent | `init`, `tick`, `timer`, `login`, `logout`, `interact`, `attack`, `broken`, `toss`, `pickedUp`, `damaged`, `damagedEntity`, `died`, `kill`, `chat`, `containerOpen`, `containerClosed`, `rangedLaunched`, `keyPressed`, `levelUp`, `factionUpdate` |
| NpcEvent | `init`, `tick`, `timer`, `target`, `targetLost`, `interact`, `damaged`, `died`, `kill`, `meleeAttack`, `rangedAttack`, `collide` |
| ItemEvent | `init`, `tick`, `spawn`, `toss`, `pickedUp`, `interact`, `attack` |
| DialogEvent | `dialog`, `dialogClose`, `dialogOption` |
| QuestEvent | `questStart`, `questCompleted`, `questTurnIn` |
| CustomGuiEvent | `customGuiButton`, `customGuiScroll`, `customGuiClosed`, `customGuiSlot`, `customGuiSlotClicked` |
| ProjectileEvent | `projectileTick`, `projectileImpact` |
| RoleEvent | `role` (single handler for all role sub-events) |
| WorldEvent | `scriptCommand` |

**Special case**: `PlayerEvent.UpdateEvent` → `function tick(event) {}`
**CustomGuiEvent prefix**: All handlers start with `customGui` then the event name in camelCase.

## Delays

Thread-based async utilities. Define `delay()` and `runAsync()` once at the top of any script that needs delays.

**Core utility (copy into your script):**
```javascript
var Thread = Java.type("java.lang.Thread")

function delay(ms) {
    Thread.sleep(ms)
}

function runAsync(fn) {
    new (Java.extend(Thread, {
        run: fn
    }))().start()
}
```

**Usage — sequential delays:**
```javascript
function interact(e) {
    var npc = e.npc

    runAsync(function() {
        npc.say("Hello!")
        delay(1000)
        npc.say("1 second later")
        delay(2000)
        npc.say("Done!")
    })

    npc.say("This runs immediately, parallel to thread")
}
```

**Usage — loop with delay:**
```javascript
runAsync(function() {
    for (var i = 0; i < 5; i++) {
        npc.say("hi")
        delay(100)
    }
})
```

**Rules:**
- `delay(ms)` must ONLY be called inside `runAsync()` — outside it freezes the server tick
- Capture NPC/player/world references BEFORE entering `runAsync` — event objects may be invalid after the handler returns
- Multiple `runAsync` calls run in parallel on separate threads
- `Java.extend` is a Java interop built-in (suppress `@ts-ignore` for type errors)

## Particles & Projectiles

**Always use particle-based effects** via `/particle` commands (spawning along a `FrontVectorsInPlane` path) unless the user specifically asks for CNPC projectile entities. Use `dust` particles for custom RGB colors.

**Version matters for `/particle` syntax:**
- **1.20.1**: `/particle dust 1.0 0.0 0.0 1 x y z 0 0 0 0 1 force`
- **1.21.1**: `/particle dust{color:[1.0,0.0,0.0],scale:1.0} x y z 0 0 0 0 1 force`

Reference (only if user asks for entity projectiles):

```javascript
function interact(e) {
  var npc = e.npc
  var player = e.player
  var world = npc.getWorld()

  var P = world.createEntity("customnpcs:customnpcprojectile")
  var item = world.createItem("minecraft:stick", 1)
  item.setCustomName("The Big Stick")
  P.setItem(item)
  P.setPosition(npc.getX(), npc.getY() + 4, npc.getZ())
  P.setHeading(player)
  world.spawnEntity(P)

  // Customize damage via NBT
  var n = P.getEntityNbt()
  n.setFloat("damagev2", 50)
  P.setEntityNbt(n)
}
```

## Vector Math (FrontVectors)

**Always prefer `FrontVectorsInPlane` over basic `FrontVectors`** — it supports tilted/rotated planes and is strictly more capable. Use basic `FrontVectors` only as the internal building block.

Basic direction vector (used internally by FrontVectorsInPlane):
```javascript
function FrontVectors(entity, dr, dp, distance, mode) {
  if (!mode) mode = 0
  if (mode == 1) { var angle = dr + entity.getRotation(); var pitch = (-entity.getPitch() + dp) * Math.PI / 180 }
  if (mode == 0) { var angle = dr; var pitch = (dp) * Math.PI / 180 }
  var dx = -Math.sin(angle * Math.PI / 180) * (distance * Math.cos(pitch))
  var dy = Math.sin(pitch) * distance
  var dz = Math.cos(angle * Math.PI / 180) * (distance * Math.cos(pitch))
  return [dx, dy, dz]
}
```

### FrontVectors in Custom Plane

Defines a new coordinate system (arbitrary Y-axis from rotation+pitch, X-axis 90° down, Z-axis via right-hand rule) and transforms FrontVectors into that plane. Useful for creating shapes, arcs, and patterns on tilted or rotated planes rather than just world-axis-aligned ones.

```javascript
function FrontVectorsInPlane(NewYRot, NewYPitch, npc, dr, dp, distance) {
  var NewAxis = MakeNewAxis(npc, NewYRot, NewYPitch)
  var E = FrontVectors(npc, dr, dp, distance, 0)
  return Transform(NewAxis, E)
}

function Transform(Axis, V) {
  var x = Axis[0][0] * -V[0] + Axis[1][0] * V[1] + Axis[2][0] * V[2]
  var y = Axis[0][1] * -V[0] + Axis[1][1] * V[1] + Axis[2][1] * V[2]
  var z = Axis[0][2] * -V[0] + Axis[1][2] * V[1] + Axis[2][2] * V[2]
  return [x, y, z]
}

function MakeNewAxis(npc, R, P) {
  var A = FrontVectors(npc, R, P, 1, 0)
  var B = FrontVectors(npc, R, P - 90, 1, 0)
  var NewAxis = [B, A, Cross(B, A)]
  return NewAxis
}

function Cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
```

## GUI Layout Rules

Define fixed GUI size, then use a `GuiMath` helper:
- `centerX(width)` / `centerY(height)` — center coords
- `anchor(type, w, h, offsetX, offsetY)` — positional anchor (top-left, top-right, etc.)
- `grid(col, row, cellW, cellH, padX, padY, originX, originY)` — grid placement
- `percent(xPct, yPct)` — percentage-based positioning

**Never hardcode arbitrary coordinates.** Origin is (0,0) top-left, X right, Y down.

## GUI Gotchas (Known Bugs)

For HTML GUIs, see [HTML GUI gotchas](./references/html-gui-pattern.md#gotchas).

- **ICustomGUI component IDs** must be unique across the entire GUI, including components added by helpers.
- `gui.update(player)` causes ClassCastException (`PlayerWrapper` cast to `ICustomGuiComponent`). Use `player.showCustomGui(gui)` + `scroll.setDefaultSelection(idx)` to preserve scroll position.
- `gui.updateComponent(component)` does not exist on 1.20.1. Rebuild and re-show via `player.showCustomGui()` instead.
- `addItemRenderer(id, x, y, width, height, stack)` — 6 params (not 4).
- Cannot mutate `e.gui` and re-show — CNPC throws "already contains component id". Rebuild GUI from scratch.
- Replacing a GUI with `player.showCustomGui(newGui)` fires `customGuiClosed` for the old GUI. If that handler clears temp/draft state, the replacement GUI can render normally while its buttons silently stop working. Mark internal GUI transitions before re-showing, consume that marker in `customGuiClosed`, and skip cleanup for the replaced GUI; clean up only on a genuine player close.
- Scroll widget is text-only — no inline items. Use a side preview panel.
- Label text without an explicit color code appears default gray. Prefix label strings with a color code (for example `§f`, `§7`, `§e`) to avoid accidental dull text.
- **`KeyPressedEvent` is not cancelable**: `e.setCanceled(true)` throws "not a function" on Forge. Cannot block vanilla inventory opening via keyPressed.
- **`containerOpen` does not fire for player inventory** — only fires for external containers (chests, etc.). Not cancelable. `containerClosed` does fire for `InventoryMenu` on close.
- **Inventory edits (observed on 1.20.1 Forge)**: Non-hotbar stack changes can revert when the inventory opens despite appearing applied server-side. Use hotbar slots 0–8 for scripted item transactions on this setup.
- **`addEntityDisplay` scale**: `setScale(1)` = inventory-model size. Scale is a multiplier, not pixel size.
- **`IEntityDisplay.setRotation(yaw)`**: Takes ONE int parameter (yaw only), despite the .d.ts declaring two. Pass yaw only.
- **Entity display uses vanilla renderer only**: Epic Fight animations don't show in `addEntityDisplay`. Use the actual entity in-world instead.
- **Do not call `setID()` on `addItemSlot()` result**: Setting an ID on item slot components can break the slot and cause buggy/non-functional behavior. Example:
  ```javascript
  var slot = gui.addItemSlot(100, 40)
  slot.setID(50)
  ```
- **Component layering**: Higher component IDs render closer to the screen (on top). When using `addTexturedRect` with `showPlayerInventory`, ensure background rects have lower IDs and stop before the inventory Y position to avoid covering it.
- **CRITICAL: PacketGuiData 65KB UTF limit** — CNPC GUI packet uses `DataOutputStream.writeUTF()` with a hard 65,535-byte limit. Large scrolls (350+ entries) cause `UTFDataFormatException` → crashes the player's CNPC network state. Paginate scrolls to ~25 entries per page.
## Workflow Gotchas (Agent Safety)

- This workspace is for **script authoring only**. Do not advise on file placement, installation, or server setup.

## Player Script Engine Model

Each online player gets a **separate Nashorn engine instance** running the same script. Key implications:

- **Global `var` is per-instance** — not shared between players. Use `world.getStoreddata()` for cross-player state.
- **Events fire in the owning player's context** — Player A's `tick`/`damaged`/`logout` runs in A's engine only.
- **World-level systems** (duels, rankings, arenas) must store state in `world.getStoreddata()`, sync in-memory caches periodically, and use state flags (e.g. `duel.state = "ended"`) to prevent duplicate processing across player engines.
- For CNPC tasks (new scripts or edits), do not scan unrelated workspace files.
- Assume the skill references contain the needed implementation guidance unless the user asks for project-specific integration.
- Do not scan/read **workspace** files that are not explicitly provided in user context or explicitly requested by the user. **Exception**: the reference files linked below (api-types.md, onescript-pattern.md) are part of this skill — always read them when writing or editing scripts.
- Use this flow by default: read skill instructions → **read api-types.md to verify method names/signatures** → implement requested change → validate syntax/errors.
- **`PlayerEvent.UpdateEvent` (tick) fires every 10 ticks**, not every server tick. Cooldown math and actionbar update frequency must account for this (e.g. decrement cooldowns by 10, not 1).
- **For debug output, prefer `log()` or `print()`** over `player.message()`. Log/print output goes to the server console where it's copy-pasteable. Use `player.message()` only when the player needs to see it in-game chat.
- **CNPC `keyPressed` uses GLFW key codes on 1.20.1 Forge**, NOT LWJGL scan codes. Z=90, X=88, C=67, A=65, etc. The reference note "GLFW keycodes ≠ CNPC keycodes" applies only to CNPCExtended bridge — vanilla CNPC `keyPressed` event uses GLFW codes.
- **`htmlGuiEvent` `e.data` can be double-stringified** — when the HTML calls `JSON.stringify()` before `window.cnpc.sendEvent(name, data)`, the data arrives double-wrapped. Always double-parse: `if (typeof data === "string") data = JSON.parse(data); if (typeof data === "string") data = JSON.parse(data)` to safely handle both single and double stringify.
- Do not modify or rewrite existing large scripts unless the user explicitly asks to edit that exact file.
- Use workspace/codebase search only when the user asks integration with existing systems or asks to edit/debug existing code.
- **Version-specific gotchas**: Only warn about bugs that apply to the user's stated target version. Do not warn 1.20.1 users about 1.21.1-only regressions.

## JSON Config Files

For reading external JSON configs:
```javascript
var DGFile = Java.type("java.io.File")
var DGFileReader = Java.type("java.io.FileReader")
var DGJsonParser = Java.type("com.google.gson.JsonParser")
```

## Output Style Rules

Default to minimal production-ready code unless the user requests explanation-heavy output.

### Hard Rules
- Do not add bloat comments
- Do not write tutorial-style comments inside code
- Do not use try/catch unless explicitly requested or strictly required
- Do not add defensive wrappers, helper abstractions, or boilerplate unless necessary
- Do not add fallback logic unless requested
- Do not add features not requested by the user
- Prefer the smallest clean implementation that satisfies the request
- Prefer editing the minimal necessary portion of existing scripts
- If multiple valid implementations exist, choose the simplest maintainable one

### Comment Policy
- Comments are forbidden unless:
  - The user requests commented code
  - A non-obvious engine/API quirk requires explanation
  - The code would otherwise be materially harder to understand

### Explanation Policy
- Do not explain code unless the user asks
- Keep non-code explanations concise and directly relevant


