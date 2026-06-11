import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { canAccessWhatsApp } from '@/lib/whatsapp-access';
import {
  isMonotonicTransition,
  WHATSAPP_STATUS_PRECEDENCE,
  type WhatsAppStatus,
} from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

interface UpdateRequest {
  contact_key: string;
  action: 'status' | 'notes' | 'do_not_contact';
  status?: WhatsAppStatus;
  override?: boolean;
  notes?: string;
  do_not_contact?: boolean;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email;
  if (!actor || !canAccessWhatsApp(actor, session?.user?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: UpdateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { contact_key, action } = body;
  if (!contact_key || !action) {
    return NextResponse.json(
      { error: 'contact_key and action are required' },
      { status: 400 }
    );
  }

  const { data: contact, error: fetchError } = await supabase
    .from('whatsapp_contacts')
    .select('*')
    .eq('contact_key', contact_key)
    .single();

  if (fetchError || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  let update: Record<string, unknown>;
  let activityAction: string;
  let activityMeta: Record<string, unknown> = {};

  if (action === 'status') {
    const next = body.status;
    if (!next || !(next in WHATSAPP_STATUS_PRECEDENCE)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const current = contact.status as WhatsAppStatus;
    if (!isMonotonicTransition(current, next) && !body.override) {
      return NextResponse.json(
        {
          error: 'monotonic_violation',
          message: `Status is already '${current}'; pass override to demote.`,
          current,
        },
        { status: 409 }
      );
    }

    update = { status: next, updated_at: now };
    // Stamp milestone timestamps once; never clear them on demotion so the
    // history of what happened survives an override.
    if (next === 'contacted' && !contact.contacted_at) {
      update.contacted_at = now;
      update.contacted_by = actor;
    }
    if (next === 'responded' && !contact.responded_at) update.responded_at = now;
    if (next === 'converted' && !contact.converted_at) update.converted_at = now;

    activityAction = body.override ? 'status_overridden' : 'status_changed';
    activityMeta = { from: current, to: next };
  } else if (action === 'notes') {
    update = { notes: body.notes?.trim() || null, updated_at: now };
    activityAction = 'notes_updated';
  } else if (action === 'do_not_contact') {
    update = { do_not_contact: !!body.do_not_contact, updated_at: now };
    activityAction = body.do_not_contact
      ? 'marked_do_not_contact'
      : 'cleared_do_not_contact';
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from('whatsapp_contacts')
    .update(update)
    .eq('contact_key', contact_key)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabase.from('whatsapp_activity').insert({
    contact_key,
    action: activityAction,
    actor,
    metadata: activityMeta,
  });

  return NextResponse.json({ success: true, contact: updated });
}
