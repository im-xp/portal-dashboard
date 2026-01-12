-- Phase 2b: Thread-Ticket Mapping
-- Maps new Gmail threads back to their original tickets when subject changes

CREATE TABLE thread_ticket_mapping (
  gmail_thread_id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL REFERENCES email_tickets(ticket_key) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for reverse lookup (find all threads for a ticket)
CREATE INDEX idx_thread_mapping_ticket ON thread_ticket_mapping(ticket_key);

COMMENT ON TABLE thread_ticket_mapping IS
'Maps spawned Gmail threads to their parent tickets. When team responds with a changed subject, Gmail creates a new thread. This table links that new thread back to the original ticket.';
