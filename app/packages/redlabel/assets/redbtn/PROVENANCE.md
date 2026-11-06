# redbtn mark, provenance

The glossy red disc with a specular highlight and a soft drop shadow on transparency. redLabel owns it
from now on; before this, nobody did, and two divergent copies exist elsewhere in the tree.

- md5: 259319c75056c08bcdaf89b9e03d7248
- bytes: 244490
- dimensions: 1024x1024
- format: PNG, RGBA, transparent background

Verified byte identical on 2026-09-21 at all four of:

- `~/code/redoffice/public/logo.png`
- `~/code/redboard/public/logo.png`
- `~/code/accounts/public/logo.png`
- `~/code/@redbtn/webapp/public/logo.png`

Two known divergent copies, which are NOT this file and must not be used: `355889ae...` in redAct and
`~/indy/assets/red.png`, and `8ef669eb...` in `~/code/sites/production`.

`scripts/build-brand-icons.mjs` reads the md5 above and exits non-zero on a mismatch, so a silently
replaced master cannot propagate into a generated icon set.
