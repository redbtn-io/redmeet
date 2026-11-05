import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'redmeet',
    version: '0.1.0',
    at: new Date().toISOString(),
  });
}
