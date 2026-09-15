var API = Java.type("noppes.npcs.api.NpcAPI").Instance()
var LAST_USE_KEY = "mageTowerBuilderLastUse"

/**
 * @param {ItemEvent.InitEvent} event
 */
function init(event) {
    event.item.setTexture(0, "minecraft:amethyst_shard")
    event.item.setItemDamage(0)
    event.item.setDurabilityShow(false)
    event.item.setMaxStackSize(1)
    event.item.setCustomName("\u00a75Mage Tower Architect")
    event.item.setLore([
        "\u00a77Creative: right-click a ground block",
        "\u00a77Build area: 19 x 19 x 42"
    ])
}

/**
 * @param {ItemEvent.InteractEvent} event
 */
function interact(event) {
    var player = event.player
    event.setCanceled(true)
    if (player.getGamemode() !== 1) {
        player.message("\u00a7cCreative mode is required")
        return
    }

    var trace = player.rayTraceBlock(24, false, true)
    if (!trace || !trace.getBlock() || trace.getBlock().isAir()) {
        player.message("\u00a7cAim at the ground where the tower should be centered")
        return
    }

    var anchor = trace.getBlock()
    var world = player.getWorld()
    var now = world.getTotalTime()
    var lastUse = player.getTempdata().get(LAST_USE_KEY)
    if (lastUse !== null && lastUse !== undefined && now - Number(lastUse) < 40) return

    player.getTempdata().put(LAST_USE_KEY, now)
    var x = anchor.getX()
    var y = anchor.getY() + 1
    var z = anchor.getZ()
    fill(world, x - 2, y - 1, z - 13, x + 1, y, z - 11, "minecraft:polished_deepslate")
    player.setPosition(x, y + 1, z - 12)
    buildMageTower(world, x, y, z)
    fill(world, x - 1, y - 1, z - 10, x, y, z - 9, "minecraft:polished_deepslate")
    player.message("\u00a7dMage tower constructed")
}

function buildMageTower(world, x, y, z) {
    fill(world, x - 10, y, z - 10, x + 10, y + 41, z + 10, "minecraft:air")
    fill(world, x - 8, y - 1, z - 8, x + 8, y, z + 8, "minecraft:polished_deepslate")
    fill(world, x - 6, y, z - 6, x + 6, y + 20, z + 6, "minecraft:deepslate_bricks", "hollow")

    wallBand(world, x, y + 5, z, 6, "minecraft:polished_deepslate")
    wallBand(world, x, y + 11, z, 6, "minecraft:polished_deepslate")
    wallBand(world, x, y + 17, z, 6, "minecraft:polished_deepslate")
    cutMainCorners(world, x, y, z)

    fill(world, x - 5, y + 6, z - 5, x + 5, y + 6, z + 5, "minecraft:dark_oak_planks")
    fill(world, x - 5, y + 12, z - 5, x + 5, y + 12, z + 5, "minecraft:dark_oak_planks")
    fill(world, x - 5, y + 18, z - 5, x + 5, y + 18, z + 5, "minecraft:dark_oak_planks")

    fill(world, x - 1, y + 1, z - 6, x, y + 3, z - 6, "minecraft:air")
    fillOne(world, x - 1, y + 1, z - 6, "minecraft:dark_oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]")
    fillOne(world, x - 1, y + 2, z - 6, "minecraft:dark_oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]")
    fillOne(world, x, y + 1, z - 6, "minecraft:dark_oak_door[facing=north,half=lower,hinge=right,open=false,powered=false]")
    fillOne(world, x, y + 2, z - 6, "minecraft:dark_oak_door[facing=north,half=upper,hinge=right,open=false,powered=false]")

    mainWindows(world, x, y, z)
    fill(world, x + 4, y + 1, z + 4, x + 4, y + 25, z + 4, "minecraft:scaffolding")
    fillOne(world, x, y + 5, z, "minecraft:sea_lantern")
    fillOne(world, x, y + 11, z, "minecraft:sea_lantern")
    fillOne(world, x, y + 17, z, "minecraft:sea_lantern")

    fill(world, x - 8, y + 20, z - 8, x + 8, y + 26, z + 8, "minecraft:polished_blackstone_bricks", "hollow")
    cutCrownCorners(world, x, y, z)
    crownWindows(world, x, y, z)
    fill(world, x - 5, y + 20, z - 5, x + 5, y + 20, z + 5, "minecraft:dark_oak_planks")
    fillOne(world, x, y + 21, z, "minecraft:enchanting_table")
    fill(world, x - 3, y + 21, z + 6, x + 3, y + 22, z + 6, "minecraft:bookshelf")
    fillOne(world, x, y + 25, z, "minecraft:sea_lantern")

    for (var level = 0; level < 10; level++) {
        roofLayer(world, x, y + 27 + level, z, 9 - level, "minecraft:dark_prismarine")
    }

    fill(world, x, y + 37, z, x, y + 40, z, "minecraft:amethyst_block")
    fill(world, x - 1, y + 38, z, x + 1, y + 38, z, "minecraft:amethyst_block")
    fill(world, x, y + 38, z - 1, x, y + 38, z + 1, "minecraft:amethyst_block")
    fillOne(world, x, y + 41, z, "minecraft:sea_lantern")
}

