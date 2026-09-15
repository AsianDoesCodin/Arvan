import json
from pathlib import Path
server = {'path': 'scripts/player/ADMsLevelingSystem.js', 'sha': '95cc7823f1310cb5a8926c357168466fa986a2f7', 'edits': []}
html = {'path': 'scripts/quest_map.html', 'sha': 'd3936b39e8a7aef9b3d4b2c44ae717eb96c9fd0a', 'edits': []}
def edit(file, old, new, scope=None):
    item = {'old': old, 'new': new}
    if scope: item['scope'] = scope
    file['edits'].append(item)
helper = '''// Optional second destination. Legacy turnin-only records keep their old flag.
function normalizeQuestMapTurninDestination(source) {
    if (source === undefined || source === null) return null
    if (typeof source !== "object" || Array.isArray(source)) throw new Error("Invalid turn-in destination.")
    var keys = ["x", "y", "z"]
    for (var i = 0; i < keys.length; i++) {
        var value = source[keys[i]]
        if (value === undefined || value === null || typeof value === "boolean" ||
            String(value).trim() === "" || !isFinite(Number(value))) {
            throw new Error("Enter all turn-in X/Y/Z coordinates.")
        }
    }
    var x = Number(source.x), y = Number(source.y), z = Number(source.z)
    if (Math.abs(x) > 29999984 || Math.abs(z) > 29999984 ||
        y !== Math.floor(y) || y < -2048 || y > 2047) {
        throw new Error("Check turn-in X/Z bounds and whole-number Y (-2048 to 2047).")
    }
    var id = String(source.dimensionId || "").trim()
    var name = String(source.dimensionName || "").trim()
    var dimension = source.dimension === undefined || source.dimension === null ||
        String(source.dimension).trim() === "" ? null : Number(source.dimension)
    if ((id && !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)) ||
        name.length > 128 || /[\\u0000-\\u001f\\u007f]/.test(name) ||
        (dimension !== null && (!isFinite(dimension) || dimension !== Math.floor(dimension))) ||
        (!id && !name && dimension === null)) {
        throw new Error("Use the turn-in My Pos button to select a valid dimension.")
    }
    return { x: Math.floor(x), y: y, z: Math.floor(z), dimensionId: id,
        dimension: dimension, dimensionName: name }
}

'''
edit(server, 'function getQuestMapRegistry(world, strict) {', helper + 'function getQuestMapRegistry(world, strict) {')
edit(server, '                turnin: source.turnin === true,', '                turnin: source.turnin === true,\n                turninDestination: normalizeQuestMapTurninDestination(source.turninDestination),')
sc = ['function buildQuestMapMarkers(player, adminMode) {', '\nfunction openQuestMapHtml(']
edit(server, '        if (!marker) continue', '        if (!marker) continue\n        var destination = marker\n        var turnin = marker.turnin === true', sc)
edit(server, '            if ((marker.turnin === true) !== readyQuests[questKey]) continue', '''            if (marker.turninDestination) {
                turnin = readyQuests[questKey] === true
                if (turnin) destination = marker.turninDestination
            } else if ((marker.turnin === true) !== readyQuests[questKey]) continue''', sc)
edit(server, '        markers.push({', '        var rendered = {', sc)
edit(server, '''            turnin: marker.turnin === true,
            x: Number(marker.x),
            y: marker.y === null || marker.y === undefined || !isFinite(Number(marker.y))
                ? Math.floor(player.getY()) : Math.floor(Number(marker.y)),
            z: Number(marker.z),
            dimensionId: String(marker.dimensionId || ""),
            dimension: Number(marker.dimension),
            dimensionName: String(marker.dimensionName || "")
        })''', '''            turnin: turnin,
            x: Number(destination.x),
            y: destination.y === null || destination.y === undefined || !isFinite(Number(destination.y))
                ? Math.floor(player.getY()) : Math.floor(Number(destination.y)),
            z: Number(destination.z),
            dimensionId: String(destination.dimensionId || ""),
            dimension: Number(destination.dimension),
            dimensionName: String(destination.dimensionName || "")
        }
        // The editor receives both locations; the map bridge receives only the active one.
        if (adminMode) rendered.turninDestination = marker.turninDestination
        markers.push(rendered)''', sc)
