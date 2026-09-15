// Offline marker-storage and HTML bridge/DOM tests; not a Minecraft runtime test.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const serverSource = fs.readFileSync(path.join(root, 'scripts/player/ADMsLevelingSystem.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'scripts/quest_map.html'), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const destination = { x: 3066, y: 7, z: 222, dimensionId: 'minecraft:overworld', dimension: 0, dimensionName: 'custom_world' }
const objective = { x: 3072, y: 10, z: 55, dimensionId: 'minecraft:overworld', dimension: 0, dimensionName: 'custom_world' }
const marker = (extra = {}) => ({ markerId: 'goblins', mode: 'QUEST', questId: 2, name: 'Goblins On The Road', symbol: '!', showOutside: true, turnin: false, ...objective, ...extra })

function functionSource(name) {
    const start = serverSource.indexOf('function ' + name + '(')
    assert.notEqual(start, -1, name + ' must exist')
    const end = serverSource.indexOf('\nfunction ', start + 1)
    assert.notEqual(end, -1, name + ' must have a following boundary')
    return serverSource.slice(start, end)
}

function backend(registry = {}, settings = {}) {
    let saved = JSON.stringify(registry)
    let writes = 0
    const replies = []
    const stored = { has: () => true, get: () => saved, put: (key, value) => { assert.equal(key, 'questMapRegistry'); writes++; saved = value } }
    const world = { getStoreddata: () => stored, getName: () => 'custom_world', getDimension: () => ({ getId: () => 0 }) }
    const player = {
        active: settings.active || { 2: true }, ready: settings.ready === true,
        getWorld: () => world, getY: () => 64,
        getTempdata: () => ({ has: () => true, get: () => settings.session || 'MAP_ADMIN' })
    }
    const context = {
        QUEST_MAP_STORAGE_KEY: 'questMapRegistry', QUEST_MAP_MARKER_LIMIT: 256, HTML_ACTIVE_SESSION_KEY: 'session',
        API: { getIWorlds: () => [], getQuests: () => ({ get: id => [2, 3, 4].includes(id) ? { getName: () => 'Quest ' + id } : null }) },
        getActiveQuestIdLookup: p => p.active,
        playerMenuQuest: (q, complete, p) => ({ ready: p.ready }),
        isQuestTracked: () => settings.tracked !== false,
        isMapAdmin: () => settings.admin !== false,
        isArvanPersistenceFrozen: () => settings.frozen === true,
        parseClassSkillHtmlData: value => value,
        buildQuestMapPlayerState: () => ({ ...objective }),
        queueJourneyMapSync: () => {},
        pushQuestMapMeta: (p, admin, message, ok, requestId, action, markerId) => replies.push({ message, ok, action, markerId })
    }
    vm.createContext(context)
    for (const name of ['normalizeQuestMapMarkerId', 'normalizeQuestMapTurninDestination', 'getQuestMapRegistry', 'saveQuestMapRegistry', 'getQuestMapName', 'buildQuestMapMarkers', 'handleQuestMapHtmlEvent']) vm.runInContext(functionSource(name), context)
    return {
        context, player, replies,
        visible: (admin = false) => plain(context.buildQuestMapMarkers(player, admin)),
        save: data => context.handleQuestMapHtmlEvent({ player, data: { action: 'save', actionRequestId: 'test', ...data } }),
        remove: markerId => context.handleQuestMapHtmlEvent({ player, data: { action: 'delete', markerId } }),
        registry: () => JSON.parse(saved),
        writes: () => writes
    }
}

