#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const QUEST_TYPES = ['item', 'dialog', 'kill', 'location', 'area-kill', 'manual'];
const QUEST_STATES = ['available', 'active', 'objectives-complete', 'finished'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validate(pack) {
  const errors = [];
  const warnings = [];
  const error = (path, message) => errors.push(`${path}: ${message}`);
  const warn = (path, message) => warnings.push(`${path}: ${message}`);
  const fields = (value, path, required, optional = []) => {
    if (!isObject(value)) { error(path, 'must be an object'); return false; }
    for (const key of required) if (!Object.hasOwn(value, key)) error(`${path}.${key}`, 'is required');
    for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) error(`${path}.${key}`, 'unknown property');
    return true;
  };
  const string = (value, path) => {
    if (typeof value !== 'string' || !value.trim()) error(path, 'must be a nonempty string');
    else if (/\uFFFD|\u00C2\u00A7|\u00C3\u00A2\u00E2/u.test(value)) warn(path, 'possible text encoding corruption; review the original text');
  };
  const key = (value, path) => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(value)) error(path, 'must be a symbolic key beginning with a lowercase letter');
  };
  const integer = (value, path, minimum) => {
    if (!Number.isSafeInteger(value) || value < minimum) error(path, `must be a safe integer >= ${minimum}`);
  };
  const array = (value, path, minimum = 0) => {
    if (!Array.isArray(value)) { error(path, 'must be an array'); return []; }
    if (value.length < minimum) error(path, `must contain at least ${minimum} record(s)`);
    return value;
  };
  const unique = (values, path, getKey = value => value) => {
    const seen = new Set();
    for (const value of values) {
      const id = getKey(value);
      if (id === undefined || id === null) continue;
      if (seen.has(id)) error(path, `duplicate value ${JSON.stringify(id)}`);
      seen.add(id);
    }
  };
  const nativeId = (record, path) => {
    if (record.nativeId !== undefined && record.nativeId !== null) integer(record.nativeId, `${path}.nativeId`, 0);
  };
  const conditions = (value, path) => {
    const entries = array(value, path);
    entries.forEach((condition, i) => {
      const at = `${path}[${i}]`;
      if (!fields(condition, at, ['quest', 'state'])) return;
      key(condition.quest, `${at}.quest`);
      if (!QUEST_STATES.includes(condition.state)) error(`${at}.state`, `must be one of ${QUEST_STATES.join(', ')}`);
    });
    unique(entries.filter(isObject), path, condition => condition.quest);
  };

  if (!fields(pack, '$', ['format', 'minecraft', 'title', 'npcs', 'dialogues', 'quests'])) return { errors, warnings, nativeImportReady: false };
  if (pack.format !== 'cnpc-story-draft/v1') error('$.format', 'must be cnpc-story-draft/v1; native imports are not supported');
  if (pack.minecraft !== '1.20.1') error('$.minecraft', 'this draft version is scoped to 1.20.1');
  string(pack.title, '$.title');
  const npcs = array(pack.npcs, '$.npcs', 1);
  const dialogues = array(pack.dialogues, '$.dialogues', 1);
  const quests = array(pack.quests, '$.quests');

  npcs.forEach((npc, i) => {
    const path = `$.npcs[${i}]`;
    if (!fields(npc, path, ['key', 'name', 'entryDialogue'])) return;
    key(npc.key, `${path}.key`); string(npc.name, `${path}.name`); key(npc.entryDialogue, `${path}.entryDialogue`);
  });
  dialogues.forEach((dialogue, i) => {
    const path = `$.dialogues[${i}]`;
    if (!fields(dialogue, path, ['key', 'category', 'title', 'speaker', 'text', 'conditions', 'choices'], ['nativeId'])) return;
    key(dialogue.key, `${path}.key`); key(dialogue.speaker, `${path}.speaker`); nativeId(dialogue, path);
    for (const field of ['category', 'title', 'text']) string(dialogue[field], `${path}.${field}`);
    conditions(dialogue.conditions, `${path}.conditions`);
    const choices = array(dialogue.choices, `${path}.choices`);
    choices.forEach((choice, j) => {
      const at = `${path}.choices[${j}]`;
      if (!fields(choice, at, ['key', 'text', 'next', 'conditions', 'actions'])) return;
      key(choice.key, `${at}.key`); string(choice.text, `${at}.text`);
      if (choice.next !== null) key(choice.next, `${at}.next`);
      conditions(choice.conditions, `${at}.conditions`);
      const actions = array(choice.actions, `${at}.actions`);
      actions.forEach((action, k) => {
        const actionPath = `${at}.actions[${k}]`;
        if (!fields(action, actionPath, ['kind', 'quest'])) return;
        if (!['start-quest', 'turn-in-quest'].includes(action.kind)) error(`${actionPath}.kind`, 'must be start-quest or turn-in-quest');
        key(action.quest, `${actionPath}.quest`);
      });
      unique(actions.filter(isObject), `${at}.actions`, action => action.quest);
    });
    unique(choices.filter(isObject), `${path}.choices`, choice => choice.key);
  });
  quests.forEach((quest, i) => {
    const path = `$.quests[${i}]`;
    if (!fields(quest, path, ['key', 'category', 'title', 'type', 'logText', 'completeText', 'objectives', 'prerequisites', 'turnIn', 'repeatable', 'rewards', 'nextQuest'], ['nativeId'])) return;
    key(quest.key, `${path}.key`); nativeId(quest, path);
    for (const field of ['category', 'title', 'logText', 'completeText']) string(quest[field], `${path}.${field}`);
    if (!QUEST_TYPES.includes(quest.type)) error(`${path}.type`, `must be one of ${QUEST_TYPES.join(', ')}`);
    if (typeof quest.repeatable !== 'boolean') error(`${path}.repeatable`, 'must be boolean');
    if (quest.nextQuest !== null) key(quest.nextQuest, `${path}.nextQuest`);
    const prerequisites = array(quest.prerequisites, `${path}.prerequisites`);
    prerequisites.forEach((value, j) => key(value, `${path}.prerequisites[${j}]`));
    unique(prerequisites, `${path}.prerequisites`);
    if (fields(quest.turnIn, `${path}.turnIn`, ['npc', 'dialogue'])) {
      key(quest.turnIn.npc, `${path}.turnIn.npc`); key(quest.turnIn.dialogue, `${path}.turnIn.dialogue`);
    }
    const objectives = array(quest.objectives, `${path}.objectives`, 1);
    objectives.forEach((objective, j) => {
      const at = `${path}.objectives[${j}]`;
      if (!fields(objective, at, ['key', 'description', 'target', 'count'])) return;
      key(objective.key, `${at}.key`); string(objective.description, `${at}.description`); string(objective.target, `${at}.target`); integer(objective.count, `${at}.count`, 1);
    });
    unique(objectives.filter(isObject), `${path}.objectives`, objective => objective.key);
    if (fields(quest.rewards, `${path}.rewards`, ['experience', 'items'])) {
      integer(quest.rewards.experience, `${path}.rewards.experience`, 0);
      array(quest.rewards.items, `${path}.rewards.items`).forEach((item, j) => {
        const at = `${path}.rewards.items[${j}]`;
        if (!fields(item, at, ['item', 'count'])) return;
        if (typeof item.item !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(item.item)) error(`${at}.item`, 'must be a namespaced registry identifier');
        integer(item.count, `${at}.count`, 1);
      });
    }
  });
  for (const [name, records] of [['npcs', npcs], ['dialogues', dialogues], ['quests', quests]]) unique(records.filter(isObject), `$.${name}`, record => record.key);
  for (const [name, records] of [['dialogues', dialogues], ['quests', quests]]) unique(records.filter(isObject), `$.${name}.nativeId`, record => record.nativeId);
  if (errors.length) return { errors, warnings, nativeImportReady: false };

  const npcMap = new Map(npcs.map(record => [record.key, record]));
  const dialogueMap = new Map(dialogues.map(record => [record.key, record]));
  const questMap = new Map(quests.map(record => [record.key, record]));
  const reference = (map, value, path) => { if (!map.has(value)) error(path, `unknown reference ${JSON.stringify(value)}`); };
  npcs.forEach(npc => {
    reference(dialogueMap, npc.entryDialogue, `npc ${npc.key}.entryDialogue`);
    if (dialogueMap.has(npc.entryDialogue) && dialogueMap.get(npc.entryDialogue).speaker !== npc.key) warn(`npc ${npc.key}`, 'entry dialogue has a different speaker');
  });
  dialogues.forEach(dialogue => {
    reference(npcMap, dialogue.speaker, `dialogue ${dialogue.key}.speaker`);
    dialogue.conditions.forEach(condition => reference(questMap, condition.quest, `dialogue ${dialogue.key}.conditions`));
    dialogue.choices.forEach(choice => {
      const path = `dialogue ${dialogue.key}, choice ${choice.key}`;
      if (choice.next !== null) reference(dialogueMap, choice.next, `${path}.next`);
      choice.conditions.forEach(condition => reference(questMap, condition.quest, `${path}.conditions`));
      choice.actions.forEach(action => {
        reference(questMap, action.quest, `${path}.actions`);
        const requiredState = action.kind === 'turn-in-quest' ? 'objectives-complete' : 'available';
        if (![...dialogue.conditions, ...choice.conditions].some(condition => condition.quest === action.quest && condition.state === requiredState)) warn(path, `${action.kind} has no ${requiredState} condition on this page/choice`);
      });
    });
  });
  quests.forEach(quest => {
    quest.prerequisites.forEach(value => reference(questMap, value, `quest ${quest.key}.prerequisites`));
    if (quest.nextQuest !== null) reference(questMap, quest.nextQuest, `quest ${quest.key}.nextQuest`);
    reference(npcMap, quest.turnIn.npc, `quest ${quest.key}.turnIn.npc`);
    reference(dialogueMap, quest.turnIn.dialogue, `quest ${quest.key}.turnIn.dialogue`);
    const turnInDialogue = dialogueMap.get(quest.turnIn.dialogue);
    if (turnInDialogue && turnInDialogue.speaker !== quest.turnIn.npc) error(`quest ${quest.key}.turnIn`, 'NPC differs from the turn-in dialogue speaker');
    const starts = dialogues.flatMap(dialogue => dialogue.choices).flatMap(choice => choice.actions).some(action => action.quest === quest.key && action.kind === 'start-quest');
    if (!starts) warn(`quest ${quest.key}`, 'no start action in this draft; document its external acceptance trigger');
    if (turnInDialogue && !turnInDialogue.choices.some(choice => choice.actions.some(action => action.quest === quest.key && action.kind === 'turn-in-quest'))) warn(`quest ${quest.key}`, 'turn-in page has no matching turn-in action; document the external turn-in trigger');
  });
  if (errors.length) return { errors, warnings, nativeImportReady: false };

  const reachable = new Set();
  const pending = npcs.map(npc => npc.entryDialogue);
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const choice of dialogueMap.get(id).choices) if (choice.next !== null) pending.push(choice.next);
  }
  for (const dialogue of dialogues) if (!reachable.has(dialogue.key)) warn(`dialogue ${dialogue.key}`, 'unreachable from NPC entry points');
  const canExit = new Set(dialogues.filter(dialogue => !dialogue.choices.length || dialogue.choices.some(choice => choice.next === null)).map(dialogue => dialogue.key));
  let changed = true;
  while (changed) {
    changed = false;
    for (const dialogue of dialogues) if (!canExit.has(dialogue.key) && dialogue.choices.some(choice => canExit.has(choice.next))) { canExit.add(dialogue.key); changed = true; }
  }
  for (const dialogue of dialogues) if (!canExit.has(dialogue.key)) error(`dialogue ${dialogue.key}`, 'has no structural path to an exit');
  function checkCycles(getNext, report, label) {
    const done = new Set();
    const visiting = new Set();
    function visit(id, trail) {
      if (visiting.has(id)) { report(`quest ${id}`, `${label} cycle: ${[...trail, id].join(' -> ')}`); return; }
      if (done.has(id)) return;
      visiting.add(id);
      for (const next of getNext(questMap.get(id))) visit(next, [...trail, id]);
      visiting.delete(id); done.add(id);
    }
    for (const quest of quests) visit(quest.key, []);
  }
  checkCycles(quest => quest.prerequisites, error, 'prerequisite');
  checkCycles(quest => quest.nextQuest === null ? [] : [quest.nextQuest], warn, 'nextQuest');
  return { errors, warnings, nativeImportReady: false };
}

