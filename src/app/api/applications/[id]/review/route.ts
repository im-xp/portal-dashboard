import { NextRequest, NextResponse } from 'next/server';
import { reviewApplication } from '@/lib/edgeos-api';
import { patchVolunteerInCache } from '@/lib/nocodb';
import type { ReviewApplicationBody } from '@/lib/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (isNaN(applicationId)) {
    return NextResponse.json({ error: 'Invalid application ID' }, { status: 400 });
  }

  let body: ReviewApplicationBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.status !== 'accepted' && body.status !== 'rejected' && body.status !== 'withdrawn') {
    return NextResponse.json({ error: 'status must be "accepted", "rejected", or "withdrawn"' }, { status: 400 });
  }

  try {
    const result = await reviewApplication(applicationId, body);

    await patchVolunteerInCache(applicationId, {
      status: body.status,
      coordinator_notes: body.coordinator_notes ?? null,
      discount_assigned: body.discount_assigned ?? null,
      assigned_segment_slugs: body.segment_slugs ?? [],
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(`[API] Failed to review application ${applicationId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('400') ? 400 : message.includes('403') ? 403 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
