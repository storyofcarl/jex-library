import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsChatbot',
  fileName: 'chatbot',
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/theme': 'JectsTheme',
    '@jects/widgets': 'JectsWidgets',
  },
});
