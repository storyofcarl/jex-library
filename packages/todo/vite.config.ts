import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsTodo',
  fileName: 'todo',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/icons': 'JectsIcons',
    '@jects/theme': 'JectsTheme',
    '@jects/widgets': 'JectsWidgets',
  },
});
