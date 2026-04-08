'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, Save, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch, getStoredApiKey, setStoredApiKey } from '@/lib/api';
import { setAvatarUrl as publishAvatarUrl } from '@/lib/avatar-store';
import type { SettingsData } from '@/types/settings';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

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
// AvatarUpload sub-component
// ---------------------------------------------------------------------------

interface AvatarUploadProps {
  /** Current avatar URL (relative path from server) or null if none set. */
  avatarUrl: string | null;
  /** Called with the new relative avatar URL after a successful upload. */
  onUploadSuccess: (newAvatarUrl: string) => void;
}

function AvatarUpload({ avatarUrl, onUploadSuccess }: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleClick = () => {
    // Reset any previous error state so the user can retry cleanly.
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so the same file can be re-selected after an error.
    e.target.value = '';

    if (!file) return;

    // Client-side validation mirrors the server constraints so errors surface
    // immediately without a network round-trip.
    const allowedTypes = new Set(['image/jpeg', 'image/png']);
    const allowedExts = new Set(['.jpg', '.jpeg', '.png']);
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

    if (!allowedTypes.has(file.type) && !allowedExts.has(ext)) {
      setUploadError('Invalid file type. Only JPG and PNG images are accepted.');
      return;
    }

    const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
    if (file.size > MAX_BYTES) {
      setUploadError('File too large. Maximum allowed size is 2 MB.');
      return;
    }

    setUploadStatus('uploading');
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const result = await apiFetch<{ avatarUrl: string }>('/api/settings/avatar', {
        method: 'POST',
        body: formData,
      });

      onUploadSuccess(result.avatarUrl);
      setUploadStatus('success');
      // Return to idle after a brief acknowledgement window.
      setTimeout(() => setUploadStatus('idle'), 2000);
    } catch (err: unknown) {
      setUploadStatus('error');
      setUploadError(
        err instanceof Error ? err.message : 'Failed to upload avatar. Please try again.'
      );
    }
  };

  const isUploading = uploadStatus === 'uploading';

  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
      {/* ── Clickable avatar circle ── */}
      <button
        type="button"
        onClick={handleClick}
        disabled={isUploading}
        aria-label="Upload profile image"
        className="group relative flex-shrink-0 w-24 h-24 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100 transition-colors hover:border-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
      >
        {/* Avatar image or placeholder icon */}
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt="Profile avatar"
            fill
            sizes="96px"
            className="object-cover"
            // Use a cache-busting timestamp so the browser always fetches the
            // latest version after an upload replaces the file on disk.
            key={avatarUrl}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <User className="w-10 h-10 text-gray-400" />
          </span>
        )}

        {/* Upload-in-progress overlay */}
        {isUploading && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-white/70"
          >
            <Loader2 className="w-6 h-6 animate-spin text-black" />
          </span>
        )}

        {/* Success flash overlay */}
        {uploadStatus === 'success' && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-white/70"
          >
            <CheckCircle2 className="w-6 h-6 text-black" />
          </span>
        )}

        {/* Hover overlay — only shown when not uploading/showing success */}
        {uploadStatus === 'idle' && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors"
          >
            <span className="text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity select-none">
              Change
            </span>
          </span>
        )}
      </button>

      {/* ── Label + status text ── */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-black">Profile Image</p>
        <p className="text-xs text-gray-500">
          Click the avatar to upload a new image.
          <br />
          JPG or PNG, max 2 MB.
        </p>

        {/* Status / error feedback */}
        {isUploading && (
          <p className="text-xs text-black flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Uploading&hellip;
          </p>
        )}
        {uploadStatus === 'success' && (
          <p className="text-xs text-black flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Avatar updated successfully.
          </p>
        )}
        {uploadStatus === 'error' && uploadError && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <XCircle className="w-3 h-3 flex-shrink-0" />
            {uploadError}
          </p>
        )}
      </div>

      {/* Hidden file input — accepts JPG and PNG only */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        className="hidden"
        aria-hidden="true"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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
        setAvatarUrl(data.avatarUrl ?? null);
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
      const payload: Record<string, string | null> = {
        cloneName,
        tone,
        responseLength,
        systemPrompt,
      };

      if (storeKeyOnServer && apiKey) {
        // Store the key on the server
        payload.openaiApiKey = apiKey;
      } else if (!storeKeyOnServer && serverKeyMasked) {
        // User unchecked the box and there was a key — clear it from the server
        payload.openaiApiKey = null;
      }

      const saved = await apiFetch<SettingsData>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      // Sync the server-key masked display from the authoritative server response
      // rather than computing it locally, so the UI always reflects what the
      // server actually stored.
      if (saved.openaiApiKeyMasked) {
        setServerKeyMasked(saved.openaiApiKeyMasked);
        setStoreKeyOnServer(true);
      } else {
        setServerKeyMasked(null);
        // Only uncheck the box if the save was intended to clear the key.
        if (!storeKeyOnServer) {
          setStoreKeyOnServer(false);
        }
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
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-black">Settings</h1>
        <p className="mt-1 text-gray-500">
          Configure your digital clone&apos;s behavior and preferences.
        </p>
      </div>

      {/* Profile Image */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile Image</CardTitle>
          <CardDescription>
            Upload a profile photo for your digital clone. This image is shown in the public
            chat interface and on the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUpload
            avatarUrl={avatarUrl}
            onUploadSuccess={(newUrl) => {
              setAvatarUrl(newUrl);
              // Broadcast the new URL to all store subscribers (e.g. Sidebar)
              // so the avatar updates immediately without a page reload.
              publishAvatarUrl(newUrl);
            }}
          />
        </CardContent>
      </Card>

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
            Your key is stored in your browser&apos;s localStorage and sent with each request.
            Optionally, store it on the server to enable public clone access without requiring
            visitors to supply their own key.
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
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black transition-colors"
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
                <CheckCircle2 className="w-4 h-4" />
              ) : testStatus === 'error' ? (
                <XCircle className="w-4 h-4" />
              ) : null}
              Test Connection
            </Button>
          </div>
          {testMessage && (
            <p className={`text-sm ${testStatus === 'error' ? 'text-red-600' : 'text-black'}`}>
              {testMessage}
            </p>
          )}

          {/* Store key on server option */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-2 max-w-lg">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={storeKeyOnServer}
                onChange={(e) => setStoreKeyOnServer(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium text-black">
                Store API key on server for public clone access
              </span>
            </label>
            <p className="text-xs text-gray-500">
              When enabled, your API key will be saved on the server so visitors can chat with
              your public clone without needing their own key. The key is sent when you click
              &quot;Save Settings&quot;. Uncheck and save to remove the server-stored key.
            </p>
            {serverKeyMasked && storeKeyOnServer && (
              <p className="text-xs text-gray-500">
                Currently stored: <code className="text-black font-mono">{serverKeyMasked}</code>
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
            Choose the tone your clone uses when generating responses. This setting is applied
            to every chat as a style instruction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="flex h-10 w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 text-black"
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
            Controls how verbose your clone&apos;s answers are. This setting is applied to every
            chat as a length instruction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <select
            value={responseLength}
            onChange={(e) => setResponseLength(e.target.value)}
            className="flex h-10 w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 text-black"
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
          <CardTitle className="text-base">Additional Persona Instructions</CardTitle>
          <CardDescription>
            Additional style and tone instructions appended to every conversation. The core
            persona rules (first-person identity and knowledge-base grounding) are always
            enforced and cannot be overridden here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Infer tone, style, and manner of expression from the provided knowledge base context. Be natural, personal, and human. Do not sound robotic."
            rows={6}
            className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 text-black resize-y min-h-[120px]"
          />
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </Button>
        {saveMessage && (
          <p className={`text-sm ${saveMessage.type === 'error' ? 'text-red-600' : 'text-black'}`}>
            {saveMessage.text}
          </p>
        )}
      </div>
    </div>
  );
}
