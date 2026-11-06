/**
 * `@redbtn/redlabel`: the one place a redbtn product is taught to wear somebody
 * else's face.
 *
 * This barrel is PURE. It imports zod and, from `src/tokens.ts` alone,
 * redstyle's token values. It never imports react, next, a node builtin,
 * `process.env`, `./brands` or console IO, so a non-Next, non-React consumer (a
 * CLI producing a branded PDF, an email renderer) imports `.` alone and installs
 * neither react nor next.
 *
 * The other entries are `./server` (request scoped, `server-only`), `./client`
 * (the provider and hooks), `./theme` (server-safe React elements), `./ui`,
 * `./next` and `./brands` (the static registry, server and build only).
 */
export * from './color';
export * from './tokens';
export * from './charts';
export * from './brand';
export * from './vocabulary';
export * from './features';
export * from './auth';
export * from './resolve';
export * from './wordmark';
export * from './powered-by';
export * from './platform';
export * from './export';
export * from './notify';
