import { NextRequest, NextResponse } from 'next/server';
import { listSessions, createSession } from '@/lib/services/chat-service';

export async function GET() {
  try {
    const sessions = await listSessions(1);
    return NextResponse.json(sessions);
  } catch (error: any) {
    console.error('Error listing sessions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list sessions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { title } = body;

    const session = await createSession(title);
    return NextResponse.json(session, { status: 201 });
  } catch (error: any) {
    console.error('Error creating session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create session' },
      { status: 500 }
    );
  }
}
