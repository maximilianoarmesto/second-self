import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-openai-api-key');
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key is required' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey });
    await openai.models.list();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('OpenAI connection test failed:', error);

    // Provide a user-friendly error message
    if (error?.status === 401) {
      return NextResponse.json(
        { error: 'Invalid API key. Please check your OpenAI API key and try again.' },
        { status: 401 }
      );
    }

    if (error?.status === 429) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to connect to OpenAI' },
      { status: 500 }
    );
  }
}
