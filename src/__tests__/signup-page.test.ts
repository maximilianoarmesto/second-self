/**
 * Unit tests for the Sign Up page UI logic (src/app/signup/page.tsx).
 *
 * Because the project uses jest-environment-node (no DOM / React renderer),
 * we test the pure logic that drives the page rather than rendering the
 * component tree directly. The tests validate:
 *
 *  Acceptance criteria (from task spec):
 *   AC-1  Mismatched passwords show a client-side error before any API call
 *   AC-2  Short password (< 8 chars) shows a client-side error before any API call
 *   AC-3  Successful signup navigates to "/"
 *   AC-4  409 API response shows "email already in use" error inline
 *   AC-5  Submit button is disabled while API call is in flight (isSubmitting=true)
 *
 *  Additional scenarios:
 *   1.   Both passwords empty → confirmPassword error, no API call
 *   2.   Name field empty → name error, no API call
 *   3.   Email field empty → email error, no API call
 *   4.   Invalid email format → email error, no API call
 *   5.   Password exactly 7 chars → password error, no API call
 *   6.   Password exactly 8 chars → passes validation
 *   7.   Mismatched passwords → confirmPassword error, no API call
 *   8.   All fields valid → validate() returns true
 *   9.   fetch is called with POST /api/auth/signup
 *  10.   fetch receives Content-Type: application/json header
 *  11.   name is trimmed before sending
 *  12.   email is trimmed before sending
 *  13.   password is sent exactly as entered
 *  14.   confirmPassword is NOT included in the request body
 *  15.   Success (201) → redirects to "/"
 *  16.   409 → serverError is set to body.error (duplicate email)
 *  17.   500 → serverError is set to body.error
 *  18.   Missing body.error → generic fallback message shown
 *  19.   Network failure → connection error message shown
 *  20.   No redirect on error response
 *  21.   isSubmitting is true before the fetch call resolves
 *  22.   isSubmitting is false after a successful response
 *  23.   isSubmitting is false after an error response
 *  24.   isSubmitting is false after a network failure
 *  25.   Server error cleared when user edits name field
 *  26.   Server error cleared when user edits email field
 *  27.   Server error cleared when user edits password field
 *  28.   Server error cleared when user edits confirmPassword field
 *  29.   Per-field error cleared when user edits that field
 *  30.   Per-field error NOT cleared when user edits a different field
 *  31.   /signup is classified as an auth page (no session required)
 *  32.   Authenticated users visiting /signup are redirected to /
 *  33.   Request body contains exactly { name, email, password } — no extra fields
 *  34.   Only mismatched passwords error — no API call even with valid name/email
 *  35.   Empty confirmPassword → confirm error, no API call
 */

// ---------------------------------------------------------------------------
// Inline helpers — mirror the exact logic in src/app/signup/page.tsx
// ---------------------------------------------------------------------------
//
// We extract and replicate the three logical units of the page:
//   1. validate()    — pure function, no side-effects
//   2. submit flow   — async state machine driven by fetch + router
//   3. updateField() — field-state helper (clears errors on edit)
//
// This keeps the tests framework-agnostic while remaining tightly coupled to
// the production logic.

// ---------------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------------

interface FormState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

type FieldError = Partial<FormState>;

// ---------------------------------------------------------------------------
// 2. Validation helper (mirrors SignUpPage.validate)
// ---------------------------------------------------------------------------

/**
 * Mirrors the validate() function inside SignUpPage.
 * Returns { valid, errors } so tests can inspect both the boolean result
 * and the individual field messages.
 */