function frontend(initial = {}) {
    const nodes = {}
    function makeElement(id = '') {
        let content = ''
        const n = { id, value: '', checked: false, disabled: false, hidden: false, style: {}, className: '', children: [], clientHeight: 420,
            setAttribute: (key, value) => { n[key] = value }, getAttribute: key => n[key], appendChild: child => n.children.push(child) }
        Object.defineProperty(n, 'textContent', { get: () => content, set: value => { content = String(value); n.children = [] } })
        return n
    }
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
        assert.equal(nodes[match[1]], undefined, 'Duplicate HTML id: ' + match[1])
        nodes[match[1]] = makeElement(match[1])
    }
    const sends = [], listeners = {}
    const context = { document: { getElementById: id => nodes[id] || null, createElement: () => makeElement() },
        window: { addEventListener: () => {}, cnpc: {
            initData: { admin: true, player: { ...objective }, ...initial },
            sendEvent: (event, data) => sends.push({ event, data: plain(data) }),
            onEvent: (event, fn) => { listeners[event] = fn }, close: () => {}
        } }
    }
    vm.createContext(context)
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)
    assert.ok(script, 'Editor script is present')
    vm.runInContext(script[1], context)
    if (context.pending) context.receiveMeta({ actionRequestId: context.pending.id, action: 'ready', ok: true })
    sends.length = 0
    return { context, nodes, sends,
        load: data => context.loadDraft(data),
        enable: () => { nodes.turnin.checked = true; nodes.turnin.onchange() },
        setReturn: () => { nodes.turninX.value = '3066'; nodes.turninY.value = '7'; nodes.turninZ.value = '222'; context.draftTurninDimension = { ...destination } },
        answerPosition: value => context.receiveMeta({ actionRequestId: context.pending.id, action: 'mypos', ok: true, player: value })
    }
}

test('paired marker uses objective while unfinished and return when ready, with stable identity', () => {
    const b = backend({ goblins: marker({ turninDestination: destination }) })
    let out = b.visible()
    assert.equal(out.length, 1)
    assert.equal(out[0].x, objective.x)
    assert.equal(out[0].turnin, false)
    assert.equal('turninDestination' in out[0], false)
    b.player.ready = true
    out = b.visible()
    assert.equal(out.length, 1)
    assert.equal(out[0].markerId, 'goblins')
    assert.equal(out[0].x, destination.x)
    assert.equal(out[0].y, destination.y)
    assert.equal(out[0].z, destination.z)
    assert.equal(out[0].turnin, true)
    assert.equal(out[0].name, 'Goblins On The Road')
    b.player.ready = false
    assert.equal(b.visible()[0].x, objective.x)
    assert.equal(b.writes(), 0)
})

test('return destination switches dimension as well as all three coordinates', () => {
    const b = backend({ goblins: marker({ turninDestination: { ...destination, dimensionId: 'minecraft:the_nether', dimension: -1, dimensionName: 'Nether' } }) }, { ready: true })
    const out = b.visible()[0]
    assert.equal(out.dimensionId, 'minecraft:the_nether')
    assert.equal(out.dimension, -1)
    assert.equal(out.dimensionName, 'Nether')
})

test('admin sees one editable record with both destinations independent of quest state', () => {
    const b = backend({ goblins: marker({ turninDestination: destination }) }, { active: {}, ready: true })
    const out = b.visible(true)
    assert.equal(out.length, 1)
    assert.equal(out[0].x, objective.x)
    assert.deepEqual(out[0].turninDestination, destination)
})

test('legacy separate objective/turn-in markers keep their existing visibility', () => {
    const b = backend({ goblins: marker(), return: marker({ markerId: 'return', turnin: true, ...destination }) })
    assert.deepEqual(b.visible().map(m => m.markerId), ['goblins'])
    b.player.ready = true
    assert.deepEqual(b.visible().map(m => m.markerId), ['return'])
    assert.equal(b.writes(), 0)
})

for (const [name, settings] of [['untracked', { tracked: false }], ['inactive', { active: {} }], ['finished/handed-in', { active: {}, ready: true }]]) {
    test(name + ' quest marker is not shown', () => {
        const b = backend({ goblins: marker({ turninDestination: destination }) }, settings)
        assert.deepEqual(b.visible(), [])
    })
}

