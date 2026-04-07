'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Send, ShieldAlert, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CloneMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PublicClonePage() {
  const params = useParams();
  const token = params.token as string;

  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [messages, setMessages] = useState<CloneMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Scroll to bottom ----
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // ---- Validate token ----
  useEffect(() => {
    async function validate() {
      try {
        const res = await fetch(`/api/clone/${token}/validate`);
        if (res.ok) {
          const data = await res.json();
          setValid(true);
          setCloneName(data.cloneName || 'Anonymous');
        } else {
          setValid(false);
        }
      } catch {
        setValid(false);
      } finally {
        setValidating(false);
      }
    }
    validate();
  }, [token]);

  // ---- Send message ----
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMessage: CloneMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(`/api/clone/${token}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.ok) {
        let errMsg = `Request failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) errMsg = body.error;
        } catch {
          // ignore JSON parse error — use the generic message
        }
        throw new Error(errMsg);
      }

      const data = await res.json();

      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.message ?? data.content ?? 'Sorry, I could not generate a response.',
        },
      ]);
    } catch (err: unknown) {
      const errorContent =
        err instanceof Error
          ? `Sorry, something went wrong: ${err.message}`
          : 'Sorry, something went wrong. Please try again.';
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: errorContent,
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

  // ---- Validating state ----
  if (validating) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Validating access...</span>
        </div>
      </div>
    );
  }

  // ---- Invalid token ----
  if (!valid) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <ShieldAlert className="w-12 h-12 text-black mb-4" />
            <h1 className="text-xl font-semibold text-black mb-2">Access Denied</h1>
            <p className="text-sm text-gray-500">
              This link is invalid or has been revoked. Please contact the owner for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Valid — show chat ----
  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">SS</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-black">
              {cloneName}&apos;s Second Self
            </h1>
            <p className="text-xs text-gray-500">AI-powered digital clone</p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <span className="text-lg font-bold text-black">SS</span>
            </div>
            <h2 className="text-lg font-semibold text-black mb-1">
              Chat with {cloneName}&apos;s Second Self
            </h2>
            <p className="text-sm text-gray-500">
              Ask questions and get answers based on {cloneName}&apos;s knowledge base.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg) => (
              <PublicMessageBubble key={msg.id} message={msg} />
            ))}
            {isLoading && <PublicTypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white p-4 flex-shrink-0">
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
        <p className="max-w-3xl mx-auto text-[10px] text-gray-400 mt-2 text-center">
          Responses are generated from the owner&apos;s uploaded knowledge base.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PublicMessageBubble
// ---------------------------------------------------------------------------

function PublicMessageBubble({ message }: { message: CloneMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PublicTypingIndicator
// ---------------------------------------------------------------------------

function PublicTypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-900">
        SS
      </div>
      <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex space-x-1.5">
          <span
            className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
    </div>
  );
}
