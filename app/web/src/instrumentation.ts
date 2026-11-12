/**
 * Next.js instrumentation hook, runs once when the server process
 * starts. Boots the calendar reconciliation sweep (Epic 0) in the
 * Node runtime only: the sweep needs Mongo and the gateway client,
 * neither of which belongs in the edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCalendarReconciler } = await import('@/lib/reconcile');
    startCalendarReconciler();
  }
}
