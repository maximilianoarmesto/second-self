import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// The default system prompt is stored in Settings as the operator-supplied
// "custom prompt" extension.  The strict first-person persona rules (identity,
// knowledge-base grounding, refusal to hallucinate) are always enforced by
// buildSystemPrompt() in rag-service and cannot be overridden from here.
// This value only controls *tone and style* — it is appended after the base
// constraints, not instead of them.
const DEFAULT_SYSTEM_PROMPT =
  'Infer tone, style, and manner of expression from the provided knowledge base context. ' +
  'Be natural, personal, and human. Do not sound robotic.';

export async function GET() {
  try {
    let settings = await prisma.settings.findUnique({
      where: { ownerId: 1 },
    });

    if (!settings) {
      // Ensure owner exists
      await prisma.owner.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, cloneName: 'My Second Self' },
      });
      // Create default settings
      settings = await prisma.settings.create({
        data: {
          ownerId: 1,
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
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { cloneName, systemPrompt, tone, responseLength, openaiApiKey } = body;

    // Ensure the owner row exists before upserting settings (the settings table
    // has a foreign-key constraint on owner_id).  Using upsert here avoids a
    // race condition where a concurrent GET already created the row.
    await prisma.owner.upsert({
      where: { id: 1 },
      update: cloneName !== undefined ? { cloneName } : {},
      create: { id: 1, cloneName: cloneName || 'My Second Self' },
    });

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
      where: { ownerId: 1 },
      update: updateData,
      create: {
        ownerId: 1,
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
}
