import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/nocodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Dashboard data error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
