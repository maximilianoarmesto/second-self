import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DEFAULT_SYSTEM_PROMPT =
  'You are the user\'s Second Self. Speak in first person as if you are the user. ' +
  'Infer tone, style, and manner of expression from the provided knowledge base context. ' +
  'Be natural, personal, and human. Do not sound robotic. Only make claims supported by ' +
  'the retrieved knowledge. If something is unknown or unsupported, say so honestly and ' +
  'naturally. Do not mention that you are an AI unless explicitly asked.';

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

    // Return a masked version of the API key so the client knows one is stored
    const { openaiApiKeyEncrypted, ...rest } = settings as any;
    const maskedKey =
      openaiApiKeyEncrypted && openaiApiKeyEncrypted.length > 8
        ? `${openaiApiKeyEncrypted.slice(0, 5)}..${openaiApiKeyEncrypted.slice(-4)}`
        : openaiApiKeyEncrypted
          ? '••••••••'
          : null;

    return NextResponse.json({ ...rest, openaiApiKeyMasked: maskedKey });
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

    // Build update data, only including provided fields
    const updateData: Record<string, any> = {};
    if (cloneName !== undefined) updateData.cloneName = cloneName;
    if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt;
    if (tone !== undefined) updateData.tone = tone;
    if (responseLength !== undefined) updateData.responseLength = responseLength;
    if (openaiApiKey !== undefined) updateData.openaiApiKeyEncrypted = openaiApiKey;

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

    // If cloneName is provided, also update the Owner record
    if (cloneName !== undefined) {
      await prisma.owner.update({
        where: { id: 1 },
        data: { cloneName },
      });
    }

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Error updating settings:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update settings' },
      { status: 500 }
    );
  }
}
