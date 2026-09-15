#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const NOTICE = 'Read-only lexical SNBT inventory. Parser acceptance is not native-import validation. No field semantics are inferred; numeric ranges and list type compatibility are not validated. Raw tokens are never repaired or normalized.';
const USAGE = `Usage: node snbt-inventory.cjs <input-file>\n\n${NOTICE}\nReads one UTF-8 text file and prints JSON to stdout; never writes files.\nSupports compounds, lists, typed arrays [B;...]/[I;...]/[L;...], quoted\nstrings/keys, and unquoted tokens using letters, digits, _, -, +, or .\nQuoted strings permit escaping their delimiter or a backslash only.\nCustom indexed lists such as [0:{...}] are unsupported and rejected.\nPaths use JSON-quoted bracket keys; start/end are UTF-16 offsets (end exclusive).\n`;

function numericType(raw) {
  if (/^[+-]?\d+[bB]$/.test(raw)) return 'byte';
  if (/^[+-]?\d+[sS]$/.test(raw)) return 'short';
  if (/^[+-]?\d+[lL]$/.test(raw)) return 'long';
  const decimal = '[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?';
  if (new RegExp(`^${decimal}[fF]$`).test(raw)) return 'float';
  if (new RegExp(`^${decimal}[dD]$`).test(raw)) return 'double';
  if (/^[+-]?\d+$/.test(raw)) return 'int';
  if (new RegExp(`^${decimal}$`).test(raw)) return 'double';
  return null;
}

class SnbtSyntaxError extends SyntaxError {
  constructor(message, text, offset) {
    const before = text.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    super(`${message} at line ${line}, column ${column} (offset ${offset})`);
    this.name = 'SnbtSyntaxError';
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

function inventorySnbt(source) {
  if (typeof source !== 'string') throw new TypeError('SNBT input must be a string');
  let pos = 0;
  const entries = [];
  const numericFindings = [];
  const fail = (message, offset = pos) => { throw new SnbtSyntaxError(message, source, offset); };
  const whitespace = () => {
    while (pos < source.length && /[ \t\r\n]/.test(source[pos])) pos++;
  };
  const peek = () => source[pos];
  const expect = (character) => {
    whitespace();
    if (peek() !== character) fail(`Expected ${JSON.stringify(character)}, found ${pos === source.length ? 'end of input' : JSON.stringify(peek())}`);
    pos++;
  };
  const quoted = () => {
    const delimiter = source[pos++];
    let decoded = '';
    while (pos < source.length) {
      const character = source[pos++];
      if (character === delimiter) return decoded;
      if (character === '\\') {
        if (pos === source.length) fail('Unterminated quoted escape');
        const escaped = source[pos++];
        if (escaped !== delimiter && escaped !== '\\') fail(`Unsupported quoted escape \\${escaped}; only the quote delimiter and backslash may be escaped`, pos - 2);
        decoded += escaped;
      } else {
        decoded += character;
      }
    }
    fail('Unterminated quoted string');
  };
  const bare = () => {
    const start = pos;
    while (pos < source.length && /[A-Za-z0-9_.+-]/.test(source[pos])) pos++;
    if (start === pos) fail('Expected a quoted string or an unquoted SNBT token');
    return source.slice(start, pos);
  };
  const key = () => {
    whitespace();
    return peek() === '"' || peek() === "'" ? quoted() : bare();
  };

  function value(path, depth) {
    whitespace();
    if (depth > 256) fail('Unsupported nesting depth: maximum is 256');
    if (pos === source.length) fail('Expected an SNBT value, found end of input');
    const entry = { path, type: '', start: pos, end: null };
    entries.push(entry);
    if (peek() === '{') {
      entry.type = 'compound';
      entry.size = 0;
      pos++;
      whitespace();
      while (peek() !== '}') {
        if (pos === source.length) fail('Unterminated compound; expected "}"');
        const field = key();
        expect(':');
        value(`${path}[${JSON.stringify(field)}]`, depth + 1);
        entry.size++;
        whitespace();
        if (peek() === '}') break;
        expect(',');
        whitespace();
      }
      expect('}');
    } else if (peek() === '[') {
      entry.type = 'list';
      entry.size = 0;
      pos++;
      whitespace();
      const marker = /^([A-Za-z]+)\s*;/.exec(source.slice(pos));
      if (marker) {
        if (!['B', 'I', 'L'].includes(marker[1])) fail(`Unsupported typed-array marker ${JSON.stringify(marker[1])}; expected B, I, or L`);
        entry.type = 'typed-array';
        entry.elementType = { B: 'byte', I: 'int', L: 'long' }[marker[1]];
        pos += marker[0].length;
        whitespace();
      }
      while (peek() !== ']') {
        if (pos === source.length) fail('Unterminated list or typed array; expected "]"');
        const child = value(`${path}[${entry.size}]`, depth + 1);
        whitespace();
        if (peek() === ':') fail('Unsupported custom indexed-list syntax (for example [0:{...}]); input was not modified');
        if (entry.elementType && (child.type !== 'number' || child.numericType !== entry.elementType)) {
          fail(`Typed array requires ${entry.elementType} numeric tokens`, child.start);
        }
        entry.size++;
        if (peek() === ']') break;
        expect(',');
        whitespace();
      }
      expect(']');
    } else if (peek() === '"' || peek() === "'") {
      entry.type = 'quoted-string';
      quoted();
      entry.raw = source.slice(entry.start, pos);
    } else {
      entry.raw = bare();
      const type = numericType(entry.raw);
      entry.type = type ? 'number' : 'unquoted-token';
      if (type) entry.numericType = type;
    }
    entry.end = pos;
    if (entry.type === 'number') numericFindings.push({ ...entry });
    return entry;
  }

  value('$', 0);
  whitespace();
  if (pos !== source.length) fail(`Unexpected trailing input beginning ${JSON.stringify(peek())}`);
  return {
    format: 'lexical-snbt-inventory/v1',
    notice: NOTICE,
    nativeImportValidated: false,
    fieldSemanticsInferred: false,
    entries,
    numericFindings
  };
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.length !== 1 || args[0].startsWith('--')) {
    process.stderr.write(USAGE);
    return 2;
  }
  try {
    const bytes = fs.readFileSync(args[0]);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const inventory = inventorySnbt(text);
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`SNBT inventory failed: ${error.message}\nNo inventory was produced; no file was modified.\n`);
    return 1;
  }
}

module.exports = { inventorySnbt, SnbtSyntaxError };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
