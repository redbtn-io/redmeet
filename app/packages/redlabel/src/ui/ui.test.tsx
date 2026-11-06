import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { brandSchema, type Brand } from '../brand';
import { medshield } from '../brands/medshield';
import { redbtn } from '../brands/redbtn';
import { BrandMark } from './BrandMark';
import { BrandSplash } from './BrandSplash';
import { DangerButton } from './DangerButton';
import { DataTable, type DataTableColumn } from './DataTable';
import { Donut, HeatStrip, Sparkline, StackedBar } from './charts';
import { LivePulse } from './LivePulse';
import { PoweredBy } from './PoweredBy';
import { Skeleton } from './Skeleton';
import { Wordmark } from './Wordmark';
import { FOCUSABLE_SELECTOR, focusableIn, nextFocusIndex } from './useModalSurface';

/**
 * The server-safe primitives, rendered WITHOUT a DOM.
 *
 * Every test in this package is pure by rule: no database, no network, no
 * filesystem outside the package, no environment, and that is what lets
 * `npm test` pass in an extracted redLabel with no app present. A DOM renderer
 * would mean `react-dom` or `jsdom`, and the package deliberately imports
 * neither: `react-dom` is an optional peer that nothing in the source touches,
 * and 1.2's claim that a non-React consumer installs neither has to stay true.
 *
 * So the components are CALLED and the element tree they return is walked. That
 * is exactly what a server render does with a hook-free component, which is why
 * only the components that carry no directive are tested this way: the ones that
 * hold state are tested through their pure pieces (the focus trap below).
 */

type Rendered = { tag: string; props: Record<string, unknown>; children: Rendered[]; text: string };

function flatten(node: ReactNode, out: Rendered[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
    return;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push({ tag: '#text', props: {}, children: [], text: String(node) });
    return;
  }
  if (!isValidElement(node)) return;
  out.push(render(node));
}

/** Expand one element. A function component is CALLED, which is what a server render does. */
function render(node: ReactElement): Rendered {
  const props = { ...(node.props as Record<string, unknown>) };
  const children: Rendered[] = [];

  if (typeof node.type === 'function') {
    const produced = (node.type as (p: unknown) => ReactNode)(props);
    flatten(produced, children);
    // A component is not an element: it BECOMES one. A single root is returned
    // as itself, which is what a server render emits; a component that returns
    // null or a fragment keeps a wrapper so the caller can see the shape.
    if (children.length === 1) return children[0] as Rendered;
    return { tag: node.type.name || '#component', props, children, text: textOf(children) };
  }

  const tag = typeof node.type === 'string' ? node.type : '#fragment';
  flatten(props['children'] as ReactNode, children);
  delete props['children'];
  return { tag, props, children, text: textOf(children) };
}

function textOf(children: Rendered[]): string {
  return children.map((child) => (child.tag === '#text' ? child.text : child.text)).join('');
}

function tree(node: ReactNode): Rendered {
  const out: Rendered[] = [];
  flatten(node, out);
  return out[0] ?? { tag: '#empty', props: {}, children: [], text: '' };
}

