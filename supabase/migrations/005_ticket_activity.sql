-- Activity log for tracking ticket state changes
CREATE TABLE ticket_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_key TEXT NOT NULL REFERENCES email_tickets(ticket_key) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'claimed', 'unclaimed', 'responded', 'reopened', 'customer_replied', 'created'
  actor TEXT, -- email of team member, null for system actions, 'customer' for inbound
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ticket_activity_ticket_key ON ticket_activity(ticket_key);
CREATE INDEX idx_ticket_activity_created_at ON ticket_activity(created_at DESC);
