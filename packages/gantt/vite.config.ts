import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsGantt',
  fileName: 'gantt',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/timeline-core': 'JectsTimelineCore',
    '@jects/grid': 'JectsGrid',
    '@jects/widgets': 'JectsWidgets',
    '@jects/theme': 'JectsTheme',
  },
});
