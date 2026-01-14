'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Mail,
  RefreshCw,
  ExternalLink,
  Clock,
  User,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  RotateCcw,
  Reply
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TicketNotes } from '@/components/email/TicketNotes';
import { TicketActivity } from '@/components/email/TicketActivity';
import { ComposeResponse } from '@/components/email/ComposeResponse';
import { ThreadMessages, ThreadMessage } from '@/components/email/ThreadMessages';
import { SearchInput } from '@/components/email/SearchInput';

interface EmailTicket {
  ticket_key: string;
  gmail_thread_id: string;
  customer_email: string;
  subject: string | null;
  summary: string | null;
  last_inbound_ts: string | null;
  last_outbound_ts: string | null;
  needs_response: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  responded_by: string | null;
  responded_at: string | null;
  status: 'awaiting_team_response' | 'awaiting_customer_response' | 'resolved';
  is_followup: boolean;
  response_count: number;
  created_at: string;
  updated_at: string;
  age_hours: number | null;
  age_display: string;
  is_stale: boolean;
  is_mass_email_thread: boolean;
}

interface SyncStatus {
  configured: boolean;
  lastSyncAt: string | null;
  ticketCount: number;
  messageCount: number;
}

export default function EmailQueuePage() {
  const { data: session } = useSession();
  const currentUser = session?.user?.email || '';
  const [tickets, setTickets] = useState<EmailTicket[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<'unclaimed' | 'followups' | 'claimed' | 'awaiting_customer_response' | 'resolved' | 'all'>('unclaimed');
  const [error, setError] = useState<string | null>(null);
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [threadCCs, setThreadCCs] = useState<Record<string, string[]>>({});

  const toggleExpanded = (ticketKey: string) => {
    setExpandedTickets(prev => {
      const next = new Set(prev);
      if (next.has(ticketKey)) {
        next.delete(ticketKey);
      } else {
        next.add(ticketKey);
      }
      return next;
    });
  };

  const handleThreadLoaded = useCallback((ticketKey: string, messages: ThreadMessage[]) => {
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    const ccs = lastMessage.cc_emails || [];
    setThreadCCs(prev => ({ ...prev, [ticketKey]: ccs }));
  }, []);

  const fetchTickets = useCallback(async () => {
    try {
      const params = new URLSearchParams({ filter });
      if (debouncedSearch.length >= 3) {
        params.set('search', debouncedSearch);
      }
      const response = await fetch(`/api/email/tickets?${params}`);
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setTickets(data.tickets || []);
        setError(null);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [filter, debouncedSearch]);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch('/api/email/sync?status=true');
      const data = await response.json();
      setSyncStatus(data);
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchTickets(), fetchSyncStatus()]);
      setLoading(false);
    };
    loadData();
  }, [fetchTickets]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/email/sync', { method: 'POST' });
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        await fetchTickets();
        await fetchSyncStatus();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  };

  const handleClaim = async (ticketKey: string, action: 'claim' | 'unclaim' | 'mark_responded' | 'reopen') => {
    if (!currentUser) return;
    setClaimingKey(ticketKey);
    try {
      const response = await fetch('/api/email/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_key: ticketKey,
          user_email: currentUser,
          action,
        }),
      });
      const data = await response.json();
      if (data.success) {
        await fetchTickets();
      } else if (data.error === 'already_claimed') {
        setError(`Already claimed by ${data.claimed_by}`);
        await fetchTickets();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setClaimingKey(null);
    }
  };

  const openInGmail = (threadId: string) => {
    // Direct link to thread in inbox view
    const url = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
    window.open(url, '_blank');
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col">
      <Header 
        title="Email Reply Queue" 
        description="Customer emails awaiting response"
      />

      <div className="p-4 md:p-8">
        {/* Search */}
        <div className="mb-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by customer email or keyword..."
            className="max-w-md"
          />
          {search.length > 0 && search.length < 3 && (
            <p className="text-xs text-zinc-400 mt-1">Type at least 3 characters to search</p>
          )}
        </div>

        {/* Status Bar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="flex gap-2 flex-wrap">
              {(['unclaimed', 'followups', 'awaiting_customer_response', 'claimed', 'resolved', 'all'] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "capitalize",
                    f === 'followups' && "bg-orange-100 hover:bg-orange-200 text-orange-700 border-orange-200"
                  )}
                >
                  {f === 'awaiting_customer_response' ? 'Awaiting Customer Reply' :
                   f === 'followups' ? 'Awaiting Team Reply' :
                   f === 'unclaimed' ? 'Unclaimed' :
                   f.replace('_', ' ')}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {syncStatus && (
              <div className="text-sm text-zinc-500">
                {syncStatus.configured ? (
                  <>
                    <span className="text-emerald-600">●</span> Gmail connected
                    {syncStatus.lastSyncAt && (
                      <> • Last sync: {formatTime(syncStatus.lastSyncAt)}</>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-amber-500">●</span> Gmail not configured
                  </>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing || !syncStatus?.configured}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </div>

        {/* Help Text */}
        <div className="mb-6 rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-2">
          <p className="text-sm text-blue-800">
            <strong>Workflow:</strong> Claim a ticket → Click <strong>Reply</strong> to compose your response →
            Send directly from this dashboard. Your reply will be sent from your Google account.
          </p>
          <p className="text-sm text-blue-700">
            <strong>Subject changes:</strong> If you change the subject, a new thread will be created in Gmail.
            The system will still track it as part of the same ticket.
          </p>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800">Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="ml-auto"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Queue Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-zinc-400" />
                <div>
                  <p className="text-2xl font-bold">{tickets.length}</p>
                  <p className="text-sm text-zinc-500">Showing</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {tickets.filter(t => t.needs_response && !t.claimed_by).length}
                  </p>
                  <p className="text-sm text-zinc-500">Unclaimed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {tickets.filter(t => t.claimed_by === currentUser).length}
                  </p>
                  <p className="text-sm text-zinc-500">My Claims</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {tickets.filter(t => t.is_stale).length}
                  </p>
                  <p className="text-sm text-zinc-500">Stale (&gt;24h)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tickets Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {filter === 'unclaimed' ? 'Unclaimed Tickets' :
               filter === 'followups' ? 'Awaiting Team Reply' :
               filter === 'claimed' ? 'Claimed Tickets' :
               filter === 'awaiting_customer_response' ? 'Awaiting Customer Reply' :
               filter === 'resolved' ? 'Resolved Tickets' : 'All Tickets'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                {debouncedSearch.length >= 3 ? (
                  <>
                    <Mail className="h-12 w-12 mx-auto mb-4 text-zinc-300" />
                    <p className="text-lg font-medium">No results found</p>
                    <p className="text-sm">No tickets match &quot;{debouncedSearch}&quot;</p>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 text-emerald-400" />
                    <p className="text-lg font-medium">All caught up!</p>
                    <p className="text-sm">No tickets matching this filter.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {tickets.map((ticket) => {
                  const isExpanded = expandedTickets.has(ticket.ticket_key);
                  return (
                  <div
                    key={ticket.ticket_key}
                    className={cn(
                      "p-4 rounded-lg border transition-colors",
                      ticket.is_stale && "bg-red-50 border-red-200",
                      ticket.claimed_by === currentUser && "bg-blue-50 border-blue-200",
                      !ticket.is_stale && ticket.claimed_by !== currentUser && "hover:bg-zinc-50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">
                            {ticket.customer_email}
                          </p>
                          {ticket.is_followup && ticket.needs_response && (
                            <Badge 
                              variant="outline" 
                              className="text-xs bg-orange-50 text-orange-700 border-orange-200"
                            >
                              <Reply className="h-3 w-3 mr-1" />
                              Follow-up{ticket.response_count > 1 ? ` #${ticket.response_count}` : ''}
                            </Badge>
                          )}
                          {ticket.is_stale && (
                            <Badge variant="destructive" className="text-xs">
                              Stale
                            </Badge>
                          )}
                          {ticket.status === 'awaiting_customer_response' && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200"
                            >
                              <MessageSquare className="h-3 w-3 mr-1" />
                              Awaiting Customer Reply
                            </Badge>
                          )}
                          {ticket.status === 'resolved' && (
                            <Badge 
                              variant="outline" 
                              className="text-xs bg-zinc-100 text-zinc-600"
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Resolved
                            </Badge>
                          )}
                          {ticket.claimed_by && (
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "text-xs",
                                ticket.claimed_by === currentUser 
                                  ? "bg-blue-100 text-blue-700 border-blue-200"
                                  : "bg-zinc-100 text-zinc-600"
                              )}
                            >
                              {`Claimed: ${ticket.claimed_by?.split('@')[0]}`}
                            </Badge>
                          )}
                        </div>
                        
                        {/* Summary - expandable */}
                        <button 
                          onClick={() => toggleExpanded(ticket.ticket_key)}
                          className="text-left w-full mt-1 group"
                        >
                          <p className={cn(
                            "text-sm text-zinc-600",
                            !isExpanded && "line-clamp-1"
                          )}>
                            {ticket.summary || ticket.subject || '(No subject)'}
                          </p>
                          {ticket.summary && (
                            <span className="text-xs text-blue-500 group-hover:text-blue-700 flex items-center gap-1 mt-1">
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-3 w-3" />
                                  Show less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3 w-3" />
                                  Show more
                                </>
                              )}
                            </span>
                          )}
                        </button>
                        
                        {ticket.subject && (
                          <p className="text-xs text-zinc-400 truncate mt-1">
                            Re: {ticket.subject}
                          </p>
                        )}

                        {/* Conversation, Notes and Activity - shown when expanded */}
                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-zinc-200 space-y-4">
                            <ThreadMessages
                              ticketKey={ticket.ticket_key}
                              onThreadLoaded={(msgs) => handleThreadLoaded(ticket.ticket_key, msgs)}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-zinc-100">
                              <TicketNotes ticketKey={ticket.ticket_key} currentUser={currentUser} />
                              <TicketActivity ticketKey={ticket.ticket_key} />
                            </div>
                          </div>
                        )}

                      <div className="flex items-center gap-4 mt-2 text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {ticket.age_display} ago
                        </span>
                        <span>
                          Customer: {formatTime(ticket.last_inbound_ts)}
                        </span>
                        {ticket.last_outbound_ts && (
                          <span className="text-emerald-600">
                            Team: {formatTime(ticket.last_outbound_ts)}
                          </span>
                        )}
                        {ticket.responded_by && (
                          <span className="text-zinc-500">
                            by {ticket.responded_by.split('@')[0]}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      {/* Action buttons based on status */}
                      {ticket.status === 'resolved' ? (
                        // Resolved tickets - option to reopen
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleClaim(ticket.ticket_key, 'reopen')}
                          disabled={claimingKey === ticket.ticket_key}
                        >
                          {claimingKey === ticket.ticket_key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Reopen
                            </>
                          )}
                        </Button>
                      ) : (
                        // Active tickets - show claim/unclaim and reply buttons
                        <>
                          {ticket.status === 'awaiting_customer_response' ? (
                            <span className="text-sm text-zinc-400 italic">Awaiting customer</span>
                          ) : (
                            <>
                              {ticket.claimed_by === currentUser ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleClaim(ticket.ticket_key, 'unclaim')}
                                  disabled={claimingKey === ticket.ticket_key}
                                >
                                  {claimingKey === ticket.ticket_key ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Unclaim'
                                  )}
                                </Button>
                              ) : !ticket.claimed_by ? (
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleClaim(ticket.ticket_key, 'claim')}
                                  disabled={claimingKey === ticket.ticket_key}
                                >
                                  {claimingKey === ticket.ticket_key ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Claim'
                                  )}
                                </Button>
                              ) : null}

                              {/* Mark as Replied - only available once claimed */}
                              {ticket.claimed_by && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleClaim(ticket.ticket_key, 'mark_responded')}
                                  disabled={claimingKey === ticket.ticket_key}
                                >
                                  {claimingKey === ticket.ticket_key ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Mark Replied'
                                  )}
                                </Button>
                              )}
                            </>
                          )}

                          {/* Reply from Dashboard - available to any team member once ticket is claimed */}
                          {ticket.claimed_by && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                setReplyingTo(ticket.ticket_key);
                                if (!expandedTickets.has(ticket.ticket_key)) {
                                  setExpandedTickets(prev => new Set([...prev, ticket.ticket_key]));
                                }
                              }}
                              disabled={replyingTo === ticket.ticket_key}
                              className="gap-1"
                            >
                              <Reply className="h-4 w-4" />
                              Reply
                            </Button>
                          )}
                        </>
                      )}

                      {/* Open in Gmail - search by sender email */}
                      <a
                        href={`https://mail.google.com/mail/u/0/#search/from:${encodeURIComponent(ticket.customer_email)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                        title={`Search: from:${ticket.customer_email}`}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Gmail
                      </a>
                    </div>
                    </div>

                    {/* Compose Response Form */}
                    {replyingTo === ticket.ticket_key && (
                      <div className="mt-4 pt-4 border-t border-zinc-200">
                        <ComposeResponse
                          ticketKey={ticket.ticket_key}
                          customerEmail={ticket.customer_email}
                          originalSubject={ticket.subject || ''}
                          threadId={ticket.gmail_thread_id}
                          isMassEmailThread={ticket.is_mass_email_thread}
                          existingCCs={threadCCs[ticket.ticket_key] || []}
                          onSent={() => {
                            setReplyingTo(null);
                            fetchTickets();
                          }}
                          onCancel={() => setReplyingTo(null)}
                        />
                      </div>
                    )}
                  </div>
                );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

