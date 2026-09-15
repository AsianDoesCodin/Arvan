'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { inventorySnbt } = require('./snbt-inventory.cjs');

// These are regression assertions about the supplied records, not a native schema
// or evidence that CustomNPCs accepts an edited file on import.
const filenames = [
  'branching-dialogue-11.native.json',
  'quest-start-dialogue-12.native.json',
  'talk-quest-1.native.json'
];
const samples = filenames.map(filename => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/native', filename), 'utf8');
  return { filename, source, inventory: inventorySnbt(source) };
});
const [branching, questStart, quest] = samples;

function entry(sample, entryPath) {
  const matches = sample.inventory.entries.filter(item => item.path === entryPath);
  assert.equal(matches.length, 1, `${sample.filename}: expected exactly one ${entryPath}`);
  return matches[0];
}

function number(sample, entryPath, raw, numericType = 'int') {
  const item = entry(sample, entryPath);
  assert.equal(item.type, 'number', `${sample.filename}: ${entryPath}`);
  assert.equal(item.numericType, numericType, `${sample.filename}: ${entryPath}`);
  assert.equal(item.raw, raw, `${sample.filename}: ${entryPath}`);
}

function fields(sample, parentPath, names) {
  const actual = sample.inventory.entries
    .map(item => item.path)
    .filter(itemPath => itemPath.startsWith(`${parentPath}[`) && /^\["[^"\\]*"\]$/.test(itemPath.slice(parentPath.length)))
    .sort();
  const expected = names.map(name => `${parentPath}[${JSON.stringify(name)}]`).sort();
  assert.deepEqual(actual, expected, `${sample.filename}: fields of ${parentPath}`);
}

for (const sample of samples) {
  test(`${sample.filename} inventories lexically but is not strict JSON or import-validated`, () => {
    assert.equal(entry(sample, '$').type, 'compound');
    assert.equal(sample.inventory.nativeImportValidated, false);
    assert.equal(sample.inventory.fieldSemanticsInferred, false);
    assert.throws(() => JSON.parse(sample.source), SyntaxError);
    for (const item of sample.inventory.entries.filter(item => Object.hasOwn(item, 'raw'))) {
      assert.equal(sample.source.slice(item.start, item.end), item.raw, item.path);
    }
  });
}

test('both dialogue records retain their complete observed field sets and case-distinct flags', () => {
  const dialogueFields = [
    'AvailabilityDayTime', 'AvailabilityDialog', 'AvailabilityDialog2', 'AvailabilityDialog2Id',
    'AvailabilityDialog3', 'AvailabilityDialog3Id', 'AvailabilityDialog4', 'AvailabilityDialog4Id',
    'AvailabilityDialogId', 'AvailabilityFaction', 'AvailabilityFaction2', 'AvailabilityFaction2Id',
    'AvailabilityFaction2Stance', 'AvailabilityFactionId', 'AvailabilityFactionStance',
    'AvailabilityMinPlayerLevel', 'AvailabilityQuest', 'AvailabilityQuest2', 'AvailabilityQuest2Id',
    'AvailabilityQuest3', 'AvailabilityQuest3Id', 'AvailabilityQuest4', 'AvailabilityQuest4Id',
    'AvailabilityQuestId', 'AvailabilityScoreboard2Objective', 'AvailabilityScoreboard2Type',
    'AvailabilityScoreboard2Value', 'AvailabilityScoreboardObjective', 'AvailabilityScoreboardType',
    'AvailabilityScoreboardValue', 'DecreaseFaction1Points', 'DecreaseFaction2Points',
    'DialogCommand', 'DialogDisableEsc', 'DialogHideNPC', 'DialogHideNpc', 'DialogId', 'DialogQuest',
    'DialogShowWheel', 'DialogSound', 'DialogStopMusic', 'DialogText', 'DialogTitle', 'ModRev',
    'OptionFaction1Points', 'OptionFaction2Points', 'OptionFactions1', 'OptionFactions2', 'Options', 'DialogMail'
  ];
  for (const sample of [branching, questStart]) {
    fields(sample, '$', dialogueFields);
    number(sample, '$["DialogHideNPC"]', '0');
    number(sample, '$["DialogHideNpc"]', '0');
    number(sample, '$["DialogDisableEsc"]', '1');
  }
  number(branching, '$["DialogId"]', '11');
  number(questStart, '$["DialogId"]', '12');
});

test('mail records preserve int versus byte BeenRead and lossless long timestamp tokens', () => {
  const mailFields = ['Sender', 'BeenRead', 'Message', 'MailItems', 'MailQuest', 'TimePast', 'Time', 'Subject'];
  for (const [sample, mail, readType, readToken, pastToken] of [
    [branching, 'DialogMail', 'int', '0', '1669491043541L'],
    [questStart, 'DialogMail', 'int', '0', '1669491043541L'],
    [quest, 'QuestMail', 'byte', '0b', '1789300293017L']
  ]) {
    const prefix = `$["${mail}"]`;
    fields(sample, prefix, mailFields);
    number(sample, `${prefix}["BeenRead"]`, readToken, readType);
    number(sample, `${prefix}["TimePast"]`, pastToken, 'long');
    number(sample, `${prefix}["Time"]`, '0L', 'long');
    assert.equal(entry(sample, `${prefix}["Message"]`).type, 'compound');
    assert.equal(entry(sample, `${prefix}["Message"]`).size, 0);
    assert.equal(entry(sample, `${prefix}["MailItems"]`).type, 'list');
    assert.equal(entry(sample, `${prefix}["MailItems"]`).size, 0);
  }
});

test('dialogue option wrappers, slots, target numbers and type numbers match the supplied records', () => {
  for (const [sample, options] of [
    [branching, [['0', '10', '1'], ['1', '8', '1']]],
    [questStart, [['0', '-1', '0']]]
  ]) {
    assert.equal(entry(sample, '$["Options"]').type, 'list');
    assert.equal(entry(sample, '$["Options"]').size, options.length);
    for (const [index, [slot, dialog, type]] of options.entries()) {
      const prefix = `$["Options"][${index}]`;
      fields(sample, prefix, ['Option', 'OptionSlot']);
      fields(sample, `${prefix}["Option"]`, ['Dialog', 'DialogColor', 'DialogCommand', 'OptionType', 'Title']);
      number(sample, `${prefix}["OptionSlot"]`, slot);
      number(sample, `${prefix}["Option"]["Dialog"]`, dialog);
      number(sample, `${prefix}["Option"]["OptionType"]`, type);
    }
  }
});

test('quest-start DialogQuest matches the supplied quest filename and QuestDialogs preserves Integer/Slot', () => {
  const filenameId = /^talk-quest-(\d+)\.native\.json$/.exec(quest.filename)[1];
  number(questStart, '$["DialogQuest"]', filenameId);
  number(branching, '$["DialogQuest"]', '-1');
  assert.equal(entry(quest, '$["QuestDialogs"]').type, 'list');
  assert.equal(entry(quest, '$["QuestDialogs"]').size, 1);
  fields(quest, '$["QuestDialogs"][0]', ['Integer', 'Slot']);
  number(quest, '$["QuestDialogs"][0]["Integer"]', '13');
  number(quest, '$["QuestDialogs"][0]["Slot"]', '0');
});

test('quest fields remain as observed with no invented QuestId and retained byte flags', () => {
  fields(quest, '$', [
    'CompleterNpc', 'NextQuestId', 'RandomReward', 'QuestRepeat', 'QuestCompletion',
    'Title', 'Text', 'QuestFactionPoints', 'RewardExp', 'QuestCommand', 'QuestDialogs',
    'ModRev', 'Type', 'QuestMail', 'Rewards', 'CompleteText'
  ]);
  assert.ok(quest.inventory.entries.every(item => !item.path.endsWith('["QuestId"]')));
  number(quest, '$["RandomReward"]', '0b', 'byte');
  number(quest, '$["QuestFactionPoints"]["DecreaseFaction1Points"]', '0b', 'byte');
  number(quest, '$["QuestFactionPoints"]["DecreaseFaction2Points"]', '0b', 'byte');
  number(quest, '$["Type"]', '1');
  number(quest, '$["QuestCompletion"]', '1');
  fields(quest, '$["Rewards"]', ['NpcMiscInv']);
  assert.equal(entry(quest, '$["Rewards"]["NpcMiscInv"]').type, 'list');
  assert.equal(entry(quest, '$["Rewards"]["NpcMiscInv"]').size, 0);
});

test('all native samples retain integer ModRev 18', () => {
  for (const sample of samples) number(sample, '$["ModRev"]', '18');
});

test('native narrative strings remain raw quoted tokens, including numeric-looking title', () => {
  for (const [sample, entryPath, raw] of [
    [branching, '$["DialogTitle"]', '"1"'],
    [branching, '$["DialogText"]', '"Halt! are you agressive or friendly?"'],
    [branching, '$["Options"][0]["Option"]["Title"]', '"Agressive (joke)"'],
    [branching, '$["Options"][1]["Option"]["Title"]', '"Friendly"'],
    [questStart, '$["Options"][0]["Option"]["Title"]', '"..."'],
    [quest, '$["CompleterNpc"]', '"Elder Posta"'],
    [quest, '$["CompleteText"]', '""']
  ]) {
    assert.equal(entry(sample, entryPath).type, 'quoted-string');
    assert.equal(entry(sample, entryPath).raw, raw);
    assert.ok(sample.inventory.numericFindings.every(item => item.path !== entryPath));
  }
});
