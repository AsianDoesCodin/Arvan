'use strict';
// Offline content tests only. This file is NOT an NPC/player runtime script.
// The model uses the upstream API numbering documented in the native-availability
// reference; it cannot establish exact-build implementation or live NPC binding.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inventorySnbt } = require('./snbt-inventory.cjs');
const root = path.resolve(__dirname, '../../..');
const folder = path.join(root, 'dialogs/Act 1  Intro');
const plan = JSON.parse(fs.readFileSync(path.join(root, 'docs/elder-posta-entry-plan.json'), 'utf8'));
const dialogs = new Map();
for (const filename of fs.readdirSync(folder).filter(f => /^\d+\.json$/.test(f))) {
  const text = fs.readFileSync(path.join(folder, filename), 'utf8');
  const entries = inventorySnbt(text).entries;
  const map = new Map(entries.map(e => [e.path, e]));
  const scalar = key => map.get('$[' + JSON.stringify(key) + ']');
  const number = key => {
    const e = scalar(key);
    assert.equal(e.numericType, 'int', key);
    return Number(e.raw);
  };
  const options = [];
  for (let i = 0; i < scalar('Options').size; i++) {
    const prefix = '$["Options"][' + i + ']';
    options.push({
      target: Number(map.get(prefix + '["Option"]["Dialog"]').raw),
      type: Number(map.get(prefix + '["Option"]["OptionType"]').raw),
      slot: Number(map.get(prefix + '["OptionSlot"]').raw)
    });
  }
  const id = number('DialogId');
  assert.equal(String(id), path.basename(filename, '.json'));
  assert.equal(dialogs.has(id), false);
  dialogs.set(id, { text, entries, map, scalar, number, options });
}
function state({ read = [], active = [], finished = [] } = {}) {
  return { read: new Set(read), active: new Set(active), finished: new Set(finished) };
}
function available(id, p) {
  const d = dialogs.get(id);
  assert.ok(d, 'Missing dialogue ' + id);
  for (let slot = 1; slot <= 4; slot++) {
    const suffix = slot === 1 ? '' : String(slot);
    const did = d.number('AvailabilityDialog' + suffix + 'Id');
    const dm = d.number('AvailabilityDialog' + suffix);
    if (did >= 0 && dm !== 0) {
      assert.ok(dm === 1 || dm === 2);
      if ((dm === 1) !== p.read.has(did)) return false;
    }
    const qid = d.number('AvailabilityQuest' + suffix + 'Id');
    const qm = d.number('AvailabilityQuest' + suffix);
    if (qid >= 0 && qm !== 0) {
      assert.ok(qm >= 1 && qm <= 4, 'Unmodeled quest availability');
      if (qm === 1 && !p.finished.has(qid)) return false;
      if (qm === 2 && p.finished.has(qid)) return false;
      if (qm === 3 && !p.active.has(qid)) return false;
      if (qm === 4 && p.active.has(qid)) return false;
    }
  }
  return true;
}
function first(p) { return plan.slotOrder.find(id => available(id, p)); }
function open(id, p) {
  assert.ok(available(id, p), 'Unavailable dialogue ' + id);
  p.read.add(id);
  const qid = dialogs.get(id).number('DialogQuest');
  if (qid >= 0) { assert.equal(p.finished.has(qid), false); p.active.add(qid); }
  return id;
}
function visit(p) { const id = first(p); assert.ok(id, 'No entry'); return open(id, p); }
function choices(id, p) { return dialogs.get(id).options.filter(o => o.type === 1 && available(o.target, p)).map(o => o.target); }
function choose(from, to, p) { assert.ok(choices(from, p).includes(to), `${from} -> ${to}`); return open(to, p); }
function turnIn(p, qid) { p.active.delete(qid); p.finished.add(qid); }

