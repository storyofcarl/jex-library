import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsCalendar',
  fileName: 'calendar',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/widgets': 'JectsWidgets',
    '@jects/theme': 'JectsTheme',
  },
});
