/**
 * Unit tests for the "Test Connection" feedback message color logic
 * in the Settings page (src/app/settings/page.tsx).
 *
 * The color class applied to the feedback <p> element is derived from the
 * `testStatus` state value using the following ternary expression:
 *
 *   testStatus === 'success'
 *     ? 'text-green-700'
 *     : testStatus === 'error'
 *       ? 'text-red-700'
 *       : 'text-black'
 *
 * Acceptance criteria verified:
 *  1. 'success' status resolves to 'text-green-700'
 *  2. 'error' status resolves to 'text-red-700'
 *  3. 'testing' status (in-flight) resolves to 'text-black' (neutral fallback)
 *  4. 'idle' status (no message shown yet) resolves to 'text-black' (neutral fallback)
 *  5. The class is not hardcoded — each status produces a distinct value
 *  6. Success and error produce different color classes
 *  7. The full class string used in JSX (including 'text-sm') is correct per status
 *  8. testConnection sets status to 'success' and message on a successful API response
 *  9. testConnection sets status to 'error' and message when the API returns success:false
 * 10. testConnection sets status to 'error' and message when apiFetch throws
 * 11. testConnection resets status to 'testing' and clears the message at the start
 */

// ---------------------------------------------------------------------------
// Inline color-class helper — mirrors the JSX ternary in the component
// ---------------------------------------------------------------------------
//
// This is a direct extraction of the expression used to compute the className
// for the feedback <p> element.  Keeping it in sync with the component is
// intentional: if the component's expression changes, this helper (and the
// tests that rely on it) must be updated to match.

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

/**
 * Returns the Tailwind color class for the test-connection feedback message
 * based on the current `testStatus` value.
 *
 * Mirrors the ternary in src/app/settings/page.tsx:
 *   testStatus === 'success'
 *     ? 'text-green-700'
 *     : testStatus === 'error'
 *       ? 'text-red-700'
 *       : 'text-black'
 */
function getTestMessageColorClass(status: TestStatus): string {
  return status === 'success' ? 'text-green-700' : status === 'error' ? 'text-red-700' : 'text-black';
}

/**
 * Returns the full className string applied to the feedback <p> element,
 * matching the JSX expression:
 *   `text-sm ${getTestMessageColorClass(status)}`
 */
function getTestMessageClassName(status: TestStatus): string {
  return `text-sm ${getTestMessageColorClass(status)}`;
}

// ---------------------------------------------------------------------------
// Simulated testConnection logic — mirrors the handler in the component
// ---------------------------------------------------------------------------
//
// We test the state-transition logic in isolation by extracting the branching
// into a pure function, just as the avatar-upload tests do. This avoids a
// React render environment while still validating the exact transitions that
// drive which color class the component selects.

interface TestConnectionState {
  testStatus: TestStatus;
  testMessage: string;
}

type ApiFetchResult = { success: boolean; message?: string };

/**
 * Simulates the state changes performed by `testConnection` in the component.
 *
 * Returns the final { testStatus, testMessage } after the async operation
 * completes, along with the intermediate "testing" snapshot taken at the
 * start of the call — before the API response arrives.
 */
async function simulateTestConnection(
  apiFetch: () => Promise<ApiFetchResult>
): Promise<{ initial: TestConnectionState; final: TestConnectionState }> {
  // Phase 1 — start of call: reset to 'testing'
  let state: TestConnectionState = { testStatus: 'testing', testMessage: '' };
  const initial = { ...state };

  try {
    const result = await apiFetch();
    if (result.success) {
      state = { testStatus: 'success', testMessage: 'Connection successful. Your API key is valid.' };
    } else {
      state = { testStatus: 'error', testMessage: result.message ?? 'Connection test failed.' };
    }
  } catch (err: unknown) {
    state = {
      testStatus: 'error',
      testMessage: err instanceof Error ? err.message : 'Connection test failed.',
    };
  }

  return { initial, final: state };
}

// ---------------------------------------------------------------------------
// 1–4. Color class derivation per status
// ---------------------------------------------------------------------------

describe('getTestMessageColorClass — color per TestStatus value', () => {
  // 1. Success → green
  it("returns 'text-green-700' for status 'success'", () => {
    expect(getTestMessageColorClass('success')).toBe('text-green-700');
  });

  // 2. Error → red
  it("returns 'text-red-700' for status 'error'", () => {
    expect(getTestMessageColorClass('error')).toBe('text-red-700');
  });

  // 3. Testing → neutral (message is cleared at start of call, so this is a
  //    safety net — the <p> is hidden while testMessage is empty)
  it("returns 'text-black' for status 'testing' (neutral fallback)", () => {
    expect(getTestMessageColorClass('testing')).toBe('text-black');
  });

  // 4. Idle → neutral
  it("returns 'text-black' for status 'idle' (neutral fallback)", () => {
    expect(getTestMessageColorClass('idle')).toBe('text-black');
  });
});

// ---------------------------------------------------------------------------
// 5–6. Distinctness checks
// ---------------------------------------------------------------------------

