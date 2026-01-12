import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export interface TicketActivity {
  id: string;
  ticket_key: string;
  action: 'created' | 'claimed' | 'unclaimed' | 'responded' | 'reopened' | 'customer_replied';
  actor: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const ticketKey = request.nextUrl.searchParams.get('ticket_key');

  if (!ticketKey) {
    return NextResponse.json(
      { error: 'ticket_key is required' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('ticket_activity')
    .select('*')
    .eq('ticket_key', ticketKey)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: data });
}
