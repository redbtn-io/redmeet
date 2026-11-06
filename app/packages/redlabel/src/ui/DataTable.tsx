import type React from 'react';

import { Skeleton } from './Skeleton';

/**
 * The table, with phone card mode. **A server component, and that is a contract
 * with ui.md rather than a preference.**
 *
 * ui.md builds `/findings`, the scans table and the SBOM component table on this
 * component, lists it in no client exception, and budgets 160 KB of first-load JS
 * on `/findings`. A hydrating table breaks all three. So there is no
 * `onRowClick`, no client state and no directive:
 *
 * - **Sorting is controlled and the URL owns it.** A sortable header is a link
 *   built by the caller's `sortHref`, carrying `aria-sort`. That is also the
 *   accessible form: a real link is keyboard reachable, middle clickable and
 *   announced.
 * - **Row navigation is a link around the first cell's content**, not a handler
 *   on `<tr>`, for the same three reasons.
 * - There is no client-side pagination, because paging is cursor based on the
 *   server.
 *
 * The one caller that genuinely needs a handler imports `./ui/DataTableInteractive`,
 * the same markup in a `'use client'` file. v0 has no such caller.
 *
 * **`linkComponent` is why this file imports no `next/link`.** `next` is an
 * OPTIONAL peer and `./ui` has to stay usable without it, so the element defaults
 * to a plain `<a>` and a Next app passes `Link`, getting client-side navigation
 * without making Next a requirement of the package. It is the same argument that
 * keeps `next/image` out of `BrandMark`.
 *
 * Below 640px the redoffice card-table technique takes over, from
 * `src/css/redlabel.css` rather than from the app's `globals.css`: `thead` goes
 * away, every row becomes a block card and every cell states its own column name
 * from `data-label`. Two refinements come with it: a cell with no `data-label`
 * (an actions cell) wraps from the left instead of being labelled, and the
 * desktop column clamps are released, because a card has the full width.
 *
 * Cells carry `.select-text`, because redstyle's `base.css` sets a global
 * `user-select: none` with an allowlist and a findings table is content.
 */
export interface DataTableColumn<Row> {
  id: string;
  /** The column name. Also the phone card's `data-label`, so it is plain text. */
  header: string;
  cell: (row: Row) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Any CSS width. A clamp here is released in card mode. */
  width?: string;
  /** Hide this column below a breakpoint. It stays hidden in card mode too. */
  hideBelow?: 'sm' | 'md' | 'lg';
  sortable?: boolean;
}

export interface DataTableSort {
  columnId: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<Row> {
  columns: Array<DataTableColumn<Row>>;
  rows: Row[];
  getRowId: (row: Row) => string;
  /** Required by ui.md 2.3: a real table carries a caption or an aria-label. */
  label: string;
  /** Render the label as a visible `<caption>` rather than an `aria-label`. */
  showCaption?: boolean;
  /** The caller builds it from its own URL state. Absent means nothing sorts. */
  sortHref?: (columnId: string) => string;
  sort?: DataTableSort | null;
  /** Wraps the FIRST cell's content in a link. Absent means rows do not navigate. */
  rowHref?: (row: Row) => string;
  /** What to render instead of a body when `rows` is empty and nothing is loading. */
  empty?: React.ReactNode;
  /** N skeleton rows, never a spinner. `0` or absent means not loading. */
  loading?: number;
  density?: 'default' | 'dense';
  /** `'a'` by default. A Next app passes `Link` and gets client-side navigation. */
  linkComponent?: React.ElementType;
  className?: string;
}

const ALIGN: Readonly<Record<NonNullable<DataTableColumn<unknown>['align']>, string>> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const HIDE: Readonly<Record<NonNullable<DataTableColumn<unknown>['hideBelow']>, string>> = {
  sm: 'rl-col-hide-sm',
  md: 'rl-col-hide-md',
  lg: 'rl-col-hide-lg',
};

const CELL_PADDING: Readonly<Record<NonNullable<DataTableProps<unknown>['density']>, string>> = {
  default: 'px-3 py-2.5',
  dense: 'px-2 py-1.5',
};

/**
 * The two helpers read only the PRESENTATIONAL half of a column, so they are
 * typed on that half rather than on `DataTableColumn<unknown>`: a
 * `DataTableColumn<Row>` is not assignable to a `DataTableColumn<unknown>`
 * because `cell` makes the parameter contravariant.
 */
type ColumnLayout = Pick<DataTableColumn<never>, 'id' | 'align' | 'hideBelow' | 'sortable'>;

/** `aria-sort` takes the state of THIS column, not of the table. */
function ariaSort(
  column: ColumnLayout,
  sort: DataTableSort | null | undefined,
): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable) return undefined;
  if (!sort || sort.columnId !== column.id) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

function classesFor(column: ColumnLayout): string {
  return [ALIGN[column.align ?? 'left'], column.hideBelow ? HIDE[column.hideBelow] : '']
    .filter(Boolean)
    .join(' ');
}

export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  label,
  showCaption = false,
  sortHref,
  sort,
  rowHref,
  empty,
  loading = 0,
  density = 'default',
  linkComponent,
  className,
}: DataTableProps<Row>): React.JSX.Element {
  const Link = (linkComponent ?? 'a') as React.ElementType;
  const padding = CELL_PADDING[density];
  const isLoading = loading > 0;

  if (!isLoading && rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }

  return (
    <div className={['rl-card-table-wrap overflow-x-auto', className].filter(Boolean).join(' ')}>
      <table
        className="rl-card-table w-full border-collapse text-sm"
        aria-label={showCaption ? undefined : label}
        aria-busy={isLoading ? 'true' : undefined}
      >
        {showCaption ? (
          <caption className="px-3 py-2 text-left text-xs font-medium tracking-wide text-text-muted uppercase">
            {label}
          </caption>
        ) : null}
        <thead>
          <tr className="border-b border-border bg-bg-tertiary">
            {columns.map((column) => {
              const sortState = ariaSort(column, sort);
              const heading = (
                <span className="text-xs font-medium tracking-wide text-text-muted uppercase">
                  {column.header}
                </span>
              );
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sortState}
                  style={column.width ? { width: column.width } : undefined}
                  className={[classesFor(column), padding, 'font-medium'].join(' ')}
                >
                  {column.sortable && sortHref ? (
                    <Link
                      href={sortHref(column.id)}
                      className="tap inline-flex items-center gap-1 rounded hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                    >
                      {heading}
                      {/* The arrow is a second channel on top of aria-sort, and
                          it is hidden from assistive technology because
                          aria-sort already says it. */}
                      <span aria-hidden="true" className="text-[10px] text-text-muted">
                        {sortState === 'ascending' ? '↑' : sortState === 'descending' ? '↓' : '↕'}
                      </span>
                    </Link>
                  ) : (
                    heading
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: loading }, (_unused, index) => (
                <tr key={`rl-skeleton-${index}`} className="border-b border-border">
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      data-label={column.header}
                      className={[classesFor(column), padding].join(' ')}
                    >
                      <Skeleton height="0.875rem" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => {
                const id = getRowId(row);
                return (
                  <tr key={id} className="border-b border-border last:border-0 hover:bg-bg-hover">
                    {columns.map((column, index) => {
                      const content = column.cell(row);
                      return (
                        <td
                          key={column.id}
                          data-label={column.header}
                          className={[classesFor(column), padding, 'select-text align-top'].join(' ')}
                        >
                          {index === 0 && rowHref ? (
                            <Link
                              href={rowHref(row)}
                              className="tap rounded font-medium text-text-primary hover:text-accent-text focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                            >
                              {content}
                            </Link>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