test('exactly 12 distinct ordered native opening IDs; referral 12 is not Posta', () => {
  assert.deepEqual(plan.slotOrder, [34, 35, 33, 31, 28, 30, 27, 23, 26, 13, 15, 17]);
  assert.equal(new Set(plan.slotOrder).size, 12);
  assert.equal(plan.notANativeNpcExport, true);
});
test('21 native records parse without stripping suffixes; all links and exits exist', () => {
  assert.equal(dialogs.size, 21);
  for (const [id, d] of dialogs) {
    assert.equal(d.number('ModRev'), 18);
    assert.equal(d.number('DialogHideNPC'), 0);
    assert.equal(d.number('DialogHideNpc'), 0);
    assert.equal(d.map.get('$["DialogMail"]["TimePast"]').raw, '1669491043541L');
    assert.equal(d.map.get('$["DialogMail"]["Time"]').raw, '0L');
    assert.ok(d.options.some(o => o.type === 0 && o.target === -1), 'No exit: ' + id);
    for (const [i, o] of d.options.entries()) {
      assert.equal(o.slot, i);
      assert.ok(o.type === 0 || o.type === 1);
      if (o.type === 1) assert.ok(dialogs.has(o.target), 'Broken target ' + o.target);
    }
  }
});
test('meeting and briefing each appear once, even when the player closes early', () => {
  const p = state();
  assert.equal(visit(p), 13);
  assert.equal(visit(p), 15);
  assert.equal(visit(p), 17);
  assert.equal(visit(p), 17);
  assert.equal(p.active.size, 0);
});
test('asking lore before the briefing never traps or restarts the player', () => {
  const p = state(); visit(p); choose(13, 19, p); choose(19, 20, p); choose(20, 19, p);
  assert.equal(visit(p), 15);
  assert.equal(visit(p), 17);
});
test('already-read briefing skips an introduction even with missing old meeting history', () => {
  assert.equal(first(state({ read: [15] })), 17);
});
for (const [qid, offer, accept, progress, previous] of [
  [2, 17, 18, 26, []], [3, 23, 24, 30, [2]], [4, 28, 29, 33, [2, 3]]
]) {
  test('quest ' + qid + ': decline, accept, revisit, abandon, accept again', () => {
    const p = state({ read: [13, 15, 27, 31], finished: previous });
    assert.equal(visit(p), offer);
    assert.equal(p.active.has(qid), false);
    assert.equal(visit(p), offer);
    choose(offer, accept, p);
    assert.equal(visit(p), progress);
    assert.equal(available(offer, p), false);
    assert.equal(available(accept, p), false);
    p.active.delete(qid);
    assert.equal(visit(p), offer);
    choose(offer, accept, p);
    assert.equal(visit(p), progress);
  });
  test('quest ' + qid + ': active includes objectives-ready until actual turn-in', () => {
    const p = state({ read: [13, 15], active: [qid], finished: previous });
    assert.equal(visit(p), progress);
    // Objective completion is not simulated as hasFinishedQuest.
    assert.equal(visit(p), progress);
    assert.equal(p.finished.has(qid), false);
    assert.equal(dialogs.get(progress).number('DialogQuest'), -1);
  });
}
test('packwolf and core advice remain available while their quests are active', () => {
  const wolves = state({ active: [3], finished: [2] });
  assert.equal(visit(wolves), 30); choose(30, 25, wolves);
  assert.ok(choices(25, wolves).includes(30));
  assert.equal(choices(25, wolves).includes(23), false);
  const cores = state({ active: [4], finished: [2, 3] });
  assert.equal(visit(cores), 33); choose(33, 32, cores);
  assert.ok(choices(32, cores).includes(33));
  assert.equal(choices(32, cores).includes(28), false);
});
test('every active page permits lore and a safe exit without changing quest progress', () => {
  for (const [qid, progress, finished] of [[2, 26, []], [3, 30, [2]], [4, 33, [2, 3]]]) {
    const p = state({ read: [13, 15], active: [qid], finished });
    assert.equal(visit(p), progress); choose(progress, 19, p); choose(19, 21, p); choose(21, 19, p);
    assert.equal(visit(p), progress);
    assert.deepEqual([...p.active], [qid]);
    assert.deepEqual([...p.finished], finished);
  }
});
test('transition acknowledgements precede repeatable offers only once', () => {
  const p = state({ read: [13, 15], finished: [2] });
  assert.equal(visit(p), 27); assert.equal(visit(p), 23); assert.equal(visit(p), 23);
  p.finished.add(3);
  assert.equal(visit(p), 31); assert.equal(visit(p), 28); assert.equal(visit(p), 28);
});
test('post-completion acknowledgement links to a repeatable conversation', () => {
  const p = state({ finished: [2, 3, 4] });
  assert.equal(visit(p), 34); choose(34, 35, p);
  assert.equal(visit(p), 35); choose(35, 19, p);
  assert.equal(visit(p), 35);
});
test('all 27 active/finished/unstarted task combinations prioritize the furthest stage', () => {
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const statuses = [a, b, c];
    const p = state({ read: [13, 15], active: statuses.flatMap((s, i) => s === 1 ? [i + 2] : []), finished: statuses.flatMap((s, i) => s === 2 ? [i + 2] : []) });
    const expected = c === 2 ? 34 : c === 1 ? 33 : b === 2 ? 31 : b === 1 ? 30 : a === 2 ? 27 : a === 1 ? 26 : 17;
    assert.equal(first(p), expected, String(statuses));
  }
});
test('two players use the same slot order without sharing dialogue-read state', () => {
  const firstTimer = state(), returning = state({ read: [13, 15], active: [2] });
  assert.equal(visit(firstTimer), 13); assert.equal(visit(returning), 26);
  assert.equal(visit(firstTimer), 15); assert.equal(visit(returning), 26);
});
test('only the three acceptance pages start tasks; no new commands or rewards', () => {
  for (const [id, d] of dialogs) {
    assert.equal(d.number('DialogQuest'), ({18: 2, 24: 3, 29: 4})[id] ?? -1);
    assert.equal(d.scalar('DialogCommand').raw, '""');
    for (const e of d.entries.filter(e => /\["DialogCommand"\]$/.test(e.path))) assert.equal(e.raw, '""');
  }
});
test('full quest journey permits interruptions and never uses a permanent intro root', () => {
  const p = state();
  assert.equal(visit(p), 13); choose(13, 15, p); choose(15, 17, p); choose(17, 18, p);
  assert.equal(visit(p), 26); turnIn(p, 2);
  assert.equal(visit(p), 27); choose(27, 23, p); choose(23, 24, p);
  assert.equal(visit(p), 30); turnIn(p, 3);
  assert.equal(visit(p), 31); choose(31, 28, p); choose(28, 29, p);
  assert.equal(visit(p), 33); turnIn(p, 4);
  assert.equal(visit(p), 34); assert.equal(visit(p), 35); assert.equal(visit(p), 35);
});