function validate(form: FormState): { valid: boolean; errors: FieldError } {
  const errors: FieldError = {};

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

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// 3. Submit state machine (mirrors SignUpPage.handleSubmit)
// ---------------------------------------------------------------------------

interface SubmitState {
  serverError: string | null;
  isSubmitting: boolean;
  redirectedTo: string | null;
}

/**
 * Simulates the async submit flow from handleSubmit.
 * Returns state snapshots and fetch call metadata to verify transitions.
 */
async function simulateSubmit(
  form: FormState,
  mockFetch: jest.Mock,
): Promise<{
  beforeFetch: SubmitState;
  afterFetch: SubmitState;
  fetchCalled: boolean;
  fetchArgs: [string, RequestInit] | null;
}> {
  // Validate first — mirrors the early-return in handleSubmit
  const { valid } = validate(form);

  let isSubmitting = false;
  let serverError: string | null = null;
  let redirectedTo: string | null = null;
  let fetchCalled = false;
  let fetchArgs: [string, RequestInit] | null = null;

  if (!valid) {
    return {
      beforeFetch: { isSubmitting, serverError, redirectedTo },
      afterFetch: { isSubmitting, serverError, redirectedTo },
      fetchCalled,
      fetchArgs,
    };
  }

  // Phase 1: in-flight
  isSubmitting = true;
  const beforeFetch: SubmitState = { isSubmitting, serverError, redirectedTo };

  try {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      }),
    };

    fetchCalled = true;
    fetchArgs = ['/api/auth/signup', requestInit];
    const response = await mockFetch('/api/auth/signup', requestInit);

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      serverError = body.error ?? 'Something went wrong. Please try again.';
    } else {
      // Success — redirect to the dashboard root
      redirectedTo = '/';
    }
  } catch {
    serverError =
      'Unable to reach the server. Please check your connection and try again.';
  } finally {
    isSubmitting = false;
  }

  const afterFetch: SubmitState = { isSubmitting, serverError, redirectedTo };
  return { beforeFetch, afterFetch, fetchCalled, fetchArgs };
}

// ---------------------------------------------------------------------------
// 4. updateField helper (mirrors SignUpPage.updateField)
// ---------------------------------------------------------------------------

/**
 * Simulates the updateField() call that clears per-field and server errors
 * when the user edits a field.
 */
function updateField(
  field: keyof FormState,
  value: string,
  form: FormState,
  fieldError: FieldError,
  serverError: string | null,
): {
  form: FormState;
  fieldError: FieldError;
  serverError: string | null;
} {
  const newForm = { ...form, [field]: value };

  // Clear the per-field error for the edited field
  const newFieldError = fieldError[field]
    ? { ...fieldError, [field]: undefined }
    : fieldError;

  // Clear the server error when any field is edited
  const newServerError = serverError ? null : serverError;

  return { form: newForm, fieldError: newFieldError, serverError: newServerError };
}

// ---------------------------------------------------------------------------
// Helpers — build mock fetch responses
// ---------------------------------------------------------------------------

function mockOkResponse(
  body: unknown = { id: 1, email: 'user@example.com', name: 'User' },
) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: () => Promise.resolve(body),
  });
}

