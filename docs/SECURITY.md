# Jects UI — HTML / Injection Security Contract

> Authored in Phase 1 (roadmap §1.6) as the spec that Phase 2.5 hardening implements against.
> The bar: **no user-provided string ever reaches `innerHTML` (or equivalent) without sanitization
> or escaping.** This document defines the API contract, the surface inventory, the sanitizer
> requirements, and the test plan.

## 1. The API contract: `text` vs `html`

Every public API that displays caller-supplied content MUST make trust explicit:

| Field naming | Meaning | Rendering rule |
| --- | --- | --- |
| `text`, `label`, `title`, `*Text`, `description`, `notes` (plain) | Untrusted plain text | **Always escaped** before insertion (`textContent` or an escape helper). Never interpreted as HTML. |
| `html`, `*Html`, `template` returning markup | Explicitly trusted/authored markup | Passed through a **sanitizer** by default; only bypasses sanitization through an explicit opt-out (`{ trusted: true }` / a `TrustedHtml` wrapper) chosen by the integrator. |
| Renderer/cellTemplate callbacks returning a string | Author-controlled, but may interpolate row data | Treated as `html` → sanitized. Document that interpolated values must be escaped by the author, and provide an `escape()` helper. |

Rules:
1. **No casual `html: string` that injects raw.** A string-typed HTML input must sanitize unless the
   caller passes an explicit trusted marker.
2. **Provide and export an `escape(text)` helper** from `@jects/core` (or reuse the existing
   `escapeHtml`) so renderer authors have one obvious tool.
3. **Provide a single shared `sanitizeHtml(html, opts?)`** in `@jects/core` used by every component —
   not per-package re-implementations.

## 2. Sanitizer requirements (`sanitizeHtml`)

A small, dependency-free, allow-list sanitizer in `@jects/core`:

- **Strip** `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`,
  `<form>` and event-handler attributes (`on*`).
- **Neutralize** `javascript:`, `data:` (except safe `data:image/*`), and `vbscript:` URLs in
  `href`/`src`/`xlink:href`/`style`.
- **Allow-list** a safe set of formatting tags + attributes (the rich-text output set: headings,
  p, span, a[href], b/i/u/strong/em, ul/ol/li, blockquote, code/pre, table family, img[src,alt],
  br, hr) and drop everything else.
- **Strip** `style` expressions that can execute (`url(javascript:)`, CSS `expression()`).
- Idempotent: sanitizing already-safe HTML is a no-op.
- This is the canonical implementation; RichText paste-clean already does much of this and should be
  refactored to call (or share) the same core sanitizer.

## 3. Surface inventory (audit + harden each)

| # | Surface | Package | Untrusted input | Required handling | Current status |
| --- | --- | --- | --- | --- | --- |
| 1 | Grid cell text + headers | grid | row values, column headers | escaped | verified XSS-safe (Phase B); confirm via test |
| 2 | Grid custom cell renderers | grid | author template + row data | sanitize template output; `escape()` helper documented | needs explicit contract + test |
| 3 | RichText paste / import / setHTML | widgets (richtext) | pasted HTML, `setHTML`, markdown | sanitize through core sanitizer | paste-clean exists; unify on core sanitizer |
| 4 | Tooltips / popovers / templates | widgets (overlays) | `html`/template content | sanitize unless trusted | needs contract + test |
| 5 | Diagram node/edge labels + HTML shapes | diagram | label text, HTML-foreignObject shape | label escaped; HTML shape sanitized | verify; HTML shape is the risk |
| 6 | Kanban card content | kanban | title, description, comments, links | escaped (text) / sanitized (rich) | verified XSS-safe; confirm via test |
| 7 | Todo titles / comments / @mentions / notes | todo | titles, comment text, mentions | escaped; mention parse must not inject | confirm via test |
| 8 | Spreadsheet cell display | spreadsheet | cell text, formula error text | escaped | verified XSS-safe; confirm via test |
| 9 | Calendar event title/description/location | calendar | event fields, editor inputs | escaped | confirm via test |
| 10 | Booking service/reservation fields | booking | names, notes, custom fields | escaped | confirm via test |
| 11 | Chatbot message rendering (markdown) | chatbot | message text → markdown → HTML | markdown renderer must escape raw HTML in source | verify markdown renderer escapes embedded HTML |
| 12 | Charts labels / tooltips | charts | series names, axis labels, tooltip | escaped | confirm via test |

## 4. Test plan

A dedicated XSS suite (one spec per surface, run in the existing vitest browser/jsdom harness):

- Inject the standard payloads into each untrusted field and assert **none execute** and the DOM is
  clean: `<img src=x onerror=ALERT>`, `<script>ALERT</script>`, `javascript:` links,
  `<svg onload=ALERT>`, `"><iframe src=javascript:...>`, `data:text/html` URLs, and a CSS
  `expression()` / `url(javascript:)`.
- Use a global hook (`window.__xss = false; ... onerror/alert sets it true`) and assert it stays
  false after rendering + interaction.
- Assert sanitized output preserves legitimate formatting (e.g. `<b>` survives, `<img src=x onerror>`
  becomes `<img src=x>`).
- Add a lint/grep guard (CI) flagging any new `innerHTML =`/`insertAdjacentHTML` that isn't fed by
  `sanitizeHtml`/`escape` (allow an inline `// jects-safe-html: <reason>` annotation for vetted
  internal-only template literals).

## 5. Acceptance criteria

- `sanitizeHtml` + `escape` exported from `@jects/core`; RichText + all rich surfaces route through it.
- XSS suite green across all rich surfaces.
- CI grep guard passes (no unguarded `innerHTML` from untrusted input).
- Public `html`-typed APIs documented with their trust/sanitization behavior.

## 6. Reporting a vulnerability

Please report security issues privately — do not open a public GitHub issue for a vulnerability.

- Open a [GitHub security advisory](https://github.com/storyofcarl/jex-library/security/advisories/new),
  or file a regular issue marked `security` that contains only a request to be contacted (no details).
- Include affected package + version, a description, impact, and a reproduction if possible.
- We acknowledge reports within 2 business days, work with you on a fix and disclosure timeline, and
  credit reporters who wish to be credited. Security fixes ship as a priority patch (see
  [`RELEASE-POLICY.md`](./RELEASE-POLICY.md)).
