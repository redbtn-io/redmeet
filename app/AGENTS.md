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
- **Deploys must be honest.** A host with no connected calendar still
  takes bookings locally, flagged `pending_calendar`, and availability
  reports `calendarConnected: false`; never fake a calendar event id,
  and never let a missing host credential fall back to anyone else's.
