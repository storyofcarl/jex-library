import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsElements',
  fileName: 'elements',
  // The `@jects/*` peer scope is externalized by the preset so a host app ships
  // a single copy of core and each engine.
  globals: {
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
