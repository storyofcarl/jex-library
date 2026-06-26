import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsCharts',
  fileName: 'charts',
  globals: {
    '@jects/core': 'JectsCore',
  },
});
