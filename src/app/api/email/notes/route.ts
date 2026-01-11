import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export interface TicketNote {
  id: string;
  ticket_key: string;
  author: string;
  content: string;
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
    .from('ticket_notes')
    .select('*')
    .eq('ticket_key', ticketKey)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: data });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticket_key, author, content } = body;

    if (!ticket_key || !author || !content) {
      return NextResponse.json(
        { error: 'ticket_key, author, and content are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('ticket_notes')
      .insert({
        ticket_key,
        author,
        content: content.trim(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, note: data });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
