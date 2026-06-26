import { jectsLibConfig } from '@jects/vite-config';

export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsVue',
  fileName: 'vue',
  // Vue must stay external so the host app ships a single copy. The `@jects/*`
  // peer scope is externalized by the preset.
  external: ['vue'],
  globals: {
    vue: 'Vue',
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
