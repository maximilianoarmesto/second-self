import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

// The default system prompt is stored in Settings as the operator-supplied
// "custom prompt" extension.  The strict first-person persona rules (identity,
// knowledge-base grounding, refusal to hallucinate) are always enforced by
// buildSystemPrompt() in rag-service and cannot be overridden from here.
// This value only controls *tone and style* — it is appended after the base
// constraints, not instead of them.
const DEFAULT_SYSTEM_PROMPT =
  'Infer tone, style, and manner of expression from the provided knowledge base context. ' +
  'Be natural, personal, and human. Do not sound robotic.';

/**
 * Produces a masked representation of an API key so the client knows one is
 * stored without ever seeing the raw value.
 *
 * Mirrors the masking logic used for openaiApiKeyEncrypted and is shared by
 * all API key fields (openaiApiKeyEncrypted, anthropicApiKey).
 *
 * Rules:
 *  - null / undefined  → null  (no key stored)
 *  - length > 8        → first 5 chars + ".." + last 4 chars
 *  - any shorter value → "••••••••" (generic mask)
 */
function maskApiKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 8) {
    return `${raw.slice(0, 5)}..${raw.slice(-4)}`;
  }
  return '••••••••';
}

export const GET = requireAuth(async (_request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    let settings = await prisma.settings.findUnique({
      where: { ownerId: userId },
    });

    if (!settings) {
      // Create default settings for this user
      settings = await prisma.settings.create({
        data: {
          ownerId: userId,
          cloneName: 'My Second Self',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          tone: 'natural',
          responseLength: 'balanced',
        },
      });
    }

    // Strip both raw API keys from the response and replace them with their
    // masked equivalents so the client knows whether keys are stored without
    // ever receiving the raw values.
    const { openaiApiKeyEncrypted, anthropicApiKey, ...rest } = settings;

    return NextResponse.json({
      ...rest,
      avatarUrl: settings.avatarUrl ?? null,
      openaiApiKeyMasked: maskApiKey(openaiApiKeyEncrypted),
      anthropicApiKeyMasked: maskApiKey(anthropicApiKey),
      aiProvider: settings.aiProvider,
      openaiModel: settings.openaiModel ?? null,
      anthropicModel: settings.anthropicModel ?? null,
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch settings' },
      { status: 500 }
    );
  }
});

export const PUT = requireAuth(async (request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    const body = await request.json();
    const {
      cloneName,
      systemPrompt,
      tone,
      responseLength,
      openaiApiKey,
      anthropicApiKey,
      aiProvider,
      openaiModel,
      anthropicModel,
    } = body;

    // Also update the owner's display name when cloneName is provided.
    if (cloneName !== undefined) {
      await prisma.owner.update({
        where: { id: userId },
        data: { cloneName },
      });
    }

    // Build update data, only including provided fields.
    // A field set to null explicitly clears the stored value.
    // A field set to undefined means it was not sent (no change).
    const updateData: Record<string, any> = {};
    if (cloneName !== undefined) updateData.cloneName = cloneName;
    if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt;
    if (tone !== undefined) updateData.tone = tone;
    if (responseLength !== undefined) updateData.responseLength = responseLength;
    if (openaiApiKey !== undefined) {
      // null clears the key; any string value sets it
      updateData.openaiApiKeyEncrypted = openaiApiKey ?? null;
    }
    if (anthropicApiKey !== undefined) {
      // null clears the key; any string value sets it
      updateData.anthropicApiKey = anthropicApiKey ?? null;
    }
    if (aiProvider !== undefined) updateData.aiProvider = aiProvider;
    if (openaiModel !== undefined) updateData.openaiModel = openaiModel ?? null;
    if (anthropicModel !== undefined) updateData.anthropicModel = anthropicModel ?? null;

    const settings = await prisma.settings.upsert({
      where: { ownerId: userId },
      update: updateData,
      create: {
        ownerId: userId,
        cloneName: cloneName || 'My Second Self',
        systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        tone: tone || 'natural',
        responseLength: responseLength || 'balanced',
        ...(openaiApiKey ? { openaiApiKeyEncrypted: openaiApiKey } : {}),
        ...(anthropicApiKey ? { anthropicApiKey } : {}),
        ...(aiProvider ? { aiProvider } : {}),
        ...(openaiModel !== undefined ? { openaiModel: openaiModel ?? null } : {}),
        ...(anthropicModel !== undefined ? { anthropicModel: anthropicModel ?? null } : {}),
      },
    });

    // Strip the raw API keys from the response for security — the client only
    // needs to know whether keys are stored (via their masked representations).
    const { openaiApiKeyEncrypted, anthropicApiKey: rawAnthropicKey, ...rest } = settings;

    return NextResponse.json({
      ...rest,
      avatarUrl: settings.avatarUrl ?? null,
      openaiApiKeyMasked: maskApiKey(openaiApiKeyEncrypted),
      anthropicApiKeyMasked: maskApiKey(rawAnthropicKey),
      aiProvider: settings.aiProvider,
      openaiModel: settings.openaiModel ?? null,
      anthropicModel: settings.anthropicModel ?? null,
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error updating settings:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update settings' },
      { status: 500 }
    );
  }
});
