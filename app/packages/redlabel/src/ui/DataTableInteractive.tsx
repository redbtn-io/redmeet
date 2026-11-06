'use client';

import { useCallback, useMemo } from 'react';
import type React from 'react';

import { DataTable, type DataTableProps } from './DataTable';

/**
 * `DataTable` for the one caller that genuinely needs a handler.
 *
 * **v0 has no such caller, and that is the point.** ui.md budgets 160 KB of
 * first-load JS on `/findings` and lists no table in its client exception list,
 * so the server `DataTable` is what every screen uses. This file exists so that
 * "the table cannot take a handler" never becomes a reason to make the server one
 * a client component.
 *
 * The handler is added WITHOUT taking the row out of the keyboard's reach.
 * `onRowClick` rides on the link `rowHref` already produces, so the first cell
 * stays a real link: focusable, middle clickable, announced as a link, and still
 * working before JavaScript arrives. A handler on `<tr>` would be none of those.
 * A modified click (new tab, new window, download) is left to the browser, which
 * is the behaviour a person expects from something that looks like a link.
 *
 * `rowHref` is REQUIRED here, and that is the constraint that keeps the row
 * addressable: a row with no URL is a control, and a control belongs in a cell.
 */
export interface DataTableInteractiveProps<Row>
  extends Omit<DataTableProps<Row>, 'linkComponent' | 'rowHref'> {
  rowHref: (row: Row) => string;
  onRowClick: (row: Row) => void;
}

export function DataTableInteractive<Row>({
  onRowClick,
  rowHref,
  rows,
  ...rest
}: DataTableInteractiveProps<Row>): React.JSX.Element {
  // The link element only knows its href, so the href is the key back to the
  // row. Building the map here costs one pass and keeps `DataTable` free of any
  // notion of a handler.
  const byHref = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of rows) map.set(rowHref(row), row);
    return map;
  }, [rows, rowHref]);

  const linkComponent = useCallback(
    function InteractiveLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
      const { onClick, href, ...anchor } = props;
      return (
        <a
          {...anchor}
          href={href}
          onClick={(event) => {
            onClick?.(event);
            if (event.defaultPrevented) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (event.button !== 0) return;
            const row = href === undefined ? undefined : byHref.get(href);
            // A header's sort link is not a row link: it is not in the map, so
            // it navigates exactly as it does in the server table.
            if (row === undefined) return;
            event.preventDefault();
            onRowClick(row);
          }}
        />
      );
    },
    [byHref, onRowClick],
  );

  return (
    <DataTable
      {...rest}
      rows={rows}
      rowHref={rowHref}
      linkComponent={linkComponent as unknown as React.ElementType}
    />
  );
}
