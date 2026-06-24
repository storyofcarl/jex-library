import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsTheme',
  fileName: 'theme',
  // CSS is pre-generated into dist/css by scripts/build-theme.mjs before vite runs.
  emptyOutDir: false,
});