test('always-visible points remain independent of quest tracking', () => {
    const b = backend({ place: marker({ markerId: 'place', mode: 'ALWAYS' }) }, { active: {}, tracked: false, ready: true })
    assert.equal(b.visible().length, 1)
})

test('two players can see different destinations without changing the registry', () => {
    const b = backend({ goblins: marker({ turninDestination: destination }) })
    const other = { ...b.player, ready: true }
    assert.equal(b.context.buildQuestMapMarkers(b.player, false)[0].x, objective.x)
    assert.equal(b.context.buildQuestMapMarkers(other, false)[0].x, destination.x)
    assert.equal(b.writes(), 0)
})

test('save and reload store both locations in one existing registry entry', () => {
    const b = backend({ goblins: marker(), untouched: marker({ markerId: 'untouched', turnin: true }) })
    b.save(marker({ turninDestination: destination }))
    assert.equal(b.replies.at(-1).ok, true)
    assert.deepEqual(Object.keys(b.registry()).sort(), ['goblins', 'untouched'])
    assert.deepEqual(b.registry().goblins.turninDestination, destination)
    assert.equal(b.registry().untouched.turnin, true)
    assert.equal(b.registry().goblins.x, objective.x)
    const reload = backend(b.registry(), { ready: true })
    assert.equal(reload.visible().find(m => m.markerId === 'goblins').x, destination.x)
})

test('new paired marker consumes one registry entry only', () => {
    const b = backend()
    b.save(marker({ markerId: '', turninDestination: destination }))
    assert.equal(b.replies.at(-1).ok, true)
    assert.equal(Object.keys(b.registry()).length, 1)
})

test('old editor payload preserves an existing second destination', () => {
    const b = backend({ goblins: marker({ turninDestination: destination }) })
    b.save(marker({ name: 'Edited in old editor' }))
    assert.deepEqual(b.registry().goblins.turninDestination, destination)
})

test('new editor can explicitly disable the second destination', () => {
    const b = backend({ goblins: marker({ turninDestination: destination }) })
    b.save(marker({ turninDestination: null }))
    assert.equal(b.registry().goblins.turninDestination, null)
    assert.equal(b.registry().goblins.turnin, false)
    assert.equal(b.registry().goblins.x, objective.x)
})

test('saving a legacy turn-in-only entry retains its behavior and destination', () => {
    const b = backend({ goblins: marker({ turnin: true, ...destination }) })
    b.save(marker({ turnin: true, turninDestination: null, ...destination }))
    assert.equal(b.registry().goblins.turnin, true)
    assert.equal(b.registry().goblins.x, destination.x)
})

test('switching to always-visible explicitly removes quest return behavior', () => {
    const b = backend({ goblins: marker({ turninDestination: destination }) })
    b.save(marker({ mode: 'ALWAYS', turnin: true, turninDestination: destination }))
    assert.equal(b.registry().goblins.turninDestination, null)
    assert.equal(b.registry().goblins.turnin, false)
    assert.equal(b.registry().goblins.questId, 0)
})

const invalid = [
    ['missing X', { ...destination, x: undefined }], ['null X', { ...destination, x: null }],
    ['blank Y', { ...destination, y: ' ' }], ['boolean Z', { ...destination, z: false }],
    ['nonfinite X', { ...destination, x: Infinity }], ['X border', { ...destination, x: 30000000 }],
    ['fractional Y', { ...destination, y: 7.5 }], ['Y bound', { ...destination, y: 2048 }],
    ['invalid dimension ID', { ...destination, dimensionId: 'not a dimension' }],
    ['no dimension', { x: 0, y: 0, z: 0 }], ['invalid object', []]
]
for (const [name, returnValue] of invalid) {
    test('server rejects ' + name + ' without saving either destination', () => {
        const b = backend({ goblins: marker() })
        const before = b.registry()
        b.save(marker({ turninDestination: returnValue }))
        assert.equal(b.replies.at(-1).ok, false)
        assert.equal(b.writes(), 0)
        assert.deepEqual(b.registry(), before)
    })
}

