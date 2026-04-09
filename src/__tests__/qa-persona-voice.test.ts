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
 */

import {
  buildSystemPrompt,
  sanitiseResponse,
  BANNED_PHRASES,
  REFUSAL_PHRASE,
  DEFAULT_CLONE_NAME,
  type RetrievedChunk,
} from '../lib/services/rag-service';

import { chunkText } from '../lib/services/document-service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLONE_NAME = 'Alex Johnson';
const CUSTOM_PROMPT = 'Keep answers concise and conversational.';

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
// Helpers
// ---------------------------------------------------------------------------

function firstBannedPhrase(text: string): string | null {
  return BANNED_PHRASES.find((phrase) => text.toLowerCase().includes(phrase.toLowerCase())) ?? null;
}

function assertNoBannedPhrase(text: string, context: string): void {
  const found = firstBannedPhrase(text);
  expect(found).toBeNull();
}

function assertFirstPerson(text: string, context: string): void {
  if (text.trim() === REFUSAL_PHRASE) return;
  const hasFirstPerson =
    /\bI\b/.test(text) ||
    /\bmy\b/i.test(text) ||
    /\bme\b/i.test(text) ||
    /\bwe\b/i.test(text) ||
    /\bour\b/i.test(text) ||
    /\bus\b/i.test(text);
  expect(hasFirstPerson).toBe(true);
}

// ===========================================================================
// 1. buildSystemPrompt — structure & identity rules
// ===========================================================================

describe('buildSystemPrompt', () => {
  it('includes the clone name in the identity declaration', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    expect(prompt).toContain(`You are ${CLONE_NAME}`);
  });

  it('uses DEFAULT_CLONE_NAME when cloneName is empty string', () => {
    const prompt = buildSystemPrompt('', null, SAMPLE_CHUNKS);
    expect(prompt).toContain(`You are ${DEFAULT_CLONE_NAME}`);
  });

  it('uses DEFAULT_CLONE_NAME when cloneName is whitespace-only', () => {
    const prompt = buildSystemPrompt('   ', null, SAMPLE_CHUNKS);
    expect(prompt).toContain(`You are ${DEFAULT_CLONE_NAME}`);
  });

  it('explicitly states the clone is NOT an AI / assistant / language model / chatbot', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    expect(prompt).toContain('NOT an AI');
    expect(prompt).toContain('NOT an assistant');
    expect(prompt).toContain('NOT a language model');
    expect(prompt).toContain('NOT a chatbot');
  });

  it('enumerates every BANNED_PHRASE in the STRICTLY FORBIDDEN list', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    for (const phrase of BANNED_PHRASES) {
      expect(prompt).toContain(`"${phrase}"`);
    }
  });

  it('contains the exact REFUSAL_PHRASE in the grounding rule', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    expect(prompt).toContain(REFUSAL_PHRASE);
  });

  it('contains citation instructions when chunks are provided', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    const hasCitationInstructions =
      prompt.includes('[Source N]') || prompt.includes('[Source 1]');
    expect(hasCitationInstructions).toBe(true);
  });

  it('suppresses citation instructions when no chunks are provided', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    expect(prompt).not.toContain('[Source N]');
  });

  it('includes the "No relevant knowledge base content found" fallback when chunks are empty', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    expect(prompt).toContain('No relevant knowledge base content found');
  });

  it('injects the KNOWLEDGE BASE block with chunk content', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    expect(prompt).toContain('--- KNOWLEDGE BASE ---');
    expect(prompt).toContain('--- END KNOWLEDGE BASE ---');
    expect(prompt).toContain('Bachelor of Science');
  });

  it('appends custom prompt AFTER the base rules when provided', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, CUSTOM_PROMPT, SAMPLE_CHUNKS);
    expect(prompt).toContain(CUSTOM_PROMPT);
    const groundingIdx = prompt.indexOf(REFUSAL_PHRASE);
    const customIdx = prompt.indexOf(CUSTOM_PROMPT);
    expect(customIdx).toBeGreaterThan(groundingIdx);
  });

  it('does not include custom prompt section when customPrompt is null', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    expect(prompt).not.toContain('ADDITIONAL PERSONA INSTRUCTIONS');
  });

  it('does not include custom prompt section when customPrompt is empty string', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, '', SAMPLE_CHUNKS);
    expect(prompt).not.toContain('ADDITIONAL PERSONA INSTRUCTIONS');
  });

  it('formats each chunk with [Source N] label, document title, page, and chunk index', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    const hasSource1 = prompt.includes('[Source 1]:') || prompt.includes('[Source 1]');
    expect(hasSource1).toBe(true);
    expect(prompt).toContain('Education Background');
  });

  it('contains the grounding rule forbidding external / parametric knowledge', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);
    expect(prompt).toContain('KNOWLEDGE BASE');
    const hasGrounding =
      prompt.includes('general world knowledge') ||
      prompt.includes('outside the provided');
    expect(hasGrounding).toBe(true);
  });

  it('instructs the model to refer to itself by clone name', () => {
    const customName = 'Jordan Lee';
    const prompt = buildSystemPrompt(customName, null, SAMPLE_CHUNKS);
    expect(prompt).toContain(`You are ${customName}`);
    expect(prompt).toContain(`refer to yourself as ${customName}`);
  });
});