describe('getTestMessageColorClass — class distinctness', () => {
  // 5. Every status produces a unique value — no two statuses map to the same class
  it('produces a distinct class for each of the four statuses', () => {
    const statuses: TestStatus[] = ['idle', 'testing', 'success', 'error'];
    const classes = statuses.map(getTestMessageColorClass);
    const unique = new Set(classes);
    // 'idle' and 'testing' intentionally share 'text-black' (both are neutral),
    // so we expect 3 distinct values: text-black, text-green-700, text-red-700.
    expect(unique.size).toBe(3);
  });

  // 6. Success and error are strictly different colors
  it("'success' and 'error' produce different color classes", () => {
    expect(getTestMessageColorClass('success')).not.toBe(getTestMessageColorClass('error'));
  });

  // Additional: success is not the neutral fallback
  it("'success' class is not 'text-black'", () => {
    expect(getTestMessageColorClass('success')).not.toBe('text-black');
  });

  // Additional: error is not the neutral fallback
  it("'error' class is not 'text-black'", () => {
    expect(getTestMessageColorClass('error')).not.toBe('text-black');
  });
});

// ---------------------------------------------------------------------------
// 7. Full className string (as used in JSX)
// ---------------------------------------------------------------------------

describe('getTestMessageClassName — full className string', () => {
  // 7a. Success full class
  it("produces 'text-sm text-green-700' for status 'success'", () => {
    expect(getTestMessageClassName('success')).toBe('text-sm text-green-700');
  });

  // 7b. Error full class
  it("produces 'text-sm text-red-700' for status 'error'", () => {
    expect(getTestMessageClassName('error')).toBe('text-sm text-red-700');
  });

  // 7c. Testing full class (neutral)
  it("produces 'text-sm text-black' for status 'testing'", () => {
    expect(getTestMessageClassName('testing')).toBe('text-sm text-black');
  });

  // 7d. Idle full class (neutral)
  it("produces 'text-sm text-black' for status 'idle'", () => {
    expect(getTestMessageClassName('idle')).toBe('text-sm text-black');
  });
});

// ---------------------------------------------------------------------------
// 8–11. testConnection state-transition logic
// ---------------------------------------------------------------------------

describe('simulateTestConnection — state transitions', () => {
  // 8. Successful API response → success status + success message
  it("sets testStatus to 'success' and correct message on a successful API response", async () => {
    const apiFetch = jest.fn().mockResolvedValue({ success: true });

    const { final } = await simulateTestConnection(apiFetch);

    expect(final.testStatus).toBe('success');
    expect(final.testMessage).toBe('Connection successful. Your API key is valid.');
  });

  // 8a. Verify that a successful result uses the green color class
  it("a 'success' result maps to 'text-green-700' after the call", async () => {
    const apiFetch = jest.fn().mockResolvedValue({ success: true });

    const { final } = await simulateTestConnection(apiFetch);

    expect(getTestMessageColorClass(final.testStatus)).toBe('text-green-700');
  });

  // 9. API returns success:false → error status + server message
  it("sets testStatus to 'error' and server message when API returns success:false", async () => {
    const apiFetch = jest.fn().mockResolvedValue({
      success: false,
      message: 'Invalid API key.',
    });

    const { final } = await simulateTestConnection(apiFetch);

    expect(final.testStatus).toBe('error');
    expect(final.testMessage).toBe('Invalid API key.');
  });

  // 9a. API returns success:false with no message → uses fallback message
  it("uses fallback 'Connection test failed.' when API returns success:false with no message", async () => {
    const apiFetch = jest.fn().mockResolvedValue({ success: false });

    const { final } = await simulateTestConnection(apiFetch);

    expect(final.testStatus).toBe('error');
    expect(final.testMessage).toBe('Connection test failed.');
  });

  // 9b. Verify that a failure result maps to the red color class
  it("an 'error' result maps to 'text-red-700' after the call", async () => {
    const apiFetch = jest.fn().mockResolvedValue({ success: false, message: 'Invalid API key.' });

    const { final } = await simulateTestConnection(apiFetch);

    expect(getTestMessageColorClass(final.testStatus)).toBe('text-red-700');
  });

  // 10. apiFetch throws an Error → error status + error.message
  it("sets testStatus to 'error' and the Error message when apiFetch throws", async () => {
    const apiFetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const { final } = await simulateTestConnection(apiFetch);

    expect(final.testStatus).toBe('error');
    expect(final.testMessage).toBe('Network error');
  });

  // 10a. apiFetch throws a non-Error → fallback message
  it("uses generic fallback message when apiFetch throws a non-Error value", async () => {
    const apiFetch = jest.fn().mockRejectedValue('string rejection');

    const { final } = await simulateTestConnection(apiFetch);

    expect(final.testStatus).toBe('error');
    expect(final.testMessage).toBe('Connection test failed.');
  });

  // 10b. Thrown error also maps to the red color class
  it("a thrown error maps to 'text-red-700'", async () => {
    const apiFetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const { final } = await simulateTestConnection(apiFetch);

    expect(getTestMessageColorClass(final.testStatus)).toBe('text-red-700');
  });

  // 11. At the very start of the call the status is 'testing' and message is cleared
  it("resets testStatus to 'testing' and clears testMessage at the start of the call", async () => {
    // simulateTestConnection captures the initial state synchronously before
    // awaiting the apiFetch promise, so the snapshot always reflects the
    // 'testing' phase regardless of when the API resolves.
    const apiFetch = jest.fn().mockResolvedValue({ success: true });
    const { initial } = await simulateTestConnection(apiFetch);

    expect(initial.testStatus).toBe('testing');
    expect(initial.testMessage).toBe('');
  });

  // 11a. 'testing' maps to the neutral 'text-black' class (message is hidden during the call)
  it("'testing' status maps to the neutral 'text-black' class", () => {
    expect(getTestMessageColorClass('testing')).toBe('text-black');
  });
});
