/**
 * The `./ui` barrel.
 *
 * **No `'use client'` here, ever.** A directive on the barrel would make
 * `BrandMark`, `Wordmark`, `PoweredBy`, `DataTable`, `Skeleton`, `DangerButton`,
 * `BrandSplash`, `LivePulse` and the four charts un-renderable on the server, and
 * the shell header, the footer and every table are server components by contract
 * with ui.md. Omitting one where a component needs it is a `useContext` crash.
 * Each FILE decides for itself, and `./ui/client` holds the context-reading
 * wrappers.
 *
 * Inside a client component, deep-import (`@redbtn/redlabel/ui/BottomSheet`)
 * rather than pulling this barrel, so a page that wants one sheet does not drag
 * the tooltip and the charts into its graph.
 *
 * `BottomSheet`, `Drawer`, `Tooltip`, `InfoTip` and `DataTableInteractive` are
 * re-exported here for discoverability and typing; each carries its own
 * directive, so importing one of them from a server component is a build error
 * that names the right file rather than a runtime crash.
 */
export { BrandMark, type BrandMarkProps } from './BrandMark';
export { Wordmark, type WordmarkProps } from './Wordmark';
export { PoweredBy, type PoweredByProps } from './PoweredBy';

export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSort,
} from './DataTable';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { LivePulse, type LivePulseProps } from './LivePulse';
export { DangerButton, type DangerButtonProps } from './DangerButton';
export { BrandSplash, type BrandSplashProps } from './BrandSplash';

export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { Drawer, type DrawerProps } from './Drawer';
export { Tooltip, type TooltipProps } from './Tooltip';
export { InfoTip, type InfoTipProps } from './InfoTip';

export {
  Donut,
  HeatStrip,
  SeriesSwatch,
  Sparkline,
  StackedBar,
  type DonutProps,
  type HeatStripProps,
  type SeriesSwatchProps,
  type SparklineProps,
  type StackedBarProps,
  type StackedBarSegment,
} from './charts';
