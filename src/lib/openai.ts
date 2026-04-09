import OpenAI from 'openai';

export function getOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}
