/**
 * Pure room UI logic for the Epic 3 meeting room: grid layout,
 * tile identity fallbacks, screen share resolution, and device
 * fallback picking. Everything here is framework free and unit
 * tested (room-ui.test.ts); the React components consume it.
 */

export interface GridLayout {
  columns: number;
  rows: number;
}

/** Columns for a participant grid of 1 to 10 tiles. */
export function gridLayout(count: number): GridLayout {
  const n = Math.max(1, Math.floor(count) || 1);
  let columns: number;
  if (n === 1) columns = 1;
  else if (n <= 4) columns = 2;
  else if (n <= 9) columns = 3;
  else columns = 4;
  return { columns, rows: Math.ceil(n / columns) };
}

export interface FitGrid {
  columns: number;
  rows: number;
  /** Pixel size of every tile, already at the requested aspect. */
  tileWidth: number;
  tileHeight: number;
}

/**
 * The tile grid that fills a stage best: try every column count, size
 * each tile to the largest box at `aspect` (width / height) that fits
 * its cell, and keep the column count with the biggest tiles. This is
 * what makes two people on a phone stack vertically and two people on
 * a laptop sit side by side, from the same rule. A stage with no size
 * yet (first render) yields zero sized tiles, never NaN.
 */
export function fitGrid(
  count: number,
  width: number,
  height: number,
  aspect: number,
  gap = 8,
): FitGrid {
  const n = Math.max(1, Math.floor(count) || 1);
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const a = aspect > 0 ? aspect : 16 / 9;
  let best: FitGrid = { columns: 1, rows: n, tileWidth: 0, tileHeight: 0 };
  let bestArea = -1;
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const cellW = (w - gap * (columns - 1)) / columns;
    const cellH = (h - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    const tileWidth = Math.min(cellW, cellH * a);
    const tileHeight = tileWidth / a;
    const area = tileWidth * tileHeight;
    // Strictly greater: on a tie the fewer columns (bigger rows) win.
    if (area > bestArea + 0.5) {
      bestArea = area;
      best = {
        columns,
        rows,
        tileWidth: Math.floor(tileWidth),
        tileHeight: Math.floor(tileHeight),
      };
    }
  }
  return best;
}

/**
 * The tile shape for a stage: landscape video tiles on a landscape
 * stage, taller tiles on a portrait one (a phone held upright), where
 * 16:9 tiles would waste most of the screen.
 */
export function tileAspectFor(width: number, height: number): number {
  return height > width ? 3 / 4 : 16 / 9;
}

/** "Smoke Guest" -> "SG", "Host" -> "HO", "" -> "?". */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? '';
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** A stable background color for a participant identity. */
export function colorForIdentity(identity: string): string {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) {
    hash = (hash * 31 + identity.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 45% 38%)`;
}

export interface ShareRef {
  trackSid: string;
  ownerIdentity: string;
  ownerName: string;
  /** Arrival order on this client; higher is newer. */
  seq: number;
}

/**
 * The share in the main area is the most recently started one.
 * A new share takes over from an older one (story 3.4.4), and
 * when the displayed share ends the next newest takes its
 * place, because every client stamps arrival order the same
 * way and applies this same rule.
 */
export function resolveDisplayedShare(shares: ShareRef[]): ShareRef | null {
  let best: ShareRef | null = null;
  for (const share of shares) {
    if (!best || share.seq > best.seq) best = share;
  }
  return best;
}

/**
 * The notice owed to the participant whose share just lost the
 * main area to a newer share, or null when no notice is due.
 */
export function displacedShareNotice(
  shares: ShareRef[],
  displayed: ShareRef | null,
  localIdentity: string,
): string | null {
  if (!displayed || displayed.ownerIdentity === localIdentity) return null;
  const mine = shares.find((s) => s.ownerIdentity === localIdentity);
  if (!mine) return null;
  return `${displayed.ownerName} is sharing their screen now, so theirs is in the main area. Yours is still being shared.`;
}

export interface DeviceLike {
  deviceId: string;
  label: string;
}

/**
 * When the active device vanishes from the enumerated list,
 * fall back to the first remaining device. Returns null when
 * the active device is still there, when no explicit device
 * was picked (the browser default is the browser's problem),
 * or when nothing remains to fall back to.
 */
export function pickFallbackDevice(
  activeId: string,
  devices: DeviceLike[],
): DeviceLike | null {
  if (!activeId) return null;
  if (!devices.length) return null;
  if (devices.some((d) => d.deviceId === activeId)) return null;
  return devices.find((d) => d.deviceId) ?? null;
}
