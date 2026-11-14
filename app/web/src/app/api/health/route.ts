import { NextResponse } from 'next/server';

import { checkHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health, a REAL health check (Epic 0). Reports the state of
 * the dependencies the app cannot work without, Mongo, the MCP
 * gateway, LiveKit, and token readiness (Epic 5: a mint and
 * verify roundtrip proving the configured LiveKit key pair
 * works, the operation the token endpoints depend on), and
 * answers 503 when any is down, so a monitor (or a
 * human) can tell a wedged deployment from a healthy one. The old
 * version returned a static ok and checked nothing.
 */
export async function GET() {
  const report = await checkHealth();
  return NextResponse.json(
    {
      ok: report.ok,
      service: 'redmeet',
      version: '0.1.0',
      at: new Date().toISOString(),
      checks: report.checks,
    },
    { status: report.ok ? 200 : 503 },
  );
}
