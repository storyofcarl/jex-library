import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsKanban',
  fileName: 'kanban',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/widgets': 'JectsWidgets',
    '@jects/theme': 'JectsTheme',
  },
});
