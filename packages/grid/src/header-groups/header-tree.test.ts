import { describe, it, expect } from 'vitest';
import {
  resolveHeaderTree,
  pathsFromGroups,
  hasHeaderGroups,
  type HeaderGroup,
  type LeafColumnInput,
  type GroupedColumnDef,
} from './header-tree.js';

/** Build leaf inputs from compact column defs (index = array position). */
function leaves(defs: GroupedColumnDef[]): LeafColumnInput[] {
  return defs.map((def, index) => {
    const input: LeafColumnInput = {
      id: def.id ?? def.field ?? `col-${index}`,
      index,
      def,
    };
    if (def.frozen) input.frozen = def.frozen;
    return input;
  });
}

/** Flatten a band's level matrix to `label×colSpan@depth` tokens for assertions. */
function tokens(cells: { label: string; colSpan: number; depth: number }[]): string[] {
  return cells.map((c) => `${c.label}×${c.colSpan}@${c.depth}`);
}

describe('header-tree: hasHeaderGroups', () => {
  it('is false for a flat column set', () => {
    expect(hasHeaderGroups(leaves([{ field: 'a' }, { field: 'b' }]))).toBe(false);
  });
  it('is true when a column carries a group', () => {
    expect(hasHeaderGroups(leaves([{ field: 'a', group: 'G' }]))).toBe(true);
  });
  it('is true when an explicit headerGroups tree is supplied', () => {
    expect(hasHeaderGroups(leaves([{ field: 'a' }]), [{ header: 'G', children: [{ columnId: 'a' }] }])).toBe(
      true,
    );
  });
});

describe('header-tree: resolveHeaderTree via column.group / groupPath', () => {
  it('flat columns → single leaf row, no spanning', () => {
    const tree = resolveHeaderTree(leaves([{ field: 'a' }, { field: 'b' }]));
    expect(tree.levelCount).toBe(1);
    expect(tree.bands.center[0]!.every((c) => c.isLeaf)).toBe(true);
    expect(tree.bands.center[0]!.map((c) => c.colSpan)).toEqual([1, 1]);
  });

  it('one group level spans contiguous leaves that share the group', () => {
    const tree = resolveHeaderTree(
      leaves([
        { field: 'first', group: 'Name' },
        { field: 'last', group: 'Name' },
        { field: 'age' },
      ]),
    );
    expect(tree.levelCount).toBe(2);
    // Top row: a "Name" group spanning 2 leaves (cols 0..1).
    const top = tree.bands.center[0]!;
    expect(tokens(top)).toContain('Name×2@0');
    const nameCell = top.find((c) => c.label === 'Name')!;
    expect(nameCell.colSpan).toBe(2);
    expect(nameCell.leafStart).toBe(0);
    expect(nameCell.leafEnd).toBe(1);
    expect(nameCell.isLeaf).toBe(false);

    // Ungrouped "age" leaf is promoted to the top row with rowSpan = 2.
    const ageCell = tree.cells.find((c) => c.id === 'age')!;
    expect(ageCell.depth).toBe(0);
    expect(ageCell.rowSpan).toBe(2);
    expect(ageCell.isLeaf).toBe(true);

    // Bottom row: the two leaf headers under "Name".
    const bottom = tree.bands.center[1]!;
    expect(bottom.map((c) => c.id).sort()).toEqual(['first', 'last']);
    expect(bottom.every((c) => c.depth === 1 && c.colSpan === 1)).toBe(true);
  });

  it('does NOT merge equal labels that are not contiguous', () => {
    const tree = resolveHeaderTree(
      leaves([
        { field: 'a', group: 'X' },
        { field: 'b', group: 'Y' },
        { field: 'c', group: 'X' },
      ]),
    );
    const top = tree.bands.center[0]!;
    const xCells = top.filter((c) => c.label === 'X');
    // Two separate "X" groups (cols 0 and 2) — not one span across the gap.
    expect(xCells).toHaveLength(2);
    expect(xCells.every((c) => c.colSpan === 1)).toBe(true);
  });

  it('multi-level groupPath nests and spans correctly', () => {
    const tree = resolveHeaderTree(
      leaves([
        { field: 'q1', groupPath: ['2024', 'H1'] },
        { field: 'q2', groupPath: ['2024', 'H1'] },
        { field: 'q3', groupPath: ['2024', 'H2'] },
        { field: 'q4', groupPath: ['2024', 'H2'] },
      ]),
    );
    expect(tree.levelCount).toBe(3);
    // Level 0: one "2024" spanning all 4 leaves.
    const l0 = tree.bands.center[0]!;
    expect(l0).toHaveLength(1);
    expect(l0[0]!.label).toBe('2024');
    expect(l0[0]!.colSpan).toBe(4);
    // Level 1: H1 (2) and H2 (2).
    const l1 = tree.bands.center[1]!;
    expect(tokens(l1).sort()).toEqual(['H1×2@1', 'H2×2@1']);
    // Level 2: four leaf cells, colSpan 1 each.
    const l2 = tree.bands.center[2]!;
    expect(l2).toHaveLength(4);
    expect(l2.every((c) => c.colSpan === 1 && c.isLeaf)).toBe(true);
  });

  it('rowSpans a leaf shallower than the deepest group level', () => {
    const tree = resolveHeaderTree(
      leaves([
        { field: 'q1', groupPath: ['2024', 'H1'] },
        { field: 'total', groupPath: ['2024'] }, // one level shallower
      ]),
    );
    expect(tree.levelCount).toBe(3);
    const totalCell = tree.cells.find((c) => c.id === 'total')!;
    // "total" sits at depth 1 (under 2024) and spans the remaining 2 rows.
    expect(totalCell.depth).toBe(1);
    expect(totalCell.rowSpan).toBe(2);
  });
});

