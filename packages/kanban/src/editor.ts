/**
 * Card editor — a modal editing surface for a kanban card.
 *
 * Reuses the @jects/widgets `Window` as the modal shell (backdrop + focus trap
 * + Escape), and renders a small token-styled form inside its body. On Save the
 * collected `Partial<KanbanCard>` is handed back to the board, which writes it
 * to the Store and emits `cardEdit`.
 *
 * The form is built from plain inputs (not the widgets `Form` class) to keep the
 * editor self-contained and resilient while the widgets package evolves; it
 * still lives visually inside the reused Window chrome.
 */

import { createEl, type RecordId } from '@jects/core';
import { Window } from '@jects/widgets';

import { escapeHtml } from './card.js';
import type {
  CardAttachment,
  CardComment,
  CardTag,
  CardVotes,
  KanbanCard,
  TaskBoard,
} from './types.js';

type Commit = (changes: Partial<KanbanCard>) => void;

/**
 * Open the editor for `card`. Calls `commit` with the changed fields on Save.
 * Returns the Window instance (already shown, modal).
 */
export function openCardEditor(board: TaskBoard, card: KanbanCard, commit: Commit): Window {
  const win = new Window(document.body, {
    title: card.title ? `Edit: ${card.title}` : 'Edit card',
    modal: true,
    width: 460,
    height: 620,
    maximizable: false,
    label: 'Edit card',
  });

  const body = win.el.querySelector<HTMLElement>('.jects-window__body');
  const formHost = body ?? win.el;
  formHost.classList.add('jects-kanban-editor__host');

  const form = createEl('form', { className: 'jects-kanban-editor' });
  form.setAttribute('novalidate', '');

  const titleInput = field(form, 'Title', 'text', String(card.title ?? ''));
  const descInput = areaField(form, 'Description', String(card.description ?? ''));
  const tagsInput = field(
    form,
    'Tags (comma separated)',
    'text',
    (card.tags ?? []).map((t) => t.text).join(', '),
  );
  const progressInput = field(
    form,
    'Progress (0–100)',
    'number',
    card.progress != null ? String(card.progress) : '',
  );
  progressInput.min = '0';
  progressInput.max = '100';
  const avatarInput = field(form, 'Avatar (URL or initials)', 'text', String(card.avatar ?? ''));
  const coverInput = field(form, 'Cover image URL', 'text', String(card.cover ?? ''));
  const assigneeInput = field(form, 'Assignee', 'text', String(card.assignee ?? ''));
  const dueInput = field(form, 'Due (date)', 'text', String(card.due ?? ''));
  const linksInput = field(
    form,
    'Links (comma-separated card ids)',
    'text',
    (card.links ?? []).map((id) => String(id)).join(', '),
  );
  // Attachments: one `name|url` per line.
  const attachmentsInput = areaField(
    form,
    'Attachments (one per line: name|url)',
    (card.attachments ?? []).map((a) => `${a.name}${a.url ? `|${a.url}` : ''}`).join('\n'),
  );
  // Comments: one `author|text` per line.
  const commentsInput = areaField(
    form,
    'Comments (one per line: author|text)',
    (card.comments ?? []).map((c) => `${c.author}|${c.text}`).join('\n'),
  );
  const votesInput = field(
    form,
    'Votes',
    'number',
    card.votes != null ? String(card.votes.count) : '',
  );
  votesInput.min = '0';

  const actions = createEl('div', { className: 'jects-kanban-editor__actions' });
  const cancelBtn = createEl('button', {
    className: 'jects-kanban-editor__btn jects-kanban-editor__btn--cancel',
    attrs: { type: 'button' },
  });
  cancelBtn.textContent = 'Cancel';
  const saveBtn = createEl('button', {
    className: 'jects-kanban-editor__btn jects-kanban-editor__btn--save',
    attrs: { type: 'submit' },
  });
  saveBtn.textContent = 'Save';
  actions.append(cancelBtn, saveBtn);
  form.appendChild(actions);

  formHost.appendChild(form);

  const close = (): void => {
    if (!win.isDestroyed) win.destroy();
  };

  cancelBtn.addEventListener('click', close);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const changes: Partial<KanbanCard> = {};
    const newTitle = titleInput.value;
    if (newTitle !== String(card.title ?? '')) changes.title = newTitle;

    const newDesc = descInput.value;
    if (newDesc !== String(card.description ?? '')) changes.description = newDesc;

    const newTags = parseTags(tagsInput.value);
    if (!sameTags(newTags, card.tags)) changes.tags = newTags;

    const rawProg = progressInput.value.trim();
    const newProg = rawProg === '' ? undefined : clampNum(Number(rawProg), 0, 100);
    if (newProg !== card.progress) changes.progress = newProg;

    const newAvatar = avatarInput.value.trim();
    if (newAvatar !== String(card.avatar ?? '')) changes.avatar = newAvatar || undefined;

    const newCover = coverInput.value.trim();
    if (newCover !== String(card.cover ?? '')) changes.cover = newCover || undefined;

    const newAssignee = assigneeInput.value.trim();
    if (newAssignee !== String(card.assignee ?? '')) changes.assignee = newAssignee || undefined;

    const newDue = dueInput.value.trim();
    if (newDue !== String(card.due ?? '')) changes.due = newDue || undefined;

    const newLinks = parseLinks(linksInput.value);
    if (!sameLinks(newLinks, card.links)) changes.links = newLinks;

    const newAttachments = parseAttachments(attachmentsInput.value);
    if (!sameAttachments(newAttachments, card.attachments)) changes.attachments = newAttachments;

    const newComments = parseComments(commentsInput.value);
    if (!sameComments(newComments, card.comments)) changes.comments = newComments;

    const rawVotes = votesInput.value.trim();
    let newVotes: CardVotes | undefined;
    if (rawVotes !== '') {
      newVotes = { count: clampNum(Number(rawVotes), 0, Number.MAX_SAFE_INTEGER) };
      if (card.votes?.voted) newVotes.voted = true;
    }
    if (!sameVotes(newVotes, card.votes)) changes.votes = newVotes;

    if (Object.keys(changes).length > 0) commit(changes);
    close();
  });

  // Focus the first field once shown.
  titleInput.focus();
  void board; // board kept in signature for future hooks / event context
  return win;
}

