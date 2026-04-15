import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';
import type { SlackIntegrationData } from '@/types/settings';

/**
 * GET /api/slack/integration
 *
 * Returns the current Slack connection status for the authenticated user.
 * The raw access token is never sent to the client — only the boolean
 * `connected` flag and the human-readable `workspaceName` are exposed.
 */
export const GET = requireAuth(async (_request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    const settings = await prisma.settings.findUnique({
      where: { ownerId: userId },
      select: { slackAccessToken: true, slackWorkspaceName: true },
    });

    const connected = Boolean(settings?.slackAccessToken);
    const workspaceName = settings?.slackWorkspaceName ?? null;

    return NextResponse.json<SlackIntegrationData>({ connected, workspaceName });
  } catch (error: any) {
    console.error('[GET /api/slack/integration] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch Slack integration status.' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/slack/integration
 *
 * Disconnects the user's Slack integration by clearing the stored access
 * token and workspace name. Returns 204 No Content on success.
 */
export const DELETE = requireAuth(async (_request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    await prisma.settings.update({
      where: { ownerId: userId },
      data: {
        slackAccessToken: null,
        slackWorkspaceName: null,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('[DELETE /api/slack/integration] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect Slack integration.' },
      { status: 500 }
    );
  }
});
