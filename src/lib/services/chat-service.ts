import { prisma } from '@/lib/prisma';
import { MessageRole } from '@/generated/prisma';

/**
 * Create a new chat session.
 */
export async function createSession(title?: string, ownerId = 1) {
  return prisma.chatSession.create({
    data: {
      title: title || 'New Conversation',
      ownerId,
    },
  });
}

/**
 * List all chat sessions for an owner, ordered by most recently updated.
 */
export async function listSessions(ownerId = 1) {
  return prisma.chatSession.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Get a single chat session with its messages.
 */
export async function getSession(sessionId: number) {
  return prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

/**
 * Delete a chat session and all associated messages.
 */
export async function deleteSession(sessionId: number) {
  return prisma.chatSession.delete({
    where: { id: sessionId },
  });
}

/**
 * Rename a chat session.
 */
export async function renameSession(sessionId: number, title: string) {
  return prisma.chatSession.update({
    where: { id: sessionId },
    data: { title },
  });
}

/**
 * Save a message to a chat session and update the session's updatedAt timestamp.
 */
export async function saveMessage(
  sessionId: number,
  content: string,
  role: 'USER' | 'ASSISTANT' | 'SYSTEM',
  sources?: any
) {
  const message = await prisma.message.create({
    data: {
      sessionId,
      content,
      role: MessageRole[role],
      sources: sources ?? undefined,
    },
  });

  // Touch the session's updatedAt
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

  return message;
}

/**
 * Get the most recent messages for a chat session, returned in chronological order.
 */
export async function getMessages(sessionId: number, limit = 50) {
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return messages.reverse();
}