function all(node: Rendered, predicate: (candidate: Rendered) => boolean): Rendered[] {
  const found: Rendered[] = [];
  const visit = (current: Rendered): void => {
    if (predicate(current)) found.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return found;
}

const byTag = (node: Rendered, tag: string): Rendered[] => all(node, (candidate) => candidate.tag === tag);
const classOf = (node: Rendered): string => String(node.props['className'] ?? '');

const REDBTN: Brand = brandSchema.parse(redbtn);
const MEDSHIELD: Brand = brandSchema.parse(medshield);

/* ------------------------------------------------------------- the chrome -- */

describe('BrandMark', () => {
  it('is a plain <img>, never next/image, with explicit width and height', () => {
    const node = tree(<BrandMark brand={REDBTN} size={28} />);
    const image = byTag(node, 'img')[0];
    expect(image).toBeDefined();
    expect(image?.props['src']).toBe('/brand/redbtn/icon-192.png');
    expect(image?.props['width']).toBe(28);
    expect(image?.props['height']).toBe(28);
    expect(image?.props['decoding']).toBe('async');
    // No alt and an aria-hidden wrapper: the wordmark beside it reads the name.
    expect(image?.props['alt']).toBe('');
    expect(node.props['aria-hidden']).toBe('true');
  });

  it('the glow is a brand flag and its colour is derived from --accent, never hardcoded', () => {
    expect(classOf(tree(<BrandMark brand={REDBTN} />))).toContain('var(--accent)');
    // A flat reseller logo gets no halo, which would read as a rendering bug.
    expect(classOf(tree(<BrandMark brand={MEDSHIELD} />))).not.toContain('shadow-[');
  });
});

describe('Wordmark', () => {
  it('splits on the brand prefix and colours the suffix with a TOKEN', () => {
    const node = tree(<Wordmark brand={REDBTN} />);
    expect(node.props['aria-label']).toBe('redScan');
    const halves = byTag(node, 'span').filter((span) => span.props['aria-hidden'] === 'true');
    expect(halves.map((half) => half.text)).toEqual(['red', 'scan']);
    expect(classOf(halves[1] as Rendered)).toContain('text-accent-text');
    expect(classOf(halves[0] as Rendered)).toContain('text-text-primary');
  });

  it('a brand that states no prefix takes the plain path', () => {
    const node = tree(<Wordmark brand={MEDSHIELD} />);
    expect(node.props['aria-label']).toBe('MedShield');
    expect(node.text).toBe('MedShield');
    expect(classOf(node)).not.toContain('text-accent-text');
  });

  it('variant full renders product.name, which is what the landing hero wants', () => {
    expect(tree(<Wordmark brand={MEDSHIELD} variant="full" />).text).toBe('MedShield Code Assurance');
  });

  it('the product name is announced ONCE: the wrapper labels, both halves are hidden', () => {
    const node = tree(<Wordmark brand={REDBTN} />);
    const hidden = all(node, (candidate) => candidate.props['aria-hidden'] === 'true');
    expect(hidden).toHaveLength(2);
  });
});

describe('PoweredBy', () => {
  it('renders nothing when the brand is not a reseller', () => {
    expect(tree(<PoweredBy poweredBy={{ show: false, text: '', href: '' }} />).children).toHaveLength(0);
  });

  it('renders the precomputed value, so the client never needs the registry', () => {
    const node = tree(<PoweredBy poweredBy={{ show: true, text: 'Powered by redScan', href: 'https://scan.redbtn.io' }} />);
    expect(node.tag).toBe('a');
    expect(node.props['href']).toBe('https://scan.redbtn.io');
    expect(node.text).toBe('Powered by redScan');
  });
});

/* ------------------------------------------------------------- DataTable -- */

interface Row {
  id: string;
  name: string;
  severity: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'alpha', severity: 'critical' },
  { id: 'b', name: 'beta', severity: 'low' },
];

const COLUMNS: Array<DataTableColumn<Row>> = [
  { id: 'name', header: 'Name', cell: (row) => row.name, sortable: true },
  { id: 'severity', header: 'Severity', cell: (row) => row.severity, align: 'right', hideBelow: 'md' },
];

