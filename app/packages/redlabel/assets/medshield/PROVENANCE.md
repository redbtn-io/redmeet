# medshield mark, provenance

**PLACEHOLDER artwork, not supplied artwork.** MedShield is a demo configuration for a named prospect
(redlabel.md 9.3); nobody has handed redbtn a mark. The file exists so the icon pipeline stays honest
end to end: the generator verifies a master's md5 either way, so a recorded placeholder behaves exactly
like real artwork, and substituting real artwork is a two-step change. Replace `logo.png`, update the
md5 below, rerun `npm run icons -- --brand medshield`, commit the outputs and the lock.

- md5: ea6152dc61c168896450cdbb3b25351c
- sha256: 0185b6a59ef1910d6627ced382e7268d4138c99a7a7b66e3b755a07f347bd7fd
- bytes: 16327
- dimensions: 1024x1024
- format: PNG, RGBA, transparent background
- date recorded: 2026-09-21

## How it was made

A flat shield glyph filled with the brand accent `#0ea5e9` (redlabel.md 9.3, `tokens.shared.accent`),
rasterized at 1024x1024 from this exact SVG with
`sharp(Buffer.from(svg)).resize(1024, 1024, { fit: 'contain', background: transparent, kernel: 'lanczos3' }).png({ compressionLevel: 9, palette: false })`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><path d="M512 96L864 216v304c0 200-152 336-352 408-200-72-352-208-352-408V216z" fill="#0ea5e9"/></svg>
```

The nine generated sizes in `generated/` and in `web/public/brand/medshield/` come from
`scripts/build-brand-icons.mjs --brand medshield`. Its two flattened outputs sit on medshield's own dark
`bg-primary` `#07101a`, from the `BRAND_ICON_BACKGROUND` table in that script. Their sha256, dimensions
and byte counts are in `brand-icons.lock.json`, which `npm run icons -- --check` verifies.
