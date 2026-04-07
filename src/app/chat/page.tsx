'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageCircle,
  Plus,
  Send,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Trash2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatSession {
  id: number;
  title: string;
  updatedAt: string;
  createdAt: string;
}

interface Source {
  /** Inline citation label matching the model's reply, e.g. "[Source 1]". */
  sourceLabel: string;
  filename: string;
  chunkIndex: number;
  pageNumber: number;
  /** Short preview of the chunk used as a tooltip. */
  content: string;
  /** Cosine similarity score [0, 1]. */
  similarity: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showSources, setShowSources] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Scroll to bottom ----
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // ---- Load sessions ----
  useEffect(() => {
    async function loadSessions() {
      try {
        const result = await apiFetch<ChatSession[]>('/api/chat/sessions');
        setSessions(result);
      } catch {
        // Silently handle - user sees empty list
      } finally {
        setSessionsLoading(false);
      }
    }
    loadSessions();
  }, []);

  // ---- Focus rename input when entering rename mode ----
  useEffect(() => {
    if (renamingId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  // ---- Load messages for active session ----
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }

    async function loadMessages() {
      try {
        const session = await apiFetch<{ messages: any[] }>(
          `/api/chat/sessions/${activeSessionId}`
        );
        const msgs: ChatMessage[] = (session.messages || []).map((m: any) => ({
          id: String(m.id),
          role: m.role === 'USER' ? 'user' : m.role === 'ASSISTANT' ? 'assistant' : 'user',
          content: m.content,
          sources: m.sources || undefined,
          created_at: m.createdAt,
        }));
        setMessages(msgs);
      } catch {
        setMessages([]);
      }
    }
    loadMessages();
  }, [activeSessionId]);

  // ---- Create new session ----
  const createNewSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setRenamingId(null);
    inputRef.current?.focus();
  };

  // ---- Select session ----
  const selectSession = (id: number) => {
    if (renamingId !== null) return; // Don't switch while renaming
    setActiveSessionId(id);
  };

  // ---- Delete session ----
  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiFetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch {
      // silent
    }
  };

  // ---- Start rename ----
  const startRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  // ---- Commit rename ----
  const commitRename = async (id: number) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    // Optimistic update
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s))
    );
    setRenamingId(null);
    try {
      await apiFetch(`/api/chat/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: trimmed }),
      });
    } catch {
      // Revert on failure by re-fetching sessions
      try {
        const updated = await apiFetch<ChatSession[]>('/api/chat/sessions');
        setSessions(updated);
      } catch {
        // silent
      }
    }
  };

  // ---- Cancel rename ----
  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  // ---- Handle rename key events ----
  const handleRenameKeyDown = (e: React.KeyboardEvent, id: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id);
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  };

  // ---- Send message ----
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const payload: Record<string, unknown> = { message: text };
      if (activeSessionId) {
        payload.sessionId = activeSessionId;
      }

      const response = await apiFetch<{
        sessionId: number;
        message: string;
        sources?: Source[];
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ ...payload, showSources }),
      });

      // If this was a new session, update session list
      if (!activeSessionId && response.sessionId) {
        setActiveSessionId(response.sessionId);
        const updatedSessions = await apiFetch<ChatSession[]>('/api/chat/sessions');
        setSessions(updatedSessions);
      } else if (activeSessionId && response.sessionId) {
        // Refresh session list to pick up updated title / timestamp
        const updatedSessions = await apiFetch<ChatSession[]>('/api/chat/sessions');
        setSessions(updatedSessions);
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        sources: response.sources,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Sorry, an error occurred: ${errorMsg}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-full">
      {/* Session sidebar */}
      <div
        className={cn(
          'flex-shrink-0 border-r border-gray-200 bg-white flex flex-col transition-all duration-200',
          sidebarOpen ? 'w-[280px]' : 'w-0 overflow-hidden'
        )}
      >
        {/* New chat button */}
        <div className="p-3 border-b border-gray-200">
          <Button onClick={createNewSession} className="w-full gap-2" size="sm">
            <Plus className="w-4 h-4" />
            New Chat
          </Button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {sessionsLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-8 px-4">
              No conversations yet. Start a new chat.
            </p>
          ) : (
            sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                isRenaming={renamingId === session.id}
                renameValue={renameValue}
                renameInputRef={renamingId === session.id ? renameInputRef : undefined}
                onSelect={() => selectSession(session.id)}
                onDelete={(e) => deleteSession(session.id, e)}
                onStartRename={(e) => startRename(session, e)}
                onRenameChange={setRenameValue}
                onRenameKeyDown={(e) => handleRenameKeyDown(e, session.id)}
                onRenameCommit={() => commitRename(session.id)}
                onRenameCancel={cancelRename}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-black transition-colors"
              aria-label="Toggle session list"
            >
              <MessageCircle className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-semibold text-black">
              {activeSessionId
                ? sessions.find((s) => s.id === activeSessionId)?.title ?? 'Chat'
                : 'New Conversation'}
            </h2>
          </div>
          <button
            onClick={() => setShowSources((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors',
              showSources
                ? 'text-black bg-gray-100'
                : 'text-gray-500 hover:bg-gray-100'
            )}
          >
            {showSources ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Sources
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-black" />
              </div>
              <h3 className="text-lg font-semibold text-black mb-1">
                Start a conversation with your Second Self
              </h3>
              <p className="text-sm text-gray-500 max-w-md">
                Ask questions about your uploaded documents. Your AI clone will answer based on your
                knowledge base.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  showSources={showSources}
                />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-gray-200 p-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              size="icon"
              className="flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionItem sub-component
// ---------------------------------------------------------------------------

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef?: React.RefObject<HTMLInputElement>;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onStartRename: (e: React.MouseEvent) => void;
  onRenameChange: (value: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function SessionItem({
  session,
  isActive,
  isRenaming,
  renameValue,
  renameInputRef,
  onSelect,
  onDelete,
  onStartRename,
  onRenameChange,
  onRenameKeyDown,
  onRenameCommit,
  onRenameCancel,
}: SessionItemProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group w-full text-left rounded-lg px-3 py-2.5 transition-colors cursor-pointer',
        isActive
          ? 'bg-gray-100 text-black'
          : 'text-black hover:bg-gray-100'
      )}
    >
      {isRenaming ? (
        /* ── Inline rename row ── */
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={onRenameKeyDown}
            className="flex-1 min-w-0 text-sm bg-white border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-black text-black"
            aria-label="Rename conversation"
          />
          <button
            onClick={onRenameCommit}
            className="p-1 rounded text-gray-500 hover:text-black transition-colors flex-shrink-0"
            aria-label="Confirm rename"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRenameCancel}
            className="p-1 rounded text-gray-400 hover:text-black transition-colors flex-shrink-0"
            aria-label="Cancel rename"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* ── Normal row ── */
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{session.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {new Date(session.updatedAt).toLocaleDateString()}
            </p>
          </div>
          {/* Action buttons — visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={onStartRename}
              className="p-1 rounded text-gray-400 hover:text-black transition-colors"
              aria-label="Rename conversation"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded text-gray-400 hover:text-black transition-colors"
              aria-label="Delete conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  showSources,
}: {
  message: ChatMessage;
  showSources: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
          isUser
            ? 'bg-black text-white'
            : 'bg-gray-100 text-gray-900'
        )}
      >
        {isUser ? 'Y' : 'SS'}
      </div>

      {/* Content */}
      <div className={cn('max-w-[75%] min-w-0', isUser ? 'text-right' : 'text-left')}>
        <div
          className={cn(
            'inline-block rounded-2xl px-4 py-2.5 text-sm text-left',
            isUser
              ? 'bg-black text-white rounded-tr-md'
              : 'bg-gray-100 text-gray-900 rounded-tl-md'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Sources */}
        {!isUser && showSources && message.sources && message.sources.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.sources.map((src, i) => (
              <div
                key={i}
                title={src.content}
                className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500"
              >
                <FileText className="w-3 h-3 flex-shrink-0" />
                {/* Citation label — matches [Source N] used inline in the reply */}
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 flex-shrink-0 font-mono">
                  {src.sourceLabel ?? `[Source ${i + 1}]`}
                </Badge>
                <span className="truncate max-w-[120px]">{src.filename}</span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 flex-shrink-0">
                  p.{src.pageNumber}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 flex-shrink-0">
                  §{src.chunkIndex}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TypingIndicator
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-900">
        SS
      </div>
      <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex space-x-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}
