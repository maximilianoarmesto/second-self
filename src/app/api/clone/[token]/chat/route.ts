import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/services/rag-service';
import { buildCustomPrompt } from '@/lib/settings-prompt';
import crypto from 'crypto';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Validate token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const link = await prisma.shareLink.findUnique({
      where: { tokenHash },
      include: {
        owner: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!link || !link.isActive) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const body = await request.json();
    const { message, sessionId } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Get API key: prefer stored key from settings, fall back to header
    let apiKey = link.owner.settings?.openaiApiKeyEncrypted || null;
    if (!apiKey) {
      apiKey = request.headers.get('x-openai-api-key');
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'No OpenAI API key configured for this clone' },
        { status: 400 }
      );
    }

    // Resolve the clone name and custom prompt from the owner's Settings so
    // the public chat route produces an identical strict first-person persona
    // to the private chat route.
    //
    // Resolution order for cloneName (nullish — never swallows empty string):
    //   1. settings.cloneName  — most up-to-date; set on the Settings row
    //   2. owner.cloneName     — legacy fallback on the Owner record itself
    //   3. undefined           — lets buildSystemPrompt() use DEFAULT_CLONE_NAME
    //
    // Using nullish coalescing (??) rather than logical OR (||) ensures that
    // an intentionally empty cloneName from Settings is not silently discarded
    // in favour of a potentially stale Owner-record value.
    const ownerSettings = link.owner.settings;
    const cloneName = ownerSettings?.cloneName ?? link.owner.cloneName ?? undefined;

    // Build the composite custom prompt that incorporates systemPrompt, tone,
    // and responseLength from the owner's Settings.  buildSystemPrompt() in
    // rag-service appends it after the strict first-person base rules, so
    // persona constraints are always enforced.
    // Pass null (not undefined) when no custom prompt exists so generateResponse()
    // knows to skip its own Settings fetch — this route already has the data.
    const customPrompt = buildCustomPrompt(
      ownerSettings?.systemPrompt ?? null,
      ownerSettings?.tone ?? null,
      ownerSettings?.responseLength ?? null,
    );

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      apiKey,
      showSources: false,
      cloneName,
      customPrompt,
      // Mark sessions created via the public clone link so the owner can
      // distinguish them from their own private-chat sessions.
      isPublicSession: true,
    });

    return NextResponse.json({
      message: result.message,
      sessionId: result.sessionId,
    });
  } catch (error: any) {
    console.error('Public chat error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate response' },
      { status: 500 }
    );
  }
}
