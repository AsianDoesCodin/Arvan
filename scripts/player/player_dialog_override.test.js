// Offline regression tests, not a Minecraft/CNPCExtended runtime test.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, 'player_dialog_override.js'), 'utf8')

function list(items) {
    return { size: () => items.length, get: i => items[i] }
}

function player(state = {}, uuid = 'player-a') {
    const read = new Set(state.read || [])
    const active = new Set(state.active || [])
    const finished = new Set(state.finished || [])
    const p = {
        read, active, finished, messages: [], started: [], completed: [],
        getUUID: () => uuid,
        getDisplayName: () => uuid,
        getMCEntity: () => p,
        hasReadDialog: id => read.has(id),
        addDialog: id => read.add(id),
        hasActiveQuest: id => active.has(id),
        hasFinishedQuest: id => finished.has(id),
        startQuest: id => { p.started.push(id); active.add(id) },
        finishQuest: id => { p.completed.push(id); active.delete(id); finished.add(id) },
        message: message => p.messages.push(message)
    }
    return p
}

function harness() {
    const dialogs = {}
    const opened = []
    const pushed = []
    const commands = []
    const context = {
        Java: { type: () => ({ Instance: () => ({ getDialogs: () => ({ get: id => dialogs[id] || null }) }) }) },
        cnpcext: {
            entityId: () => 1,
            openHtmlGui: (p, file, w, h, data) => opened.push({ player: p.getUUID(), ...JSON.parse(data) }),
            getClientBridge: () => ({ sendToBrowser: (event, data) => pushed.push(JSON.parse(data)) })
        }
    }
    vm.createContext(context)
    vm.runInContext(source, context)
    function npc(name = 'Elder Posta') {
        return {
            getDisplay: () => ({ getName: () => name }),
            executeCommand: command => commands.push(command),
            setDialog: () => { throw new Error('Must not change shared NPC slots') }
        }
    }
    function add(id, config = {}) {
        const d = {
            getId: () => id,
            getName: () => 'Dialog ' + id,
            getText: () => 'Text ' + id,
            getCommand: () => config.command || '',
            getQuest: () => config.quest == null ? null : ({ getId: () => config.quest, getName: () => 'Quest ' + config.quest }),
            getAvailability: () => ({ isAvailable: p => typeof config.available === 'function' ? config.available(p) : config.available !== false }),
            getOptions: () => list((config.links || []).map((target, slot) => ({
                getName: () => 'To ' + target,
                getSlot: () => slot,
                getType: () => 1,
                hasDialog: () => !!dialogs[target],
                getDialog: () => dialogs[target] || null
            })))
        }
        dialogs[id] = d
        return d
    }
    for (const id of [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 90]) add(id)
    function open(p, id = 13, n = npc()) {
        const count = opened.length
        let canceled = false
        context.dialog({ player: p, npc: n, dialog: dialogs[id], setCanceled: value => { canceled = value } })
        assert.equal(canceled, true)
        return opened.length > count ? opened[opened.length - 1].dialog.id : null
    }
    function navigate(p, id) {
        context.htmlGuiEvent({ player: p, eventName: 'navigate', data: { dialogId: id } })
    }
    return { context, dialogs, opened, pushed, commands, npc, add, open, navigate }
}

const routes = [
    ['first meeting', {}, 13],
    ['unfinished briefing after meeting', { read: [13] }, 15],
    ['legacy middle page read', { read: [14] }, 15],
    ['finished referral quest', { finished: [1] }, 15],
    ['briefing already read', { read: [15] }, 17],
    ['declined goblin offer', { read: [17] }, 17],
    ['abandoned goblin quest', { read: [18] }, 17],
    ['old quest-dialog history without quest flags', { read: [24] }, 17],
    ['goblins active', { active: [2] }, 26],
    ['goblins finished', { finished: [2] }, 27],
    ['packwolves active', { finished: [2], active: [3] }, 30],
    ['packwolves finished', { finished: [2, 3] }, 31],
    ['cores active', { finished: [2, 3], active: [4] }, 33],
    ['cores finished, first acknowledgement', { finished: [2, 3, 4] }, 34],
    ['post-Act-1 repeat conversation', { finished: [4], read: [34] }, 35],
    ['migrated ending already read', { finished: [4], read: [35] }, 35]
]
for (const [name, state, expected] of routes) {
    test('entry: ' + name, () => {
        const h = harness()
        assert.equal(h.open(player(state)), expected)
    })
}

test('all 27 active/finished/unstarted quest combinations prefer the furthest stage', () => {
    const h = harness()
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
        const states = [a, b, c]
        const p = player({
            read: [15],
            active: states.flatMap((s, i) => s === 1 ? [i + 2] : []),
            finished: states.flatMap((s, i) => s === 2 ? [i + 2] : [])
        })
        const expected = c === 2 ? 34 : c === 1 ? 33 : b === 2 ? 31 : b === 1 ? 30 : a === 2 ? 27 : a === 1 ? 26 : 17
        assert.equal(h.context.getElderPostaEntryId(p), expected, String(states))
        assert.deepEqual(p.started, [])
        assert.deepEqual(p.completed, [])
    }
})

test('repeat clicks do not repeat meeting side effects or automatically accept quests', () => {
    const h = harness()
    h.add(13, { command: 'meeting-once' })
    const p = player({ active: [1] })
    assert.equal(h.open(p), 13)
    assert.equal(h.open(p), 15)
    assert.equal(h.open(p), 17)
    assert.equal(h.open(p), 17)
    assert.deepEqual(p.completed, [1])
    assert.deepEqual(p.started, [])
    assert.deepEqual(h.commands, ['meeting-once'])
})