describe('DataTable', () => {
  const table = (extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
    tree(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        label="Findings"
        {...extra}
      />,
    );

  it('is a real <table> with th scope=col and an accessible name', () => {
    const node = table();
    const element = byTag(node, 'table')[0];
    expect(element?.props['aria-label']).toBe('Findings');
    const headers = byTag(node, 'th');
    expect(headers).toHaveLength(2);
    for (const header of headers) expect(header.props['scope']).toBe('col');
  });

  it('carries the phone card-mode class from redLabel’s own stylesheet', () => {
    expect(classOf(byTag(table(), 'table')[0] as Rendered)).toContain('rl-card-table');
  });

  it('every body cell states its own column name for card mode', () => {
    const cells = byTag(table(), 'td');
    expect(cells.map((cell) => cell.props['data-label'])).toEqual(['Name', 'Severity', 'Name', 'Severity']);
  });

  it('cells are selectable, because redstyle sets a global user-select: none', () => {
    for (const cell of byTag(table(), 'td')) expect(classOf(cell)).toContain('select-text');
  });

  it('aria-sort is none on a sortable column and set on the sorted one', () => {
    const unsorted = byTag(table(), 'th');
    expect(unsorted[0]?.props['aria-sort']).toBe('none');
    // A column that is not sortable carries no aria-sort at all.
    expect(unsorted[1]?.props['aria-sort']).toBeUndefined();

    const sorted = byTag(table({ sort: { columnId: 'name', dir: 'desc' }, sortHref: (id) => `?sort=${id}` }), 'th');
    expect(sorted[0]?.props['aria-sort']).toBe('descending');
  });

  it('a sortable header is a LINK built by the caller, so the URL owns the state', () => {
    const node = table({ sortHref: (id) => `?sort=${id}&dir=asc` });
    const links = byTag(node, 'a');
    expect(links.map((link) => link.props['href'])).toContain('?sort=name&dir=asc');
  });

  it('nothing sorts without a sortHref, rather than rendering a dead control', () => {
    expect(byTag(table(), 'a')).toHaveLength(0);
  });

  it('row navigation wraps the FIRST cell only, and is a real link', () => {
    const node = table({ rowHref: (row) => `/findings/${row.id}` });
    const links = byTag(node, 'a');
    expect(links.map((link) => link.props['href'])).toEqual(['/findings/a', '/findings/b']);
    expect(links[0]?.text).toBe('alpha');
  });

  it('no row carries a handler, which is what lets the whole table render on the server', () => {
    const node = table({ rowHref: (row) => `/findings/${row.id}` });
    for (const row of byTag(node, 'tr')) {
      expect(row.props['onClick']).toBeUndefined();
      expect(row.props['onKeyDown']).toBeUndefined();
      expect(row.props['tabIndex']).toBeUndefined();
      expect(row.props['role']).toBeUndefined();
    }
  });

  it('loading renders N skeleton rows and never a spinner', () => {
    const node = table({ loading: 3, rows: [] });
    expect(byTag(node, 'tr')).toHaveLength(4); // one header row plus three
    expect(all(node, (candidate) => classOf(candidate).includes('rl-skeleton')).length).toBe(6);
    expect(byTag(node, 'table')[0]?.props['aria-busy']).toBe('true');
  });

  it('an empty table renders the caller’s empty state instead of a headed shell', () => {
    const node = tree(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        getRowId={(row) => row.id}
        label="Findings"
        empty={<p>No findings yet.</p>}
      />,
    );
    expect(byTag(node, 'table')).toHaveLength(0);
    expect(node.text).toContain('No findings yet.');
  });

  it('a hidden column carries the redLabel class, not a Tailwind hidden that card mode outranks', () => {
    const node = table();
    const severity = byTag(node, 'th')[1];
    expect(classOf(severity as Rendered)).toContain('rl-col-hide-md');
    expect(classOf(severity as Rendered)).not.toMatch(/\bhidden\b/);
  });

  it('a caption is opt in, and replaces the aria-label rather than doubling it', () => {
    const node = table({ showCaption: true });
    expect(byTag(node, 'caption')[0]?.text).toBe('Findings');
    expect(byTag(node, 'table')[0]?.props['aria-label']).toBeUndefined();
  });
});

/* ------------------------------------------------------- the leak patches -- */

describe('the redstyle leak workarounds', () => {
  it('Skeleton uses the rl- class, because .light .skeleton outranks a local copy', () => {
    const node = tree(<Skeleton width="4rem" />);
    expect(classOf(node)).toContain('rl-skeleton');
    expect(classOf(node)).not.toMatch(/(?<!rl-)\bskeleton\b/);
    expect(node.props['aria-hidden']).toBe('true');
  });

  it('LivePulse uses the rl- keyframes and is hidden from assistive technology', () => {
    const node = tree(<LivePulse />);
    expect(classOf(node)).toContain('rl-streaming-pulse');
    expect(node.props['aria-hidden']).toBe('true');
  });

  it('DangerButton is a token fill with the DERIVED foreground, never a palette class', () => {
    const node = tree(<DangerButton>Delete</DangerButton>);
    expect(node.tag).toBe('button');
    expect(node.props['type']).toBe('button');
    expect(classOf(node)).toContain('rl-danger-button');
    expect(classOf(node)).not.toMatch(/bg-(red|rose)-\d{3}/);
    // NOT text-accent-foreground: in dark that is #ffffff on #f87171, 2.77.
    expect(classOf(node)).not.toContain('accent-foreground');
    expect(node.text).toBe('Delete');
  });

  it('BrandSplash draws the resolved brand’s mark, not an embedded disc', () => {
    const node = tree(<BrandSplash brand={MEDSHIELD} message="Preparing sandbox." detail="12s" />);
    expect(byTag(node, 'img')[0]?.props['src']).toBe('/brand/medshield/icon-192.png');
    expect(node.props['role']).toBe('status');
    expect(node.props['aria-live']).toBe('polite');
    expect(node.text).toContain('Preparing sandbox.');
    expect(node.text).toContain('12s');
    // The ping ring stops under reduced motion.
    expect(all(node, (candidate) => classOf(candidate).includes('motion-reduce:animate-none')).length).toBe(1);
  });
});

/* ----------------------------------------------------------------- charts -- */

describe('the charts', () => {
  it('every fill and stroke is a var(), never a hex', () => {
    const nodes = [
      tree(<Donut value={0.82} label="B+" />),
      tree(<Sparkline points={[1, 4, 2, 8]} ariaLabel="trend" />),
      tree(<StackedBar segments={[{ value: 3, tone: 'critical' }, { value: 1, tone: 'low' }]} />),
      tree(<HeatStrip buckets={[null, 0, 0.5, 1]} ariaLabel="heat" />),
    ];
    for (const node of nodes) {
      for (const element of all(node, () => true)) {
        for (const key of ['fill', 'stroke']) {
          const value = element.props[key];
          if (typeof value !== 'string' || value === 'none') continue;
          expect(value).toMatch(/^var\(--[a-z0-9-]+\)$/);
        }
      }
    }
  });

  it('each carries role=img and an aria-label, and NO per-segment <title>', () => {
    // An aria-label on an svg role="img" suppresses child <title>s, so a title
    // would never be the text channel.
    const nodes = [
      tree(<Donut value={0.5} ariaLabel="Grade B" />),
      tree(<Sparkline points={[1, 2]} ariaLabel="trend" />),
      tree(<StackedBar segments={[{ value: 1, tone: 'high', label: 'high' }]} />),
      tree(<HeatStrip buckets={[0.2]} ariaLabel="heat" />),
    ];
    for (const node of nodes) {
      const svg = byTag(node, 'svg')[0];
      expect(svg?.props['role']).toBe('img');
      expect(String(svg?.props['aria-label'] ?? '').length).toBeGreaterThan(0);
      expect(byTag(node, 'title')).toHaveLength(0);
    }
  });

  it('StackedBar composes its label from the segments, so colour is not the only channel', () => {
    const node = tree(<StackedBar segments={[{ value: 3, tone: 'critical', label: 'critical' }, { value: 1, tone: 'low', label: 'low' }]} />);
    expect(byTag(node, 'svg')[0]?.props['aria-label']).toBe('critical 3, low 1');
  });

  it('an empty StackedBar says so rather than rendering a lie', () => {
    const node = tree(<StackedBar segments={[]} />);
    expect(byTag(node, 'svg')[0]?.props['aria-label']).toBe('no data');
    expect(byTag(node, 'rect')).toHaveLength(1);
  });

  it('a Sparkline with fewer than two points renders the frame, so the card does not reflow', () => {
    expect(byTag(tree(<Sparkline points={[]} ariaLabel="trend" />), 'line')).toHaveLength(1);
    expect(byTag(tree(<Sparkline points={[3]} ariaLabel="trend" />), 'path')).toHaveLength(0);
  });

  it('Donut clamps out-of-range values, because a grade cannot be 140 percent', () => {
    const node = tree(<Donut value={1.4} />);
    const arc = byTag(node, 'circle')[1];
    const [drawn, total] = String(arc?.props['strokeDasharray']).split(' ').map(Number);
    expect(drawn).toBeCloseTo(total as number, 5);
  });
});

/* ----------------------------------------------------------- the focus trap -- */

describe('the modal focus trap, through its pure pieces', () => {
  it('the selector excludes what a Tab must not land on', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])');
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
    // A trap that ignores inert walks straight out into the page it just inerted.
    expect(FOCUSABLE_SELECTOR.split(',').every((part) => part.includes(':not([inert])'))).toBe(true);
    expect(FOCUSABLE_SELECTOR.split(',').every((part) => part.includes(':not([hidden])'))).toBe(true);
  });

  it('focusableIn returns the queried elements in document order', () => {
    const fake = { querySelectorAll: () => ['first', 'second'] as unknown as ArrayLike<Element> };
    expect(focusableIn(fake)).toEqual(['first', 'second']);
  });

  it('Tab wraps at both ends', () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(1, 3, true)).toBe(0);
  });

  it('focus outside the trap comes back inside, forwards and backwards', () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
  });

  it('an empty surface has nowhere to go, and says so rather than picking 0', () => {
    expect(nextFocusIndex(-1, 0, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });

  it('a single focusable element stays put in both directions', () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
  });
});
