'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { inventorySnbt, SnbtSyntaxError } = require('./snbt-inventory.cjs');

test('nested compound/list paths are unambiguous and quoted keys are decoded', () => {
  const result = inventorySnbt('{quest:{steps:[{title:"Hi",amount:3},{title:"Bye"}]},"a.b[0]":{"x\\\"y":4}}');
  assert.deepEqual(result.entries.map(entry => entry.path), [
    '$', '$["quest"]', '$["quest"]["steps"]', '$["quest"]["steps"][0]',
    '$["quest"]["steps"][0]["title"]', '$["quest"]["steps"][0]["amount"]',
    '$["quest"]["steps"][1]', '$["quest"]["steps"][1]["title"]',
    '$["a.b[0]"]', '$["a.b[0]"]["x\\\"y"]'
  ]);
  assert.equal(result.entries[2].size, 2);
});

test('all numeric suffixes and exact original spelling are retained', () => {
  const values = ['-1b', '+2B', '3s', '-4S', '5L', '+6l', '1.25f', '-.5F', '2e+3d', '4.D', '7', '-8.0', '1e9'];
  const result = inventorySnbt(`[${values.join(',')}]`);
  assert.deepEqual(result.numericFindings.map(entry => entry.raw), values);
  assert.deepEqual(result.numericFindings.map(entry => entry.numericType), [
    'byte', 'byte', 'short', 'short', 'long', 'long', 'float', 'float', 'double', 'double', 'int', 'double', 'double'
  ]);
});

test('numeric-looking quoted strings and quoted keys are not numeric findings', () => {
  const result = inventorySnbt('{"7L":"123b",a:\'456L\',b:"1.2f",c:9s}');
  assert.deepEqual(result.numericFindings.map(entry => entry.raw), ['9s']);
  assert.deepEqual(result.entries.filter(entry => entry.type === 'quoted-string').map(entry => entry.raw), ['"123b"', "'456L'", '"1.2f"']);
});

test('typed byte/int/long arrays preserve types, paths, and empty arrays', () => {
  const result = inventorySnbt('{bytes:[B;1b,-2B],ints:[I;+3,-4],longs:[L;5L,-6l],empty:[B;]}');
  assert.deepEqual(result.entries.filter(entry => entry.type === 'typed-array').map(entry => [entry.elementType, entry.size]), [
    ['byte', 2], ['int', 2], ['long', 2], ['byte', 0]
  ]);
  assert.equal(result.numericFindings[5].path, '$["longs"][1]');
  for (const invalid of ['[B;1]', '[I;1L]', '[L;"1L"]', '[B;{}]', '[X;1]', '[b;1b]']) {
    assert.throws(() => inventorySnbt(invalid), SnbtSyntaxError, invalid);
  }
});

test('large longs remain lossless raw strings through JSON output', () => {
  const raw = ['9223372036854775807L', '-9223372036854775808L', '9007199254740993L', '999999999999999999999999999999L'];
  const result = JSON.parse(JSON.stringify(inventorySnbt(`[L;${raw.join(',')}]`)));
  assert.deepEqual(result.numericFindings.map(entry => entry.raw), raw);
  assert.ok(result.numericFindings.every(entry => typeof entry.raw === 'string' && !Object.hasOwn(entry, 'value')));
  assert.match(result.notice, /numeric ranges.*not validated/);
});

test('unknown fields and opaque tokens are inventoried without semantic guesses', () => {
  const result = inventorySnbt('{UndocumentedTag:some_unknown-value,FutureEnum:987Q,flag:true,nan:NaN}');
  assert.deepEqual(result.entries.slice(1).map(entry => [entry.type, entry.raw]), [
    ['unquoted-token', 'some_unknown-value'], ['unquoted-token', '987Q'],
    ['unquoted-token', 'true'], ['unquoted-token', 'NaN']
  ]);
  assert.equal(result.numericFindings.length, 0);
  assert.equal(result.fieldSemanticsInferred, false);
  assert.equal(result.nativeImportValidated, false);
  assert.match(result.notice, /acceptance is not native-import validation/);
});

test('source spans and duplicate keys preserve every observed scalar', () => {
  const source = '{ a: 01b, a: "two", \'single\': \'it\\\'s here\' }';
  const result = inventorySnbt(source);
  assert.equal(result.entries[0].size, 3);
  assert.deepEqual(result.entries.slice(1, 3).map(entry => entry.path), ['$["a"]', '$["a"]']);
  for (const entry of result.entries.filter(entry => Object.hasOwn(entry, 'raw'))) {
    assert.equal(source.slice(entry.start, entry.end), entry.raw);
  }
});

test('empty structures, scalar roots, whitespace, and SNBT trailing commas work', () => {
  for (const source of ['{}', '[]', '[I;]', '{a:{},b:[],}', '[1,2,]', '\n 1b \t', '"text"']) {
    assert.ok(inventorySnbt(source).entries.length > 0, source);
  }
});

test('malformed input and unsupported quoting dialects fail without partial results', () => {
  const invalid = ['', ' ', '{', '[', '{a}', '{a:}', '{a:1 b:2}', '{a:1,,b:2}', '[1,,2]', '[1 2]',
    '{a:1} garbage', '{a:"unterminated}', '{a:"bad\\n"}', '{a:"bad\\u1234"}', '{a:minecraft:stone}', '{a:1 // comment\n}', '\uFEFF{}'];
  for (const source of invalid) assert.throws(() => inventorySnbt(source), SnbtSyntaxError, source);
  assert.throws(() => inventorySnbt(null), TypeError);
  assert.throws(() => inventorySnbt('{\n a: }'), error => error.line === 2 && error.column === 5);
});

test('custom indexed-list syntax is rejected explicitly, including nested use', () => {
  for (const source of ['[0:{a:1}]', '{x:[0:{a:1},1:{b:2}]}', '["0":{}]']) {
    assert.throws(() => inventorySnbt(source), /Unsupported custom indexed-list syntax/, source);
  }
});

test('excessive nesting fails with an intentional diagnostic', () => {
  assert.throws(() => inventorySnbt('['.repeat(258) + ']'.repeat(258)), /Unsupported nesting depth/);
});

test('CLI reads one file, emits inventory, leaves bytes unchanged, and reports failures', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snbt-inventory-test-'));
  const input = path.join(directory, 'input.snbt');
  t.after(() => {
    if (fs.existsSync(input)) fs.unlinkSync(input);
    fs.rmdirSync(directory);
  });
  const cli = path.join(__dirname, 'snbt-inventory.cjs');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const original = Buffer.from('{x:9223372036854775807L,text:"123b"}\n', 'utf8');
  fs.writeFileSync(input, original);
  const success = run(input);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, '');
  assert.equal(JSON.parse(success.stdout).numericFindings[0].raw, '9223372036854775807L');
  assert.deepEqual(fs.readFileSync(input), original);
  assert.deepEqual(fs.readdirSync(directory), ['input.snbt']);
  const malformed = Buffer.from('[0:{}]');
  fs.writeFileSync(input, malformed);
  const failure = run(input);
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /Unsupported custom indexed-list syntax/);
  assert.deepEqual(fs.readFileSync(input), malformed);
  fs.writeFileSync(input, Buffer.from([0xff]));
  assert.equal(run(input).status, 1, 'Invalid UTF-8 must not be silently replaced');
  assert.equal(run(path.join(directory, 'missing.snbt')).status, 1);
  assert.equal(run().status, 2);
  assert.equal(run(input, input).status, 2);
  assert.match(run('--help').stdout, /not native-import validation/);
});
