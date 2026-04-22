'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  XCircle,
  Save,
  User,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch, getStoredApiKey, setStoredApiKey } from '@/lib/api';
import { setAvatarUrl as publishAvatarUrl } from '@/lib/avatar-store';
import type { SettingsData } from '@/types/settings';
import type { AiProvider } from '@/lib/ai-provider';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const OPENAI_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
];

const ANTHROPIC_MODELS = [
  { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
];

const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';

// ---------------------------------------------------------------------------
// Shared styled select — reuses Input visual style for consistency
// ---------------------------------------------------------------------------

interface StyledSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

function StyledSelect({ options, className, ...props }: StyledSelectProps) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <select
        {...props}
        className="appearance-none flex h-10 w-full rounded-md border border-gray-300 bg-white pl-3 pr-8 py-2 text-sm text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:border-black disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        aria-hidden="true"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TestConnectionButton — shared feedback icon inside the Test button
// ---------------------------------------------------------------------------

function TestConnectionIcon({ status }: { status: TestStatus }) {
  if (status === 'testing') return <Loader2 className="w-4 h-4 animate-spin" />;
  if (status === 'success') return <CheckCircle2 className="w-4 h-4" />;
  if (status === 'error') return <XCircle className="w-4 h-4" />;
  return null;
}

// ---------------------------------------------------------------------------
// ProviderApiKeyInput — masked API key field with show/hide toggle
// ---------------------------------------------------------------------------

interface ProviderApiKeyInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  serverKeyMasked: string | null;
}

