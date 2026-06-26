/** Route: diagram. */
import { el, card } from '../shell/dom.js';
import { proofPanel } from '../shell/proof-card.js';
import { enterpriseSwap } from '../shell/enterprise.js';
import { genDiagramGraph } from '../shell/data.js';
import { section, Button, Diagram, documentToJson, downloadBlob } from '../shell/registry.js';

export function register() {
  section(
    'diagram',
    'Diagram',
    'A no-code diagram editor — flowchart/org/mind/PERT modes, custom/HTML/image shapes, orthogonal A* routing, auto-layout, swimlanes, groups, a properties panel, undo/redo and export.',
    (grid) => {
      grid.appendChild(el('p', { class: 'g-lede', style: 'margin-top:0',
        text: 'Scenario: a no-code process map — drop shapes, let connectors auto-route, auto-layout the graph, then export it.' }));
      grid.appendChild(proofPanel({ title: 'Diagram — at a glance', items: [
        ['Modes', 'flowchart · org · mind · PERT'],
        ['Shapes', 'built-in · custom · HTML · image'],
        ['Routing', 'orthogonal A* connectors'],
        ['Layout', 'auto-layout + swimlanes + groups'],
        ['Export', 'JSON · PNG · PDF'],
      ] }));

      grid.appendChild(card('Diagram (full editor)', (h) => {
        const warn = (label, e) => console.warn('DIAGRAM-DEMO feature failed:', label, e && e.message);

        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        h.appendChild(bar);

        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);

        const imgHref =
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'>" +
            "<rect width='120' height='80' rx='8' fill='%2306b6d4'/>" +
            "<circle cx='60' cy='34' r='18' fill='white'/>" +
            "<rect x='30' y='56' width='60' height='10' rx='5' fill='white'/></svg>",
          );

        const diagram = new Diagram(host, {
          mode: 'flowchart',
          editable: true,
          grid: true,
          snap: 8,
          selectionMode: 'multi',
          shapes: [
            { id: 'start', type: 'start', x: 180, y: 20, w: 140, h: 56, text: 'Start', lane: 'lane-intake' },
            { id: 'input', type: 'data', x: 180, y: 120, w: 140, h: 60, text: 'Get request', lane: 'lane-intake' },
            { id: 'check', type: 'decision', x: 170, y: 230, w: 160, h: 90, text: 'Valid?', lane: 'lane-process' },
            { id: 'ok', type: 'process', x: 40, y: 370, w: 150, h: 60, text: 'Process order', lane: 'lane-process' },
            { id: 'err', type: 'process', x: 330, y: 370, w: 150, h: 60, text: 'Reject', lane: 'lane-process' },
            { id: 'end', type: 'end', x: 180, y: 470, w: 140, h: 56, text: 'Done', lane: 'lane-process' },
            {
              id: 'note', type: 'rect', x: 540, y: 30, w: 220, h: 96,
              data: { html: "<div style='font:13px system-ui;padding:8px;color:#0f172a'><b>SLA note</b><br/>Reject after 3 retries. Editable HTML body.</div>" },
            },
            { id: 'logo', type: 'image', x: 580, y: 150, w: 120, h: 80, data: { href: imgHref } },
          ],
          connectors: [
            { id: 'c1', from: { shape: 'start' }, to: { shape: 'input' }, kind: 'orthogonal', arrows: { end: 'arrow' } },
            { id: 'c2', from: { shape: 'input' }, to: { shape: 'check' }, kind: 'orthogonal' },
            { id: 'c3', from: { shape: 'check' }, to: { shape: 'ok' }, kind: 'orthogonal', label: 'Yes' },
            { id: 'c4', from: { shape: 'check' }, to: { shape: 'err' }, kind: 'orthogonal', label: 'No' },
            { id: 'c5', from: { shape: 'ok' }, to: { shape: 'end' }, kind: 'orthogonal' },
          ],
          swimlanes: [
            { id: 'lane-intake', title: 'Intake', orientation: 'horizontal', x: 0, y: 0, w: 520, h: 200, order: 0 },
            { id: 'lane-process', title: 'Processing', orientation: 'horizontal', x: 0, y: 200, w: 520, h: 360, order: 1 },
          ],
        });

        try {
          diagram.engine.registerShape({
            key: 'badge',
            defaultSize: { width: 120, height: 80 },
            defaultStyle: { fill: 'primary', stroke: 'border', strokeWidth: 2 },
            outline: ({ width: w, height: hh }) =>
              `M ${w * 0.5} 0 L ${w} ${hh * 0.3} L ${w} ${hh * 0.75} ` +
              `L ${w * 0.5} ${hh} L 0 ${hh * 0.75} L 0 ${hh * 0.3} Z`,
          });
          diagram.addShape({
            id: 'badge1', type: 'custom', shapeDef: 'badge',
            x: 560, y: 270, w: 120, h: 80, text: 'Custom',
            style: { fill: 'accent', stroke: 'border', strokeWidth: 2, textColor: 'accent-foreground' },
          });
        } catch (e) { warn('registerShape', e); }

        const tb = (text, onClick, variant = 'secondary') => {
          const b = new Button(bar, { text, variant, size: 'sm' });
          b.el.addEventListener('click', (ev) => { try { onClick(ev); } catch (e) { warn(text, e); } });
          return b;
        };

        const undoBtn = tb('Undo', () => { diagram.undo(); sync(); }, 'ghost');
        const redoBtn = tb('Redo', () => { diagram.redo(); sync(); }, 'ghost');
        function sync() {
          try {
            undoBtn.el.disabled = !diagram.canUndo();
            redoBtn.el.disabled = !diagram.canRedo();
          } catch (e) { warn('sync', e); }
        }

        const modes = ['flowchart', 'orgchart', 'mindmap', 'pert'];
        let modeIx = 0;
        tb('Mode: flowchart', (ev) => {
          modeIx = (modeIx + 1) % modes.length;
          diagram.setMode(modes[modeIx]);
          ev.currentTarget && (ev.currentTarget.textContent = 'Mode: ' + modes[modeIx]);
          sync();
        }, 'outline');

        let layoutRadial = false;
        tb('Auto-layout', () => {
          diagram.autoLayout(layoutRadial ? 'radial' : 'orthogonal', { nodeSpacing: 40, rankSpacing: 80, direction: 'down' });
          layoutRadial = !layoutRadial;
          diagram.fitToView();
          sync();
        }, 'outline');

        let laneN = 3;
        tb('Add lane', () => {
          diagram.addSwimlane({
            id: 'lane-' + laneN, title: 'Lane ' + laneN, orientation: 'vertical',
            x: 540 + (laneN - 3) * 240, y: 270, w: 220, h: 240, order: laneN,
          });
          laneN += 1;
          sync();
        }, 'outline');

        let groupId = null;
        tb('Group', () => {
          diagram.select(['ok', 'err']);
          groupId = diagram.group(['ok', 'err']) || null;
          sync();
        }, 'outline');
        tb('Ungroup', () => {
          if (groupId) { diagram.ungroup(groupId); groupId = null; }
          sync();
        }, 'outline');

        tb('Recolor', () => {
          const sel = diagram.getSelection();
          const ids = sel.length ? sel : ['check'];
          for (const id of ids) {
            diagram.updateShape(id, { style: { fill: 'accent', stroke: 'primary', strokeWidth: 3, textColor: 'accent-foreground', fontSize: 14 } });
          }
          sync();
        }, 'outline');

        tb('Fit', () => { diagram.fitToView(); }, 'ghost');

        tb('Export JSON', () => {
          const json = documentToJson(diagram.toJSON());
          try { downloadBlob(json, 'diagram.json', 'application/json'); } catch (e) { warn('downloadBlob', e); }
          console.info('DIAGRAM-DEMO export bytes:', json.length);
        }, 'ghost');

        enterpriseSwap(bar, host, {
          key: 'diagram',
          count: '200 nodes (auto-layout)',
          build: (bigHost) => {
            const g = genDiagramGraph(200);
            const big = new Diagram(bigHost, {
              mode: 'flowchart',
              editable: true,
              grid: true,
              snap: 8,
              shapes: g.shapes,
              connectors: g.connectors,
            });
            try { big.autoLayout('orthogonal', { nodeSpacing: 40, rankSpacing: 80, direction: 'down' }); } catch (_) {}
            try { big.fitToView(); } catch (_) {}
          },
        });

        try { diagram.on('change', sync); } catch (e) { warn('on change', e); }
        try { diagram.on('select', sync); } catch (e) { warn('on select', e); }
        sync();

        h.appendChild(el('div', { class: 'g-note', text: 'A full no-code editor: drag shapes, draw connectors from edges, and pick from the left rail. The toolbar above drives undo/redo, mode switching (flowchart/org/mind/PERT), A*-routed auto-layout (orthogonal + radial), swimlanes, grouping, property styling, and JSON export. The built-in toolbar adds align/distribute, copy/apply style, and PNG/PDF export. Includes an HTML body, an image node, and a registered custom shape.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
