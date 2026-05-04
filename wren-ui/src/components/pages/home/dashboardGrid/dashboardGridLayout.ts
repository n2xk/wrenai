import { DashboardItemType } from '@/types/home';
import type { DashboardGridItem } from './dashboardGridTypes';

export const DASHBOARD_GRID_GUTTER = 8;
export const DASHBOARD_GRID_COLUMN_COUNT = 6;
export const DASHBOARD_GRID_ROW_HEIGHT = 108;

export const getLayoutToGrid = (item: DashboardGridItem) => ({
  i: item.id.toString(),
  x: item.layout.x,
  y: item.layout.y,
  w: item.layout.w,
  h: Math.max(item.layout.h, resolveDashboardGridItemMinHeight(item)),
});

export const resolveDashboardGridWidth = (containerWidth: number) =>
  Math.max(containerWidth, 0);

export const resolveDashboardGridItemMinHeight = (item: DashboardGridItem) =>
  item.type === DashboardItemType.NUMBER ? 1 : 3;

export const resolveDashboardGridLayouts = (items: DashboardGridItem[]) =>
  items.map((item) => getLayoutToGrid(item));
