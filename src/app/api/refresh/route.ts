import { NextResponse } from 'next/server';
import { clearCache } from '@/lib/nocodb';

export async function POST() {
  clearCache();
  return NextResponse.json({ success: true, message: 'Cache cleared' });
}

