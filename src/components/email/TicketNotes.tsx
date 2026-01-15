'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, MessageSquare, Send, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Note {
  id: string;
  ticket_key: string;
  author: string;
  content: string;
  created_at: string;
}

interface TicketNotesProps {
  ticketKey: string;
  currentUser: string;
}

export function TicketNotes({ ticketKey, currentUser }: TicketNotesProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [collapsed, setCollapsed] = useState(true);

  const fetchNotes = useCallback(async () => {
    try {
      const response = await fetch(`/api/email/notes?ticket_key=${ticketKey}`);
      const data = await response.json();
      setNotes(data.notes || []);
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    } finally {
      setLoading(false);
    }
  }, [ticketKey]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/email/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_key: ticketKey,
          author: currentUser,
          content: newNote.trim(),
        }),
      });

      if (response.ok) {
        setNewNote('');
        await fetchNotes();
      }
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900 w-full"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        <MessageSquare className="h-4 w-4" />
        Internal Notes
        {notes.length > 0 && (
          <span className="text-xs text-zinc-400 font-normal">({notes.length})</span>
        )}
      </button>

      {!collapsed && (
        <>
          {notes.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto pl-6">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className={cn(
                    "p-2 rounded-md text-sm",
                    note.author === currentUser
                      ? "bg-blue-50 border border-blue-100"
                      : "bg-zinc-50 border border-zinc-100"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-zinc-700">
                      {note.author.split('@')[0]}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatTime(note.created_at)}
                    </span>
                  </div>
                  <p className="text-zinc-600 whitespace-pre-wrap">{note.content}</p>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2 pl-6">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note for the team..."
              className="flex-1 text-sm border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!newNote.trim() || submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
