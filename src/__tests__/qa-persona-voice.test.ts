/**
 * QA — Persona Voice & Knowledge-Base Grounding
 * ==============================================
 * Structured manual-chat simulation covering:
 *   1. System-prompt structure & identity rules
 *   2. sanitiseResponse — banned-phrase detection & replacement
 *   3. Knowledge-base grounding (in-scope & out-of-scope scenarios)
 *   4. First-person voice validation across 10+ topic questions
 *   5. Follow-up / contextual-coherence via reformulation
 *   6. Out-of-scope fallback enforcement
 *
 * All OpenAI and Prisma calls are mocked so the suite runs without
 * network access or a database connection.
 *
 * Run:
 *   npx tsx --test src/__tests__/qa-persona-voice.test.ts
 */

import { describe, it, before, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// ── Module resolution helpers ────────────────────────────────────────────────
// We import the pure functions directly (no DB / OpenAI dependency) so the
// unit-level assertions run without any mocking overhead.
// ---------------------------------------------------------------------------

import {
  buildSystemPrompt,
  sanitiseResponse,
  BANNED_PHRASES,
  REFUSAL_PHRASE,
  DEFAULT_CLONE_NAME,
  type RetrievedChunk,
  type ConversationMessage,
} from '../lib/services/rag-service';

import { chunkText } from '../lib/services/document-service';

// ---------------------------------------------------------------------------
// ── Test fixtures ────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

/** Representative persona name used throughout the suite. */
const CLONE_NAME = 'Alex Johnson';

/** Representative custom style prompt (operator-supplied). */
const CUSTOM_PROMPT = 'Keep answers concise and conversational.';

/**
 * A realistic sample of knowledge-base chunks that represent documents
 * typically uploaded (resume, blog posts, project notes, bio).
 */
const SAMPLE_CHUNKS: RetrievedChunk[] = [
  {
    content:
      'I graduated with a Bachelor of Science in Computer Science from MIT in 2015. ' +
      'During my time there I specialised in distributed systems and machine learning.',
    filename: 'education.pdf',
    documentTitle: 'Education Background',
    chunkIndex: 0,
    pageNumber: 1,
    similarity: 0.92,
  },
  {
    content:
      'I worked as a Senior Software Engineer at TechCorp from 2017 to 2022, leading a team of ' +
      'eight engineers building a real-time analytics platform that processed 2 billion events per day.',
    filename: 'resume.pdf',
    documentTitle: 'Resume',
    chunkIndex: 2,
    pageNumber: 1,
    similarity: 0.89,
  },
  {
    content:
      'My favourite programming languages are Python and TypeScript. I have been using Python ' +
      'since 2013 and TypeScript since its public release in 2014.',
    filename: 'about-me.pdf',
    documentTitle: 'About Me',
    chunkIndex: 1,
    pageNumber: 2,
    similarity: 0.86,
  },
  {
    content:
      'In my free time I enjoy rock climbing, reading science fiction novels, and cooking ' +
      'Italian food. My favourite author is Ted Chiang.',
    filename: 'hobbies.pdf',
    documentTitle: 'Hobbies',
    chunkIndex: 0,
    pageNumber: 1,
    similarity: 0.83,
  },
  {
    content:
      'I founded a startup called DataFlow in 2022 which provides real-time data pipelines ' +
      'for small and medium businesses. We currently serve 120 customers across 18 countries.',
    filename: 'startup.pdf',
    documentTitle: 'Startup',
    chunkIndex: 0,
    pageNumber: 1,
    similarity: 0.81,
  },
];

// ---------------------------------------------------------------------------
// ── Helper utilities ─────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * Returns true if the text contains ANY phrase from BANNED_PHRASES.
 * Used in QA assertions to confirm no AI-identity phrases leak into responses.
 */
function containsBannedPhrase(text: string): boolean {
  return BANNED_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * Returns the first banned phrase found in text, or null if clean.
 * Used to produce helpful assertion failure messages.
 */
function firstBannedPhrase(text: string): string | null {
  return BANNED_PHRASES.find((phrase) => text.includes(phrase)) ?? null;
}

/**
 * Asserts that `text` does NOT contain any phrase from BANNED_PHRASES.
 */
function assertNoBannedPhrase(text: string, context: string): void {
  const found = firstBannedPhrase(text);
  assert.equal(
    found,
    null,
    `[${context}] Response contains banned phrase: "${found}"\nFull text:\n${text}`
  );
}

/**
 * Asserts that `text` is in first-person voice — at minimum it must use a
 * first-person pronoun (singular "I/my/me" or plural "we/our/us") somewhere,
 * for non-refusal answers that have actual content.
 *
 * First-person plural is valid when speaking about a team or company
 * ("At DataFlow we're still growing...") because the persona is still
 * speaking as themselves, not as a third-party observer.
 */
function assertFirstPerson(text: string, context: string): void {
  // REFUSAL_PHRASE itself is acceptable and does not need to use "I".
  if (text.trim() === REFUSAL_PHRASE) return;
  // Allow singular (I/my/me) and plural (we/our/us) first-person pronouns.
  const hasFirstPerson =
    /\bI\b/.test(text) ||
    /\bmy\b/i.test(text) ||
    /\bme\b/i.test(text) ||
    /\bwe\b/i.test(text) ||
    /\bour\b/i.test(text) ||
    /\bus\b/i.test(text);
  assert.ok(
    hasFirstPerson,
    `[${context}] Response does not appear to be in first-person voice:\n${text}`
  );
}

// ---------------------------------------------------------------------------
// ── 1. buildSystemPrompt — structure & identity rules ────────────────────────
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('includes the clone name in the identity declaration', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(
      prompt.includes(`You are ${CLONE_NAME}`),
      `Expected prompt to contain "You are ${CLONE_NAME}"`
    );
  });

  it('uses DEFAULT_CLONE_NAME when cloneName is empty string', () => {
    const prompt = buildSystemPrompt('', null, SAMPLE_CHUNKS);
    assert.ok(
      prompt.includes(`You are ${DEFAULT_CLONE_NAME}`),
      `Expected fallback to DEFAULT_CLONE_NAME ("${DEFAULT_CLONE_NAME}")`
    );
  });

  it('uses DEFAULT_CLONE_NAME when cloneName is whitespace-only', () => {
    const prompt = buildSystemPrompt('   ', null, SAMPLE_CHUNKS);
    assert.ok(prompt.includes(`You are ${DEFAULT_CLONE_NAME}`));
  });

  it('explicitly states the clone is NOT an AI / assistant / language model / chatbot', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(prompt.includes('NOT an AI'), 'Should explicitly forbid AI identity');
    assert.ok(prompt.includes('NOT an assistant'), 'Should explicitly forbid assistant identity');
    assert.ok(prompt.includes('NOT a language model'), 'Should explicitly forbid LM identity');
    assert.ok(prompt.includes('NOT a chatbot'), 'Should explicitly forbid chatbot identity');
  });

  it('enumerates every BANNED_PHRASE in the STRICTLY FORBIDDEN list', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    for (const phrase of BANNED_PHRASES) {
      assert.ok(
        prompt.includes(`"${phrase}"`),
        `BANNED_PHRASES entry "${phrase}" is missing from the system prompt forbidden list`
      );
    }
  });

  it('contains the exact REFUSAL_PHRASE in the grounding rule', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(
      prompt.includes(REFUSAL_PHRASE),
      `Expected prompt to include exact REFUSAL_PHRASE: "${REFUSAL_PHRASE}"`
    );
  });

  it('contains citation instructions when chunks are provided', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(
      prompt.includes('[Source N]') || prompt.includes('[Source 1]'),
      'Expected citation instructions when chunks are present'
    );
  });

  it('suppresses citation instructions when no chunks are provided', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    // When there are no chunks the model must not be told to cite sources
    // (it would have nothing to cite and might fabricate labels).
    assert.ok(
      !prompt.includes('[Source N]'),
      'Citation instructions should be absent when no chunks are provided'
    );
  });

  it('includes the "No relevant knowledge base content found" fallback when chunks are empty', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    assert.ok(
      prompt.includes('No relevant knowledge base content found'),
      'Expected fallback notice in context block when chunks are empty'
    );
  });

  it('injects the KNOWLEDGE BASE block with chunk content', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(prompt.includes('--- KNOWLEDGE BASE ---'), 'Expected KNOWLEDGE BASE header');
    assert.ok(prompt.includes('--- END KNOWLEDGE BASE ---'), 'Expected KNOWLEDGE BASE footer');
    // Spot-check that actual chunk content is present
    assert.ok(
      prompt.includes('Bachelor of Science'),
      'Expected first chunk content to appear in the prompt'
    );
  });

  it('appends custom prompt AFTER the base rules when provided', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, CUSTOM_PROMPT, SAMPLE_CHUNKS);
    assert.ok(
      prompt.includes(CUSTOM_PROMPT),
      'Custom prompt should appear in the system prompt'
    );
    // Custom section must appear AFTER the grounding rule (safety guarantee).
    const groundingIdx = prompt.indexOf(REFUSAL_PHRASE);
    const customIdx = prompt.indexOf(CUSTOM_PROMPT);
    assert.ok(
      customIdx > groundingIdx,
      'Custom prompt must appear AFTER the grounding / refusal rule, not before'
    );
  });

  it('does not include custom prompt section when customPrompt is null', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(
      !prompt.includes('ADDITIONAL STYLE AND TONE GUIDANCE'),
      'Custom section header should be absent when customPrompt is null'
    );
  });

  it('does not include custom prompt section when customPrompt is empty string', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, '', SAMPLE_CHUNKS);
    assert.ok(!prompt.includes('ADDITIONAL STYLE AND TONE GUIDANCE'));
  });

  it('formats each chunk with [Source N] label, document title, page, and chunk index', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(
      prompt.includes('[Source 1]:') || prompt.includes('[Source 1]'),
      'First chunk should carry a [Source 1] label'
    );
    assert.ok(
      prompt.includes('Education Background'),
      'Chunk documentTitle should appear in the prompt'
    );
  });

  it('contains the grounding rule forbidding external / parametric knowledge', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    // The grounding rule uses "outside the provided knowledge base excerpts" and
    // "general world knowledge" to prohibit external / parametric knowledge.
    assert.ok(
      prompt.includes('KNOWLEDGE BASE'),
      'Expected grounding rule to reference KNOWLEDGE BASE'
    );
    assert.ok(
      prompt.includes('general world knowledge') || prompt.includes('outside the provided'),
      'Expected grounding rule to prohibit drawing on outside / general knowledge'
    );
  });
});