describe('header-tree: frozen-band awareness', () => {
  it('splits a group that straddles two bands into one cell per band', () => {
    // Same group label "G" across a frozen-left and a center column must NOT
    // produce a single spanning cell (it would cross the band boundary).
    const tree = resolveHeaderTree(
      leaves([
        { field: 'a', frozen: 'left', group: 'G' },
        { field: 'b', group: 'G' },
      ]),
    );
    const leftGroup = tree.bands.left[0]!.filter((c) => !c.isLeaf);
    const centerGroup = tree.bands.center[0]!.filter((c) => !c.isLeaf);
    expect(leftGroup).toHaveLength(1);
    expect(centerGroup).toHaveLength(1);
    expect(leftGroup[0]!.colSpan).toBe(1);
    expect(centerGroup[0]!.colSpan).toBe(1);
    expect(leftGroup[0]!.band).toBe('left');
    expect(centerGroup[0]!.band).toBe('center');
  });

  it('keeps a group contiguous within a single band', () => {
    const tree = resolveHeaderTree(
      leaves([
        { field: 'a', frozen: 'left', group: 'G' },
        { field: 'b', frozen: 'left', group: 'G' },
        { field: 'c' },
      ]),
    );
    const leftGroup = tree.bands.left[0]!.filter((c) => !c.isLeaf);
    expect(leftGroup).toHaveLength(1);
    expect(leftGroup[0]!.colSpan).toBe(2);
  });
});

describe('header-tree: explicit headerGroups tree', () => {
  const cols = leaves([{ field: 'a' }, { field: 'b' }, { field: 'c' }]);
  const groups: HeaderGroup[] = [
    {
      header: 'AB',
      children: [{ columnId: 'a' }, { columnId: 'b' }],
    },
    { columnId: 'c' },
  ];

  it('pathsFromGroups maps each referenced leaf to its ancestor path', () => {
    const map = pathsFromGroups(groups, new Set(['a', 'b', 'c']));
    expect(map.get('a')!.path).toEqual(['AB']);
    expect(map.get('b')!.path).toEqual(['AB']);
    // "c" is a bare leaf reference → empty path.
    expect(map.get('c')!.path).toEqual([]);
  });

  it('throws on a reference to an unknown column', () => {
    expect(() => pathsFromGroups([{ columnId: 'zzz' }], new Set(['a']))).toThrow(/unknown column/);
  });

  it('resolves the tree with the explicit groups (overriding column.group)', () => {
    const tree = resolveHeaderTree(cols, groups);
    expect(tree.levelCount).toBe(2);
    const ab = tree.cells.find((c) => c.label === 'AB' && !c.isLeaf)!;
    expect(ab.colSpan).toBe(2);
    expect(ab.columnIds).toEqual(['a', 'b']);
    const c = tree.cells.find((x) => x.id === 'c')!;
    expect(c.rowSpan).toBe(2); // promoted to fill both rows
    expect(c.isLeaf).toBe(true);
  });

  it('explicit groups take precedence over per-column group hints', () => {
    const hinted = leaves([
      { field: 'a', group: 'IGNORED' },
      { field: 'b', group: 'IGNORED' },
      { field: 'c' },
    ]);
    const tree = resolveHeaderTree(hinted, groups);
    expect(tree.cells.some((c) => c.label === 'IGNORED')).toBe(false);
    expect(tree.cells.some((c) => c.label === 'AB')).toBe(true);
  });
});
