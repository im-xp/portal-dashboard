import { NextRequest, NextResponse } from 'next/server';
import { fetchSegments } from '@/lib/edgeos-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const slug = request.nextUrl.searchParams.get('popup_city_slug');
  if (!slug) {
    return NextResponse.json({ error: 'popup_city_slug is required' }, { status: 400 });
  }

  try {
    const segments = await fetchSegments(slug);
    return NextResponse.json(segments);
  } catch (error) {
    console.error('[API] Failed to fetch segments:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