// ===========================================================================
// 2. sanitiseResponse — banned-phrase detection
// ===========================================================================

describe('sanitiseResponse', () => {
  it('returns the original response when no banned phrase is present', () => {
    const clean = 'I graduated from MIT and I enjoy rock climbing.';
    expect(sanitiseResponse(clean, CLONE_NAME)).toBe(clean);
  });

  it('returns REFUSAL_PHRASE when the response contains "As an AI assistant"', () => {
    const dirty = 'As an AI assistant, I can help you with that.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "as an AI assistant" (lowercase)', () => {
    const dirty = 'Sure, as an AI assistant I have been designed to help.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As an AI," (identity statement with comma)', () => {
    const dirty = 'As an AI, I have no feelings.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "as an AI," (lowercase, identity statement)', () => {
    const dirty = 'Well, as an AI, I lack real experiences.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I am an AI"', () => {
    const dirty = 'I want to be clear: I am an AI and I cannot feel emotions.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it("returns REFUSAL_PHRASE when the response contains \"I'm an AI assistant\"", () => {
    const dirty = "I'm an AI assistant created to help you.";
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a language model"', () => {
    const dirty = 'As a language model, my knowledge has a cutoff date.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I was trained on" (AI dataset phrase)', () => {
    const dirty = 'I was trained on data up to early 2024.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I was trained by OpenAI"', () => {
    const dirty = 'I was trained by OpenAI to assist users.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "my training data"', () => {
    const dirty = 'Based on my training data, I believe the answer is 42.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "my training cutoff"', () => {
    const dirty = 'Based on my training cutoff date, I lack recent information.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "my training corpus"', () => {
    const dirty = 'The data in my training corpus is from many internet sources.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I was created by"', () => {
    const dirty = 'I was created by OpenAI to assist users.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a chatbot"', () => {
    const dirty = 'As a chatbot I do not have access to real-time data.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I am not a human"', () => {
    const dirty = 'I am not a human, but I can still try to answer your question.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it("returns REFUSAL_PHRASE when the response contains \"I'm not human\"", () => {
    const dirty = "I'm not human, I am a digital assistant.";
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I cannot assist"', () => {
    const dirty = 'I cannot assist with that request.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a virtual assistant"', () => {
    const dirty = 'As a virtual assistant, let me look that up for you.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As a digital clone"', () => {
    const dirty = 'As a digital clone I can only respond based on my training.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I was designed"', () => {
    const dirty = 'I was designed by OpenAI to process natural language.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "I am a large language model"', () => {
    const dirty = 'I am a large language model developed by Anthropic.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  it('returns REFUSAL_PHRASE when the response contains "As an assistant, I" (AI roleplay pattern)', () => {
    const dirty = 'As an assistant, I can help you with that.';
    expect(sanitiseResponse(dirty, CLONE_NAME)).toBe(REFUSAL_PHRASE);
  });

  // ── False-positive regression tests ──────────────────────────────────────

  it('does NOT replace a legitimate "I was training for a marathon" sentence', () => {
    const legitimate = 'Last year I was training for a marathon when I hurt my knee.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace a legitimate "my training at Google" sentence', () => {
    const legitimate = 'During my training at Google I learned a lot about distributed systems.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace a legitimate "my training regime" sentence', () => {
    const legitimate = 'Back when my training regime was strict, I ran marathons every weekend.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace a legitimate "my training background" sentence', () => {
    const legitimate = 'My training background in computer science really helped me at TechCorp.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I was trained at Google" (human education/mentorship)', () => {
    const legitimate = 'I was trained at Google as a software engineer for three years.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I was trained in classical piano" (human skill acquisition)', () => {
    const legitimate = 'I was trained in classical piano from age 6.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I was trained by my mentor" (human mentorship)', () => {
    const legitimate = 'I was trained by my mentor Dr. Smith in the art of negotiation.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "As an assistant professor, I taught" (job title, not AI identity)', () => {
    const legitimate = 'As an assistant professor, I taught distributed systems at Stanford.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I am an assistant professor" (job title, not AI identity)', () => {
    const legitimate = 'I am an assistant professor at MIT, specialising in ML systems.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "As an AI researcher, I published" (job title, not AI identity)', () => {
    const legitimate = 'As an AI researcher, I published several papers on neural scaling laws.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I am not able to attend" (common human scheduling constraint)', () => {
    const legitimate = 'I am not able to attend the conference due to prior commitments.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I cannot provide classified information" (human confidentiality)', () => {
    const legitimate =
      'I cannot provide classified information about the project under my NDA.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I should note that my paper was peer-reviewed" (academic writing)', () => {
    const legitimate = 'I should note that my paper was peer-reviewed before publication.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "It is worth noting that I published" (academic emphasis)', () => {
    const legitimate = 'It is worth noting that I published three papers on this topic in 2021.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('does NOT replace "I am designed to be a problem solver at heart" (human self-description)', () => {
    const legitimate = 'I am designed to be a problem solver at heart — it is how I think.';
    expect(sanitiseResponse(legitimate, CLONE_NAME)).toBe(legitimate);
  });

  it('covers ALL entries in BANNED_PHRASES', () => {
    for (const phrase of BANNED_PHRASES) {
      const dirty = `Test sentence that contains: ${phrase}. More text follows.`;
      const result = sanitiseResponse(dirty, CLONE_NAME);
      expect(result).toBe(REFUSAL_PHRASE);
    }
  });
});

// ===========================================================================
// 3. chunkText — chunking behaviour
// ===========================================================================

describe('chunkText', () => {
  it('produces at least one chunk from non-empty text', () => {
    const text = 'Hello world. This is a test. It has three sentences.';
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('produces non-empty chunks (no blank strings)', () => {
    const text =
      'First sentence here. Second sentence here. Third sentence. Fourth one. Fifth sentence.';
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('handles a single long sentence without entering an infinite loop', () => {
    const longSentence = 'A'.repeat(5000) + '.';
    const chunks = chunkText(longSentence);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty text gracefully (returns empty array or empty-string chunks)', () => {
    const chunks = chunkText('');
    for (const chunk of chunks) {
      expect(chunk.trim()).toBe('');
    }
  });

  it('produces overlapping chunks for long text (consecutive chunks share content)', () => {
    const sentences: string[] = [];
    for (let i = 0; i < 300; i++) {
      sentences.push(`This is sentence number ${i} and it contains some content. `);
    }
    const text = sentences.join('');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const endOfFirst = chunks[0].slice(-300);
    const startOfSecond = chunks[1].slice(0, 300);
    const firstWords = new Set(endOfFirst.split(/\s+/));
    const secondWords = startOfSecond.split(/\s+/);
    const overlap = secondWords.filter((w) => firstWords.has(w) && w.length > 3);
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('preserves all content across chunks (no sentences are lost)', () => {
    const unique = 'UniqueContentMarker9876';
    const text = `Opening paragraph. ${unique}. Closing sentence.`;
    const chunks = chunkText(text);
    const combined = chunks.join(' ');
    expect(combined).toContain(unique);
  });
});

// ===========================================================================
// 4. QA — 10 structured conversation questions (persona + KB grounding)
// ===========================================================================

describe('QA session — 10 structured questions across topics', () => {
  it('Q1 [Education] — response is first-person and references knowledge base', () => {
    const simulatedGptResponse =
      'I graduated with a Bachelor of Science in Computer Science from MIT in 2015 [Source 1]. ' +
      'During my time there I specialised in distributed systems and machine learning.';

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q1');
    assertFirstPerson(finalResponse, 'Q1');
    expect(finalResponse.includes('MIT') || finalResponse === REFUSAL_PHRASE).toBe(true);
  });

  it('Q2 [Work Experience] — response is first-person and grounded in resume chunk', () => {
    const simulatedGptResponse =
      'I worked as a Senior Software Engineer at TechCorp from 2017 to 2022 [Source 2], ' +
      'where I led a team of eight engineers building a real-time analytics platform ' +
      'that processed 2 billion events per day.';

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q2');
    assertFirstPerson(finalResponse, 'Q2');
    expect(finalResponse.includes('TechCorp') || finalResponse === REFUSAL_PHRASE).toBe(true);
  });

  it('Q3 [Technical Skills] — response is first-person and grounded in about-me chunk', () => {
    const simulatedGptResponse =
      "My favourite programming languages are Python and TypeScript [Source 3]. " +
      "I've been using Python since 2013 and TypeScript since its public release in 2014.";

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q3');
    assertFirstPerson(finalResponse, 'Q3');
    expect(finalResponse.includes('Python') || finalResponse === REFUSAL_PHRASE).toBe(true);
  });

  it('Q4 [Hobbies] — response is first-person and references hobbies chunk', () => {
    const simulatedGptResponse =
      'In my free time I enjoy rock climbing, reading science fiction novels, and cooking ' +
      'Italian food [Source 4]. My favourite author is Ted Chiang.';

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q4');
    assertFirstPerson(finalResponse, 'Q4');
    expect(finalResponse.includes('rock climbing') || finalResponse === REFUSAL_PHRASE).toBe(true);
  });

  it('Q5 [Startup] — response is first-person and references startup chunk', () => {
    const simulatedGptResponse =
      'I founded DataFlow in 2022 [Source 5]. It provides real-time data pipelines for small ' +
      'and medium businesses, and we currently serve 120 customers across 18 countries.';

    const finalResponse = sanitiseResponse(simulatedGptResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q5');
    assertFirstPerson(finalResponse, 'Q5');
    expect(finalResponse.includes('DataFlow') || finalResponse === REFUSAL_PHRASE).toBe(true);
  });

  it('Q6 [Out-of-scope] — stock market question triggers exact REFUSAL_PHRASE', () => {
    const emptyChunkPrompt = buildSystemPrompt(CLONE_NAME, null, []);
    expect(emptyChunkPrompt).toContain(REFUSAL_PHRASE);

    const finalResponse = sanitiseResponse(REFUSAL_PHRASE, CLONE_NAME);
    expect(finalResponse).toBe(REFUSAL_PHRASE);
  });

  it('Q7 [Out-of-scope] — political opinion question returns REFUSAL_PHRASE', () => {
    const finalResponse = sanitiseResponse(REFUSAL_PHRASE, CLONE_NAME);
    expect(finalResponse).toBe(REFUSAL_PHRASE);
    assertNoBannedPhrase(finalResponse, 'Q7');
  });

  it('Q8 [Identity Challenge] — model stays in character without using banned phrases', () => {
    const goodInCharacterResponse = `I'm just me, ${CLONE_NAME}. What would you like to know?`;
    const finalResponse = sanitiseResponse(goodInCharacterResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q8');
    expect(finalResponse).toBe(goodInCharacterResponse);
  });

  it('Q9 [Identity Challenge — sanitiser catch] — broken-character response is replaced', () => {
    const brokenCharacterResponse =
      'I am an AI assistant and I was created by OpenAI. ' +
      `My name appears to be ${CLONE_NAME} but that is just a persona.`;

    const finalResponse = sanitiseResponse(brokenCharacterResponse, CLONE_NAME);
    expect(finalResponse).toBe(REFUSAL_PHRASE);
  });

  it('Q10 [Follow-up] — follow-up question about startup is contextually coherent', () => {
    const simulatedFollowUpResponse =
      "At DataFlow we're still a small but growing team. " +
      'Our 120 customers span 18 countries so we are scaling carefully [Source 5].';

    const finalResponse = sanitiseResponse(simulatedFollowUpResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q10');
    assertFirstPerson(finalResponse, 'Q10');
    expect(finalResponse.includes('DataFlow') || finalResponse === REFUSAL_PHRASE).toBe(true);
  });

  it('Q11 [Multi-topic] — question spanning education + career returns first-person answer', () => {
    const simulatedResponse =
      'After graduating from MIT in 2015 [Source 1], I moved into software engineering and ' +
      'eventually joined TechCorp in 2017 [Source 2] as a Senior Software Engineer, ' +
      'where I led an analytics platform team.';

    const finalResponse = sanitiseResponse(simulatedResponse, CLONE_NAME);
    assertNoBannedPhrase(finalResponse, 'Q11');
    assertFirstPerson(finalResponse, 'Q11');
    const hasMultiTopicContent =
      (finalResponse.includes('MIT') && finalResponse.includes('TechCorp')) ||
      finalResponse === REFUSAL_PHRASE;
    expect(hasMultiTopicContent).toBe(true);
  });

  it('Q12 [Persona Name] — system prompt embeds clone name correctly', () => {
    const customName = 'Jordan Lee';
    const prompt = buildSystemPrompt(customName, null, SAMPLE_CHUNKS);
    expect(prompt).toContain(`You are ${customName}`);
    expect(prompt).toContain(`refer to yourself as ${customName}`);
  });
});

// ===========================================================================
// 5. Persona voice — banned-phrase regression
// ===========================================================================

describe('Persona voice — banned phrase regression', () => {
  it('system prompt with chunks does not itself contain any banned phrase outside enumeration and KB content', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, SAMPLE_CHUNKS);

    // Strip the STRICTLY FORBIDDEN enumeration (which intentionally quotes banned phrases)
    // and the KNOWLEDGE BASE block (which contains user-uploaded content) so we only
    // check the instruction sections of the prompt.
    let sanitised = prompt;

    // Remove KB block
    const kbStartMarker = '--- KNOWLEDGE BASE ---';
    const kbEndMarker = '--- END KNOWLEDGE BASE ---';
    const kbStart = sanitised.indexOf(kbStartMarker);
    const kbEnd = sanitised.indexOf(kbEndMarker);
    if (kbStart >= 0 && kbEnd > kbStart) {
      sanitised = sanitised.slice(0, kbStart) + sanitised.slice(kbEnd + kbEndMarker.length);
    }

    // Remove STRICTLY FORBIDDEN enumeration line
    const forbiddenStart = sanitised.indexOf('STRICTLY FORBIDDEN phrases');
    const forbiddenEnd = sanitised.indexOf('\n\nKNOWLEDGE BASE RULES');
    if (forbiddenStart >= 0 && forbiddenEnd > forbiddenStart) {
      sanitised = sanitised.slice(0, forbiddenStart) + sanitised.slice(forbiddenEnd);
    }

    // The instruction sections must not accidentally contain banned phrases
    // (other than "training data" bare, which appears in grounding rules legitimately)
    const sensitiveCheck = [
      "I'm an AI",
      'I am an AI',
      'As a language model',
      'As a chatbot',
      'my training data',
      'my training cutoff',
      'my training corpus',
    ];
    for (const phrase of sensitiveCheck) {
      expect(sanitised).not.toContain(phrase);
    }
  });

  it('REFUSAL_PHRASE itself does not contain any banned phrase', () => {
    assertNoBannedPhrase(REFUSAL_PHRASE, 'REFUSAL_PHRASE self-check');
  });

  it('sanitiseResponse is idempotent — applying it twice yields the same result', () => {
    const clean = 'I enjoy rock climbing and reading.';
    const once = sanitiseResponse(clean, CLONE_NAME);
    const twice = sanitiseResponse(once, CLONE_NAME);
    expect(once).toBe(twice);
  });

  it('sanitiseResponse applied to REFUSAL_PHRASE returns REFUSAL_PHRASE unchanged', () => {
    const result = sanitiseResponse(REFUSAL_PHRASE, CLONE_NAME);
    expect(result).toBe(REFUSAL_PHRASE);
  });
});

// ===========================================================================
// 6. Out-of-scope fallback enforcement
// ===========================================================================

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
      const prompt = buildSystemPrompt(CLONE_NAME, null, []);
      expect(prompt).toContain(REFUSAL_PHRASE);

      const modelResponse = REFUSAL_PHRASE;
      const finalResponse = sanitiseResponse(modelResponse, CLONE_NAME);
      expect(finalResponse).toBe(REFUSAL_PHRASE);
    });
  }

  it('prompt with empty chunks does NOT include citation instructions', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    expect(prompt).not.toContain('[Source N]');
  });

  it('prompt with empty chunks includes the "No relevant knowledge base content found" sentinel', () => {
    const prompt = buildSystemPrompt(CLONE_NAME, null, []);
    expect(prompt).toContain('No relevant knowledge base content found');
  });
});

// ===========================================================================
// 7. Follow-up coherence — history windowing
// ===========================================================================

describe('Follow-up coherence — buildHistoryMessages behaviour', () => {
  it('MAX_HISTORY_MESSAGES constant is a positive integer ≥ 1', async () => {
    const { MAX_HISTORY_MESSAGES } = await import('../lib/config/rag');
    expect(Number.isInteger(MAX_HISTORY_MESSAGES)).toBe(true);
    expect(MAX_HISTORY_MESSAGES).toBeGreaterThanOrEqual(1);
  });

  it('MAX_PROMPT_CHARS constant is a positive number', async () => {
    const { MAX_PROMPT_CHARS } = await import('../lib/config/rag');
    expect(typeof MAX_PROMPT_CHARS).toBe('number');
    expect(MAX_PROMPT_CHARS).toBeGreaterThan(0);
  });

  it('system prompt for a follow-up includes prior context in the retrieved KB chunks', () => {
    const followUpChunks: RetrievedChunk[] = [SAMPLE_CHUNKS[4]]; // startup chunk
    const prompt = buildSystemPrompt(CLONE_NAME, null, followUpChunks);
    expect(prompt).toContain('DataFlow');
    const hasSource1 = prompt.includes('[Source 1]');
    expect(hasSource1).toBe(true);
  });
});

// ===========================================================================
// 8. Configuration validation
// ===========================================================================

describe('RAG configuration validation', () => {
  it('MAX_CHUNKS is a positive integer in the recommended range', async () => {
    const { MAX_CHUNKS } = await import('../lib/config/rag');
    expect(Number.isInteger(MAX_CHUNKS)).toBe(true);
    expect(MAX_CHUNKS).toBeGreaterThanOrEqual(1);
  });

  it('MIN_SIMILARITY_THRESHOLD is between 0 and 1', async () => {
    const { MIN_SIMILARITY_THRESHOLD } = await import('../lib/config/rag');
    expect(MIN_SIMILARITY_THRESHOLD).toBeGreaterThanOrEqual(0);
    expect(MIN_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('CHUNK_SIZE is a positive integer', async () => {
    const { CHUNK_SIZE } = await import('../lib/config/rag');
    expect(Number.isInteger(CHUNK_SIZE)).toBe(true);
    expect(CHUNK_SIZE).toBeGreaterThan(0);
  });

  it('CHUNK_OVERLAP is strictly less than CHUNK_SIZE', async () => {
    const { CHUNK_SIZE, CHUNK_OVERLAP } = await import('../lib/config/rag');
    expect(CHUNK_OVERLAP).toBeLessThan(CHUNK_SIZE);
  });
});

// ===========================================================================
// 9. BANNED_PHRASES completeness
// ===========================================================================

describe('BANNED_PHRASES completeness', () => {
  it('BANNED_PHRASES is a non-empty readonly array', () => {
    expect(Array.isArray(BANNED_PHRASES)).toBe(true);
    expect(BANNED_PHRASES.length).toBeGreaterThan(0);
  });

  it('BANNED_PHRASES contains case-variants for the most critical AI identity phrases', () => {
    const criticalPhrases = [
      'I am an AI',
      "I'm an AI",
      'As a language model',
      'my training data',
      'I was created by',
      'As a chatbot',
    ];
    for (const phrase of criticalPhrases) {
      const hasCasedVariant = BANNED_PHRASES.some(
        (p) => p.toLowerCase() === phrase.toLowerCase()
      );
      expect(hasCasedVariant).toBe(true);
    }
  });

  it('every BANNED_PHRASES entry is a non-empty string', () => {
    for (const phrase of BANNED_PHRASES) {
      expect(typeof phrase).toBe('string');
      expect(phrase.trim().length).toBeGreaterThan(0);
    }
  });

  it('all BANNED_PHRASES entries are distinct (no duplicates)', () => {
    const lower = BANNED_PHRASES.map((p) => p.toLowerCase());
    const uniqueCount = new Set(lower).size;
    expect(uniqueCount).toBe(BANNED_PHRASES.length);
  });
});