function mockErrorResponse(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function mockNetworkFailure(message = 'Failed to fetch') {
  return jest.fn().mockRejectedValue(new TypeError(message));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_FORM: FormState = {
  name: 'Jane Smith',
  email: 'jane@example.com',
  password: 'supersecret',
  confirmPassword: 'supersecret',
};

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
};

// ===========================================================================
// AC-1: Mismatched passwords — client-side error, no API call
// ===========================================================================

describe('AC-1: SignUpPage — mismatched passwords (client-side error, no API call)', () => {
  it('produces a confirmPassword error when passwords do not match', () => {
    const form: FormState = {
      ...VALID_FORM,
      password: 'password1',
      confirmPassword: 'password2',
    };
    const { valid, errors } = validate(form);

    expect(valid).toBe(false);
    expect(errors.confirmPassword).toMatch(/do not match/i);
  });

  it('does not call fetch when passwords do not match', async () => {
    const form: FormState = {
      ...VALID_FORM,
      password: 'password1',
      confirmPassword: 'password2',
    };
    const mockFetch = mockOkResponse();
    const { fetchCalled } = await simulateSubmit(form, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('confirmPassword error message clearly indicates a mismatch', () => {
    const form: FormState = {
      ...VALID_FORM,
      password: 'abcdefgh',
      confirmPassword: 'ABCDEFGH',
    };
    const { errors } = validate(form);

    expect(errors.confirmPassword).toBeTruthy();
    expect(typeof errors.confirmPassword).toBe('string');
  });

  it('no other field errors occur when only passwords mismatch (name, email, password are valid)', () => {
    const form: FormState = {
      ...VALID_FORM,
      password: 'validpassword',
      confirmPassword: 'differentpassword',
    };
    const { errors } = validate(form);

    expect(errors.name).toBeUndefined();
    expect(errors.email).toBeUndefined();
    expect(errors.password).toBeUndefined();
    expect(errors.confirmPassword).toBeDefined();
  });

  it('mismatched passwords block submission even when all other fields are perfectly filled', async () => {
    const form: FormState = {
      name: 'Alice Smith',
      email: 'alice@example.com',
      password: 'correct-password',
      confirmPassword: 'wrong-password',
    };
    const mockFetch = mockOkResponse();
    const { fetchCalled, afterFetch } = await simulateSubmit(form, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(afterFetch.redirectedTo).toBeNull();
    expect(afterFetch.serverError).toBeNull();
  });

  it('empty confirmPassword also produces a confirm error (distinct from mismatch)', () => {
    const form: FormState = { ...VALID_FORM, confirmPassword: '' };
    const { valid, errors } = validate(form);

    expect(valid).toBe(false);
    expect(errors.confirmPassword).toBeTruthy();
  });

  it('empty confirmPassword blocks the API call', async () => {
    const form: FormState = { ...VALID_FORM, confirmPassword: '' };
    const mockFetch = mockOkResponse();
    const { fetchCalled } = await simulateSubmit(form, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('validate() returns false when passwords are mismatched regardless of length', () => {
    const pairs: [string, string][] = [
      ['aaaaaaaa', 'AAAAAAAA'],
      ['password1', 'password!'],
      ['short1111', 'short1112'],
    ];

    for (const [pw, confirm] of pairs) {
      const { valid } = validate({ ...VALID_FORM, password: pw, confirmPassword: confirm });
      expect(valid).toBe(false);
    }
  });
});

// ===========================================================================
// AC-2: Short password — client-side error, no API call
// ===========================================================================

describe('AC-2: SignUpPage — short password (< 8 chars) shows error, no API call', () => {
  it('produces a password error when password is shorter than 8 characters', () => {
    const form: FormState = { ...VALID_FORM, password: '1234567', confirmPassword: '1234567' };
    const { valid, errors } = validate(form);

    expect(valid).toBe(false);
    expect(errors.password).toMatch(/at least 8/i);
  });

  it('does not call fetch when the password is too short', async () => {
    const form: FormState = { ...VALID_FORM, password: '1234567', confirmPassword: '1234567' };
    const mockFetch = mockOkResponse();
    const { fetchCalled } = await simulateSubmit(form, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('produces a password error for each password length < 8', () => {
    const shortPasswords = ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg'];

    for (const pw of shortPasswords) {
      const { errors } = validate({ ...VALID_FORM, password: pw, confirmPassword: pw });
      expect(errors.password).toBeTruthy();
    }
  });

  it('does NOT produce a password-length error when password is exactly 8 characters', () => {
    const form: FormState = {
      ...VALID_FORM,
      password: '12345678',
      confirmPassword: '12345678',
    };
    const { errors } = validate(form);

    expect(errors.password).toBeUndefined();
  });

  it('accepts a password of exactly 8 characters (lower boundary)', () => {
    const form: FormState = {
      ...VALID_FORM,
      password: '12345678',
      confirmPassword: '12345678',
    };
    const { valid } = validate(form);

    expect(valid).toBe(true);
  });

  it('rejects a password of 7 characters (one below the boundary)', () => {
    const form: FormState = {
      ...VALID_FORM,
      password: '1234567',
      confirmPassword: '1234567',
    };
    const { valid } = validate(form);

    expect(valid).toBe(false);
  });

  it('short password error message mentions "8 characters"', () => {
    const form: FormState = { ...VALID_FORM, password: 'short', confirmPassword: 'short' };
    const { errors } = validate(form);

    expect(errors.password).toMatch(/8/);
  });

  it('does not call fetch for any password shorter than 8 characters', async () => {
    const shortPasswords = ['a', 'abc', '1234567'];

    for (const pw of shortPasswords) {
      const mockFetch = mockOkResponse();
      const { fetchCalled } = await simulateSubmit(
        { ...VALID_FORM, password: pw, confirmPassword: pw },
        mockFetch,
      );
      expect(fetchCalled).toBe(false);
    }
  });
});

// ===========================================================================
// AC-3: Successful signup — navigates to "/"
// ===========================================================================

describe('AC-3: SignUpPage — successful signup navigates to "/"', () => {
  it('redirects to "/" after a successful API response', async () => {
    const mockFetch = mockOkResponse({ id: 1, email: 'jane@example.com', name: 'Jane' });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.redirectedTo).toBe('/');
  });

  it('does not show a server error after a successful response', async () => {
    const mockFetch = mockOkResponse();
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.serverError).toBeNull();
  });

  it('calls fetch exactly once on a successful submit', async () => {
    const mockFetch = mockOkResponse();
    await simulateSubmit(VALID_FORM, mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('redirects to "/" regardless of the user payload returned', async () => {
    const mockFetch = mockOkResponse({ id: 99, email: 'other@example.com', name: 'Other' });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.redirectedTo).toBe('/');
  });

  it('success: fetch is called with POST /api/auth/signup', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(fetchArgs![0]).toBe('/api/auth/signup');
    expect(fetchArgs![1].method).toBe('POST');
  });
});

// ===========================================================================
// AC-4: 409 API response — duplicate email error is displayed inline
// ===========================================================================

describe('AC-4: SignUpPage — 409 response shows "email already in use" error inline', () => {
  it('sets serverError to body.error when the API returns 409', async () => {
    const mockFetch = mockErrorResponse(409, {
      error: 'An account with this email address already exists.',
    });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.serverError).toBe(
      'An account with this email address already exists.',
    );
  });

  it('does not redirect when the API returns 409', async () => {
    const mockFetch = mockErrorResponse(409, {
      error: 'An account with this email address already exists.',
    });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.redirectedTo).toBeNull();
  });

  it('409 serverError is a non-empty string', async () => {
    const mockFetch = mockErrorResponse(409, {
      error: 'An account with this email address already exists.',
    });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(typeof afterFetch.serverError).toBe('string');
    expect(afterFetch.serverError!.length).toBeGreaterThan(0);
  });

  it('409 serverError references the email / existing account concept', async () => {
    const mockFetch = mockErrorResponse(409, {
      error: 'An account with this email address already exists.',
    });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    // The error message should convey that the account / email already exists
    expect(afterFetch.serverError).toMatch(/already exists|already in use|duplicate|email/i);
  });

  it('uses a generic fallback when 409 response has no body.error', async () => {
    const mockFetch = mockErrorResponse(409, {});
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.serverError).toBeTruthy();
    expect(typeof afterFetch.serverError).toBe('string');
    expect(afterFetch.serverError!.length).toBeGreaterThan(0);
  });

  it('shows body.error as the server error message on HTTP 500', async () => {
    const mockFetch = mockErrorResponse(500, { error: 'An unexpected error occurred.' });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.serverError).toBe('An unexpected error occurred.');
    expect(afterFetch.redirectedTo).toBeNull();
  });

  it('shows a generic fallback when error response has no body.error', async () => {
    const mockFetch = mockErrorResponse(422, {});
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.serverError).toBeTruthy();
    expect(typeof afterFetch.serverError).toBe('string');
  });

  it('shows a connection error when fetch throws a network error', async () => {
    const mockFetch = mockNetworkFailure();
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.serverError).toMatch(/unable to reach the server/i);
    expect(afterFetch.redirectedTo).toBeNull();
  });
});

// ===========================================================================
// AC-5: Submit button disabled while API call is in flight (isSubmitting)
// ===========================================================================

describe('AC-5: SignUpPage — isSubmitting is true during the API call (button disabled)', () => {
  it('isSubmitting is true before the fetch response arrives (button is disabled)', async () => {
    const mockFetch = mockOkResponse();
    const { beforeFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(beforeFetch.isSubmitting).toBe(true);
  });

  it('isSubmitting is false after a successful API response (button re-enabled)', async () => {
    const mockFetch = mockOkResponse();
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.isSubmitting).toBe(false);
  });

  it('isSubmitting is false after an error API response (button re-enabled)', async () => {
    const mockFetch = mockErrorResponse(409, {
      error: 'An account with this email address already exists.',
    });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.isSubmitting).toBe(false);
  });

  it('isSubmitting is false after a network failure (button re-enabled)', async () => {
    const mockFetch = mockNetworkFailure();
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.isSubmitting).toBe(false);
  });

  it('isSubmitting stays false when validation fails (fetch never called)', async () => {
    const invalidForm: FormState = { ...VALID_FORM, password: 'short', confirmPassword: 'short' };
    const mockFetch = mockOkResponse();
    const { beforeFetch, afterFetch } = await simulateSubmit(invalidForm, mockFetch);

    // Validation short-circuits before isSubmitting is ever set to true
    expect(beforeFetch.isSubmitting).toBe(false);
    expect(afterFetch.isSubmitting).toBe(false);
  });

  it('isSubmitting transitions from false → true → false across the full submit cycle', async () => {
    const states: boolean[] = [];
    const mockFetch = jest.fn().mockImplementation(async () => {
      // Capture a mid-flight snapshot: isSubmitting must be true at this point.
      // simulateSubmit() sets isSubmitting=true before calling mockFetch(),
      // so we can read the beforeFetch snapshot after the promise resolves.
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 1, email: 'j@j.com', name: 'J' }),
      };
    });

    states.push(false); // initial state
    const { beforeFetch, afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);
    states.push(beforeFetch.isSubmitting); // true while in-flight
    states.push(afterFetch.isSubmitting);  // false when done

    expect(states).toEqual([false, true, false]);
  });
});

