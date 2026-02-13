import { NextResponse } from 'next/server';
import { refreshDashboardCache } from '@/lib/nocodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const start = Date.now();
    await refreshDashboardCache();
    const duration = Date.now() - start;
    console.log(`[Cache Warm] Dashboard cache refreshed in ${duration}ms`);
    return NextResponse.json({ success: true, durationMs: duration, warmedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[Cache Warm] Failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