function field(
  form: HTMLElement,
  label: string,
  type: string,
  value: string,
): HTMLInputElement {
  const wrap = createEl('label', { className: 'jects-kanban-editor__field' });
  wrap.innerHTML = `<span class="jects-kanban-editor__label">${escapeHtml(label)}</span>`;
  const input = createEl('input', {
    className: 'jects-kanban-editor__input',
    attrs: { type },
  }) as HTMLInputElement;
  input.value = value;
  wrap.appendChild(input);
  form.appendChild(wrap);
  return input;
}

function areaField(form: HTMLElement, label: string, value: string): HTMLTextAreaElement {
  const wrap = createEl('label', { className: 'jects-kanban-editor__field' });
  wrap.innerHTML = `<span class="jects-kanban-editor__label">${escapeHtml(label)}</span>`;
  const area = createEl('textarea', {
    className: 'jects-kanban-editor__input jects-kanban-editor__textarea',
    attrs: { rows: '3' },
  }) as HTMLTextAreaElement;
  area.value = value;
  wrap.appendChild(area);
  form.appendChild(wrap);
  return area;
}

function parseTags(raw: string): CardTag[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text, i) => ({ text, color: (i % 8) + 1 }));
}

function sameTags(a: CardTag[], b: CardTag[] | undefined): boolean {
  const bb = b ?? [];
  if (a.length !== bb.length) return false;
  return a.every((t, i) => t.text === bb[i]?.text);
}

function clampNum(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return n < min ? min : n > max ? max : n;
}

function parseLinks(raw: string): RecordId[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function sameLinks(a: RecordId[], b: RecordId[] | undefined): boolean {
  const bb = b ?? [];
  if (a.length !== bb.length) return false;
  return a.every((id, i) => String(id) === String(bb[i]));
}

function parseAttachments(raw: string): CardAttachment[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, url] = line.split('|').map((s) => s.trim());
      const out: CardAttachment = { name: name ?? line };
      if (url) out.url = url;
      return out;
    });
}

function sameAttachments(a: CardAttachment[], b: CardAttachment[] | undefined): boolean {
  const bb = b ?? [];
  if (a.length !== bb.length) return false;
  return a.every((x, i) => x.name === bb[i]?.name && (x.url ?? '') === (bb[i]?.url ?? ''));
}

function parseComments(raw: string): CardComment[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('|');
      if (idx < 0) return { author: 'Anonymous', text: line };
      return { author: line.slice(0, idx).trim() || 'Anonymous', text: line.slice(idx + 1).trim() };
    });
}

function sameComments(a: CardComment[], b: CardComment[] | undefined): boolean {
  const bb = b ?? [];
  if (a.length !== bb.length) return false;
  return a.every((x, i) => x.author === bb[i]?.author && x.text === bb[i]?.text);
}

function sameVotes(a: CardVotes | undefined, b: CardVotes | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.count === b.count && !!a.voted === !!b.voted;
}