function ProviderApiKeyInput({
  id,
  value,
  onChange,
  placeholder,
  label,
  serverKeyMasked,
}: ProviderApiKeyInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-black">
        {label}
      </label>
      <div className="relative max-w-lg">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-10"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black transition-colors"
          aria-label={show ? 'Hide API key' : 'Show API key'}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {serverKeyMasked && (
        <p className="text-xs text-gray-500">
          Stored key:{' '}
          <code className="font-mono text-black">{serverKeyMasked}</code>
        </p>
      )}
    </div>
  );
}

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
  // Track whether the current avatarUrl failed to load so we can show the
  // placeholder icon instead of a broken-image element.
  const [imgError, setImgError] = useState(false);

  // Reset the error flag whenever the URL changes so a newly uploaded image
  // gets a fresh load attempt.
  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

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
        {/* Avatar image or placeholder icon.
            A plain <img> is used (instead of next/image) so that:
            - The onError handler can swap in the placeholder if the file is
              missing or broken — Next.js <Image> does not forward onError
              reliably in all configurations.
            - Local /uploads/ paths are served directly by Next.js's static
              file server and do not benefit from image optimisation.
            eslint-disable-next-line @next/next/no-img-element */}
        {avatarUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt="Profile avatar"
            // key forces a remount (and therefore a fresh network request)
            // whenever the URL changes after a successful upload.
            key={avatarUrl}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImgError(true)}
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

  // ---------------------------------------------------------------------------
  // AI Provider state
  // ---------------------------------------------------------------------------

  /** Which provider is active for chat completions. */
  const [aiProvider, setAiProvider] = useState<AiProvider>('openai');

  // OpenAI
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiServerKeyMasked, setOpenaiServerKeyMasked] = useState<string | null>(null);
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_OPENAI_MODEL);
  const [openaiTestStatus, setOpenaiTestStatus] = useState<TestStatus>('idle');
  const [openaiTestMessage, setOpenaiTestMessage] = useState('');

  // Anthropic
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [anthropicServerKeyMasked, setAnthropicServerKeyMasked] = useState<string | null>(null);
  const [anthropicModel, setAnthropicModel] = useState(DEFAULT_ANTHROPIC_MODEL);
  const [anthropicTestStatus, setAnthropicTestStatus] = useState<TestStatus>('idle');
  const [anthropicTestMessage, setAnthropicTestMessage] = useState('');

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

        // AI provider
        setAiProvider(data.aiProvider ?? 'openai');

        // OpenAI
        setOpenaiServerKeyMasked(data.openaiApiKeyMasked ?? null);
        setOpenaiModel(data.openaiModel ?? DEFAULT_OPENAI_MODEL);

        // Anthropic
        setAnthropicServerKeyMasked(data.anthropicApiKeyMasked ?? null);
        setAnthropicModel(data.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL);
      } catch {
        // Use defaults on error
      } finally {
        setLoading(false);
      }
    }

    // Pre-fill OpenAI key from localStorage (browser-side cache)
    const storedKey = getStoredApiKey();
    if (storedKey) setOpenaiApiKey(storedKey);

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
        aiProvider,
        openaiModel,
        anthropicModel,
      };

      // OpenAI key: send new value when the user typed one; otherwise leave
      // the server-side key unchanged (don't send the field at all).
      if (openaiApiKey) {
        payload.openaiApiKey = openaiApiKey;
        // Mirror to localStorage for same-session requests that read it client-side
        setStoredApiKey(openaiApiKey);
      }

      // Anthropic key: send new value when typed; leave unchanged otherwise.
      if (anthropicApiKey) {
        payload.anthropicApiKey = anthropicApiKey;
      }

      const saved = await apiFetch<SettingsData>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      // Sync masked key displays from the authoritative server response.
      setOpenaiServerKeyMasked(saved.openaiApiKeyMasked ?? null);
      setAnthropicServerKeyMasked(saved.anthropicApiKeyMasked ?? null);

      // Sync model values back in case the server normalised them.
      setOpenaiModel(saved.openaiModel ?? DEFAULT_OPENAI_MODEL);
      setAnthropicModel(saved.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL);

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

  // ---- Test connection — OpenAI ----
  const testOpenAI = async () => {
    setOpenaiTestStatus('testing');
    setOpenaiTestMessage('');

    try {
      const result = await apiFetch<{ success: boolean; message?: string }>(
        '/api/settings/test-connection',
        {
          method: 'POST',
          body: JSON.stringify({ provider: 'openai', apiKey: openaiApiKey }),
        }
      );
      if (result.success) {
        setOpenaiTestStatus('success');
        setOpenaiTestMessage('Connection successful. Your OpenAI key is valid.');
      } else {
        setOpenaiTestStatus('error');
        setOpenaiTestMessage(result.message ?? 'Connection test failed.');
      }
    } catch (err: unknown) {
      setOpenaiTestStatus('error');
      setOpenaiTestMessage(err instanceof Error ? err.message : 'Connection test failed.');
    }
  };

  // ---- Test connection — Anthropic ----
  const testAnthropic = async () => {
    setAnthropicTestStatus('testing');
    setAnthropicTestMessage('');

    try {
      const result = await apiFetch<{ success: boolean; message?: string }>(
        '/api/settings/test-connection',
        {
          method: 'POST',
          body: JSON.stringify({ provider: 'anthropic', apiKey: anthropicApiKey }),
        }
      );
      if (result.success) {
        setAnthropicTestStatus('success');
        setAnthropicTestMessage('Connection successful. Your Anthropic key is valid.');
      } else {
        setAnthropicTestStatus('error');
        setAnthropicTestMessage(result.message ?? 'Connection test failed.');
      }
    } catch (err: unknown) {
      setAnthropicTestStatus('error');
      setAnthropicTestMessage(err instanceof Error ? err.message : 'Connection test failed.');
    }
  };

  // ---- Loading skeleton ----
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

      {/* ── Profile Image ── */}
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

      {/* ── Clone Name ── */}
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

      {/* ── AI Provider ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Provider</CardTitle>
          <CardDescription>
            Choose which AI provider powers your clone&apos;s chat responses. Configure both
            providers below — you can switch the active one at any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ── Provider selector ── */}
          <fieldset>
            <legend className="text-sm font-medium text-black mb-3">Active provider</legend>
            <div className="flex gap-3">
              {/* OpenAI radio */}
              <label
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-md border cursor-pointer transition-colors select-none ${
                  aiProvider === 'openai'
                    ? 'border-black bg-black text-white'
                    : 'border-gray-300 bg-white text-black hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="aiProvider"
                  value="openai"
                  checked={aiProvider === 'openai'}
                  onChange={() => setAiProvider('openai')}
                  className="sr-only"
                />
                <span className="text-sm font-medium">OpenAI</span>
              </label>

              {/* Anthropic radio */}
              <label
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-md border cursor-pointer transition-colors select-none ${
                  aiProvider === 'anthropic'
                    ? 'border-black bg-black text-white'
                    : 'border-gray-300 bg-white text-black hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="aiProvider"
                  value="anthropic"
                  checked={aiProvider === 'anthropic'}
                  onChange={() => setAiProvider('anthropic')}
                  className="sr-only"
                />
                <span className="text-sm font-medium">Anthropic</span>
              </label>
            </div>
          </fieldset>

          {/* ── Divider ── */}
          <div className="border-t border-gray-100" />

          {/* ── OpenAI subsection ── */}
          <section aria-label="OpenAI configuration">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-sm font-semibold text-black">OpenAI</h3>
              {aiProvider === 'openai' && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-black text-black bg-white">
                  Active
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* API key input */}
              <ProviderApiKeyInput
                id="openai-api-key"
                label="API Key"
                value={openaiApiKey}
                onChange={(val) => {
                  setOpenaiApiKey(val);
                  setOpenaiTestStatus('idle');
                  setOpenaiTestMessage('');
                }}
                placeholder="sk-..."
                serverKeyMasked={openaiServerKeyMasked}
              />

              {/* Model dropdown */}
              <div className="space-y-1.5">
                <label htmlFor="openai-model" className="text-sm font-medium text-black">
                  Model
                </label>
                <StyledSelect
                  id="openai-model"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  options={OPENAI_MODELS}
                  className="max-w-sm"
                />
              </div>

              {/* Test connection */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testOpenAI}
                  disabled={!openaiApiKey || openaiTestStatus === 'testing'}
                  className="gap-2"
                >
                  <TestConnectionIcon status={openaiTestStatus} />
                  Test Connection
                </Button>
                {openaiTestMessage && (
                  <p
                    className={`text-sm ${
                      openaiTestStatus === 'success'
                        ? 'text-green-700'
                        : openaiTestStatus === 'error'
                          ? 'text-red-700'
                          : 'text-black'
                    }`}
                  >
                    {openaiTestMessage}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── Divider ── */}
          <div className="border-t border-gray-100" />

          {/* ── Anthropic subsection ── */}
          <section aria-label="Anthropic configuration">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-sm font-semibold text-black">Anthropic</h3>
              {aiProvider === 'anthropic' && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-black text-black bg-white">
                  Active
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* API key input */}
              <ProviderApiKeyInput
                id="anthropic-api-key"
                label="API Key"
                value={anthropicApiKey}
                onChange={(val) => {
                  setAnthropicApiKey(val);
                  setAnthropicTestStatus('idle');
                  setAnthropicTestMessage('');
                }}
                placeholder="sk-ant-..."
                serverKeyMasked={anthropicServerKeyMasked}
              />

              {/* Model dropdown */}
              <div className="space-y-1.5">
                <label htmlFor="anthropic-model" className="text-sm font-medium text-black">
                  Model
                </label>
                <StyledSelect
                  id="anthropic-model"
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  options={ANTHROPIC_MODELS}
                  className="max-w-sm"
                />
              </div>

              {/* Test connection */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testAnthropic}
                  disabled={!anthropicApiKey || anthropicTestStatus === 'testing'}
                  className="gap-2"
                >
                  <TestConnectionIcon status={anthropicTestStatus} />
                  Test Connection
                </Button>
                {anthropicTestMessage && (
                  <p
                    className={`text-sm ${
                      anthropicTestStatus === 'success'
                        ? 'text-green-700'
                        : anthropicTestStatus === 'error'
                          ? 'text-red-700'
                          : 'text-black'
                    }`}
                  >
                    {anthropicTestMessage}
                  </p>
                )}
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      {/* ── Response Tone ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response Tone</CardTitle>
          <CardDescription>
            Choose the tone your clone uses when generating responses. This setting is applied
            to every chat as a style instruction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StyledSelect
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            options={TONE_OPTIONS}
            className="max-w-sm"
          />
        </CardContent>
      </Card>

      {/* ── Response Length ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response Length</CardTitle>
          <CardDescription>
            Controls how verbose your clone&apos;s answers are. This setting is applied to every
            chat as a length instruction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StyledSelect
            value={responseLength}
            onChange={(e) => setResponseLength(e.target.value)}
            options={RESPONSE_LENGTH_OPTIONS}
            className="max-w-sm"
          />
        </CardContent>
      </Card>

      {/* ── System Prompt ── */}
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

      {/* ── Save button ── */}
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
