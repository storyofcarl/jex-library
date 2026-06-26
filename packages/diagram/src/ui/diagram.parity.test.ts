/**
 * Parity tests for the seven audited @jects/diagram gaps:
 *   1. Undo / redo history
 *   2. The live editor wired to the strong engine routing + layout
 *   3. Swimlane editor + API (add / update / remove + lane clamp)
 *   4. Groups (group / move-children / ungroup)
 *   5. Custom + HTML + image shape rendering
 *   6. Properties-panel styling (fill / stroke / arrowheads → model + render)
 *   7. Public surface re-exports
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Diagram } from './diagram.js';
import { PropertiesPanel } from './properties-panel.js';
import { renderShape, type RenderState } from './renderer.js';

/**
 * jsdom has no `PointerEvent`; the widget listens for pointer events. Build a
 * `MouseEvent`-backed stand-in carrying the pointer fields the handlers read
 * (`button`, `clientX/Y`, `pointerId`). `setPointerCapture` is also absent, so
 * guard that in callers (the widget uses optional chaining already).
 */
function pointer(type: string, init: Record<string, number> = {}): Event {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  return e;
}
import type {
  ConnectorModel,
  ShapeDefinition,
  ShapeModel,
  SwimlaneModel,
} from '../contract.js';
// Gap 7: these symbols must be reachable from the PACKAGE ROOT.
import {
  OrthogonalRouter,
  RadialLayout,
  builtinRouters,
  builtinLayouts,
  alignShapes,
  laneOf,
  clampToLane,
} from '../index.js';

function shape(id: string, x = 0, y = 0, over: Partial<ShapeModel> = {}): ShapeModel {
  return { id, type: 'rect', x, y, w: 100, h: 60, text: id, ...over };
}

function baseState(over: Partial<RenderState> = {}): RenderState {
  return {
    selection: new Set(),
    view: { zoom: 1, panX: 0, panY: 0 },
    grid: true,
    snap: 0,
    editable: true,
    marquee: null,
    snapLines: [],
    pendingConnector: null,
    dimmed: new Set(),
    ...over,
  };
}