sc = ['function handleQuestMapHtmlEvent(e) {', '\nfunction getSelfQuestMode(']
edit(server, '    registry[markerId] = {', '''    var turninDestination = null
    try {
        if (mode === "QUEST") {
            // An older editor omits the field: preserve a saved second destination.
            // The new editor sends null explicitly when the checkbox is disabled.
            var turninSource = Object.prototype.hasOwnProperty.call(data, "turninDestination")
                ? data.turninDestination : (registry[markerId] ? registry[markerId].turninDestination : null)
            turninDestination = normalizeQuestMapTurninDestination(turninSource)
        }
    } catch (error) {
        pushQuestMapMeta(player, true, String(error.message || error), false, data.actionRequestId, action)
        return
    }
    registry[markerId] = {''', sc)
edit(server, '        turnin: mode === "QUEST" && (data.turnin === true || String(data.turnin) === "true"),', '''        turnin: mode === "QUEST" && !turninDestination && (data.turnin === true || String(data.turnin) === "true"),
        turninDestination: turninDestination,''', sc)
edit(html, '</style>\n</head>', '''</style>
<style>
#markerAtlas .fields{overflow:auto}
#markerAtlas .formGrid{height:auto;min-height:100%;align-content:start}
#markerAtlas [hidden]{display:none!important}
#markerAtlas .turninDestination{grid-column:1/-1;display:flex;flex-direction:column;gap:16px;border-top:1px solid #52605a;padding-top:16px}
#markerAtlas .legacyHint{color:#d0b477;grid-column:1/-1}
@media(max-height:650px){#markerAtlas .turninDestination{gap:10px;padding-top:10px}}
</style>
</head>''')
edit(html, '''          <label class="check wide"><input id="turnin" type="checkbox"><span><strong>turnin</strong><br>Show this destination when all quest objectives are complete.</span></label>''', '''          <p id="legacyTurninHint" class="hint legacyHint" hidden>This saved marker is turn-in-only and stays that way. Enable Turn-in below only to convert it to an objective with a separate return destination.</p>
          <label class="check wide" id="turninControl"><input id="turnin" type="checkbox" aria-controls="turninDestination" aria-expanded="false"><span><strong>Turn-in</strong><br>Add a second destination to use when all quest objectives are complete.</span></label>''')
edit(html, '<span class="fieldLabel">Destination</span><button type="button" id="myPos"', '<span class="fieldLabel" id="destinationTitle">Objective destination</span><button type="button" id="myPos"')
edit(html, '''          <label class="check wide"><input id="showOutside"''', '''          <section id="turninDestination" class="turninDestination" aria-label="Turn-in destination" hidden>
            <div class="field destination"><div class="positionHeading"><span class="fieldLabel">Turn-in destination</span><button type="button" id="turninMyPos" class="cyan">My Pos</button></div>
              <div class="coordinates">
                <div><label for="turninX">X</label><input id="turninX" type="number" step="any" min="-29999984" max="29999984"></div>
                <div><label for="turninY">Y</label><input id="turninY" type="number" step="1" min="-2048" max="2047"></div>
                <div><label for="turninZ">Z</label><input id="turninZ" type="number" step="any" min="-29999984" max="29999984"></div>
              </div>
            </div>
            <div class="field"><span class="fieldLabel">Turn-in dimension</span><div id="turninDimensionLabel" class="dimension">Unknown dimension</div><p class="hint">This My Pos button changes only the turn-in destination. Objective coordinates stay unchanged.</p></div>
          </section>
          <label class="check wide"><input id="showOutside"''')
edit(html, 'var draftDimension = {}', 'var draftDimension = {}\nvar draftTurninDimension = {}\nvar legacyTurninOnly = false')
edit(html, '''    element("turnin").disabled = !admin || element("mode").value !== "QUEST"''', '''    var questMode = element("mode").value === "QUEST"
    var paired = questMode && element("turnin").checked
    element("turninControl").hidden = !questMode
    element("turnin").disabled = !admin || !questMode
    element("turnin").setAttribute("aria-expanded", paired ? "true" : "false")
    element("turninDestination").hidden = !paired
    element("turninX").disabled = !admin || !paired
    element("turninY").disabled = !admin || !paired
    element("turninZ").disabled = !admin || !paired
    element("turninMyPos").disabled = !admin || !paired || pending !== null
    element("turninDimensionLabel").textContent = dimensionLabel(draftTurninDimension)
    element("legacyTurninHint").hidden = !questMode || !legacyTurninOnly
    element("destinationTitle").textContent = !questMode ? "Destination" :
        legacyTurninOnly && !paired ? "Turn-in destination (legacy)" : "Objective destination"''')
