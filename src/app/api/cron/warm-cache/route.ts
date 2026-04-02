import { NextResponse } from 'next/server';
import { refreshDashboardCache, refreshVolunteerCache } from '@/lib/nocodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, { ok: boolean; durationMs: number; error?: string }> = {};
  const start = Date.now();

  try {
    const t0 = Date.now();
    await refreshDashboardCache();
    results.dashboard = { ok: true, durationMs: Date.now() - t0 };
  } catch (error) {
    console.error('[Cache Warm] Dashboard failed:', error);
    results.dashboard = { ok: false, durationMs: Date.now() - start, error: String(error) };
  }

  await delay(1000);

  try {
    const t0 = Date.now();
    await refreshVolunteerCache();
    results.volunteer = { ok: true, durationMs: Date.now() - t0 };
  } catch (error) {
    console.error('[Cache Warm] Volunteer failed:', error);
    results.volunteer = { ok: false, durationMs: Date.now() - (start + 1000), error: String(error) };
  }

  const totalMs = Date.now() - start;
  console.log(`[Cache Warm] Done in ${totalMs}ms:`, JSON.stringify(results));

  const allOk = Object.values(results).every(r => r.ok);
  return NextResponse.json(
    { success: allOk, durationMs: totalMs, results, warmedAt: new Date().toISOString() },
    { status: allOk ? 200 : 207 }
  );
}
