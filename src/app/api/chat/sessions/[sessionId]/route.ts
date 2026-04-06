import { NextRequest, NextResponse } from 'next/server';
import { getSession, deleteSession, renameSession } from '@/lib/services/chat-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const id = parseInt(sessionId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error: any) {
    console.error('Error fetching session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch session' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const id = parseInt(sessionId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    await deleteSession(id);

    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('Error deleting session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete session' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const id = parseInt(sessionId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const session = await renameSession(id, title.trim());
    return NextResponse.json(session);
  } catch (error: any) {
    console.error('Error renaming session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to rename session' },
      { status: 500 }
    );
  }
}
