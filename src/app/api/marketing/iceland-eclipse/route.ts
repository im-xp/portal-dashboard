import { NextResponse } from 'next/server';
import { getIcelandEclipseCampaign } from '@/lib/marketing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await getIcelandEclipseCampaign();
  return NextResponse.json(result);
}
