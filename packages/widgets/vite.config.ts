import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsWidgets',
  fileName: 'widgets',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/icons': 'JectsIcons',
    '@jects/theme': 'JectsTheme',
  },
});
