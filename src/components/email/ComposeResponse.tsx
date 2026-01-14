'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Send, AlertTriangle, CheckCircle, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComposeResponseProps {
  ticketKey: string;
  customerEmail: string;
  originalSubject: string;
  threadId: string;
  isMassEmailThread?: boolean;
  existingCCs?: string[];
  onSent?: () => void;
  onCancel?: () => void;
}

export function ComposeResponse({
  ticketKey,
  customerEmail,
  originalSubject,
  threadId,
  isMassEmailThread = false,
  existingCCs = [],
  onSent,
  onCancel,
}: ComposeResponseProps) {
  const replySubject = originalSubject.startsWith('Re:')
    ? originalSubject
    : `Re: ${originalSubject}`;

  const [subject, setSubject] = useState(replySubject);
  const [ccList, setCcList] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [showCcInput, setShowCcInput] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedCCs = useRef(false);

  useEffect(() => {
    if (initializedCCs.current || existingCCs.length === 0) return;
    initializedCCs.current = true;
    const normalizedCustomer = customerEmail.toLowerCase();
    const filtered = existingCCs
      .map(e => e.toLowerCase())
      .filter(e => e !== normalizedCustomer && !e.endsWith('@im-xp.com'));
    setCcList([...new Set(filtered)]);
  }, [existingCCs, customerEmail]);

  const subjectChanged =
    subject.trim().toLowerCase() !== replySubject.trim().toLowerCase();

  const addCc = (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (normalized && !ccList.includes(normalized) && normalized !== customerEmail.toLowerCase()) {
      setCcList([...ccList, normalized]);
    }
    setCcInput('');
    setShowCcInput(false);
  };

  const removeCc = (email: string) => {
    setCcList(ccList.filter(e => e !== email));
  };

  const handleCcKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCc(ccInput);
    } else if (e.key === 'Escape') {
      setCcInput('');
      setShowCcInput(false);
    }
  };

  const handleSend = async (markResolved = false) => {
    if (!body.trim() || sending) return;

    setSending(true);
    setError(null);

    try {
      const response = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_key: ticketKey,
          to_email: customerEmail,
          cc_emails: ccList.length > 0 ? ccList.join(', ') : undefined,
          subject: subject.trim(),
          body: body.trim(),
          original_subject: replySubject,
          thread_id: threadId,
          mark_resolved: markResolved,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      setBody('');
      setCcList([]);
      setCcInput('');
      setSubject(replySubject);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3 p-4 bg-white border rounded-lg shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-zinc-800">Reply to Customer</h3>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      <div className="text-sm text-zinc-500">
        To: <span className="font-medium text-zinc-700">{customerEmail}</span>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-700">CC</label>
        <div className="flex flex-wrap items-center gap-1.5 min-h-[36px] border rounded-md px-2 py-1.5 bg-white">
          {ccList.map(email => (
            <span
              key={email}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 text-zinc-700 text-sm rounded-md"
            >
              {email}
              <button
                type="button"
                onClick={() => removeCc(email)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {showCcInput ? (
            <input
              type="email"
              value={ccInput}
              onChange={(e) => setCcInput(e.target.value)}
              onKeyDown={handleCcKeyDown}
              onBlur={() => {
                if (ccInput.trim()) addCc(ccInput);
                else setShowCcInput(false);
              }}
              placeholder="email@example.com"
              className="flex-1 min-w-[150px] text-sm outline-none bg-transparent py-0.5"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowCcInput(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-sm text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 rounded-md"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-700">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={cn(
            'w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2',
            subjectChanged
              ? 'border-amber-300 focus:ring-amber-500 bg-amber-50'
              : 'focus:ring-blue-500'
          )}
        />
        {isMassEmailThread && !subjectChanged && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 mt-1 font-medium">
            <AlertTriangle className="h-3 w-3" />
            Mass email reply - you must change the subject to create a new thread
          </div>
        )}
        {subjectChanged && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-1">
            <AlertTriangle className="h-3 w-3" />
            Subject changed - this will create a new thread in Gmail
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-700">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type your response..."
          rows={6}
          className="w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={() => handleSend(false)}
          disabled={!body.trim() || sending || (isMassEmailThread && !subjectChanged)}
          variant="outline"
          className="gap-2"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Send Reply
            </>
          )}
        </Button>
        <Button
          onClick={() => handleSend(true)}
          disabled={!body.trim() || sending || (isMassEmailThread && !subjectChanged)}
          className="gap-2"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              Send & Resolve
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
