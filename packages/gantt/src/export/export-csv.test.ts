/**
 * jsdom unit tests for the task-grid CSV export — RFC-4180 quoting, hierarchy
 * indentation, delimiter/eol/bom options, and the CSV/formula-injection guard.
 */
import { describe, it, expect } from 'vitest';
import {
  escapeCsvField,
  sanitizeCsvField,
  tableToCsv,
  tasksToCsv,
} from './export-csv.js';
import type { ExportTable } from './serialize.js';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';

const DELIM = ',';

describe('escapeCsvField (RFC 4180)', () => {
  it('leaves a plain field untouched', () => {
    expect(escapeCsvField('Design', DELIM)).toBe('Design');
  });

  it('quotes + doubles embedded quotes', () => {
    expect(escapeCsvField('a "b" c', DELIM)).toBe('"a ""b"" c"');
  });

  it('quotes a field containing the delimiter, CR or LF', () => {
    expect(escapeCsvField('a,b', DELIM)).toBe('"a,b"');
    expect(escapeCsvField('a\nb', DELIM)).toBe('"a\nb"');
    expect(escapeCsvField('a\rb', DELIM)).toBe('"a\rb"');
  });

  it('honors a custom delimiter (European Excel ";")', () => {
    expect(escapeCsvField('a;b', ';')).toBe('"a;b"');
    expect(escapeCsvField('a;b', DELIM)).toBe('a;b'); // not the delimiter here
  });
});

describe('sanitizeCsvField (CSV/formula-injection guard)', () => {
  it('prefixes a leading formula trigger with an apostrophe', () => {
    expect(sanitizeCsvField('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvField('+1')).toBe("'+1");
    expect(sanitizeCsvField('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeCsvField('\t=cmd')).toBe("'\t=cmd");
    expect(sanitizeCsvField('\rx')).toBe("'\rx");
  });

  it('leaves safe fields (and interior triggers) unchanged', () => {
    expect(sanitizeCsvField('Design')).toBe('Design');
    expect(sanitizeCsvField('Task = done')).toBe('Task = done'); // trigger not leading
    expect(sanitizeCsvField('')).toBe('');
    expect(sanitizeCsvField('100%')).toBe('100%');
  });

  it('the classic DDE payload is neutralized', () => {
    expect(sanitizeCsvField(`=cmd|'/c calc'!A1`)).toBe(`'=cmd|'/c calc'!A1`);
  });
});

describe('escapeCsvField integrates the injection guard', () => {
  it('defuses a formula AND still RFC-quotes when needed', () => {
    // Leading "=" → apostrophe-prefixed; comma present → quoted too.
    expect(escapeCsvField('=A1,B1', DELIM)).toBe(`"'=A1,B1"`);
  });

  it('defuses a bare formula with no structural chars (no quoting)', () => {
    expect(escapeCsvField('=HYPERLINK("http://x")', DELIM)).toBe(
      `"'=HYPERLINK(""http://x"")"`,
    );
    expect(escapeCsvField('@danger', DELIM)).toBe("'@danger");
  });
});

function table(): ExportTable {
  return {
    columns: [
      { field: 'name', header: 'Name', type: 'text' },
      { field: 'wbs', header: 'WBS', type: 'text' },
    ],
    rows: [
      {
        id: 't1',
        depth: 0,
        wbs: '1',
        summary: true,
        cells: [
          { kind: 'text', value: 'Phase 1' },
          { kind: 'text', value: '1' },
        ],
      },
      {
        id: 't2',
        depth: 1,
        wbs: '1.1',
        summary: false,
        cells: [
          { kind: 'text', value: '=cmd|calc' }, // user-controlled, injection attempt
          { kind: 'text', value: '1.1' },
        ],
      },
    ],
  };
}

describe('tableToCsv', () => {
  it('emits a header row + indented hierarchy + BOM by default', () => {
    const csv = tableToCsv(table());
    expect(csv.startsWith('﻿')).toBe(true);
    const body = csv.slice(1);
    const lines = body.split('\r\n');
    expect(lines[0]).toBe('Name,WBS');
    expect(lines[1]).toBe('Phase 1,1');
    // Child name is indented two spaces per depth AND the leading "=" is defused
    // (apostrophe prefix). The apostrophe sits before the indent's effect: the
    // sanitizer runs on the already-indented text, so a leading space is safe and
    // no apostrophe is added (the value no longer STARTS with "=").
    expect(lines[2]).toBe('  =cmd|calc,1.1');
  });

  it('defuses an injection payload that is the literal first char of the cell', () => {
    const t = table();
    t.rows[1]!.depth = 0; // no indent → "=" is the leading char
    const csv = tableToCsv(t, { bom: false, indent: '' });
    const lines = csv.split('\r\n');
    expect(lines[2]).toBe(`'=cmd|calc,1.1`);
  });

  it('supports a custom delimiter + eol + no BOM', () => {
    const csv = tableToCsv(table(), { delimiter: ';', eol: '\n', bom: false });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Name;WBS');
  });
});

describe('tasksToCsv (end-to-end via the tree serializer)', () => {
  function source(roots: Array<TaskModel & { children?: TaskModel[] }>): TaskTreeSource {
    return {
      items: roots,
      getChildren: (n) =>
        (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
    };
  }

  it('serializes user-controlled task names safely (no live formula leaks)', () => {
    const csv = tasksToCsv(
      source([
        { id: 1, name: '=HYPERLINK("http://evil","click")' } as TaskModel,
        { id: 2, name: 'Normal task' } as TaskModel,
      ]),
      { bom: false, columns: [{ field: 'name', header: 'Name' }] },
    );
    const lines = csv.split('\r\n');
    expect(lines[1]!.startsWith(`"'=HYPERLINK`)).toBe(true);
    expect(lines[2]).toBe('Normal task');
  });
});
