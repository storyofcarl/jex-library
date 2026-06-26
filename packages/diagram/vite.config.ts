import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsDiagram',
  fileName: 'diagram',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/theme': 'JectsTheme',
    '@jects/widgets': 'JectsWidgets',
  },
});
