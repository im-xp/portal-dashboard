'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmailTicket {
  ticket_key: string;
  gmail_thread_id: string;
  customer_email: string;
  subject: string | null;
  last_inbound_ts: string | null;
  last_outbound_ts: string | null;
  needs_response: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  age_hours: number | null;
  age_display: string;
  is_stale: boolean;
}

interface SyncStatus {
  configured: boolean;
  lastSyncAt: string | null;
  ticketCount: number;
  messageCount: number;
}

const SUPPORT_EMAIL = 'theportalsupport@icelandeclipse.com';

// Team members who can claim tickets
const TEAM_MEMBERS = [
  'jon@im-xp.com',
  'maryliz@im-xp.com',
  'mitch@im-xp.com',
  'james@im-xp.com',
];

export default function EmailQueuePage() {
  const [tickets, setTickets] = useState<EmailTicket[]>([]);
  const [currentUser, setCurrentUser] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<'needs_response' | 'claimed' | 'unclaimed' | 'all'>('needs_response');
  const [error, setError] = useState<string | null>(null);

  // Load current user from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('email-queue-user');
    if (saved && TEAM_MEMBERS.includes(saved)) {
      setCurrentUser(saved);
    } else {
      setCurrentUser(TEAM_MEMBERS[0]);
    }
  }, []);

  // Save current user to localStorage when changed
  const handleUserChange = (email: string) => {
    setCurrentUser(email);
    localStorage.setItem('email-queue-user', email);
  };

  const fetchTickets = useCallback(async () => {
    try {
      const response = await fetch(`/api/email/tickets?filter=${filter}`);
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
  }, [filter]);

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch('/api/email/sync');
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

  const handleClaim = async (ticketKey: string, action: 'claim' | 'unclaim') => {
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
    const url = `https://mail.google.com/mail/?authuser=${SUPPORT_EMAIL}#all/${threadId}`;
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
        {/* Status Bar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              {(['needs_response', 'unclaimed', 'claimed', 'all'] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="capitalize"
                >
                  {f.replace('_', ' ')}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* User Selector */}
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-zinc-400" />
              <select
                value={currentUser}
                onChange={(e) => handleUserChange(e.target.value)}
                className="text-sm border rounded-md px-2 py-1 bg-white"
              >
                {TEAM_MEMBERS.map((email) => (
                  <option key={email} value={email}>
                    {email.split('@')[0]}
                  </option>
                ))}
              </select>
            </div>

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
              {filter === 'needs_response' ? 'Needs Response' : 
               filter === 'claimed' ? 'Claimed Tickets' :
               filter === 'unclaimed' ? 'Unclaimed Tickets' : 'All Tickets'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 text-emerald-400" />
                <p className="text-lg font-medium">All caught up!</p>
                <p className="text-sm">No tickets matching this filter.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tickets.map((ticket) => (
                  <div
                    key={ticket.ticket_key}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-lg border transition-colors",
                      ticket.is_stale && "bg-red-50 border-red-200",
                      ticket.claimed_by === currentUser && "bg-blue-50 border-blue-200",
                      !ticket.is_stale && ticket.claimed_by !== currentUser && "hover:bg-zinc-50"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {ticket.customer_email}
                        </p>
                        {ticket.is_stale && (
                          <Badge variant="destructive" className="text-xs">
                            Stale
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
                      <p className="text-sm text-zinc-500 truncate mt-1">
                        {ticket.subject || '(No subject)'}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {ticket.age_display} ago
                        </span>
                        <span>
                          Last inbound: {formatTime(ticket.last_inbound_ts)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      {/* Claim/Unclaim Button */}
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

                      {/* Open in Gmail */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openInGmail(ticket.gmail_thread_id)}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Gmail
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help Text */}
        <div className="mt-6 rounded-lg bg-blue-50 border border-blue-200 p-4">
          <p className="text-sm text-blue-800">
            <strong>Workflow:</strong> Claim a ticket → Open in Gmail → Reply from{' '}
            <code className="bg-blue-100 px-1 rounded">{SUPPORT_EMAIL}</code> →
            {' '}Ticket will auto-clear on next sync.
          </p>
        </div>
      </div>
    </div>
  );
}