test('old slot 12 is rerouted before its quest or command runs', () => {
    const h = harness()
    h.add(12, { quest: 1, command: 'wrong-opening' })
    const p = player({ active: [2] })
    assert.equal(h.open(p, 12), 26)
    assert.equal(p.read.has(12), false)
    assert.deepEqual(p.started, [])
    assert.deepEqual(h.commands, [])
})

test('the referral remains unchanged on a different NPC', () => {
    const h = harness()
    h.add(12, { quest: 1 })
    const p = player()
    assert.equal(h.open(p, 12, h.npc('Gate Guard')), 12)
    assert.deepEqual(p.started, [1])
})

test('formatting and case do not break Posta identification', () => {
    const h = harness()
    assert.equal(h.open(player({ active: [3] }), 13, h.npc(' §6ELDER POSTA§r ')), 30)
})

test('other NPCs, future dialogue IDs, and test ID 16 are not rerouted', () => {
    const h = harness()
    assert.equal(h.open(player({ finished: [4] }), 13, h.npc('Other Elder')), 13)
    assert.equal(h.open(player({ finished: [4] }), 90), 90)
    assert.equal(h.open(player({ finished: [4] }), 16), 16)
})

test('routing is per-player and survives a script-context restart', () => {
    const h = harness()
    const a = player({ active: [2] }, 'a')
    const b = player({ active: [4] }, 'b')
    assert.equal(h.open(a), 26)
    assert.equal(h.open(b), 33)
    assert.equal(h.context.activeConversations.a.dialog.getId(), 26)
    assert.equal(h.context.activeConversations.b.dialog.getId(), 33)
    const fresh = player({}, 'fresh')
    assert.equal(h.open(fresh), 13)
    assert.equal(harness().open(fresh), 15)
})

test('missing external meeting uses briefing only without an active referral quest', () => {
    const h = harness()
    delete h.dialogs[13]
    assert.equal(h.open(player(), 15), 15)
    const p = player({ active: [1] })
    assert.equal(h.open(p, 15), null)
    assert.match(p.messages[0], /13 is missing/)
    assert.deepEqual(p.completed, [])
    assert.equal(p.read.size, 0)
})

test('missing progress page fails closed instead of replaying the intro', () => {
    const h = harness()
    delete h.dialogs[26]
    const p = player({ active: [2] })
    assert.equal(h.open(p), null)
    assert.match(p.messages[0], /26 is missing/)
    assert.equal(p.read.size, 0)
    assert.equal(h.context.activeConversations[p.getUUID()], undefined)
})

test('native availability still blocks an opening and all its side effects', () => {
    const h = harness()
    h.add(26, { available: false, command: 'must-not-run', quest: 4 })
    const p = player({ active: [2] })
    assert.equal(h.open(p), null)
    assert.match(p.messages[0], /unavailable/)
    assert.equal(p.read.size, 0)
    assert.deepEqual(p.started, [])
    assert.deepEqual(h.commands, [])
})

test('seen introductions and briefings are hidden from Posta choices', () => {
    const h = harness()
    h.add(19, { links: [13, 15, 20] })
    const p = player({ read: [13, 15] })
    const result = h.context.serializeDialog(h.dialogs[19], h.npc(), p)
    assert.deepEqual(Array.from(result.options, o => o.dialogId), [20])
})

test('server navigation rejects stale links back to a seen introduction', () => {
    const h = harness()
    h.add(17, { links: [13] })
    const p = player({ read: [13, 15] })
    assert.equal(h.open(p), 17)
    h.navigate(p, 13)
    assert.equal(h.pushed.length, 0)
    assert.equal(h.context.activeConversations[p.getUUID()].dialog.getId(), 17)
})

test('current native target gates are checked again when a choice is clicked', () => {
    const h = harness()
    let available = true
    h.add(17, { links: [18] })
    h.add(18, { available: () => available, quest: 2 })
    const p = player({ read: [15] })
    assert.equal(h.open(p), 17)
    assert.equal(h.opened[0].dialog.options.length, 1)
    available = false
    h.navigate(p, 18)
    assert.equal(h.pushed.length, 0)
    assert.deepEqual(p.started, [])
})

test('an available but unlinked target is still rejected', () => {
    const h = harness()
    const p = player({ read: [15] })
    assert.equal(h.open(p), 17)
    h.navigate(p, 29)
    assert.equal(h.pushed.length, 0)
    assert.equal(p.read.has(29), false)
})

test('accepting starts the quest on its page, and later clicks open progress', () => {
    const h = harness()
    h.add(17, { links: [18] })
    h.add(18, { quest: 2, available: p => !p.hasActiveQuest(2) && !p.hasFinishedQuest(2) })
    const p = player({ read: [15] })
    assert.equal(h.open(p), 17)
    assert.deepEqual(p.started, [])
    h.navigate(p, 18)
    assert.deepEqual(p.started, [2])
    assert.equal(h.pushed[0].dialog.id, 18)
    assert.equal(h.open(p), 26)
    assert.deepEqual(p.started, [2])
    assert.deepEqual(p.completed, [])
})

test('declining leaves the offer accessible without starting a quest', () => {
    const h = harness()
    const p = player({ read: [15] })
    assert.equal(h.open(p), 17)
    h.context.htmlGuiEvent({ player: p, eventName: 'close', data: {} })
    assert.equal(h.open(p), 17)
    assert.deepEqual(p.started, [])
})

test('progress pages never complete or reward kill/collection quests', () => {
    for (const id of [2, 3, 4]) {
        const h = harness()
        const p = player({ active: [id] })
        h.open(p)
        h.open(p)
        assert.equal(p.active.has(id), true)
        assert.deepEqual(p.completed, [])
        assert.deepEqual(p.started, [])
        assert.deepEqual(h.commands, [])
    }
})