test('zero coordinates and dimension zero are valid', () => {
    const b = backend({ goblins: marker() })
    b.save(marker({ turninDestination: { x: 0, y: 0, z: 0, dimension: 0 } }))
    assert.equal(b.replies.at(-1).ok, true)
    assert.equal(b.registry().goblins.turninDestination.x, 0)
})

test('invalid persisted return data cannot be silently discarded during another save', () => {
    const b = backend({ goblins: marker({ turninDestination: { x: null } }) })
    b.save(marker())
    assert.equal(b.writes(), 0)
    assert.match(b.replies.at(-1).message, /unreadable/)
})

for (const [name, settings] of [['nonadmin', { admin: false }], ['wrong session', { session: 'SELF' }], ['frozen player', { frozen: true }]]) {
    test(name + ' cannot modify marker storage', () => {
        const b = backend({ goblins: marker() }, settings)
        b.save(marker({ turninDestination: destination }))
        assert.equal(b.writes(), 0)
    })
}

test('delete removes only the selected entry, including its second destination', () => {
    const b = backend({ goblins: marker({ turninDestination: destination }), other: marker({ markerId: 'other' }) })
    b.remove('goblins')
    assert.deepEqual(Object.keys(b.registry()), ['other'])
})

test('checkbox reveals return fields without altering the objective coordinates', () => {
    const f = frontend()
    f.load(marker())
    assert.equal(f.nodes.turninDestination.hidden, true)
    f.enable()
    assert.equal(f.nodes.turninDestination.hidden, false)
    assert.equal(f.nodes.turnin['aria-expanded'], 'true')
    assert.equal(f.nodes.x.value, '3072')
    assert.equal(f.nodes.turninX.value, '')
    f.context.saveMarker()
    assert.equal(f.sends.length, 0)
    assert.match(f.nodes.status.textContent, /turn-in/)
})

test('return My Pos changes only return coordinates and dimension', () => {
    const f = frontend()
    f.load(marker()); f.enable()
    f.nodes.turninMyPos.onclick()
    f.answerPosition({ ...destination, dimensionId: 'minecraft:the_nether', dimension: -1, dimensionName: 'Nether' })
    assert.equal(f.nodes.turninX.value, '3066')
    assert.equal(f.nodes.turninY.value, '7')
    assert.equal(f.nodes.turninZ.value, '222')
    assert.equal(f.context.draftTurninDimension.dimensionId, 'minecraft:the_nether')
    assert.equal(f.context.draftDimension.dimensionId, objective.dimensionId)
    assert.equal(f.nodes.x.value, '3072')
    assert.equal(f.context.dirty, true)
})

test('objective My Pos leaves return fields and its dimension untouched', () => {
    const f = frontend()
    f.load(marker({ turninDestination: destination }))
    f.nodes.myPos.onclick()
    f.answerPosition({ ...objective, x: 99, y: 64, z: 88, dimensionName: 'Elsewhere' })
    assert.equal(f.nodes.x.value, '99')
    assert.equal(f.nodes.turninX.value, '3066')
    assert.equal(f.context.draftTurninDimension.dimensionName, destination.dimensionName)
})

test('late My Pos response cannot overwrite a different marker draft', () => {
    const f = frontend()
    f.load(marker()); f.enable(); f.nodes.turninMyPos.onclick()
    f.load(marker({ markerId: 'other' }))
    f.answerPosition(destination)
    assert.equal(f.nodes.markerId.value, 'other')
    assert.equal(f.nodes.turninX.value, '')
})

test('late My Pos response cannot overwrite manual edits', () => {
    const f = frontend()
    f.load(marker()); f.enable(); f.nodes.turninMyPos.onclick()
    f.nodes.turninX.value = '123'; f.nodes.turninX.oninput()
    f.answerPosition(destination)
    assert.equal(f.nodes.turninX.value, '123')
})

