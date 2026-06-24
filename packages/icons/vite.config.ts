import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsIcons',
  fileName: 'icons',
  // sprite.svg is pre-generated into dist by scripts/build-sprite.mjs.
  emptyOutDir: false,
});
