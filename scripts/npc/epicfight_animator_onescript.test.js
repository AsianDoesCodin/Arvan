const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const scriptPath = path.join(__dirname, "epicfight_animator_onescript.js")
const source = fs.readFileSync(scriptPath, "utf8")
const context = vm.createContext({
    console: console,
    Java: {
        type: function (name) {
            if (name !== "noppes.npcs.api.NpcAPI") throw new Error("Unexpected Java type: " + name)
            return { Instance: function () { return {} } }
        }
    }
})

vm.runInContext(source, context, { filename: scriptPath })

let playerApiTouched = false
const player = new Proxy({}, {
    get: function () {
        playerApiTouched = true
        throw new Error("NPC init touched the player receiver")
    }
})

assert.doesNotThrow(function () {
    context.init({ player: player })
}, "NPC init must ignore PlayerEvent.InitEvent")
assert.equal(playerApiTouched, false)

const timerCalls = []
const npc = {
    getStoreddata: function () {
        return {
            has: function () {
                return false
            }
        }
    },
    getTimers: function () {
        return {
            forceStart: function (id, ticks, repeat) {
                timerCalls.push([id, ticks, repeat])
            }
        }
    }
}

context.init({ npc: npc })
assert.deepEqual(timerCalls, [[19, 20, true], [20, 26, false]])

const mainAnimations = []
const mainNpc = {
    isAlive: function () { return true },
    getAttackTarget: function () { return null },
    isNavigating: function () { return false },
    playEFAnimation: function (animation) { mainAnimations.push(animation) }
}
context.CONFIG.main.idle = "epicfight:biped/living/idle"
context.CONFIG.main.walk = "epicfight:biped/living/walk"
context.isBlocking = false
context.enforceMainAnimation(mainNpc)
assert.deepEqual(mainAnimations, ["epicfight:biped/living/idle"])

mainNpc.isNavigating = function () { return true }
context.enforceMainAnimation(mainNpc)
assert.deepEqual(mainAnimations, [
    "epicfight:biped/living/idle",
    "epicfight:biped/living/walk"
])

vm.runInContext("Math.random = function () { return 0 }", context)
context.isBlocking = true

const playerEventFailures = []
const playerEventCases = [
    ["timer", { player: {}, id: 19 }],
    ["timer", { player: {}, id: 20 }],
    ["timer", { player: {}, id: 98 }],
    ["interact", { player: {} }],
    ["damaged", { player: {}, damage: 10, setCanceled: function () {} }],
    ["died", { player: {} }]
]

for (let i = 0; i < playerEventCases.length; i++) {
    const handlerName = playerEventCases[i][0]
    const event = playerEventCases[i][1]
    try {
        context[handlerName](event)
    } catch (error) {
        playerEventFailures.push(handlerName + ": " + error.message)
    }
}

assert.deepEqual(playerEventFailures, [], "NPC handlers must ignore player events")
assert.equal(context.isBlocking, true, "PlayerEvent timer must not mutate NPC block state")

const animationPath = "epicfight:biped/combat/sword_auto1"
const testGuiIds = [
    context.GUI_ID_ATTACKS,
    context.GUI_ID_DODGE,
    context.GUI_ID_BLOCK,
    context.GUI_ID_ANIM_BROWSER
]

context.CONFIG.attacks.animations = [animationPath]
context.CONFIG.dodge.animations = [animationPath]
context.CONFIG.block.animations = [animationPath]
context.animBrowserFiltered = [animationPath]
context.selectedScrollIndex = 0
context.selectedAnimBrowserIndex = 0

