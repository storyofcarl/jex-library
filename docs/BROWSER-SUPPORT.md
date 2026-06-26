# Browser & platform support

## Browsers

Jects UI supports the current and previous major version of every evergreen browser:

| Browser | Support |
| --- | --- |
| Chrome / Chromium / Edge | Current + previous |
| Firefox | Current + previous |
| Safari (macOS & iOS) | Current + previous |

The suite uses modern CSS (including OKLCH color and CSS custom properties) and ES2022 JavaScript.
Internet Explorer and other non-evergreen browsers are not supported.

## Frameworks

| Wrapper | Supported versions |
| --- | --- |
| `@jects/react` | React 18+ |
| `@jects/vue` | Vue 3.4+ |
| `@jects/angular` | Angular 17+ |
| `@jects/elements` | Any standards-compliant Web-Components host |

The vanilla packages have no framework requirement.

## Runtime & tooling

- **Node.js:** 20.17+ (for building and SSR/data scenarios).
- **Bundlers:** any ESM-aware bundler (Vite, Rollup, esbuild, webpack 5, Parcel). UMD builds are
  provided for direct `<script>`/CDN usage.
- **Module format:** ESM is the primary entry; a UMD build is provided per package for `require`/CDN.

## Server-side rendering

Components are light-DOM classes that instantiate against a DOM element, so they mount in the browser.
Under SSR frameworks, construct components inside a browser-only lifecycle (e.g. `useEffect`,
`onMounted`, or an `afterRender`/effect hook) and call `.destroy()` on teardown.

## Accessibility & display

- Keyboard and ARIA support across interactive components (see each module's docs and the
  accessibility test suites).
- Built-in light, dark, and high-contrast themes; honors reduced-motion preferences.
