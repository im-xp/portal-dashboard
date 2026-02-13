import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/nocodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const startMs = Date.now();
    const data = await getDashboardData();
    const durationMs = Date.now() - startMs;
    const cacheStatus = durationMs < 100 ? 'HIT' : 'MISS';

    return new NextResponse(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
        'X-Cache-Status': cacheStatus,
        'Server-Timing': `fetch;dur=${durationMs}`,
      },
    });
  } catch (error) {
    console.error('[API] Dashboard data error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
