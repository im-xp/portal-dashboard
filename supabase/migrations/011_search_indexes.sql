-- Add tsvector column for full-text search on tickets
ALTER TABLE email_tickets
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(summary, '')), 'B')
) STORED;

-- Create GIN index for fast full-text search on tickets
CREATE INDEX IF NOT EXISTS idx_email_tickets_search
ON email_tickets USING GIN (search_vector);

-- Add tsvector column for message body search
ALTER TABLE email_messages
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(body, '')), 'B')
) STORED;

-- Create GIN index for fast full-text search on messages
CREATE INDEX IF NOT EXISTS idx_email_messages_search
ON email_messages USING GIN (search_vector);