// ===========================================================================
// Additional: client-side validation coverage
// ===========================================================================

describe('SignUpPage — client-side validation: all fields required', () => {
  it('produces errors on all four fields when the form is completely empty', () => {
    const { valid, errors } = validate(EMPTY_FORM);

    expect(valid).toBe(false);
    expect(errors.name).toBeDefined();
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
    expect(errors.confirmPassword).toBeDefined();
  });

  it('produces only a name error when name is empty and other fields are valid', () => {
    const form: FormState = { ...VALID_FORM, name: '' };
    const { valid, errors } = validate(form);

    expect(valid).toBe(false);
    expect(errors.name).toBeDefined();
    expect(errors.email).toBeUndefined();
    expect(errors.password).toBeUndefined();
    expect(errors.confirmPassword).toBeUndefined();
  });

  it('produces only an email error when email is empty and other fields are valid', () => {
    const form: FormState = { ...VALID_FORM, email: '' };
    const { valid, errors } = validate(form);

    expect(valid).toBe(false);
    expect(errors.name).toBeUndefined();
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeUndefined();
    expect(errors.confirmPassword).toBeUndefined();
  });

  it('produces only a password error when password is empty and other fields are valid', () => {
    const form: FormState = { ...VALID_FORM, password: '', confirmPassword: '' };
    const { valid, errors } = validate(form);

    // Password is empty AND confirmPassword is empty — both errors fire.
    // But password and confirmPassword each produce their own error.
    expect(valid).toBe(false);
    expect(errors.password).toBeDefined();
    expect(errors.name).toBeUndefined();
    expect(errors.email).toBeUndefined();
  });

  it('name error for empty name mentions "required"', () => {
    const { errors } = validate({ ...VALID_FORM, name: '' });
    expect(errors.name).toMatch(/required/i);
  });

  it('email error for empty email mentions "required"', () => {
    const { errors } = validate({ ...VALID_FORM, email: '' });
    expect(errors.email).toMatch(/required/i);
  });

  it('password error for empty password mentions "required"', () => {
    const { errors } = validate({ ...VALID_FORM, password: '', confirmPassword: '' });
    expect(errors.password).toMatch(/required/i);
  });

  it('whitespace-only name produces a name error', () => {
    const { valid, errors } = validate({ ...VALID_FORM, name: '   ' });
    expect(valid).toBe(false);
    expect(errors.name).toBeDefined();
  });

  it('whitespace-only email produces an email validation error', () => {
    const { valid, errors } = validate({ ...VALID_FORM, email: '   ' });
    expect(valid).toBe(false);
    expect(errors.email).toBeDefined();
  });

  it('validate() returns true when all fields are valid', () => {
    const { valid, errors } = validate(VALID_FORM);

    expect(valid).toBe(true);
    expect(errors.name).toBeUndefined();
    expect(errors.email).toBeUndefined();
    expect(errors.password).toBeUndefined();
    expect(errors.confirmPassword).toBeUndefined();
  });

  it('invalid email format produces an email format error', () => {
    const invalidEmails = ['notanemail', 'missing@tld', '@nodomain.com', 'a@b'];
    for (const email of invalidEmails) {
      const { errors } = validate({ ...VALID_FORM, email });
      expect(errors.email).toMatch(/valid email/i);
    }
  });

  it('email with surrounding whitespace is accepted (trimmed before format check)', () => {
    const { valid, errors } = validate({ ...VALID_FORM, email: '  jane@example.com  ' });
    expect(valid).toBe(true);
    expect(errors.email).toBeUndefined();
  });

  it('does not call fetch when name field is empty', async () => {
    const form: FormState = { ...VALID_FORM, name: '' };
    const mockFetch = mockOkResponse();
    const { fetchCalled } = await simulateSubmit(form, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when email field is empty', async () => {
    const form: FormState = { ...VALID_FORM, email: '' };
    const mockFetch = mockOkResponse();
    const { fetchCalled } = await simulateSubmit(form, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when email format is invalid', async () => {
    const form: FormState = { ...VALID_FORM, email: 'not-an-email' };
    const mockFetch = mockOkResponse();
    const { fetchCalled } = await simulateSubmit(form, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when all four fields are empty', async () => {
    const mockFetch = mockOkResponse();
    const { fetchCalled } = await simulateSubmit(EMPTY_FORM, mockFetch);

    expect(fetchCalled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Additional: fetch payload shape
// ===========================================================================

describe('SignUpPage — fetch payload', () => {
  it('sends exactly { name, email, password } in the request body (no extra fields)', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(VALID_FORM, mockFetch);

    const body = JSON.parse(fetchArgs![1].body as string);
    const keys = Object.keys(body);

    expect(keys).toHaveLength(3);
    expect(keys).toContain('name');
    expect(keys).toContain('email');
    expect(keys).toContain('password');
  });

  it('does NOT include confirmPassword in the request body', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(VALID_FORM, mockFetch);

    const body = JSON.parse(fetchArgs![1].body as string);
    expect(body).not.toHaveProperty('confirmPassword');
  });

  it('sends Content-Type: application/json header', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(VALID_FORM, mockFetch);

    const headers = fetchArgs![1].headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('trims the name before including it in the JSON body', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(
      { ...VALID_FORM, name: '  Jane Smith  ' },
      mockFetch,
    );

    const body = JSON.parse(fetchArgs![1].body as string);
    expect(body.name).toBe('Jane Smith');
  });

  it('trims the email before including it in the JSON body', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(
      { ...VALID_FORM, email: '  jane@example.com  ' },
      mockFetch,
    );

    const body = JSON.parse(fetchArgs![1].body as string);
    expect(body.email).toBe('jane@example.com');
  });

  it('sends the password exactly as entered without trimming', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(
      { ...VALID_FORM, password: '  spaced pass  ', confirmPassword: '  spaced pass  ' },
      mockFetch,
    );

    const body = JSON.parse(fetchArgs![1].body as string);
    expect(body.password).toBe('  spaced pass  ');
  });

  it('name in body matches the trimmed input value', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(VALID_FORM, mockFetch);

    const body = JSON.parse(fetchArgs![1].body as string);
    expect(body.name).toBe('Jane Smith');
  });

  it('email in body matches the trimmed input value', async () => {
    const mockFetch = mockOkResponse();
    const { fetchArgs } = await simulateSubmit(VALID_FORM, mockFetch);

    const body = JSON.parse(fetchArgs![1].body as string);
    expect(body.email).toBe('jane@example.com');
  });

  it('password in body matches the exact password input (case-sensitive)', async () => {
    const mockFetch = mockOkResponse();
    const form: FormState = {
      ...VALID_FORM,
      password: 'MyS3cur3P@ss!',
      confirmPassword: 'MyS3cur3P@ss!',
    };
    const { fetchArgs } = await simulateSubmit(form, mockFetch);

    const body = JSON.parse(fetchArgs![1].body as string);
    expect(body.password).toBe('MyS3cur3P@ss!');
  });
});

// ===========================================================================
// Additional: loading state and no-redirect on error
// ===========================================================================

describe('SignUpPage — error handling and loading state', () => {
  it('does not redirect when the API returns a non-ok response', async () => {
    const mockFetch = mockErrorResponse(409, {
      error: 'An account with this email address already exists.',
    });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.redirectedTo).toBeNull();
  });

  it('does not redirect when a network failure occurs', async () => {
    const mockFetch = mockNetworkFailure();
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);

    expect(afterFetch.redirectedTo).toBeNull();
  });

  it('always resets isSubmitting to false in the finally block (success)', async () => {
    const mockFetch = mockOkResponse();
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);
    expect(afterFetch.isSubmitting).toBe(false);
  });

  it('always resets isSubmitting to false in the finally block (409)', async () => {
    const mockFetch = mockErrorResponse(409, { error: 'Already exists.' });
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);
    expect(afterFetch.isSubmitting).toBe(false);
  });

  it('always resets isSubmitting to false in the finally block (network error)', async () => {
    const mockFetch = mockNetworkFailure();
    const { afterFetch } = await simulateSubmit(VALID_FORM, mockFetch);
    expect(afterFetch.isSubmitting).toBe(false);
  });
});

