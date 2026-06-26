import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsPivot',
  fileName: 'pivot',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/grid': 'JectsGrid',
    '@jects/widgets': 'JectsWidgets',
    '@jects/theme': 'JectsTheme',
  },
});
