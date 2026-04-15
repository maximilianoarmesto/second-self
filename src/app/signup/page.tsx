'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/ui/Logo';
import { useAuth } from '@/lib/auth-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SignUpPage() {
  const router = useRouter();
  const auth = useAuth();

  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [fieldError, setFieldError] = useState<Partial<FormState>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Helpers ----

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear the per-field error as the user edits so feedback stays current
    if (fieldError[field]) {
      setFieldError((prev) => ({ ...prev, [field]: undefined }));
    }
    // Clear the server error whenever the user starts correcting a field
    if (serverError) setServerError(null);
  }

  // ---- Client-side validation ----

  function validate(): boolean {
    const errors: Partial<FormState> = {};

    if (!form.name.trim()) {
      errors.name = 'Name is required.';
    }

    if (!form.email.trim()) {
      errors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = 'Enter a valid email address.';
    }

    if (!form.password) {
      errors.password = 'Password is required.';
    } else if (form.password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    }

    if (!form.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (form.password !== form.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }

  // ---- Submit ----

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setServerError(body.error ?? 'Something went wrong. Please try again.');
        return;
      }

      // Success — session cookie is now set.
      // Synchronously update the auth context so the route guard sees an
      // authenticated user before navigation happens, preventing a redirect
      // loop or blank-page flash.
      auth.login({
        id: body.id,
        email: body.email ?? null,
        name: body.name,
        avatarUrl: body.avatarUrl ?? null,
      });

      // Redirect to the dashboard root.
      router.push('/');
    } catch {
      setServerError('Unable to reach the server. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---- Render ----

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      {/* Logo + heading */}
      <div className="flex flex-col items-center mb-8">
        <Logo size={48} className="mb-4" />
        <h1 className="text-2xl font-bold text-black tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Build and share your AI-powered digital clone.
        </p>
      </div>

      {/* Form card */}
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-8 py-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Server error banner */}
            {serverError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {serverError}
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-sm font-medium text-black">
                Name
              </label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Jane Smith"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldError.name)}
                aria-describedby={fieldError.name ? 'name-error' : undefined}
                className={fieldError.name ? 'border-red-400 focus-visible:ring-red-400' : ''}
              />
              {fieldError.name && (
                <p id="name-error" className="text-xs text-red-600" role="alert">
                  {fieldError.name}
                </p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-black">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="jane@example.com"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldError.email)}
                aria-describedby={fieldError.email ? 'email-error' : undefined}
                className={fieldError.email ? 'border-red-400 focus-visible:ring-red-400' : ''}
              />
              {fieldError.email && (
                <p id="email-error" className="text-xs text-red-600" role="alert">
                  {fieldError.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-black">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="Min. 8 characters"
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldError.password)}
                aria-describedby={fieldError.password ? 'password-error' : undefined}
                className={
                  fieldError.password ? 'border-red-400 focus-visible:ring-red-400' : ''
                }
              />
              {fieldError.password && (
                <p id="password-error" className="text-xs text-red-600" role="alert">
                  {fieldError.password}
                </p>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-black">
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat your password"
                value={form.confirmPassword}
                onChange={(e) => updateField('confirmPassword', e.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldError.confirmPassword)}
                aria-describedby={
                  fieldError.confirmPassword ? 'confirmPassword-error' : undefined
                }
                className={
                  fieldError.confirmPassword ? 'border-red-400 focus-visible:ring-red-400' : ''
                }
              />
              {fieldError.confirmPassword && (
                <p id="confirmPassword-error" className="text-xs text-red-600" role="alert">
                  {fieldError.confirmPassword}
                </p>
              )}
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Creating account…' : 'Create Account'}
            </Button>
          </form>
        </div>

        {/* Log in link */}
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-black underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
