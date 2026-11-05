# AGENTS.md, redMeet

## What this is

redMeet (`meet.redbtn.io`) is simple meeting scheduling: a host gets one
personal booking link (`meet.redbtn.io/<slug>`), guests pick a meeting type
and a time, and the booking lands on the host's real calendar. It is the
2026 rebuild of the original 2025 redMeet (see `../original-2025` in this
repo, which is the product spec and stays untouched): same routes, same
booking flow, new foundations.

## House rules (copied from the estate, do not drift)

1. **Monorepo, npm workspaces.** `web` + `packages/*`. Build web with
   `npm run build -w web` from this directory (the redRun build context
   root, gitSource baseDirectory `app`).
2. **Tracing root is this directory.** `web/next.config.ts` asserts it.
3. **No secrets in the repo or the image.** `.npmrc` carries no credential;
   RedRun injects the npmrc BuildKit secret. Runtime secrets come from
   `appConfig.env` and are read at first use, never at module load, never
   during `next build`.
4. **Auth:** redMeet mints nothing. Verify the shared `red_session` cookie
   from `accounts.redbtn.io`: JWT gate + device-session liveness gate,
   both required, fail closed. Sign-out is POST only.
5. **Contracts live in `@redmeet/core`.** zod schemas + pure functions
   (slugs, availability math). No duplicated shapes.
6. **Guests need no account.** `/<slug>` and `/<slug>/<meeting>` are
   public; the proxy exempts them by shape and the slug validator reserves
   every app word (`app`, `api`, `signout`, ...) so a host slug can never
   shadow a route.

## redMeet specifics

- **Calendar rides redbtn connections, server-side only.** The app calls
  the MCP gateway (`mcp.redbtn.io`) `google/calendar` namespace with its
  platform PAT (`REDMEET_MCP_PAT` in app env): `gcal_freebusy_query` for
  availability, `gcal_events_insert` for the confirmed booking. The old
  2025 `api.redbtn.io` contract is dead and must not be revived.
- **V1 tenancy:** the PAT is George's, so calendar ops act on George's
  linked Google accounts (host #1). `MeetHost.googleConnectionId` is the
  seam for per-host connections when per-user PATs exist; until then a
  host profile without George's connection still books, but availability
  falls back to the app's own booking records plus the default account.
- **Availability is the original's rules, ported:** 30 minute slots,
  weekdays 10:00 to 20:00, weekends 10:00 to 14:00, America/New_York,
  one slot of buffer before each busy block, same-day slots need two
  hours of lead, two month horizon. The pure math lives in
  `@redmeet/core` (`availability.ts`); the busy blocks come from the
  gateway, never from the client.
- **The app owns its store.** Mongo via the house mongoose singleton:
  `MeetHost`, `MeetType`, `MeetBooking`. A booking is only `confirmed`
  after the calendar event write succeeds; a failed write surfaces to the
  guest as an error, never as a fake confirmation.
- **Deploys must be honest.** No `REDMEET_MCP_PAT` means bookings still
  record locally but the response says the calendar write is pending;
  never fake a calendar event id.
