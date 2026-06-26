/**
 * Pagination stories — framework-free usage examples for the docs app.
 */
import { Pagination, type PaginationConfig } from './pagination.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Pagination;
}

const story = (name: string, config: PaginationConfig): Story => ({
  name,
  render: (host) => new Pagination(host, config),
});

export const stories: Story[] = [
  story('Basic', { total: 95, pageSize: 10, page: 1 }),
  story('Mid range with ellipses', { total: 1000, pageSize: 10, page: 25 }),
  story('Few pages', { total: 25, pageSize: 10, page: 2 }),
  story('With page-size select', {
    total: 240,
    pageSize: 20,
    page: 3,
    pageSizeOptions: [10, 20, 50, 100],
  }),
  story('Prev/next only', {
    total: 200,
    pageSize: 10,
    page: 5,
    showFirstLast: false,
  }),
  story('Disabled', { total: 100, pageSize: 10, page: 2, disabled: true }),
];