function mainWindows(world, x, y, z) {
    fill(world, x - 4, y + 2, z - 6, x - 4, y + 4, z - 6, "minecraft:purple_stained_glass")
    fill(world, x + 4, y + 2, z - 6, x + 4, y + 4, z - 6, "minecraft:purple_stained_glass")
    fill(world, x - 1, y + 2, z + 6, x + 1, y + 4, z + 6, "minecraft:purple_stained_glass")
    fill(world, x - 6, y + 2, z - 1, x - 6, y + 4, z + 1, "minecraft:purple_stained_glass")
    fill(world, x + 6, y + 2, z - 1, x + 6, y + 4, z + 1, "minecraft:purple_stained_glass")

    for (var floor = 0; floor < 2; floor++) {
        var wy = y + 8 + floor * 6
        fill(world, x - 1, wy, z - 6, x + 1, wy + 2, z - 6, "minecraft:purple_stained_glass")
        fill(world, x - 1, wy, z + 6, x + 1, wy + 2, z + 6, "minecraft:purple_stained_glass")
        fill(world, x - 6, wy, z - 1, x - 6, wy + 2, z + 1, "minecraft:purple_stained_glass")
        fill(world, x + 6, wy, z - 1, x + 6, wy + 2, z + 1, "minecraft:purple_stained_glass")
    }
}

function crownWindows(world, x, y, z) {
    fill(world, x - 4, y + 22, z - 8, x + 4, y + 24, z - 8, "minecraft:magenta_stained_glass")
    fill(world, x - 4, y + 22, z + 8, x + 4, y + 24, z + 8, "minecraft:magenta_stained_glass")
    fill(world, x - 8, y + 22, z - 4, x - 8, y + 24, z + 4, "minecraft:magenta_stained_glass")
    fill(world, x + 8, y + 22, z - 4, x + 8, y + 24, z + 4, "minecraft:magenta_stained_glass")
}

function cutMainCorners(world, x, y, z) {
    fill(world, x - 6, y + 1, z - 6, x - 5, y + 19, z - 5, "minecraft:air")
    fill(world, x + 5, y + 1, z - 6, x + 6, y + 19, z - 5, "minecraft:air")
    fill(world, x - 6, y + 1, z + 5, x - 5, y + 19, z + 6, "minecraft:air")
    fill(world, x + 5, y + 1, z + 5, x + 6, y + 19, z + 6, "minecraft:air")

    column(world, x - 5, y + 1, z - 4, y + 19, "minecraft:polished_deepslate")
    column(world, x - 4, y + 1, z - 5, y + 19, "minecraft:polished_deepslate")
    column(world, x + 5, y + 1, z - 4, y + 19, "minecraft:polished_deepslate")
    column(world, x + 4, y + 1, z - 5, y + 19, "minecraft:polished_deepslate")
    column(world, x - 5, y + 1, z + 4, y + 19, "minecraft:polished_deepslate")
    column(world, x - 4, y + 1, z + 5, y + 19, "minecraft:polished_deepslate")
    column(world, x + 5, y + 1, z + 4, y + 19, "minecraft:polished_deepslate")
    column(world, x + 4, y + 1, z + 5, y + 19, "minecraft:polished_deepslate")
}

function cutCrownCorners(world, x, y, z) {
    fill(world, x - 8, y + 21, z - 8, x - 6, y + 25, z - 6, "minecraft:air")
    fill(world, x + 6, y + 21, z - 8, x + 8, y + 25, z - 6, "minecraft:air")
    fill(world, x - 8, y + 21, z + 6, x - 6, y + 25, z + 8, "minecraft:air")
    fill(world, x + 6, y + 21, z + 6, x + 8, y + 25, z + 8, "minecraft:air")

    crownDiagonal(world, x, y, z, -1, -1)
    crownDiagonal(world, x, y, z, 1, -1)
    crownDiagonal(world, x, y, z, -1, 1)
    crownDiagonal(world, x, y, z, 1, 1)
}

function crownDiagonal(world, x, y, z, sx, sz) {
    column(world, x + sx * 7, y + 21, z + sz * 5, y + 25, "minecraft:polished_blackstone")
    column(world, x + sx * 6, y + 21, z + sz * 6, y + 25, "minecraft:polished_blackstone")
    column(world, x + sx * 5, y + 21, z + sz * 7, y + 25, "minecraft:polished_blackstone")
}

function wallBand(world, x, y, z, radius, block) {
    fill(world, x - radius, y, z - radius, x + radius, y, z - radius, block)
    fill(world, x - radius, y, z + radius, x + radius, y, z + radius, block)
    fill(world, x - radius, y, z - radius + 1, x - radius, y, z + radius - 1, block)
    fill(world, x + radius, y, z - radius + 1, x + radius, y, z + radius - 1, block)
}

function roofLayer(world, x, y, z, radius, block) {
    if (radius === 0) {
        fillOne(world, x, y, z, block)
        return
    }
    var inset = Math.max(1, Math.floor(radius / 3))
    fill(world, x - radius, y, z - radius + inset, x + radius, y, z + radius - inset, block)
    fill(world, x - radius + inset, y, z - radius, x + radius - inset, y, z + radius, block)
}

function column(world, x, y1, z, y2, block) {
    fill(world, x, y1, z, x, y2, z, block)
}

function fillOne(world, x, y, z, block) {
    fill(world, x, y, z, x, y, z, block)
}

function fill(world, x1, y1, z1, x2, y2, z2, block, mode) {
    var command = "fill " + x1 + " " + y1 + " " + z1 + " " + x2 + " " + y2 + " " + z2 + " " + block
    if (mode) command += " " + mode
    API.executeCommand(world, command)
}
