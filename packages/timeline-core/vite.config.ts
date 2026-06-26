import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsTimelineCore',
  fileName: 'timeline-core',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/theme': 'JectsTheme',
  },
});
