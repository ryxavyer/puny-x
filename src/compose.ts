import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import type { ComposeInput, Config } from './types';

let personaCache: string | null = null;

async function loadPersona(personaPath: string): Promise<string> {
  if (personaCache !== null) return personaCache;
  personaCache = await fs.readFile(personaPath, 'utf8');
  return personaCache;
}

export function buildInput(input: ComposeInput): string {
  return JSON.stringify(input, null, 2);
}

export async function composePost(
  input: ComposeInput,
  config: Pick<Config, 'anthropicApiKey' | 'personaPath'>,
): Promise<string> {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required to compose posts');
  }
  const persona = await loadPersona(config.personaPath);
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: [
      {
        type: 'text',
        text: persona,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildInput(input),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text block in Anthropic response');
  }
  return textBlock.text.trim();
}
