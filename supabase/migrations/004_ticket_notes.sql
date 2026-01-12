-- Ticket notes for internal team communication and handoffs
CREATE TABLE ticket_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_key TEXT NOT NULL REFERENCES email_tickets(ticket_key) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ticket_notes_ticket_key ON ticket_notes(ticket_key);
CREATE INDEX idx_ticket_notes_created_at ON ticket_notes(created_at DESC);