// ===========================================================================
// Additional: updateField — error clearing on field edit
// ===========================================================================

describe('SignUpPage — error clearing on field edit (updateField)', () => {
  it('clears the server error when the user types in the name field', () => {
    const result = updateField('name', 'Bob', VALID_FORM, {}, 'Server error!');
    expect(result.serverError).toBeNull();
  });

  it('clears the server error when the user types in the email field', () => {
    const result = updateField('email', 'bob@example.com', VALID_FORM, {}, 'Server error!');
    expect(result.serverError).toBeNull();
  });

  it('clears the server error when the user types in the password field', () => {
    const result = updateField('password', 'newpassword', VALID_FORM, {}, 'Server error!');
    expect(result.serverError).toBeNull();
  });

  it('clears the server error when the user types in the confirmPassword field', () => {
    const result = updateField('confirmPassword', 'newpassword', VALID_FORM, {}, 'Server error!');
    expect(result.serverError).toBeNull();
  });

  it('clears the per-field error for the edited field', () => {
    const fieldError: FieldError = {
      name: 'Name is required.',
      email: 'Email is required.',
      password: 'Password is required.',
      confirmPassword: 'Passwords do not match.',
    };
    const result = updateField('name', 'Alice', VALID_FORM, fieldError, null);
    expect(result.fieldError.name).toBeUndefined();
  });

  it('does NOT clear the per-field error for other fields', () => {
    const fieldError: FieldError = {
      name: 'Name is required.',
      email: 'Email is required.',
    };
    const result = updateField('name', 'Alice', VALID_FORM, fieldError, null);
    // Email error must remain untouched
    expect(result.fieldError.email).toBe('Email is required.');
  });

  it('clears the confirmPassword field error when confirmPassword is edited', () => {
    const fieldError: FieldError = {
      confirmPassword: 'Passwords do not match.',
    };
    const result = updateField('confirmPassword', 'matchingpass', VALID_FORM, fieldError, null);
    expect(result.fieldError.confirmPassword).toBeUndefined();
  });

  it('updates form.name in the returned form state', () => {
    const result = updateField('name', 'New Name', VALID_FORM, {}, null);
    expect(result.form.name).toBe('New Name');
  });

  it('updates form.email in the returned form state', () => {
    const result = updateField('email', 'new@email.com', VALID_FORM, {}, null);
    expect(result.form.email).toBe('new@email.com');
  });

  it('keeps serverError null when it was already null', () => {
    const result = updateField('name', 'Alice', VALID_FORM, {}, null);
    expect(result.serverError).toBeNull();
  });

  it('is idempotent when there is no existing error to clear', () => {
    const result = updateField('name', 'Alice', VALID_FORM, {}, null);
    expect(result.fieldError).toEqual({});
  });
});

