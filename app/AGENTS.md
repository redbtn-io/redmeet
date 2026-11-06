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

- **Calendar rides redbtn connections, server-side only, PER HOST.**
  The app calls the MCP gateway (`mcp.redbtn.io`) `google/calendar`
  namespace under the HOST'S OWN redbtn credential: `MeetHost.
  gatewayCredential` is the host's personal access token, sealed at
  rest (AES-256-GCM, `lib/secrets.ts`, the redauth SSO sealing format),
  and each call carries the `x-redbtn-connection-id` header naming the
  connection that call acts through. The gateway resolves that id
  against the credential owner's own connections only. Never call the
  gateway with an ambient/app credential for calendar work, and never
  use `google_account_use` (it mutates the user's account-level
  default). `gcal_freebusy_query` for availability,
  `gcal_events_insert` for the confirmed booking. The old 2025
  `api.redbtn.io` contract is dead and must not be revived.
- **Calendar scope spans ALL of a host's connections.** A host's
  schedule rarely lives on one google account, so the blocking set is
  `MeetHost.calendarSelection`: (connection, calendar) pairs across
  ANY of the host's linked accounts, with display metadata. Settings
  lists every connection via `google_accounts_list` and every
  calendar via `gcal_calendarlist_list` per connection (grouped by
  account email in the UI); availability runs one free/busy query per
  connection and merges the busy blocks; booking events write to the
  single `calendarWriteTarget` pair. The older single-connection
  fields (`calendarIds`, `googleConnectionId`) are legacy: a record
  with no selection is converted forward from them on first resolve
  (`lib/calendar-auth.ts`), and `calendarIds` is kept only as a flat
  mirror. A connected host always keeps at least one ticked calendar;
  disconnecting is how they have none.
- **Connecting is self serve and ownership-proven.** Settings walks the
  host through linking Google in redbtn Connections and minting a token
  in redbtn Settings, then `/api/v0/calendar/validate` proves the token
  belongs to the signed-in host (hub whoami) and lists accounts under
  it; `/api/v0/calendar/connect` re-checks both proofs before sealing
  anything, and records every account in that listing as a usable
  connection. A connection id may ONLY ever be stored when it came
  from a list under that same credential, so connection ids are not
  patchable through the profile route; a calendar selection saved
  through the profile route is re-proven the same way (every
  connectionId re-listed, every calendarId re-checked on its
  connection, metadata taken from the listings) before it is stored.
- **The legacy platform PAT is a migration source, nothing more.**
  `REDMEET_MCP_PAT` in app env is the v1 build's app-level PAT. When a
  host with no credential resolves calendar auth, `lib/calendar-auth.ts`
  checks whether that PAT belongs to the host (whoami match) and, if
  so, seals it into their record; from then on there is exactly one
  code path. A host with no credential gets own-bookings-only
  availability, labelled "calendar not connected" in Settings and on
  the dashboard, and bookings record as `pending_calendar`. Their
  slots NEVER resolve against another host's calendar.
- **Availability is the original's rules, ported, with the host's own
  hours:** 30 minute slots, one slot of buffer before each busy block,
  same-day slots need two hours of lead, two month horizon,
  America/New_York. The booking windows are per host:
  `MeetHost.availabilityWindows` (weekday and weekend start/end,
  "HH:mm"), set in Settings and validated by `@redmeet/core` (start
  before end, 30 minute alignment). The defaults are the original's
  hardcoded hours (weekdays 10:00 to 20:00, weekends 10:00 to 14:00),
  and `availableSlots` takes the host's windows as an input, so a host
  who never sets them sees no change. The pure math lives in
  `@redmeet/core` (`availability.ts`); the busy blocks come from the
  gateway, never from the client.
- **Brand and theme: canonical `@redbtn/redlabel`, ported from redscan.**
  `packages/redlabel` is the estate canonical package (brand schema,
  registry, host resolution, theme emitters, themable primitives),
  vendored the way redscan vendors it, NOT the v0 shim it replaced. The
  library code and its test suite are the canonical ones; the deployment
  data is redMeet's: the registry (`src/brands`) registers the shipped
  reference brands (`redbtn`, `redbtn-beta`, `medshield`, the package's
  fixtures) plus redMeet's own brand (`src/brands/redmeet.ts`, id
  `redmeet`, hosts `meet.redbtn.io`, ecosystem auth, empty token
  overrides: the redbtn face IS bare redstyle). The deployment names
  itself with `REDMEET_DEFAULT_BRAND_ID` (the canonical env contract,
  per-product prefix), asserted together with the auth plan on first
  request in `lib/session.ts`, never at module load. Theming: the root
  layout renders `brandStyleProps(brand)` and the literal `dark` default
  class on `<html>`, with `ThemeStyle` and `BrandThemeScript` in `<head>`;
  the boot script applies the stored theme (localStorage key
  `redstyle-theme`, default dark) synchronously before first paint, so
  the served `dark` class is a default, not a pin. redstyle's
  `tokens.css` carries both schemes (`:root`/`:root.dark` and
  `:root.light`), so light is a real scheme. The theme toggle is the
  app's own (`web/src/components/ThemeToggle.tsx`): the canonical split
  is redLabel owns the machinery, the app owns the control, and the
  toggle speaks the boot script's protocol exactly. Brand assets live in
  `web/public/brand/redbtn` (copied from the package's `assets/` by its
  icons script); the proxy exempts `/brand/` on purpose, because gating
  it would 302 a signed-out visitor's brand mark to the sign-in host.
  `web/src/lib/brand.ts` registers the registry once via
  `configureBrand`; server code takes the request's brand from
  `getBrand()` and never imports the registry into a client graph (it is
  `server-only` by enforcement, not convention).
- **The app owns its store.** Mongo via the house mongoose singleton:
  `MeetHost`, `MeetType`, `MeetBooking`. A booking is only `confirmed`
  after the calendar event write succeeds; a failed write surfaces to the
  guest as an error, never as a fake confirmation.
- **Deploys must be honest.** A host with no connected calendar still
  takes bookings locally, flagged `pending_calendar`, and availability
  reports `calendarConnected: false`; never fake a calendar event id,
  and never let a missing host credential fall back to anyone else's.