describe('@jects/diagram parity', () => {
  let host: HTMLElement;
  let d: Diagram;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (d && !d.isDestroyed) d.destroy();
    host.remove();
  });

  /* ── Gap 1: undo / redo ─────────────────────────────────────────────── */

  describe('undo / redo', () => {
    it('undo restores a mutation and redo reapplies it', () => {
      d = new Diagram(host, { shapes: [shape('a')] });
      expect(d.canUndo()).toBe(false);

      d.updateShape('a', { text: 'changed' });
      expect(d.engine.getShape('a')!.text).toBe('changed');
      expect(d.canUndo()).toBe(true);

      d.undo();
      expect(d.engine.getShape('a')!.text).toBe('a');
      expect(d.canRedo()).toBe(true);

      d.redo();
      expect(d.engine.getShape('a')!.text).toBe('changed');
    });

    it('undo removes an added shape; redo re-adds it', () => {
      d = new Diagram(host);
      d.addShape(shape('a'));
      expect(d.engine.getShape('a')).toBeDefined();
      d.undo();
      expect(d.engine.getShape('a')).toBeUndefined();
      d.redo();
      expect(d.engine.getShape('a')).toBeDefined();
    });

    it('a new edit forks history (clears the redo stack)', () => {
      d = new Diagram(host, { shapes: [shape('a')] });
      d.updateShape('a', { text: 'one' });
      d.undo();
      expect(d.canRedo()).toBe(true);
      d.updateShape('a', { text: 'two' });
      expect(d.canRedo()).toBe(false);
      expect(d.engine.getShape('a')!.text).toBe('two');
    });

    it('coalesces a pointer drag gesture into a single undo entry', () => {
      d = new Diagram(host, { shapes: [shape('a', 0, 0)] });
      const svg = d.el.querySelector('svg.jects-diagram__svg') as SVGSVGElement;
      const x0 = d.engine.getShape('a')!.x;
      // One drag = pointerdown + several pointermoves + pointerup.
      svg.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
      window.dispatchEvent(pointer('pointermove', { clientX: 20, clientY: 10 }));
      window.dispatchEvent(pointer('pointermove', { clientX: 30, clientY: 10 }));
      window.dispatchEvent(pointer('pointermove', { clientX: 40, clientY: 10 }));
      window.dispatchEvent(pointer('pointerup', { clientX: 40, clientY: 10 }));
      expect(d.engine.getShape('a')!.x).toBeGreaterThan(x0);
      // A SINGLE undo reverts the whole gesture (not one undo per pointermove).
      d.undo();
      expect(d.engine.getShape('a')!.x).toBe(x0);
      expect(d.canUndo()).toBe(false);
    });

    it('Ctrl+Z / Ctrl+Y keyboard shortcuts drive undo/redo', () => {
      d = new Diagram(host, { shapes: [shape('a')] });
      d.updateShape('a', { text: 'kb' });
      const canvas = d.el.querySelector('.jects-diagram__canvas') as HTMLElement;
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
      expect(d.engine.getShape('a')!.text).toBe('a');
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
      );
      expect(d.engine.getShape('a')!.text).toBe('kb');
    });
  });

  /* ── Gap 2: strong engine wired into the live editor ────────────────── */

  describe('strong routing + layout in the live editor', () => {
    it('orthogonal connector routes AROUND an obstacle shape', () => {
      // a → c straight line would pass through b; the A* router must detour.
      d = new Diagram(host, {
        shapes: [
          shape('a', 0, 100, { w: 80, h: 60, ports: [] }),
          shape('b', 200, 90, { w: 120, h: 90, ports: [] }),
          shape('c', 420, 100, { w: 80, h: 60, ports: [] }),
        ],
      });
      const conn = d.addConnector({
        id: 'ac',
        from: { shape: 'a' },
        to: { shape: 'c' },
        kind: 'orthogonal',
      });
      const route = d.route(conn.id);
      // A naive midline route is exactly 4 points; an obstacle-avoiding A* path
      // produces extra bends. Assert it detours (more than a trivial elbow) and
      // that no interior waypoint lands inside the obstacle's box.
      expect(route.points.length).toBeGreaterThan(2);
      const bx0 = 200;
      const bx1 = 320;
      const by0 = 90;
      const by1 = 180;
      for (const p of route.points) {
        const inside = p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1;
        expect(inside).toBe(false);
      }
    });

    it('orthogonal auto-layout produces a tidy tree (children below parent)', () => {
      d = new Diagram(host);
      d.addShape(shape('root'));
      d.addShape(shape('l'));
      d.addShape(shape('r'));
      d.addConnector({ id: 'c1', from: { shape: 'root' }, to: { shape: 'l' }, kind: 'straight' });
      d.addConnector({ id: 'c2', from: { shape: 'root' }, to: { shape: 'r' }, kind: 'straight' });
      d.autoLayout('orthogonal');
      const root = d.engine.getShape('root')!;
      const l = d.engine.getShape('l')!;
      const r = d.engine.getShape('r')!;
      // Children are one rank below the root and on opposite sides of it (tidy).
      expect(l.y).toBeGreaterThan(root.y);
      expect(r.y).toBeGreaterThan(root.y);
      expect(l.x).not.toBe(r.x);
    });

    it('radial layout places the hub and spokes at distinct positions', () => {
      d = new Diagram(host, { mode: 'mindmap' });
      d.addShape(shape('hub'));
      d.addShape(shape('s1'));
      d.addShape(shape('s2'));
      d.addConnector({ id: 'c1', from: { shape: 'hub' }, to: { shape: 's1' }, kind: 'straight' });
      d.addConnector({ id: 'c2', from: { shape: 'hub' }, to: { shape: 's2' }, kind: 'straight' });
      d.autoLayout('radial');
      const s1 = d.engine.getShape('s1')!;
      const s2 = d.engine.getShape('s2')!;
      expect(s1.x !== s2.x || s1.y !== s2.y).toBe(true);
    });
  });

  /* ── Gap 3: swimlane editor + API ───────────────────────────────────── */

  describe('swimlanes', () => {
    it('addSwimlane / updateSwimlane / removeSwimlane drive the engine', () => {
      d = new Diagram(host);
      const lane: SwimlaneModel = {
        id: 'lane1',
        title: 'Lane',
        orientation: 'vertical',
        x: 0,
        y: 0,
        w: 200,
        h: 400,
      };
      d.addSwimlane(lane);
      expect(d.engine.swimlanes.getById('lane1')).toBeDefined();
      d.updateSwimlane('lane1', { title: 'Renamed' });
      expect(d.engine.swimlanes.getById('lane1')!.title).toBe('Renamed');
      d.removeSwimlane('lane1');
      expect(d.engine.swimlanes.getById('lane1')).toBeUndefined();
    });

    it('a shape moved out of its lane is clamped back inside', () => {
      d = new Diagram(host, { shapes: [shape('a', 20, 20, { w: 60, h: 40 })] });
      d.addSwimlane({
        id: 'lane1',
        orientation: 'vertical',
        x: 0,
        y: 0,
        w: 200,
        h: 300,
      });
      // Nudge the shape far past the lane's right edge; clamp must pull it back.
      d.select('a');
      const canvas = d.el.querySelector('.jects-diagram__canvas') as HTMLElement;
      for (let i = 0; i < 40; i++) {
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
        );
      }
      const a = d.engine.getShape('a')!;
      // Stays within the lane box (x + w <= lane right edge, with pad).
      expect(a.x + a.w).toBeLessThanOrEqual(200);
      expect(a.lane).toBe('lane1');
    });

    it('the toolbar lane tool adds a lane', () => {
      d = new Diagram(host);
      const before = d.engine.swimlanes.toArray().length;
      const tb = d.el.querySelector('.jects-diagram__toolbar');
      expect(tb).toBeTruthy();
      // Drive the action directly through the public flow used by the toolbar.
      // (The Toolbar wires button id 'lane' → addLaneFromToolbar.)
      // Find the button labelled "Add lane" and click it.
      const btns = Array.from(tb!.querySelectorAll('button'));
      const laneBtn = btns.find((b) => /add lane/i.test(b.textContent ?? ''));
      expect(laneBtn).toBeTruthy();
      laneBtn!.click();
      expect(d.engine.swimlanes.toArray().length).toBe(before + 1);
    });
  });

  /* ── Gap 4: groups ──────────────────────────────────────────────────── */

  describe('groups', () => {
    it('group → dragging the group moves its children → ungroup detaches', () => {
      d = new Diagram(host, {
        shapes: [shape('a', 0, 0), shape('b', 200, 0)],
      });
      const groupId = d.group(['a', 'b']);
      expect(groupId).toBeDefined();
      expect(d.engine.getShape('a')!.parent).toBe(groupId);
      expect(d.engine.getShape('b')!.parent).toBe(groupId);

      // Drag the group: pointerdown inside the group box selects + arms the move,
      // pointermove applies the delta to the group AND its children.
      const svg = d.el.querySelector('svg.jects-diagram__svg') as SVGSVGElement;
      const ax0 = d.engine.getShape('a')!.x;
      const bx0 = d.engine.getShape('b')!.x;
      svg.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
      window.dispatchEvent(pointer('pointermove', { clientX: 50, clientY: 10 }));
      window.dispatchEvent(pointer('pointerup', { clientX: 50, clientY: 10 }));
      // Both children shifted right by the drag delta (≈40).
      expect(d.engine.getShape('a')!.x).toBeGreaterThan(ax0);
      expect(d.engine.getShape('b')!.x).toBeGreaterThan(bx0);
      expect(d.engine.getShape('a')!.x - ax0).toBeCloseTo(d.engine.getShape('b')!.x - bx0, 5);

      const freed = d.ungroup(groupId!);
      expect(freed.sort()).toEqual(['a', 'b']);
      expect(d.engine.getShape('a')!.parent).toBeUndefined();
      expect(d.engine.getShape(groupId!)).toBeUndefined();
    });

    it('removing a group cascades to its children', () => {
      d = new Diagram(host, { shapes: [shape('a'), shape('b', 200)] });
      const groupId = d.group(['a', 'b'])!;
      d.remove(groupId);
      expect(d.engine.getShape('a')).toBeUndefined();
      expect(d.engine.getShape('b')).toBeUndefined();
      expect(d.engine.getShape(groupId)).toBeUndefined();
    });

    it('group() needs at least two shapes', () => {
      d = new Diagram(host, { shapes: [shape('a')] });
      expect(d.group(['a'])).toBeUndefined();
    });
  });

  /* ── Gap 5: custom + HTML + image shape rendering ───────────────────── */

  describe('shape rendering', () => {
    it('renders a custom shape via its ShapeDefinition outline', () => {
      const def: ShapeDefinition = {
        key: 'chevron',
        defaultSize: { width: 100, height: 60 },
        outline: (s) => `M 0 0 L ${s.width} 0 L ${s.width} ${s.height} Z`,
      };
      const s = shape('cs', 10, 10, { type: 'custom', shapeDef: 'chevron' });
      const g = renderShape(
        s,
        baseState({ resolveShapeDef: (k) => (k === 'chevron' ? def : undefined) }),
      );
      const path = g.querySelector('path.jects-diagram__shape-body');
      expect(path).toBeTruthy();
      // Body is the definition outline placed at the shape origin.
      expect(path!.getAttribute('d')).toContain('M 0 0 L 100 0');
      expect(path!.getAttribute('transform')).toContain('translate(10 10)');
    });

    it('renders an HTML shape via <foreignObject>', () => {
      const s = shape('html', 0, 0, {
        type: 'custom',
        data: { html: '<b>Hi</b>' },
      });
      const g = renderShape(s, baseState());
      const fo = g.querySelector('foreignObject');
      expect(fo).toBeTruthy();
      expect(fo!.querySelector('.jects-diagram__html-body')!.innerHTML).toContain('<b>Hi</b>');
    });

    it('renders an image shape via <image href>', () => {
      const href = 'data:image/png;base64,AAAA';
      const s = shape('img', 0, 0, { type: 'image', data: { href } });
      const g = renderShape(s, baseState());
      const img = g.querySelector('image');
      expect(img).toBeTruthy();
      expect(img!.getAttribute('href')).toBe(href);
    });

    it('falls back to a rect for an image shape without an href', () => {
      const s = shape('img2', 0, 0, { type: 'image' });
      const g = renderShape(s, baseState());
      expect(g.querySelector('image')).toBeFalsy();
      expect(g.querySelector('rect.jects-diagram__shape-body')).toBeTruthy();
    });
  });

  /* ── Gap 6: properties-panel styling ────────────────────────────────── */

  describe('properties panel styling', () => {
    it('renders fill / stroke / strokeWidth / textColor / fontSize controls', () => {
      d = new Diagram(host, { shapes: [shape('a')] });
      d.select('a');
      const labels = Array.from(
        d.el.querySelectorAll('.jects-diagram-props__label'),
      ).map((n) => n.textContent);
      expect(labels).toEqual(
        expect.arrayContaining(['Fill', 'Stroke', 'Stroke width', 'Text color', 'Font size']),
      );
    });

    it('changing fill via the panel updates the shape model + rendered fill', () => {
      // Drive the panel in isolation: render it against a shape, open the Fill
      // listbox (the @jects/widgets Select is a custom combobox, not a native
      // <select>), and click the "Primary" option.
      const panelHost = document.createElement('div');
      document.body.appendChild(panelHost);
      const s = shape('a');
      let lastPatch: Partial<ShapeModel> | null = null;
      const panel = new PropertiesPanel(panelHost, {
        target: { kind: 'shape', model: s },
        onShapeChange: (_id, patch) => {
          lastPatch = patch;
        },
      });
      // The Fill control is the first Select in the panel body. Open it.
      const trigger = panelHost.querySelector(
        '.jects-select [role="combobox"], .jects-select button[role="combobox"], .jects-select button',
      ) as HTMLButtonElement | null;
      expect(trigger).toBeTruthy();
      trigger!.click();
      // Click the "primary" option (option rows carry data-value).
      const opt = document.querySelector(
        '[role="option"][data-value="primary"]',
      ) as HTMLElement | null;
      expect(opt).toBeTruthy();
      opt!.click();
      expect(lastPatch).toBeTruthy();
      expect((lastPatch as unknown as Partial<ShapeModel>).style?.fill).toBe('primary');
      panel.destroy();
      panelHost.remove();

      // And the rendered body reflects a primary fill token.
      const styled = shape('a', 0, 0, { style: { fill: 'primary' } });
      const g = renderShape(styled, baseState());
      const body = g.querySelector('.jects-diagram__shape-body') as SVGElement;
      expect(body.style.getPropertyValue('--_fill')).toContain('--jects-primary');
    });

    it('exposes arrowhead selects for a connector', () => {
      d = new Diagram(host);
      d.addShape(shape('a'));
      d.addShape(shape('b', 300));
      d.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'straight' });
      d.select('c');
      const labels = Array.from(
        d.el.querySelectorAll('.jects-diagram-props__label'),
      ).map((n) => n.textContent);
      expect(labels).toEqual(expect.arrayContaining(['Start arrow', 'End arrow']));
    });
  });

  /* ── Gap 7: public surface ──────────────────────────────────────────── */

  describe('public surface re-exports', () => {
    it('exposes engine routers, layouts, swimlane + align helpers at the root', () => {
      expect(typeof OrthogonalRouter).toBe('function');
      expect(typeof RadialLayout).toBe('function');
      expect(builtinRouters().length).toBeGreaterThan(0);
      expect(builtinLayouts().length).toBeGreaterThan(0);
      expect(typeof alignShapes).toBe('function');
      expect(typeof laneOf).toBe('function');
      expect(typeof clampToLane).toBe('function');
    });

    it('the re-exported OrthogonalRouter actually routes', () => {
      const router = new OrthogonalRouter();
      const from = shape('a', 0, 0);
      const to = shape('b', 300, 0);
      const conn: ConnectorModel = {
        id: 'c',
        from: { shape: 'a' },
        to: { shape: 'b' },
        kind: 'orthogonal',
      };
      const r = router.route(conn, from, to, [from, to]);
      expect(r.points.length).toBeGreaterThanOrEqual(2);
    });
  });
});
