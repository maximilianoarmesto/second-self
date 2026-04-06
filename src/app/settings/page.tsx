'use client';

import React, { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  XCircle,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiFetch, getStoredApiKey, setStoredApiKey } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsData {
  cloneName: string;
  tone: string;
  responseLength: string;
  systemPrompt: string;
  openaiApiKeyMasked: string | null;
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

const TONE_OPTIONS = [
  { value: 'natural', label: 'Natural' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'academic', label: 'Academic' },
  { value: 'friendly', label: 'Friendly' },
];

const RESPONSE_LENGTH_OPTIONS = [
  { value: 'concise', label: 'Concise' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'detailed', label: 'Detailed' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [cloneName, setCloneName] = useState('');
  const [tone, setTone] = useState('natural');
  const [responseLength, setResponseLength] = useState('balanced');
  const [systemPrompt, setSystemPrompt] = useState('');

  // API key state
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [storeKeyOnServer, setStoreKeyOnServer] = useState(false);
  const [serverKeyMasked, setServerKeyMasked] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');

  // ---- Load settings ----
  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch<SettingsData>('/api/settings');
        setCloneName(data.cloneName ?? '');
        setTone(data.tone ?? 'natural');
        setResponseLength(data.responseLength ?? 'balanced');
        setSystemPrompt(data.systemPrompt ?? '');
        if (data.openaiApiKeyMasked) {
          setServerKeyMasked(data.openaiApiKeyMasked);
          setStoreKeyOnServer(true);
        }
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    }

    // Load API key from localStorage
    const storedKey = getStoredApiKey();
    if (storedKey) setApiKey(storedKey);

    load();
  }, []);

  // ---- Save settings ----
  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const payload: Record<string, string> = {
        cloneName,
        tone,
        responseLength,
        systemPrompt,
      };

      // Include the API key for server-side storage when the option is enabled
      if (storeKeyOnServer && apiKey) {
        payload.openaiApiKey = apiKey;
      }

      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (storeKeyOnServer && apiKey) {
        // Update masked display after saving
        const masked =
          apiKey.length > 8
            ? `${apiKey.slice(0, 5)}..${apiKey.slice(-4)}`
            : '••••••••';
        setServerKeyMasked(masked);
      }
      setSaveMessage({ type: 'success', text: 'Settings saved successfully.' });
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (err: unknown) {
      setSaveMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  // ---- Save API key to localStorage ----
  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setStoredApiKey(value);
    setTestStatus('idle');
    setTestMessage('');
  };

  // ---- Test connection ----
  const testConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await apiFetch<{ success: boolean; message?: string }>(
        '/api/settings/test-connection',
        { method: 'POST' }
      );
      if (result.success) {
        setTestStatus('success');
        setTestMessage('Connection successful. Your API key is valid.');
      } else {
        setTestStatus('error');
        setTestMessage(result.message ?? 'Connection test failed.');
      }
    } catch (err: unknown) {
      setTestStatus('error');
      setTestMessage(err instanceof Error ? err.message : 'Connection test failed.');
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Configure your digital clone's behavior and preferences.
        </p>
      </div>

      {/* Clone Name */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clone Display Name</CardTitle>
          <CardDescription>
            The name displayed for your digital clone in public chats and the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
            placeholder="My Second Self"
            className="max-w-sm"
          />
        </CardContent>
      </Card>

      {/* OpenAI API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">OpenAI API Key</CardTitle>
          <CardDescription>
            Your key is stored in your browser's localStorage and sent with each request.
            Optionally, you can also store it on the server to enable public clone access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 max-w-lg">
            <div className="relative flex-1">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="sk-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={!apiKey || testStatus === 'testing'}
              className="gap-2 flex-shrink-0"
            >
              {testStatus === 'testing' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : testStatus === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : testStatus === 'error' ? (
                <XCircle className="w-4 h-4 text-destructive" />
              ) : null}
              Test Connection
            </Button>
          </div>
          {testMessage && (
            <p
              className={`text-sm ${
                testStatus === 'success' ? 'text-green-500' : 'text-destructive'
              }`}
            >
              {testMessage}
            </p>
          )}

          {/* Store key on server option */}
          <div className="border border-input rounded-lg p-4 space-y-2 max-w-lg">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={storeKeyOnServer}
                onChange={(e) => setStoreKeyOnServer(e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm font-medium text-foreground">
                Store API key on server for public clone access
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              When enabled, your API key will be saved on the server so that visitors can chat with
              your public clone without needing their own key. The key is sent when you click
              &quot;Save Settings&quot;.
            </p>
            {serverKeyMasked && (
              <p className="text-xs text-muted-foreground">
                Server key: <code className="text-foreground">{serverKeyMasked}</code>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response Tone</CardTitle>
          <CardDescription>
            Choose the tone your clone uses when generating responses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="flex h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-foreground"
          >
            {TONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Response Length */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response Length</CardTitle>
          <CardDescription>
            Controls how verbose your clone's answers are.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <select
            value={responseLength}
            onChange={(e) => setResponseLength(e.target.value)}
            className="flex h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-foreground"
          >
            {RESPONSE_LENGTH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* System Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Prompt</CardTitle>
          <CardDescription>
            Custom instructions prepended to every conversation. Use this to define your clone's
            personality and constraints.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful assistant that answers questions based on the provided knowledge base..."
            rows={6}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-foreground resize-y min-h-[120px]"
          />
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Settings
        </Button>
        {saveMessage && (
          <p
            className={`text-sm ${
              saveMessage.type === 'success' ? 'text-green-500' : 'text-destructive'
            }`}
          >
            {saveMessage.text}
          </p>
        )}
      </div>
    </div>
  );
}
