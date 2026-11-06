/**
 * The right-side drawer.
 *
 * One implementation, two presentations: this IS `BottomSheet`, which is a sheet
 * below `md` and a drawer at `md` and up. Two names exist because ui.md calls the
 * same surface a drawer on a desk and a sheet on a phone, and a second
 * implementation would be a second focus trap to keep correct.
 *
 * **No `'use client'` on this file.** The directive belongs to `BottomSheet.tsx`,
 * which is where the hooks are; a re-export that calls no hook must not carry
 * one, and `scripts/check-redlabel-boundaries.mjs` fails a file that does. The
 * client boundary still applies, because the module it re-exports declares it.
 */
export { BottomSheet as Drawer, type BottomSheetProps as DrawerProps } from './BottomSheet';
