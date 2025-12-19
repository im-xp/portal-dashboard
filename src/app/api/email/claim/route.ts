import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface ClaimRequest {
  ticket_key: string;
  user_email: string;
  action: 'claim' | 'unclaim';
}

export async function POST(request: NextRequest) {
  try {
    const body: ClaimRequest = await request.json();
    const { ticket_key, user_email, action } = body;

    if (!ticket_key || !user_email) {
      return NextResponse.json(
        { error: 'ticket_key and user_email are required' },
        { status: 400 }
      );
    }

    if (action === 'claim') {
      // Atomic claim - only succeeds if not already claimed
      // We use a raw SQL query for atomic update
      const { data, error } = await supabase
        .from('email_tickets')
        .update({
          claimed_by: user_email,
          claimed_at: new Date().toISOString(),
        })
        .eq('ticket_key', ticket_key)
        .is('claimed_by', null)  // Only if not already claimed
        .select()
        .single();

      if (error) {
        // Check if it's a "no rows" error (already claimed)
        if (error.code === 'PGRST116') {
          // Fetch who has it claimed
          const { data: existing } = await supabase
            .from('email_tickets')
            .select('claimed_by, claimed_at')
            .eq('ticket_key', ticket_key)
            .single();

          return NextResponse.json({
            success: false,
            error: 'already_claimed',
            claimed_by: existing?.claimed_by,
            claimed_at: existing?.claimed_at,
          }, { status: 409 });
        }

        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        ticket: data,
        action: 'claimed',
      });
    } else if (action === 'unclaim') {
      // Allow unclaiming only if the user is the one who claimed it
      // Or if we want to allow anyone to unclaim, remove the eq check
      const { data, error } = await supabase
        .from('email_tickets')
        .update({
          claimed_by: null,
          claimed_at: null,
        })
        .eq('ticket_key', ticket_key)
        .eq('claimed_by', user_email)  // Only if you're the claimer
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return NextResponse.json({
            success: false,
            error: 'not_your_claim',
          }, { status: 403 });
        }

        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        ticket: data,
        action: 'unclaimed',
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "claim" or "unclaim"' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[Claim API] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