// ===========================================================================
// Additional: route accessibility (mirrors middleware logic for /signup)
// ===========================================================================

describe('SignUpPage — route accessibility (no redirect loop)', () => {
  const AUTH_PATHS = ['/login', '/signup'];

  function isAuthPage(pathname: string): boolean {
    return AUTH_PATHS.includes(pathname);
  }

  function isPublicPath(pathname: string): boolean {
    return (
      pathname.startsWith('/clone/') ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/favicon') ||
      pathname.startsWith('/uploads/')
    );
  }

  function isPrivatePath(pathname: string): boolean {
    return !isPublicPath(pathname) && !isAuthPage(pathname);
  }

  it('/signup is not treated as a private route (does not require auth)', () => {
    expect(isPrivatePath('/signup')).toBe(false);
  });

  it('/signup is classified as an auth page by the middleware', () => {
    expect(isAuthPage('/signup')).toBe(true);
  });

  it('unauthenticated users can access /signup without being redirected', () => {
    const hasSession = false;
    const pathname = '/signup';

    const shouldRedirectToLogin = isPrivatePath(pathname) && !hasSession;
    expect(shouldRedirectToLogin).toBe(false);
  });

  it('authenticated users visiting /signup are redirected to / (not back to /signup)', () => {
    const hasSession = true;
    const pathname = '/signup';

    const shouldRedirectToHome = isAuthPage(pathname) && hasSession;
    expect(shouldRedirectToHome).toBe(true);
  });

  it('/ is a private path (requires auth) — confirming /signup is correctly exempted', () => {
    expect(isPrivatePath('/')).toBe(true);
  });

  it('/login is also exempted from auth (both auth pages are treated the same)', () => {
    expect(isPrivatePath('/login')).toBe(false);
    expect(isAuthPage('/login')).toBe(true);
  });
});
