import { NextResponse } from 'next/server';
import { getPopupCities } from '@/lib/nocodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cities = await getPopupCities();
    return NextResponse.json(cities);
  } catch (error) {
    console.error('[API] Failed to fetch popup cities:', error);
    return NextResponse.json([], { status: 200 });
  }
}