function render(pack) {
  const result = validate(pack);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  const out = [];
  const safe = value => String(value).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
  const line = value => out.push(value);
  const conditionText = conditions => conditions.length ? conditions.map(condition => `${safe(condition.quest)} is ${safe(condition.state)}`).join(' AND ') : 'none';
  line(`# ${safe(pack.title)}\n`);
  line('Authoring blueprint for Minecraft 1.20.1. This is not a native CustomNPCs import.\n');
  for (const npc of pack.npcs) line(`- NPC ${safe(npc.name)} (${safe(npc.key)}): entry ${safe(npc.entryDialogue)}`);
  line('\n## Dialogues\n');
  for (const dialogue of pack.dialogues) {
    line(`### ${safe(dialogue.title)} (${safe(dialogue.key)})\n`);
    line(`Speaker: ${safe(dialogue.speaker)}. Category: ${safe(dialogue.category)}. Native ID: ${dialogue.nativeId ?? 'unassigned'}.\n`);
    line(`Page conditions: ${conditionText(dialogue.conditions)}.\n`);
    line(`${safe(dialogue.text)}\n`);
    if (!dialogue.choices.length) line('Terminal page; confirm native close behavior.\n');
    for (const choice of dialogue.choices) {
      line(`- ${safe(choice.text)} -> ${choice.next === null ? 'close' : safe(choice.next)}. Conditions: ${conditionText(choice.conditions)}. Actions: ${choice.actions.length ? choice.actions.map(action => `${safe(action.kind)} ${safe(action.quest)}`).join(', ') : 'none'}.`);
    }
    line('');
  }
  line('## Quests\n');
  if (!pack.quests.length) line('No quests in this draft.\n');
  for (const quest of pack.quests) {
    line(`### ${safe(quest.title)} (${safe(quest.key)})\n`);
    line(`Category: ${safe(quest.category)}. Native ID: ${quest.nativeId ?? 'unassigned'}. Type intent: ${safe(quest.type)} (${QUEST_TYPES.indexOf(quest.type)} in the supplied API constants). Repeatable intent: ${quest.repeatable}.\n`);
    line(`Journal: ${safe(quest.logText)}\n`);
    line(`Completion: ${safe(quest.completeText)}\n`);
    line(`Prerequisites: ${quest.prerequisites.length ? quest.prerequisites.map(safe).join(', ') : 'none'}. Next quest: ${quest.nextQuest === null ? 'none' : safe(quest.nextQuest)}.\n`);
    for (const objective of quest.objectives) line(`- Objective ${safe(objective.key)}: ${safe(objective.description)} Target: ${safe(objective.target)}; count: ${objective.count}.`);
    line(`\nTurn-in: ${safe(quest.turnIn.npc)}, dialogue ${safe(quest.turnIn.dialogue)}.\n`);
    line(`Reward intent: ${quest.rewards.experience} experience; ${quest.rewards.items.length ? quest.rewards.items.map(item => `${item.count} x ${safe(item.item)}`).join(', ') : 'no items'}.\n`);
  }
  line('## Native setup still required\n');
  line('- Resolve actual categories and record IDs; preserve supplied IDs.');
  line('- Configure dialogue option labels, target links, availability, and quest acceptance/turn-in behavior using verified native settings or requested scripts.');
  line('- Configure objective data, turn-in checks, item consumption, reward payout, and repeatability; these draft fields are not native tags.');
  line('- Play through acceptance, refusal, progress, turn-in, and repeated interaction in the target build. Static validation does not prove runtime behavior.\n');
  line('## Validation\n');
  line(`${result.errors.length} errors; ${result.warnings.length} warnings. Native import ready: false.\n`);
  for (const warning of result.warnings) line(`- ${safe(warning)}`);
  return `${out.join('\n')}\n`;
}

if (require.main === module) {
  const [command, filename, ...extra] = process.argv.slice(2);
  if (!['validate', 'render'].includes(command) || !filename || extra.length) {
    console.error('Usage: node story-pack.cjs validate|render <draft.story.json>');
    process.exitCode = 2;
  } else {
    try {
      const pack = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
      const result = validate(pack);
      if (command === 'validate' || result.errors.length) console.log(JSON.stringify(result, null, 2));
      else process.stdout.write(render(pack));
      if (result.errors.length) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { validate, render };
