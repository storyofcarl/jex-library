/**
 * Card rendering helpers for the TaskBoard.
 *
 * Cards are rendered as light-DOM HTML strings into the board's column body.
 * The default template covers title / description / tags / avatar / progress;
 * `bodyItems` append custom content; a board-level `cardRenderer` overrides the
 * whole body. All user text is HTML-escaped.
 */

import type {
  CardAttachment,
  CardComment,
  CardRenderer,
  CardTag,
  CardVotes,
  KanbanCard,
} from './types.js';
import { escape as escapeCore, sanitizeHtml } from '@jects/core';
import type { RecordId } from '@jects/core';

/**
 * Escape text for safe interpolation into innerHTML.
 *
 * Thin coercing wrapper over the shared `escape` from `@jects/core` (the single
 * canonical escaper, per docs/SECURITY.md §1) — accepts any value, stringifies
 * nullish to `''`, then delegates so we keep no second escaping implementation.
 */
export function escapeHtml(s: unknown): string {
  return escapeCore(String(s ?? ''));
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** Map a 1..8 categorical color index onto a `--jects-data-N` token (wraps). */
function dataToken(color: number | undefined): string {
  if (color == null) return '';
  const n = ((Math.trunc(color) - 1) % 8 + 8) % 8 + 1;
  return `oklch(var(--jects-data-${n}))`;
}

function renderTags(tags: CardTag[] | undefined): string {
  if (!tags || tags.length === 0) return '';
  const chips = tags
    .map((t) => {
      const tok = dataToken(t.color);
      const style = tok ? ` style="--_kb-tag: ${tok}"` : '';
      return `<span class="jects-kanban-card__tag"${style}>${escapeHtml(t.text)}</span>`;
    })
    .join('');
  return `<div class="jects-kanban-card__tags">${chips}</div>`;
}

function renderAvatar(avatar: string | undefined): string {
  if (!avatar) return '';
  const isUrl = /^(https?:|data:|\/|\.\/)/.test(avatar);
  if (isUrl) {
    return `<span class="jects-kanban-card__avatar"><img src="${escapeHtml(avatar)}" alt="" class="jects-kanban-card__avatar-img" /></span>`;
  }
  // Treat as initials.
  const initials = avatar.trim().slice(0, 2).toUpperCase();
  return `<span class="jects-kanban-card__avatar jects-kanban-card__avatar--initials" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

function renderProgress(progress: number | undefined): string {
  if (progress == null) return '';
  const pct = clamp(Math.round(progress), 0, 100);
  return (
    `<div class="jects-kanban-card__progress" role="progressbar" aria-label="Progress" ` +
    `aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">` +
    `<div class="jects-kanban-card__progress-bar" style="width:${pct}%"></div>` +
    `</div>`
  );
}

function renderBodyItems(card: KanbanCard): string {
  const items = card.bodyItems;
  if (!items || items.length === 0) return '';
  const html = items
    .map((it) => {
      const cls = it.cls ? ` ${escapeHtml(it.cls)}` : '';
      // Rich `html` body items are routed through the shared allow-list
      // sanitizer (docs/SECURITY.md §2); plain `text` is escaped.
      const inner = it.html != null ? sanitizeHtml(it.html) : escapeHtml(it.text);
      return `<div class="jects-kanban-card__body-item${cls}">${inner}</div>`;
    })
    .join('');
  return `<div class="jects-kanban-card__items">${html}</div>`;
}

/** Render a cover-image banner shown at the top of the card. */
function renderCover(cover: string | undefined): string {
  if (!cover) return '';
  return (
    `<div class="jects-kanban-card__cover">` +
    `<img src="${escapeHtml(cover)}" alt="" class="jects-kanban-card__cover-img" />` +
    `</div>`
  );
}

/** Render link chips for related-card ids. */
function renderLinks(links: RecordId[] | undefined): string {
  if (!links || links.length === 0) return '';
  const chips = links
    .map(
      (id) =>
        `<span class="jects-kanban-card__link" data-link="${escapeHtml(String(id))}">🔗 ${escapeHtml(String(id))}</span>`,
    )
    .join('');
  return `<div class="jects-kanban-card__links">${chips}</div>`;
}

/**
 * Render the meta row of count badges: attachments / comments / votes. The vote
 * badge is a real toggle button (`data-vote`) the board wires to `toggleVote`.
 */
function renderMeta(
  card: KanbanCard,
  attachments: CardAttachment[] | undefined,
  comments: CardComment[] | undefined,
  votes: CardVotes | undefined,
): string {
  const badges: string[] = [];
  if (attachments && attachments.length > 0) {
    badges.push(
      `<span class="jects-kanban-card__meta-badge jects-kanban-card__attachments" aria-label="${attachments.length} attachments">📎 ${attachments.length}</span>`,
    );
  }
  if (comments && comments.length > 0) {
    badges.push(
      `<span class="jects-kanban-card__meta-badge jects-kanban-card__comments" aria-label="${comments.length} comments">💬 ${comments.length}</span>`,
    );
  }
  if (votes) {
    const pressed = votes.voted ? 'true' : 'false';
    const onCls = votes.voted ? ' jects-kanban-card__votes--on' : '';
    badges.push(
      `<button type="button" class="jects-kanban-card__meta-badge jects-kanban-card__votes${onCls}" ` +
        `data-vote="${escapeHtml(String(card.id))}" aria-pressed="${pressed}" ` +
        `aria-label="${votes.count} votes">👍 ${votes.count}</button>`,
    );
  }
  if (badges.length === 0) return '';
  return `<div class="jects-kanban-card__meta">${badges.join('')}</div>`;
}

/** Render the inner HTML for a card body (template or custom renderer). */
export function renderCardBody(card: KanbanCard, custom?: CardRenderer): string {
  if (custom) return custom(card);

  const headParts: string[] = [];
  if (card.title != null && card.title !== '') {
    headParts.push(`<div class="jects-kanban-card__title">${escapeHtml(card.title)}</div>`);
  }
  const avatar = renderAvatar(card.avatar);

  const head =
    headParts.length || avatar
      ? `<div class="jects-kanban-card__head">` +
        `<div class="jects-kanban-card__head-main">${headParts.join('')}</div>` +
        avatar +
        `</div>`
      : '';

  const desc =
    card.description != null && card.description !== ''
      ? `<div class="jects-kanban-card__desc">${escapeHtml(card.description)}</div>`
      : '';

  return (
    renderCover(card.cover) +
    head +
    desc +
    renderTags(card.tags) +
    renderProgress(card.progress) +
    renderMeta(card, card.attachments, card.comments, card.votes) +
    renderLinks(card.links) +
    renderBodyItems(card)
  );
}

/** A short accessible label for the card (used as aria-label on the card el). */
export function cardAccessibleLabel(card: KanbanCard): string {
  const title = card.title != null && card.title !== '' ? String(card.title) : `Card ${card.id}`;
  return title;
}