for (let i = 0; i < testGuiIds.length; i++) {
    const messages = []
    const logs = []
    context.print = function (message) {
        logs.push(String(message))
    }
    context.configNpc = {
        playEFAnimation: function () {
            throw new Error("missing Epic Fight patch")
        }
    }

    context.customGuiButton({
        player: {
            message: function (message) {
                messages.push(message)
            }
        },
        buttonId: context.BTN_TEST_ANIM,
        gui: {
            getID: function () {
                return testGuiIds[i]
            }
        }
    })

    assert.equal(
        messages.some(function (message) { return message.indexOf("Playing:") >= 0 }),
        false,
        "A failed animation test must not claim the animation is playing"
    )
    assert.equal(
        messages.some(function (message) { return message.indexOf("Epic Fight config") >= 0 }),
        true,
        "A failed animation test must explain the NPC Epic Fight configuration prerequisite"
    )
    assert.equal(
        logs.some(function (message) {
            return message.indexOf(animationPath) >= 0 && message.indexOf("missing Epic Fight patch") >= 0
        }),
        true,
        "A failed animation test must log the animation path and original error"
    )
}

const successMessages = []
context.configNpc = {
    playEFAnimation: function () {}
}
context.customGuiButton({
    player: {
        message: function (message) {
            successMessages.push(message)
        }
    },
    buttonId: context.BTN_TEST_ANIM,
    gui: {
        getID: function () {
            return context.GUI_ID_ANIM_BROWSER
        }
    }
})
assert.deepEqual(successMessages, ["§dPlaying: §f" + animationPath])

const attackTimerCalls = []
const attackTarget = {
    getPos: function () {
        return {
            getX: function () { return 1 },
            getY: function () { return 0 },
            getZ: function () { return 0 }
        }
    }
}
const attackNpc = {
    isAlive: function () { return true },
    getAttackTarget: function () { return attackTarget },
    getPos: function () {
        return {
            getX: function () { return 0 },
            getY: function () { return 0 },
            getZ: function () { return 0 }
        }
    },
    getTimers: function () {
        return {
            forceStart: function (id, ticks, repeat) {
                attackTimerCalls.push([id, ticks, repeat])
            }
        }
    },
    playEFAnimation: function () {}
}
context.CONFIG.attacks.enabled = true
context.CONFIG.attacks.random = false
context.CONFIG.attacks.speed = 1.3
context.CONFIG.attacks.animations = [animationPath]
context.CONFIG.attacks.animationTicks = [7]
context.activeAttacks = null
context.activeDash = null
context.attackIndex = 0
context.mainAnimationLockedUntil = 0
const attackLockStart = Date.now()
const expectedAttackLockMs = context.getAttackDelayTicks(context.CONFIG.attacks, 0) * 50
context.handleAttackTimer({ npc: attackNpc })
assert.deepEqual(attackTimerCalls, [[20, 33, false]], "attack delay must include selected animation extra ticks")
assert.equal(context.mainAnimationLockedUntil - attackLockStart >= expectedAttackLockMs - 100, true, "attack animation lock must include selected extra ticks")

let fallCanceled = false
context.damaged({
    npc: {},
    damageSource: { getType: function () { return "fall" } },
    setCanceled: function () { fallCanceled = true }
})
assert.equal(fallCanceled, true, "fall damage must be canceled before combat reactions")

context.CONFIG.block.enabled = false
context.CONFIG.dodge.enabled = true
context.CONFIG.dodge.chance = 100
context.CONFIG.dodge.cooldown = 2
context.CONFIG.dodge.animations = [animationPath]
context.activeDodge = null
context.isBlocking = false
context.dodgeCooldownUntil = 0
const dodgeAnimations = []
const dodgeNpc = {
    playEFAnimation: function (animation) { dodgeAnimations.push(animation) }
}
context.damaged({ npc: dodgeNpc })
context.damaged({ npc: dodgeNpc })
assert.deepEqual(dodgeAnimations, [animationPath], "dodge cooldown must block an immediate second dodge")

context.CONFIG.death.enabled = false
context.died({ npc: {} })
context.damaged({ npc: dodgeNpc })
assert.deepEqual(dodgeAnimations, [animationPath, animationPath], "died must reset the dodge cooldown")

console.log("PASS epicfight animator regressions")
