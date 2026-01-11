'use client';

import { useState, useEffect } from 'react';
import { Loader2, Mail, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThreadMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  to_emails: string[];
  subject: string | null;
  body: string | null;
  snippet: string | null;
  internal_ts: string;
  direction: 'inbound' | 'outbound';
}

interface ThreadMessagesProps {
  ticketKey: string;
}

export function ThreadMessages({ ticketKey }: ThreadMessagesProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await fetch(`/api/email/thread?ticket_key=${ticketKey}`);
        const data = await response.json();
        setMessages(data.messages || []);
      } catch (error) {
        console.error('Failed to fetch thread messages:', error);
      } finally {
        setLoading(false);
      }
    };
    loadMessages();
  }, [ticketKey]);

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatSender = (email: string) => {
    return email.split('@')[0];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-sm text-zinc-400 py-4 text-center">
        No messages in this thread
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
        <Mail className="h-4 w-4" />
        Conversation ({messages.length} messages)
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
        {messages.map((msg) => {
          const isInbound = msg.direction === 'inbound';

          return (
            <div
              key={msg.gmail_message_id}
              className={cn(
                "flex flex-col gap-1 max-w-[85%]",
                isInbound ? "items-start" : "items-end ml-auto"
              )}
            >
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                {isInbound ? (
                  <ArrowDownLeft className="h-3 w-3 text-zinc-400" />
                ) : (
                  <ArrowUpRight className="h-3 w-3 text-blue-400" />
                )}
                <span className="font-medium">
                  {formatSender(msg.from_email)}
                </span>
                <span className="text-zinc-400">
                  {formatTime(msg.internal_ts)}
                </span>
              </div>

              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  isInbound
                    ? "bg-zinc-100 text-zinc-700"
                    : "bg-blue-50 text-zinc-700 border border-blue-100"
                )}
              >
                {msg.body ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {msg.body}
                  </pre>
                ) : (
                  <span className="text-zinc-400 italic">
                    {msg.snippet || '(No content)'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