test('one save event contains both destinations under one marker ID', () => {
    const f = frontend()
    f.load(marker()); f.enable(); f.setReturn(); f.context.saveMarker()
    assert.equal(f.sends.length, 1)
    assert.equal(f.sends[0].event, 'quest_map')
    const data = f.sends[0].data
    assert.equal(data.markerId, 'goblins')
    assert.equal(data.turnin, false)
    assert.equal(data.x, objective.x)
    assert.deepEqual(data.turninDestination, destination)
})

test('reloading a paired marker restores its checkbox, return values and dimension', () => {
    const f = frontend()
    f.load(marker({ turninDestination: destination }))
    assert.equal(f.nodes.turnin.checked, true)
    assert.equal(f.nodes.turninDestination.hidden, false)
    assert.equal(f.nodes.turninX.value, '3066')
    assert.equal(f.nodes.turninDimensionLabel.textContent, 'custom_world')
    assert.equal(f.nodes.legacyTurninHint.hidden, true)
})

test('unchecking hides return fields without erasing draft values, and saves null', () => {
    const f = frontend()
    f.load(marker({ turninDestination: destination }))
    f.nodes.turnin.checked = false; f.nodes.turnin.onchange()
    assert.equal(f.nodes.turninDestination.hidden, true)
    assert.equal(f.nodes.turninX.value, '3066')
    f.context.saveMarker()
    assert.equal(f.sends[0].data.turninDestination, null)
    assert.equal(f.sends[0].data.x, objective.x)
})

test('editor preserves a legacy turn-in-only record until explicit conversion', () => {
    const f = frontend()
    f.load(marker({ turnin: true, ...destination }))
    assert.equal(f.nodes.turnin.checked, false)
    assert.equal(f.nodes.legacyTurninHint.hidden, false)
    assert.match(f.nodes.destinationTitle.textContent, /legacy/)
    f.context.saveMarker()
    assert.equal(f.sends[0].data.turnin, true)
    assert.equal(f.sends[0].data.turninDestination, null)
})

test('always-visible editor mode hides and disables return fields', () => {
    const f = frontend()
    f.load(marker({ turninDestination: destination }))
    f.nodes.mode.value = 'ALWAYS'; f.nodes.mode.onchange()
    assert.equal(f.nodes.turninDestination.hidden, true)
    assert.equal(f.nodes.turninControl.hidden, true)
    f.context.saveMarker()
    assert.equal(f.sends[0].data.turninDestination, null)
    assert.equal(f.sends[0].data.turnin, false)
})

test('readonly editor cannot save or request either position', () => {
    const f = frontend({ admin: false })
    f.load(marker({ turninDestination: destination }))
    assert.equal(f.nodes.turninMyPos.disabled, true)
    assert.equal(f.nodes.myPos.disabled, true)
    f.context.saveMarker(); f.nodes.myPos.onclick(); f.nodes.turninMyPos.onclick()
    assert.equal(f.sends.length, 0)
})

test('marker list presents a paired marker as a single searchable row', () => {
    const f = frontend({ markers: [marker({ turninDestination: { ...destination, dimensionName: 'ReturnWorld' } })] })
    f.nodes.search.value = 'returnworld'; f.nodes.search.oninput()
    assert.equal(f.nodes.markerList.children.length, 1)
    assert.match(f.nodes.markerList.children[0].title, /Objective \+ Turn-in/)
})

test('editor has scroll-safe return layout and no duplicate input identifiers', () => {
    assert.match(html, /#markerAtlas \.fields\{overflow:auto\}/)
    assert.match(html, /id="turninDestination"[^>]*hidden/)
    for (const id of ['turninX', 'turninY', 'turninZ', 'turninMyPos', 'turninDimensionLabel']) assert.equal([...html.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1)
})