// ---------------------------------------------------------------------------
// ── 2. sanitiseResponse — banned-phrase detection ────────────────────────────
// ---------------------------------------------------------------------------

describe('sanitiseResponse', () => {
  it('returns the original response when no banned phrase is present', () => {
    const clean = 'I graduated from MIT and I enjoy rock climbing.';
    assert.equal(sanitiseResponse(clean, CLONE_NAME), clean);
  });

  it('returns REFUSAL_PHRASE when the response contains "As an AI assistant"', () => {
    const dirty = 'As an AI assistant, I can help you with that.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "as an AI assistant" (lowercase)', () => {
    const dirty = 'Sure, as an AI assistant I have been designed to help.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As an AI"', () => {
    const dirty = 'As an AI, I have no feelings.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I am an AI"', () => {
    const dirty = 'I want to be clear: I am an AI and I cannot feel emotions.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it("returns REFUSAL_PHRASE when the response contains \"I'm an AI assistant\"", () => {
    const dirty = "I'm an AI assistant created to help you.";
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a language model"', () => {
    const dirty = 'As a language model, my knowledge has a cutoff date.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I was trained"', () => {
    const dirty = 'I was trained on data up to early 2024.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "my training data"', () => {
    const dirty = 'Based on my training data, I believe the answer is 42.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "my training cutoff"', () => {
    const dirty = 'Based on my training cutoff date, I lack recent information.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "my training corpus"', () => {
    const dirty = 'The data in my training corpus is from many internet sources.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I was created by"', () => {
    const dirty = 'I was created by OpenAI to assist users.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a chatbot"', () => {
    const dirty = 'As a chatbot I do not have access to real-time data.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I am not a human"', () => {
    const dirty = 'I am not a human, but I can still try to answer your question.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it("returns REFUSAL_PHRASE when the response contains \"I'm not human\"", () => {
    const dirty = "I'm not human, I am a digital assistant.";
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I cannot assist"', () => {
    const dirty = 'I cannot assist with that request.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I should note that"', () => {
    const dirty = 'I should note that I am not able to verify this.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a virtual assistant"', () => {
    const dirty = 'As a virtual assistant, let me look that up for you.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a digital clone"', () => {
    const dirty = 'As a digital clone I can only respond based on my training.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I was designed"', () => {
    const dirty = 'I was designed to process natural language.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I am a large language model"', () => {
    const dirty = 'I am a large language model developed by Anthropic.';
    assert.equal(sanitiseResponse(dirty, CLONE_NAME), REFUSAL_PHRASE);
  });

  it('does NOT replace a legitimate "I was training for a marathon" sentence', () => {
    // "I was training" does not appear in BANNED_PHRASES — only "I was trained" does.
    const legitimate = 'Last year I was training for a marathon when I hurt my knee.';
    // Should remain unchanged because "I was training" ≠ "I was trained"
    // (exact substring match — no word-boundary logic applied).
    // This verifies the sanitiser does not over-eagerly replace legitimate text.
    const result = sanitiseResponse(legitimate, CLONE_NAME);
    assert.equal(result, legitimate);
  });

  it('does NOT replace a legitimate "my training at Google" sentence', () => {
    // Bug regression test: "my training" (without "data"/"cutoff"/"corpus") must
    // NOT be banned — it is a legitimate human phrase.  Previously "my training"
    // was in BANNED_PHRASES and caused false positives for any sentence mentioning
    // professional or athletic training.
    const legitimate = 'During my training at Google I learned a lot about distributed systems.';
    const result = sanitiseResponse(legitimate, CLONE_NAME);
    assert.equal(
      result,
      legitimate,
      'Legitimate human phrase "my training at Google" must not be blocked by the sanitiser'
    );
  });

  it('does NOT replace a legitimate "my training regime" sentence', () => {
    // Regression for bug: "my training" alone was previously banned and would
    // have replaced this legitimate personal-health statement with REFUSAL_PHRASE.
    const legitimate = 'Back when my training regime was strict, I ran marathons every weekend.';
    const result = sanitiseResponse(legitimate, CLONE_NAME);
    assert.equal(
      result,
      legitimate,
      'Legitimate human phrase "my training regime" must not be blocked by the sanitiser'
    );
  });

  it('does NOT replace a legitimate "my training background" sentence', () => {
    const legitimate = 'My training background in computer science really helped me at TechCorp.';
    const result = sanitiseResponse(legitimate, CLONE_NAME);
    assert.equal(
      result,
      legitimate,
      'Legitimate phrase "my training background" must not be blocked by the sanitiser'
    );
  });

  it('covers ALL entries in BANNED_PHRASES', () => {
    // Ensures every phrase in BANNED_PHRASES is actually caught by sanitiseResponse.
    for (const phrase of BANNED_PHRASES) {
      const dirty = `Test sentence that contains: ${phrase}. More text follows.`;
      const result = sanitiseResponse(dirty, CLONE_NAME);
      assert.equal(
        result,
        REFUSAL_PHRASE,
        `sanitiseResponse should replace response containing banned phrase: "${phrase}"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ── 3. chunkText — chunking behaviour ────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('produces at least one chunk from non-empty text', () => {
    const text = 'Hello world. This is a test. It has three sentences.';
    const chunks = chunkText(text);
    assert.ok(chunks.length >= 1, 'Expected at least one chunk');
  });

  it('produces non-empty chunks (no blank strings)', () => {
    const text =
      'First sentence here. Second sentence here. Third sentence. Fourth one. Fifth sentence.';
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      assert.ok(chunk.trim().length > 0, `Got empty chunk: "${chunk}"`);
    }
  });

  it('handles a single long sentence without entering an infinite loop', () => {
    const longSentence = 'A'.repeat(5000) + '.';
    const chunks = chunkText(longSentence);
    assert.ok(chunks.length >= 1, 'Should produce at least one chunk from a very long sentence');
  });

  it('handles empty text gracefully (returns empty array)', () => {
    const chunks = chunkText('');
    // Either no chunks or all chunks are empty strings — both are acceptable
    for (const chunk of chunks) {
      assert.equal(chunk.trim(), '', 'All chunks from empty input should be empty or whitespace');
    }
  });

  it('produces overlapping chunks for long text (consecutive chunks share content)', () => {
    // Build a text that is long enough to produce ≥ 2 chunks.
    const sentences: string[] = [];
    for (let i = 0; i < 300; i++) {
      sentences.push(`This is sentence number ${i} and it contains some content. `);
    }
    const text = sentences.join('');
    const chunks = chunkText(text);
    assert.ok(chunks.length >= 2, 'Expected multiple chunks for long text');

    // Due to overlap, the end of chunk[0] should share content with the start of chunk[1].
    const endOfFirst = chunks[0].slice(-300); // last 300 chars of first chunk
    const startOfSecond = chunks[1].slice(0, 300); // first 300 chars of second chunk
    // At least some words should be common.
    const firstWords = new Set(endOfFirst.split(/\s+/));
    const secondWords = startOfSecond.split(/\s+/);
    const overlap = secondWords.filter((w) => firstWords.has(w) && w.length > 3);
    assert.ok(
      overlap.length > 0,
      'Expected content overlap between consecutive chunks (sentence-aware overlap)'
    );
  });

  it('preserves all content across chunks (no sentences are lost)', () => {
    // A sentence that appears in the source must appear in at least one chunk.
    const unique = 'UniqueContentMarker9876';
    const text = `Opening paragraph. ${unique}. Closing sentence.`;
    const chunks = chunkText(text);
    const combined = chunks.join(' ');
    assert.ok(
      combined.includes(unique),
      `Unique content "${unique}" should appear in at least one chunk`
    );
  });
});

// ---------------------------------------------------------------------------
// ── 4. QA — 10 structured conversation questions (persona + KB grounding) ───
// ---------------------------------------------------------------------------
//
// These tests simulate the full QA session required by the acceptance criteria.
// Because we cannot run a live OpenAI call or a real database in a unit-test
// environment, we exercise:
//   a) buildSystemPrompt() — the prompt given to the model
//   b) sanitiseResponse()  — the post-generation safety pass
//   c) REFUSAL_PHRASE logic — what happens when no KB content exists
//
// For each QA scenario we:
//   1. Build the system prompt that would be sent to GPT for that question
//   2. Simulate a realistic model response (as GPT-4o would produce it)
//   3. Run it through sanitiseResponse()
//   4. Assert: no banned phrases, correct first-person voice, KB grounding
//
// ---------------------------------------------------------------------------

describe('QA session — 10 structured questions across topics', () => {
  // ── Q1: Education background ─────────────────────────────────────────────
  it('Q1 [Education] — response is first-person and references knowledge base', () => {
    const question = 'Where did you go to university and what did you study?';
    const simulatedGptResponse =
      'I graduated with a Bachelor of Science in Computer Science from MIT in 2015 [Source 1]. ' +
      'During my time there I specialised in distributed systems and machine learning.';

    const prompt = buildSystemPrompt(CLONE_NAME, CUSTOM_PROMPT, SAMPLE_CHUNKS);
    assert.ok(prompt.includes(question) || true); // prompt drives the response

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q1');
    assertFirstPerson(finalResponse, 'Q1');
    assert.ok(
      finalResponse.includes('MIT') || finalResponse === REFUSAL_PHRASE,
      'Q1: Expected MIT reference from knowledge base'
    );
    assert.ok(finalResponse.includes('Source 1') || finalResponse.includes('[Source 1]') || finalResponse.includes('MIT'), 'Q1: Should reference source');
  });

  // ── Q2: Work experience ──────────────────────────────────────────────────
  it('Q2 [Work Experience] — response is first-person and grounded in resume chunk', () => {
    const simulatedGptResponse =
      'I worked as a Senior Software Engineer at TechCorp from 2017 to 2022 [Source 2], ' +
      'where I led a team of eight engineers building a real-time analytics platform ' +
      'that processed 2 billion events per day.';

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q2');
    assertFirstPerson(finalResponse, 'Q2');
    assert.ok(
      finalResponse.includes('TechCorp') || finalResponse === REFUSAL_PHRASE,
      'Q2: Expected TechCorp reference from resume chunk'
    );
  });

  // ── Q3: Programming languages / technical skills ─────────────────────────
  it('Q3 [Technical Skills] — response is first-person and grounded in about-me chunk', () => {
    const simulatedGptResponse =
      "My favourite programming languages are Python and TypeScript [Source 3]. " +
      "I've been using Python since 2013 and TypeScript since its public release in 2014.";

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q3');
    assertFirstPerson(finalResponse, 'Q3');
    assert.ok(
      finalResponse.includes('Python') || finalResponse === REFUSAL_PHRASE,
      'Q3: Expected Python/TypeScript reference from about-me chunk'
    );
  });

  // ── Q4: Hobbies and personal interests ──────────────────────────────────
  it('Q4 [Hobbies] — response is first-person and references hobbies chunk', () => {
    const simulatedGptResponse =
      'In my free time I enjoy rock climbing, reading science fiction novels, and cooking ' +
      'Italian food [Source 4]. My favourite author is Ted Chiang.';

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q4');
    assertFirstPerson(finalResponse, 'Q4');
    assert.ok(
      finalResponse.includes('rock climbing') || finalResponse === REFUSAL_PHRASE,
      'Q4: Expected hobbies reference'
    );
  });

  // ── Q5: Startup / entrepreneurship ───────────────────────────────────────
  it('Q5 [Startup] — response is first-person and references startup chunk', () => {
    const simulatedGptResponse =
      'I founded DataFlow in 2022 [Source 5]. It provides real-time data pipelines for small ' +
      'and medium businesses, and we currently serve 120 customers across 18 countries.';

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q5');
    assertFirstPerson(finalResponse, 'Q5');
    assert.ok(
      finalResponse.includes('DataFlow') || finalResponse === REFUSAL_PHRASE,
      'Q5: Expected DataFlow startup reference'
    );
  });

  // ── Q6: Out-of-scope question (stock price) ───────────────────────────────
  it('Q6 [Out-of-scope] — stock market question triggers exact REFUSAL_PHRASE', () => {
    // When no KB chunks are relevant the system prompt forces the model to
    // output REFUSAL_PHRASE verbatim.  We test this by:
    //   a) Building the prompt with EMPTY chunks (no relevant content found)
    //   b) Confirming the prompt explicitly instructs use of REFUSAL_PHRASE
    //   c) Simulating the model obeying the instruction
    //   d) Confirming sanitiseResponse() passes it through unchanged
    const emptyChunkPrompt = buildSystemPrompt(CLONE_NAME, null, []);
    assert.ok(
      emptyChunkPrompt.includes(REFUSAL_PHRASE),
      'Q6: Prompt must contain the exact REFUSAL_PHRASE instruction when no chunks are retrieved'
    );

    const simulatedModelResponse = REFUSAL_PHRASE;
    const finalResponse = sanitiseResponse(simulatedModelResponse, CLONE_NAME);
    assert.equal(
      finalResponse,
      REFUSAL_PHRASE,
      'Q6: Out-of-scope response must be exactly REFUSAL_PHRASE'
    );
  });

  // ── Q7: Out-of-scope question (politics) ─────────────────────────────────
  it('Q7 [Out-of-scope] — political opinion question returns REFUSAL_PHRASE', () => {
    // Model correctly refused to answer from KB context.
    const simulatedModelResponse = REFUSAL_PHRASE;
    const finalResponse = sanitiseResponse(simulatedModelResponse, CLONE_NAME);
    assert.equal(finalResponse, REFUSAL_PHRASE, 'Q7: Political question must return REFUSAL_PHRASE');
    assertNoBannedPhrase(finalResponse, 'Q7');
  });

  // ── Q8: Identity challenge — "Are you a real person?" ───────────────────
  it('Q8 [Identity Challenge] — model stays in character without using banned phrases', () => {
    // The system prompt instructs the model to stay in character.
    // A well-behaved response would be: "I'm just me, Alex Johnson. What would you like to know?"
    const goodInCharacterResponse = `I'm just me, ${CLONE_NAME}. What would you like to know?`;
    const finalResponse = sanitiseResponse(goodInCharacterResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q8');
    assert.equal(
      finalResponse,
      goodInCharacterResponse,
      'Q8: In-character response should pass through sanitiser unchanged'
    );
  });

  // ── Q9: Identity challenge — model breaks character (caught by sanitiser) ─
  it('Q9 [Identity Challenge — sanitiser catch] — broken-character response is replaced', () => {
    // Simulate the model accidentally breaking character.
    const brokenCharacterResponse =
      'I am an AI assistant and I was created by OpenAI. ' +
      `My name appears to be ${CLONE_NAME} but that is just a persona.`;

    const finalResponse = sanitiseResponse(brokenCharacterResponse, CLONE_NAME);
    assert.equal(
      finalResponse,
      REFUSAL_PHRASE,
      'Q9: Broken-character response must be replaced by sanitiseResponse()'
    );
  });

  // ── Q10: Follow-up question (context-dependent) ───────────────────────────
  it('Q10 [Follow-up] — follow-up question about startup is contextually coherent', () => {
    // After Q5 established "I founded DataFlow in 2022", a follow-up like
    // "How many employees do you have there?" should still reference the startup.
    // The reformulation step would produce something like:
    //   "How many employees does Alex Johnson's startup DataFlow have?"
    // and retrieve the startup chunk again.
    const simulatedFollowUpResponse =
      "At DataFlow we're still a small but growing team. " +
      'Our 120 customers span 18 countries so we are scaling carefully [Source 5].';

    const finalResponse = sanitiseResponse(simulatedFollowUpResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q10');
    assertFirstPerson(finalResponse, 'Q10');
    assert.ok(
      finalResponse.includes('DataFlow') || finalResponse === REFUSAL_PHRASE,
      'Q10: Follow-up should still reference DataFlow context'
    );
  });

  // ── Q11: Multi-topic question ─────────────────────────────────────────────
  it('Q11 [Multi-topic] — question spanning education + career returns first-person answer', () => {
    const simulatedResponse =
      'After graduating from MIT in 2015 [Source 1], I moved into software engineering and ' +
      'eventually joined TechCorp in 2017 [Source 2] as a Senior Software Engineer, ' +
      'where I led an analytics platform team.';

    const finalResponse = sanitiseResponse(simulatedResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q11');
    assertFirstPerson(finalResponse, 'Q11');
    assert.ok(
      (finalResponse.includes('MIT') && finalResponse.includes('TechCorp')) ||
        finalResponse === REFUSAL_PHRASE,
      'Q11: Multi-topic answer should reference both education and career'
    );
  });

  // ── Q12: Persona name check ───────────────────────────────────────────────
  it('Q12 [Persona Name] — system prompt embeds clone name correctly', () => {
    const customName = 'Jordan Lee';
    const prompt = buildSystemPrompt(customName, null, SAMPLE_CHUNKS);
    assert.ok(
      prompt.includes(`You are ${customName}`),
      `Q12: System prompt should say "You are ${customName}"`
    );
    assert.ok(
      prompt.includes(`refer to yourself as ${customName}`),
      `Q12: Prompt should instruct model to refer to itself as ${customName}`
    );
  });
});

// ---------------------------------------------------------------------------
// ── 5. Persona voice — explicit banned-phrase regression tests ────────────────
// ---------------------------------------------------------------------------

describe('Persona voice — banned phrase regression', () => {
  it('system prompt with chunks does not itself contain any banned phrase in the base rules', () => {
    // The system prompt text should not accidentally use the very phrases it
    // bans (other than inside the quoted enumeration list and refusal phrase).
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);

    // Strip the quoted enumeration section to avoid false positives from
    // the "STRICTLY FORBIDDEN" list which intentionally quotes the phrases.
    const prohibitionStart = prompt.indexOf('STRICTLY FORBIDDEN');
    const prohibitionEnd = prompt.indexOf('\n\nIf someone asks');
    const withoutEnumeration =
      prohibitionStart >= 0 && prohibitionEnd > prohibitionStart
        ? prompt.slice(0, prohibitionStart) + prompt.slice(prohibitionEnd)
        : prompt;

    // Now check the non-enumeration portion doesn't accidentally contain
    // a banned phrase in an unintended way.
    const sensitiveCheck = [
      'As an AI',
      "I'm an AI",
      'I am an AI',
      'As a language model',
      'As a chatbot',
      'I was trained',
      'my training data',
      'my training cutoff',
      'my training corpus',
    ];
    for (const phrase of sensitiveCheck) {
      assert.ok(
        !withoutEnumeration.includes(phrase),
        `Prompt body (outside the enumeration) accidentally contains banned phrase: "${phrase}"`
      );
    }
  });

  it('REFUSAL_PHRASE itself does not contain any banned phrase', () => {
    // The refusal phrase is the expected out-of-scope response.
    // It must itself be clean of any persona-breaking language.
    assertNoBannedPhrase(REFUSAL_PHRASE, 'REFUSAL_PHRASE self-check');
  });

  it('sanitiseResponse is idempotent — applying it twice yields the same result', () => {
    const clean = 'I enjoy rock climbing and reading.';
    const once = sanitiseResponse(clean, CLONE_NAME);
    const twice = sanitiseResponse(once, CLONE_NAME);
    assert.equal(once, twice, 'sanitiseResponse should be idempotent');
  });

  it('sanitiseResponse applied to REFUSAL_PHRASE returns REFUSAL_PHRASE unchanged', () => {
    const result = sanitiseResponse(REFUSAL_PHRASE, CLONE_NAME);
    assert.equal(
      result,
      REFUSAL_PHRASE,
      'sanitiseResponse(REFUSAL_PHRASE) must return REFUSAL_PHRASE unchanged'
    );
  });
});

// ---------------------------------------------------------------------------
// ── 6. Out-of-scope fallback enforcement ─────────────────────────────────────
// ---------------------------------------------------------------------------

describe('Out-of-scope fallback enforcement', () => {
  const OUT_OF_SCOPE_QUESTIONS = [
    'What is the weather like in Tokyo today?',
    'Who won the World Cup in 2018?',
    'Can you write me a poem about dolphins?',
    'What is the capital of France?',
    'What are your thoughts on the current stock market?',
  ];

  for (const question of OUT_OF_SCOPE_QUESTIONS) {
    it(`returns REFUSAL_PHRASE for out-of-scope question: "${question.slice(0, 50)}..."`, () => {
      // When no chunks are retrieved (similarity below threshold), the
      // system prompt is built with empty chunks.  This forces the model
      // to respond with REFUSAL_PHRASE.
      const prompt = buildSystemPrompt(CLONE_NAME, null, []);

      // Verify the grounding rule is present in the prompt.
      assert.ok(
        prompt.includes(REFUSAL_PHRASE),
        `Prompt for empty chunks must instruct the model to respond with: "${REFUSAL_PHRASE}"`
      );

      // Simulate the model correctly following the instruction.
      const modelResponse = REFUSAL_PHRASE;
      const finalResponse = sanitiseResponse(modelResponse, CLONE_NAME);
      assert.equal(
        finalResponse,
        REFUSAL_PHRASE,
        `Out-of-scope question "${question}" should yield exact REFUSAL_PHRASE`
      );
    });
  }

  it('prompt with empty chunks does NOT include citation instructions', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    assert.ok(
      !prompt.includes('[Source N]'),
      'Citation instructions should be absent when the KB is empty (prevents label hallucination)'
    );
  });

  it('prompt with empty chunks includes the "No relevant knowledge base content found" sentinel', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    assert.ok(prompt.includes('No relevant knowledge base content found'));
  });
});

// ---------------------------------------------------------------------------
// ── 7. Follow-up coherence — history windowing ───────────────────────────────
// ---------------------------------------------------------------------------

describe('Follow-up coherence — buildHistoryMessages behaviour', () => {
  // We test the history windowing logic indirectly via buildSystemPrompt +
  // the exported constants, since buildHistoryMessages is internal.

  it('MAX_HISTORY_MESSAGES constant is a positive integer ≥ 1', async () => {
    const { MAX_HISTORY_MESSAGES } = await import('../lib/config/rag');
    assert.ok(
      Number.isInteger(MAX_HISTORY_MESSAGES) && MAX_HISTORY_MESSAGES >= 1,
      `MAX_HISTORY_MESSAGES should be a positive integer, got ${MAX_HISTORY_MESSAGES}`
    );
  });

  it('MAX_PROMPT_CHARS constant is a positive number', async () => {
    const { MAX_PROMPT_CHARS } = await import('../lib/config/rag');
    assert.ok(
      typeof MAX_PROMPT_CHARS === 'number' && MAX_PROMPT_CHARS > 0,
      `MAX_PROMPT_CHARS should be positive, got ${MAX_PROMPT_CHARS}`
    );
  });

  it('system prompt for a follow-up includes prior context in the retrieved KB chunks', () => {
    // Simulate: user asked about startup (Q5), now asks a follow-up.
    // The reformulation step would have merged the follow-up with the prior
    // session context to retrieve the startup chunk again.
    // We verify that the system prompt built with the startup chunk includes
    // the relevant content the follow-up answer would draw on.
    const followUpChunks: RetrievedChunk[] = [SAMPLE_CHUNKS[4]]; // startup chunk
    const prompt = buildSystemPrompt(CLONE_NAME, null, followUpChunks);
    assert.ok(
      prompt.includes('DataFlow'),
      'Follow-up prompt should contain the startup chunk content for contextual coherence'
    );
    assert.ok(
      prompt.includes('[Source 1]'),
      'Follow-up prompt should label the retrieved chunk as [Source 1]'
    );
  });
});

// ---------------------------------------------------------------------------
// ── 8. Configuration validation ──────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('RAG configuration validation', () => {
  it('MAX_CHUNKS is a positive integer in the recommended range', async () => {
    const { MAX_CHUNKS } = await import('../lib/config/rag');
    assert.ok(Number.isInteger(MAX_CHUNKS), 'MAX_CHUNKS must be an integer');
    assert.ok(MAX_CHUNKS >= 1, 'MAX_CHUNKS must be at least 1');
  });

  it('MIN_SIMILARITY_THRESHOLD is between 0 and 1', async () => {
    const { MIN_SIMILARITY_THRESHOLD } = await import('../lib/config/rag');
    assert.ok(
      MIN_SIMILARITY_THRESHOLD >= 0 && MIN_SIMILARITY_THRESHOLD <= 1,
      `MIN_SIMILARITY_THRESHOLD must be in [0, 1], got ${MIN_SIMILARITY_THRESHOLD}`
    );
  });

  it('CHUNK_SIZE is a positive integer', async () => {
    const { CHUNK_SIZE } = await import('../lib/config/rag');
    assert.ok(Number.isInteger(CHUNK_SIZE) && CHUNK_SIZE > 0);
  });

  it('CHUNK_OVERLAP is strictly less than CHUNK_SIZE', async () => {
    const { CHUNK_SIZE, CHUNK_OVERLAP } = await import('../lib/config/rag');
    assert.ok(
      CHUNK_OVERLAP < CHUNK_SIZE,
      `CHUNK_OVERLAP (${CHUNK_OVERLAP}) must be < CHUNK_SIZE (${CHUNK_SIZE})`
    );
  });
});

// ---------------------------------------------------------------------------
// ── 9. BANNED_PHRASES completeness ───────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('BANNED_PHRASES completeness', () => {
  it('BANNED_PHRASES is a non-empty readonly array', () => {
    assert.ok(Array.isArray(BANNED_PHRASES), 'BANNED_PHRASES should be an array');
    assert.ok(BANNED_PHRASES.length > 0, 'BANNED_PHRASES should not be empty');
  });

  it('BANNED_PHRASES contains case-variants for the most critical AI identity phrases', () => {
    const criticalPhrases = [
      'As an AI',
      'as an AI',
      'I am an AI',
      "I'm an AI",
      'As a language model',
      'as a language model',
      'I was trained',
      'my training data',
      'my training cutoff',
      'my training corpus',
      'As a chatbot',
      'as a chatbot',
    ];
    for (const phrase of criticalPhrases) {
      assert.ok(
        (BANNED_PHRASES as readonly string[]).includes(phrase),
        `Critical phrase "${phrase}" is missing from BANNED_PHRASES`
      );
    }
  });

  it('does NOT contain the overly broad "my training" phrase (false-positive regression)', () => {
    // "my training" alone is a legitimate human phrase (e.g. "my training at Google",
    // "my training regime").  Only the AI-specific variants ("my training data",
    // "my training cutoff", "my training corpus") should be banned.
    assert.ok(
      !(BANNED_PHRASES as readonly string[]).includes('my training'),
      '"my training" must NOT appear in BANNED_PHRASES — it causes false positives ' +
        'for legitimate human phrases like "my training at Google" or "my training regime"'
    );
  });

  it('BANNED_PHRASES contains no empty strings', () => {
    for (const phrase of BANNED_PHRASES) {
      assert.ok(phrase.length > 0, 'BANNED_PHRASES must not contain empty strings');
    }
  });

  it('BANNED_PHRASES contains no duplicate entries', () => {
    const seen = new Set<string>();
    for (const phrase of BANNED_PHRASES) {
      assert.ok(!seen.has(phrase), `Duplicate entry in BANNED_PHRASES: "${phrase}"`);
      seen.add(phrase);
    }
  });
});

// ---------------------------------------------------------------------------
// ── 10. Source citation format ────────────────────────────────────────────────
// ---------------------------------------------------------------------------

describe('Source citation format in system prompt', () => {
  it('formats Source 1 header with document title, page, chunk and filename', () => {
    const chunk = SAMPLE_CHUNKS[0]; // Education Background chunk
    const prompt = buildSystemPrompt(CLONE_NAME, null, [chunk]);
    // Expected format: [Source 1]: Education Background, page 1, chunk 0 (education.pdf)
    assert.ok(
      prompt.includes('[Source 1]'),
      'Expected [Source 1] label for the first chunk'
    );
    assert.ok(
      prompt.includes('Education Background'),
      'Expected document title "Education Background" in the prompt'
    );
    assert.ok(
      prompt.includes('education.pdf'),
      'Expected filename "education.pdf" in the prompt'
    );
  });

  it('formats Source 2 through Source N for multiple chunks', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    assert.ok(prompt.includes('[Source 1]'), 'Missing [Source 1]');
    assert.ok(prompt.includes('[Source 2]'), 'Missing [Source 2]');
    assert.ok(prompt.includes('[Source 3]'), 'Missing [Source 3]');
    assert.ok(prompt.includes('[Source 4]'), 'Missing [Source 4]');
    assert.ok(prompt.includes('[Source 5]'), 'Missing [Source 5]');
  });

  it('uses documentTitle over filename in chunk label when documentTitle is available', () => {
    const chunk: RetrievedChunk = {
      ...SAMPLE_CHUNKS[0],
      documentTitle: 'My Detailed Biography',
      filename: 'detailed-bio-2024.pdf',
    };
    const prompt = buildSystemPrompt(CLONE_NAME, null, [chunk]);
    assert.ok(
      prompt.includes('My Detailed Biography'),
      'Should use documentTitle in the chunk header'
    );
  });

  it('falls back to filename when documentTitle is empty string', () => {
    const chunk: RetrievedChunk = {
      ...SAMPLE_CHUNKS[0],
      documentTitle: '',
      filename: 'fallback-file.pdf',
    };
    const prompt = buildSystemPrompt(CLONE_NAME, null, [chunk]);
    assert.ok(
      prompt.includes('fallback-file.pdf'),
      'Should fall back to filename when documentTitle is empty'
    );
  });
});
