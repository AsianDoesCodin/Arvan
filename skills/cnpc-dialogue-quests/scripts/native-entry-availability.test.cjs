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

// Explore reply links without accepting another quest. Read gates are evaluated
// at each hop, not once at the root. A terminal page always permits leaving.
function copy(p) { return state({read: [...p.read], active: [...p.active], finished: [...p.finished]}); }
function reachable(from, p) {
  const seen = new Set(), queue = [[from, copy(p)]];
  while (queue.length) {
    const [id, q] = queue.shift();
    if (seen.has(id)) continue;
    open(id, q); seen.add(id);
    for (const target of choices(id, q)) {
      if (dialogs.get(target).number('DialogQuest') < 0) queue.push([target, copy(q)]);
      else seen.add(target); // Acceptance is reachable, but is not auto-selected.
    }
  }
  return seen;
}
const stages = [
  {quest: 2, topic: 17, accept: 18, progress: 26, advice: 22, prior: []},
  {quest: 3, topic: 23, accept: 24, progress: 30, advice: 25, prior: [2]},
  {quest: 4, topic: 28, accept: 29, progress: 33, advice: 32, prior: [2,3]}
];

test('six intentional starting roots, exact title-first plan, no child assignments', () => {
  assert.deepEqual(plan.slotOrder, [35,33,30,26,13,15]);
  assert.equal(new Set(plan.slotOrder).size, 6);
  assert.equal(plan.notANativeNpcExport, true);
  assert.deepEqual(plan.startingDialogs.map(x => x.id), plan.slotOrder);
  for (const item of plan.startingDialogs) assert.equal(dialogs.get(item.id).scalar('DialogTitle').raw, JSON.stringify(item.title));
  for (const child of [17,18,19,20,21,22,23,24,25,27,28,29,31,32,34]) assert.ok(!plan.slotOrder.includes(child));
});
test('all 21 native records preserve typed longs, valid links, slots, and exits', () => {
  assert.equal(dialogs.size, 21);
  for (const [id,d] of dialogs) {
    assert.equal(d.number('ModRev'), 18);
    assert.equal(d.number('DialogHideNPC'), 0); assert.equal(d.number('DialogHideNpc'), 0);
    assert.equal(d.map.get('$["DialogMail"]["TimePast"]').raw, '1669491043541L');
    assert.equal(d.map.get('$["DialogMail"]["Time"]').raw, '0L');
    assert.ok(d.options.length <= 5, 'No expanded option-slot range: ' + id);
    assert.ok(d.options.some(o => o.type === 0 && o.target === -1), 'No exit: ' + id);
    for (const [i,o] of d.options.entries()) {
      assert.equal(o.slot,i); assert.ok(o.type === 0 || o.type === 1);
      if (o.type === 1) assert.ok(dialogs.has(o.target), 'Missing target ' + o.target);
    }
  }
});
test('only the first meeting is one-time; closing does not advance along NPC slots', () => {
  const p = state(); assert.equal(visit(p),13);
  for (let i=0;i<4;i++) assert.equal(visit(p),15);
  assert.equal(p.active.size,0);
});
test('world briefing is a linked child; work remains reachable in the same conversation', () => {
  const p=state(); visit(p); choose(13,20,p); choose(20,15,p); choose(15,17,p); choose(17,18,p);
  assert.equal(visit(p),26);
  assert.match(dialogs.get(20).text, /Six Faced World/);
  assert.match(dialogs.get(20).text, /spills more mana/);
});
test('a lore detour before work can return to the offer without another right-click', () => {
  const p=state(); visit(p); choose(13,19,p); choose(19,21,p); choose(21,19,p); choose(19,15,p); choose(15,17,p);
  assert.ok(choices(17,p).includes(18)); assert.equal(p.active.size,0);
});
test('old briefing history never blocks the repeatable hub or replays the greeting', () => {
  for (const read of [[15],[13],[13,15],[13,15,17,27,31,34,35]]) {
    const p=state({read}); assert.equal(visit(p),15);
    choose(15,17,p); assert.equal(visit(p),15);
  }
});
for (const s of stages) {
  test('quest '+s.quest+': repeatable topic and acceptance survive refusal and abandonment', () => {
    const p=state({read:[13,15],finished:s.prior});
    assert.equal(visit(p),15); choose(15,s.topic,p);
    assert.equal(p.active.size,0); assert.equal(visit(p),15); choose(15,s.topic,p);
    choose(s.topic,s.accept,p); assert.equal(visit(p),s.progress);
    assert.equal(available(s.accept,p),false);
    p.active.delete(s.quest); assert.equal(visit(p),15); choose(15,s.topic,p); choose(s.topic,s.accept,p);
    assert.deepEqual([...p.active],[s.quest]);
  });
  test('quest '+s.quest+': active topic exposes progress but hides acceptance', () => {
    const p=state({read:[13,15],active:[s.quest],finished:s.prior});
    assert.equal(visit(p),s.progress); choose(s.progress,19,p); choose(19,15,p); choose(15,s.topic,p);
    assert.ok(choices(s.topic,p).includes(s.progress));
    assert.ok(!choices(s.topic,p).includes(s.accept)); choose(s.topic,s.progress,p);
    assert.deepEqual([...p.active],[s.quest]); assert.deepEqual([...p.finished],s.prior);
  });
  test('quest '+s.quest+': advice and lore return to the active task without reopening', () => {
    const p=state({read:[13,15],active:[s.quest],finished:s.prior});
    assert.equal(visit(p),s.progress); choose(s.progress,s.advice,p);
    const reached=reachable(s.advice,p);
    assert.ok(reached.has(s.progress)); assert.ok(!reached.has(s.accept));
    assert.ok(reached.has(19)); assert.ok(reached.has(20)); assert.ok(reached.has(21));
  });
  test('quest '+s.quest+': objective readiness is not turn-in', () => {
    const p=state({read:[13,15],active:[s.quest],finished:s.prior});
    p.objectivesReady=true; p.coreCount=6; // These must not affect entry selection.
    assert.equal(visit(p),s.progress); assert.equal(visit(p),s.progress);
    assert.equal(p.finished.has(s.quest),false); assert.equal(dialogs.get(s.progress).number('DialogQuest'),-1);
    assert.equal(available(s.accept,p),false);
  });
  test('quest '+s.quest+': finished tasks cannot be accepted again', () => {
    const p=state({read:[13,15],finished:[...s.prior,s.quest]});
    assert.equal(available(s.topic,p),false); assert.equal(available(s.accept,p),false);
    const seen=reachable(first(p),p); assert.equal(seen.has(s.accept),false);
  });
}
test('one-time acknowledgements are optional descendants, never required resume roots', () => {
  for (const [done,topic,ack,next] of [[2,23,27,24],[3,28,31,29]]) {
    const p=state({read:[13,15],finished:done===2?[2]:[2,3]});
    assert.equal(visit(p),15); choose(15,topic,p); choose(topic,ack,p);
    assert.equal(visit(p),15); choose(15,topic,p);
    assert.ok(!choices(topic,p).includes(ack)); assert.ok(choices(topic,p).includes(next));
    const q=state({read:[13,15],finished:[...p.finished]});
    visit(q); choose(15,topic,q); choose(topic,next,q); // Skipping acknowledgement is safe too.
  }
});
test('the ending root is repeatable before and after its optional acknowledgement', () => {
  const p=state({finished:[2,3,4]}); assert.equal(visit(p),35);
  choose(35,34,p); assert.equal(visit(p),35); assert.ok(!choices(35,p).includes(34));
  choose(35,19,p); choose(19,15,p); assert.equal(visit(p),35);
});
test('all 27 quest-state combinations and legacy read histories select a valid root', () => {
  for (const read of [[],[13],[15],[13,15,17,27,31,34,35]]) {
    for(let a=0;a<3;a++) for(let b=0;b<3;b++) for(let c=0;c<3;c++) {
      const statuses=[a,b,c]; const p=state({read,active:statuses.flatMap((s,i)=>s===1?[i+2]:[]),finished:statuses.flatMap((s,i)=>s===2?[i+2]:[])});
      const expected=c===2?35:c===1?33:b===2?15:b===1?30:a===2?15:a===1?26:read.length?15:13;
      assert.equal(first(p),expected,JSON.stringify({statuses,read}));
    }
  }
});
test('fresh right-click after every reachable intermediate page retains the next task', () => {
  for (const s of stages) {
    for (const active of [false,true]) {
      const p=state({read:[13,15],finished:s.prior,active:active?[s.quest]:[]});
      const start=first(p), pages=reachable(start,p);
      for(const id of pages) {
        if(dialogs.get(id).number('DialogQuest')>=0) continue;
        const q=copy(p); if(!available(id,q)) continue; open(id,q);
        const again=first(q); assert.equal(again,active?s.progress:15,'Closed at '+id);
        const recovered=reachable(again,q); assert.ok(recovered.has(active?s.progress:s.accept),'Stranded at '+id);
      }
    }
  }
});
test('two players share slot order, never dialogue history or quest state', () => {
  const a=state(),b=state({active:[3],finished:[2]});
  assert.equal(visit(a),13); assert.equal(visit(b),30);
  assert.equal(visit(a),15); assert.equal(visit(b),30); assert.equal(a.active.size,0);
});
test('only acceptance pages start quests; no dialogue introduces commands or rewards', () => {
  for(const [id,d] of dialogs) {
    assert.equal(d.number('DialogQuest'),({18:2,24:3,29:4})[id]??-1);
    for(const e of d.entries.filter(e=>/\["DialogCommand"\]$/.test(e.path))) assert.equal(e.raw,'""');
  }
});
test('complete journey follows replies between roots rather than the NPC slot array', () => {
  const p=state(); assert.equal(visit(p),13); choose(13,20,p); choose(20,15,p);
  for(const s of stages) {
    choose(15,s.topic,p); choose(s.topic,s.accept,p); assert.equal(visit(p),s.progress);
    turnIn(p,s.quest); assert.equal(visit(p),s.quest===4?35:15);
  }
  choose(35,34,p); choose(34,35,p); assert.equal(visit(p),35);
});
