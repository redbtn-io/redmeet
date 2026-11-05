# redMeet

**One link in, a booked meeting out.**

redMeet (`meet.redbtn.io`) is simple meeting scheduling on the redbtn
stack. Sign in with your redbtn account, claim your slug, share
`meet.redbtn.io/<you>`. Guests pick a meeting type, a date, and a time
that respects your real Google calendar (read through redbtn's own
connections), and the confirmed booking is written back onto that
calendar. Guests never need an account.

This is the 2026 rebuild of the original 2025 redMeet app, which lives
untouched in `../original-2025` and serves as the product spec: same
booking page, same date and time pickers, same agenda. The rebuild swaps
the 2025 foundations (Firebase auth, the retired `api.redbtn.io`) for
redbtn SSO (`accounts.redbtn.io`), the MCP gateway's `google/calendar`
namespace, Mongo, and a redRun deployment, following the redSites house
pattern.

## Layout

- `web`, the Next.js app (landing, `/app` dashboard and settings, public
  booking pages, API).
- `packages/redlabel`, brand registry and the SSO sign-in seam.
- `packages/core`, `@redmeet/core`: zod contracts and the pure
  availability math.

## Run

Runtime configuration is env-only and read at first use; see
`web/.env.example` for the names. In production this runs as a redRun
app workspace (gitSource: this repo, baseDirectory `app`, branch
`main`), custom domain `meet.redbtn.io`.
