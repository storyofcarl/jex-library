import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsReact',
  fileName: 'react',
  // React (and its JSX runtime) and ReactDOM must stay external so the host app
  // ships a single copy. The `@jects/*` peer scope is externalized by the preset.
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  globals: {
    react: 'React',
    'react-dom': 'ReactDOM',
    'react/jsx-runtime': 'jsxRuntime',
    '@jects/core': 'JectsCore',
    '@jects/widgets': 'JectsWidgets',
    '@jects/grid': 'JectsGrid',
    '@jects/gantt': 'JectsGantt',
    '@jects/scheduler': 'JectsScheduler',
    '@jects/calendar': 'JectsCalendar',
    '@jects/kanban': 'JectsKanban',
    '@jects/todo': 'JectsTodo',
    '@jects/charts': 'JectsCharts',
    '@jects/diagram': 'JectsDiagram',
    '@jects/spreadsheet': 'JectsSpreadsheet',
    '@jects/pivot': 'JectsPivot',
    '@jects/booking': 'JectsBooking',
    '@jects/chatbot': 'JectsChatbot',
  },
});
