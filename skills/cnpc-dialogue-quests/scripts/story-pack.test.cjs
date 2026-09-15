'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { validate, render } = require('./story-pack.cjs');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/supply-run.story.json'), 'utf8'));
const draft = () => structuredClone(sample);

test('complete example has no draft errors or warnings and remains non-native', () => {
  assert.deepEqual(validate(draft()), { errors: [], warnings: [], nativeImportReady: false });
});

test('render retains story, conditions, actions, objectives and rewards', () => {
  const text = render(draft());
  for (const expected of ['Mara, Road Warden', 'start-quest', 'turn-in-quest', 'objectives-complete', 'minecraft:coal', '25 experience', '2 x minecraft:emerald', 'not a native CustomNPCs import']) assert.ok(text.includes(expected), expected);
});

test('malformed containers produce validation errors instead of exceptions', () => {
  for (const value of [null, [], 'story', {}, { ...draft(), dialogues: [null] }, { ...draft(), quests: [null] }]) assert.ok(validate(value).errors.length);
});

test('unknown fields and invalid counts are rejected', () => {
  const pack = draft();
  pack.dialogues[0].nativeOptions = [];
  pack.quests[0].objectives[0].count = -1;
  const errors = validate(pack).errors.join('\n');
  assert.match(errors, /unknown property/);
  assert.match(errors, /integer >= 1/);
});

test('duplicate symbolic keys and native IDs are rejected independently', () => {
  const pack = draft();
  pack.dialogues[0].nativeId = 7;
  pack.dialogues[1].nativeId = 7;
  pack.dialogues[1].key = pack.dialogues[0].key;
  const errors = validate(pack).errors.join('\n');
  assert.match(errors, /duplicate value "mara-greeting"/);
  assert.match(errors, /duplicate value 7/);
});

test('dialogue and quest native ID namespaces remain distinct', () => {
  const pack = draft();
  pack.dialogues[0].nativeId = 7;
  pack.quests[0].nativeId = 7;
  assert.equal(validate(pack).errors.length, 0);
});

test('missing branch and quest references are rejected', () => {
  const pack = draft();
  pack.dialogues[0].choices[0].next = 'missing-dialogue';
  pack.dialogues[0].choices[0].conditions[0].quest = 'missing-quest';
  const errors = validate(pack).errors.join('\n');
  assert.match(errors, /unknown reference "missing-dialogue"/);
  assert.match(errors, /unknown reference "missing-quest"/);
});

test('dialogue cycle without exit is rejected', () => {
  const pack = draft();
  pack.dialogues[0].choices = [{ key: 'trapped', text: 'Again', next: 'mara-greeting', conditions: [], actions: [] }];
  assert.match(validate(pack).errors.join('\n'), /no structural path to an exit/);
});

test('unreachable dialogue is a warning and a cycle with exit remains valid', () => {
  const pack = draft();
  pack.dialogues.push({ ...structuredClone(pack.dialogues[2]), key: 'unused' });
  const result = validate(pack);
  assert.equal(result.errors.length, 0);
  assert.match(result.warnings.join('\n'), /unreachable/);
});

test('quest prerequisite loops fail, while next-quest loops warn', () => {
  const pack = draft();
  pack.quests[0].prerequisites = [pack.quests[0].key];
  assert.match(validate(pack).errors.join('\n'), /prerequisite cycle/);
  pack.quests[0].prerequisites = [];
  pack.quests[0].nextQuest = pack.quests[0].key;
  const result = validate(pack);
  assert.equal(result.errors.length, 0);
  assert.match(result.warnings.join('\n'), /nextQuest cycle/);
});

test('turn-in without readiness gate warns', () => {
  const pack = draft();
  pack.dialogues.find(dialogue => dialogue.key === 'mara-turn-in').conditions = [];
  assert.match(validate(pack).warnings.join('\n'), /turn-in-quest has no objectives-complete condition/);
});

test('read-only inspector handles Java lists, sparse rewards and missing quest IDs', () => {
  const list = values => ({ size: () => values.length, get: index => values[index] });
  const category = { getName: () => 'Test Category', dialogs: () => list([dialogue]) };
  const item = { isEmpty: () => false, getName: () => 'minecraft:emerald', getStackSize: () => 2 };
  const quest = {
    getId: () => 9, getName: () => 'Test Quest', getType: () => 0, getLogText: () => 'Collect coal.',
    getCompleteText: () => 'Done.', getNextQuest: () => null, getIsRepeatable: () => false,
    getRewards: () => ({ getSize: () => 3, getSlot: index => index === 2 ? item : null })
  };
  const dialogue = {
    getId: () => 8, getName: () => 'Test Dialogue', getText: () => 'Welcome.', getCategory: () => category,
    getQuest: () => quest, getCommand: () => '',
    getAvailability: () => ({ getDaytime: () => 0, getMinPlayerLevel: () => 0 }),
    getOptions: () => list([{ getSlot: () => 3, getName: () => 'Leave', getType: () => 4, isValid: () => true, hasDialog: () => false, canClose: () => true }])
  };
  const api = { getDialogs: () => ({ categories: () => list([category]) }), getQuests: () => ({ get: id => id === 9 ? quest : null }) };
  const printed = [];
  const context = { Java: { type: name => { assert.equal(name, 'noppes.npcs.api.NpcAPI'); return { Instance: () => api }; } }, print: text => printed.push(JSON.parse(text)) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/inspect-content.js'), 'utf8'), context);
  assert.equal(printed.length, 0, 'loading the helper must not enumerate or modify content');
  assert.equal(context.inspectDialogueCatalog(), 1);
  context.inspectQuestIds([9, 42]);
  context.inspectPlayerQuestIds({ getActiveQuests: () => [quest], getFinishedQuests: () => [] });
  assert.equal(printed[0].value.options[0].slot, 3);
  assert.equal(printed[1].value.itemRewards[0].slot, 2);
  assert.equal(printed[2].value, null);
  assert.deepEqual(printed[3].value.activeQuestIds, [9]);
  assert.throws(() => context.inspectQuestIds([-1]), /Invalid quest ID/);
});
