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

    // Return a masked version of the API key so the client knows one is stored.
    // avatarUrl is included explicitly so the contract is clear to callers.
    const { openaiApiKeyEncrypted, ...rest } = settings;
    const maskedKey =
      openaiApiKeyEncrypted && openaiApiKeyEncrypted.length > 8
        ? `${openaiApiKeyEncrypted.slice(0, 5)}..${openaiApiKeyEncrypted.slice(-4)}`
        : openaiApiKeyEncrypted
          ? '••••••••'
          : null;

    return NextResponse.json({
      ...rest,
      avatarUrl: settings.avatarUrl ?? null,
      openaiApiKeyMasked: maskedKey,
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
    const { cloneName, systemPrompt, tone, responseLength, openaiApiKey } = body;

    // Also update the owner's display name when cloneName is provided.
    if (cloneName !== undefined) {
      await prisma.owner.update({
        where: { id: userId },
        data: { cloneName },
      });
    }

    // Build update data, only including provided fields.
    // openaiApiKey === null explicitly clears the stored server key.
    // openaiApiKey === undefined means the field was not sent (no change).
    const updateData: Record<string, any> = {};
    if (cloneName !== undefined) updateData.cloneName = cloneName;
    if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt;
    if (tone !== undefined) updateData.tone = tone;
    if (responseLength !== undefined) updateData.responseLength = responseLength;
    if (openaiApiKey !== undefined) {
      // null clears the key; any string value sets it
      updateData.openaiApiKeyEncrypted = openaiApiKey ?? null;
    }

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
      },
    });

    // Strip the raw API key from the response for security — the client only
    // needs to know whether a key is stored (via the masked representation).
    // avatarUrl is included explicitly so the contract is clear to callers.
    const { openaiApiKeyEncrypted, ...rest } = settings;
    const maskedKey =
      openaiApiKeyEncrypted && openaiApiKeyEncrypted.length > 8
        ? `${openaiApiKeyEncrypted.slice(0, 5)}..${openaiApiKeyEncrypted.slice(-4)}`
        : openaiApiKeyEncrypted
          ? '••••••••'
          : null;

    return NextResponse.json({
      ...rest,
      avatarUrl: settings.avatarUrl ?? null,
      openaiApiKeyMasked: maskedKey,
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