edit(html, '''    element("turnin").checked = marker.turnin === true
    draftDimension = dimensionOf(marker)''', '''    var destination = marker.turninDestination || {}
    element("turnin").checked = marker.mode !== "ALWAYS" && !!marker.turninDestination
    legacyTurninOnly = marker.turnin === true && !marker.turninDestination
    element("turninX").value = text(destination.x)
    element("turninY").value = text(destination.y)
    element("turninZ").value = text(destination.z)
    draftTurninDimension = dimensionOf(destination)
    draftDimension = dimensionOf(marker)''')
edit(html, '''dimensionLabel(candidate) + (candidate.turnin ? " turnin" : "")''', '''dimensionLabel(candidate) + (candidate.turnin || candidate.turninDestination ? " turnin" : "") +
            (candidate.turninDestination ? " " + dimensionLabel(candidate.turninDestination) : "")''')
edit(html, '''(marker.turnin ? " · Turn-in" : " · Objective")''', '''(marker.turninDestination ? " · Objective + Turn-in" : marker.turnin ? " · Turn-in" : " · Objective")''')
edit(html, '''markerId: element("markerId").value }''', '''markerId: element("markerId").value, destination: data.destination || "objective" }''')
edit(html, '''    data.turnin = mode === "QUEST" && element("turnin").checked
    send("save", data, "Saving marker...")''', '''    var paired = mode === "QUEST" && element("turnin").checked
    data.turnin = mode === "QUEST" && legacyTurninOnly && !paired
    data.turninDestination = null
    if (paired) {
        var tx = element("turninX").value.trim(), ty = element("turninY").value.trim(), tz = element("turninZ").value.trim()
        if (!tx || !tz || !isFinite(Number(tx)) || !isFinite(Number(tz)) || Math.abs(Number(tx)) > 29999984 || Math.abs(Number(tz)) > 29999984) return setStatus("Enter valid turn-in X and Z coordinates within the world border.", false)
        if (!ty || !isFinite(Number(ty)) || Number(ty) !== Math.floor(Number(ty)) || Number(ty) < -2048 || Number(ty) > 2047) return setStatus("Enter a whole-number turn-in Y from -2048 to 2047.", false)
        if (!draftTurninDimension.dimensionId && draftTurninDimension.dimension == null && !draftTurninDimension.dimensionName) return setStatus("Use the turn-in My Pos button to set its dimension.", false)
        data.turninDestination = dimensionOf(draftTurninDimension)
        data.turninDestination.x = Number(tx)
        data.turninDestination.y = Number(ty)
        data.turninDestination.z = Number(tz)
    }
    send("save", data, "Saving marker...")''')
edit(html, '''            element("x").value = text(player.x)
            element("y").value = text(player.y)
            element("z").value = text(player.z)
            draftDimension = dimensionOf(player)
            dirty = true
            draftRevision++''', '''            // Ignore a late position response after the user edits or switches drafts.
            if (request.revision === draftRevision) {
                if (request.destination === "turnin") {
                    element("turninX").value = text(player.x)
                    element("turninY").value = text(player.y)
                    element("turninZ").value = text(player.z)
                    draftTurninDimension = dimensionOf(player)
                } else {
                    element("x").value = text(player.x)
                    element("y").value = text(player.y)
                    element("z").value = text(player.z)
                    draftDimension = dimensionOf(player)
                }
                dirty = true
                draftRevision++
            }''')
edit(html, 'element("turnin").onchange = markDirty', '''element("turnin").onchange = markDirty
element("turninX").oninput = markDirty
element("turninY").oninput = markDirty
element("turninZ").oninput = markDirty
element("turninMyPos").onclick = function() { send("mypos", { destination: "turnin" }, "Getting your turn-in position...") }''')
manifest = {'base': '86ee15385b18385c8f8ec2894b9e097775f70b1d', 'files': [server, html]}
Path(__file__).with_name('changes.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print('Created manifest with', sum(len(f['edits']) for f in manifest['files']), 'anchored edits')
