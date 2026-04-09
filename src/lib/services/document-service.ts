import { prisma } from '@/lib/prisma';
import { getOpenAIClient } from '@/lib/openai';
import { DocumentStatus } from '@/generated/prisma';
import pdfParse from 'pdf-parse';

/**
 * Extract text content from a PDF buffer.
 */
export async function extractTextFromPdf(
  buffer: Buffer
): Promise<{ text: string; pages: number }> {
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    pages: data.numpages,
  };
}

/**
 * Split text into overlapping chunks with approximate page tracking.
 * Assumes ~3000 characters per page for page number estimation.
 */
export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200
): { content: string; pageNumber: number }[] {
  const chunks: { content: string; pageNumber: number }[] = [];
  const charsPerPage = 3000;

  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const content = text.slice(start, end);

    // Estimate the page number based on character position
    const midpoint = start + content.length / 2;
    const pageNumber = Math.floor(midpoint / charsPerPage) + 1;

    chunks.push({ content, pageNumber });
    chunkIndex++;

    // Move start forward by (chunkSize - overlap), ensuring progress
    const step = chunkSize - overlap;
    start += step > 0 ? step : chunkSize;
  }

  return chunks;
}

/**
 * Generate embeddings for an array of texts using OpenAI text-embedding-3-small.
 * Processes in batches of 20.
 */
export async function generateEmbeddings(
  apiKey: string,
  texts: string[]
): Promise<number[][]> {
  const openai = getOpenAIClient(apiKey);
  const batchSize = 20;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });

    const batchEmbeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}

/**
 * Search for similar document chunks using pgvector cosine distance.
 */
export async function searchSimilarChunks(
  queryEmbedding: number[],
  topK = 5,
  ownerId = 1
): Promise<
  {
    id: number;
    document_id: number;
    chunk_index: number;
    page_number: number;
    content: string;
    original_filename: string;
  }[]
> {
  const vectorString = `[${queryEmbedding.join(',')}]`;

  const results = await prisma.$queryRawUnsafe(
    `SELECT dc.id, dc.document_id, dc.chunk_index, dc.page_number, dc.content, d.original_filename
     FROM document_chunks dc
     JOIN documents d ON dc.document_id = d.id
     WHERE d.owner_id = $1 AND d.status = $2
     ORDER BY dc.embedding <=> $3::vector
     LIMIT $4`,
    ownerId,
    'completed',
    vectorString,
    topK
  );

  return results as any[];
}

/**
 * Full document ingestion pipeline:
 * 1. Update status to PROCESSING
 * 2. Extract text from PDF
 * 3. Chunk text into overlapping segments
 * 4. Generate embeddings for each chunk
 * 5. Insert chunks with embeddings into the database
 * 6. Update document status to COMPLETED
 *
 * On failure, sets status to FAILED with error message.
 */
export async function ingestDocument(
  documentId: number,
  buffer: Buffer,
  apiKey: string
): Promise<void> {
  try {
    // Mark document as processing
    await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.PROCESSING },
    });

    // Extract text from PDF
    const { text, pages } = await extractTextFromPdf(buffer);

    // Split into chunks
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      throw new Error('No text content could be extracted from the document.');
    }

    // Generate embeddings for all chunks
    const chunkTexts = chunks.map((c) => c.content);
    const embeddings = await generateEmbeddings(apiKey, chunkTexts);

    // Insert each chunk with its embedding via raw SQL
    for (let i = 0; i < chunks.length; i++) {
      const vectorString = `[${embeddings[i].join(',')}]`;

      await prisma.$executeRawUnsafe(
        'INSERT INTO document_chunks (document_id, chunk_index, page_number, content, embedding, created_at) VALUES ($1, $2, $3, $4, $5::vector, NOW())',
        documentId,
        i,
        chunks[i].pageNumber,
        chunks[i].content,
        vectorString
      );
    }

    // Update document status to completed
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.COMPLETED,
        pageCount: pages,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error during ingestion';

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.FAILED,
        errorMessage,
      },
    });

    throw error;
  }
}

/**
 * Re-ingest a document from stored file data.
 * Deletes existing chunks, then runs the full ingestion pipeline again.
 */
export async function reingestDocument(
  documentId: number,
  originalFilename: string,
  buffer: Buffer,
  apiKey: string
): Promise<void> {
  // Delete existing chunks before re-processing
  await prisma.documentChunk.deleteMany({ where: { documentId } });
  // Run the standard ingestion pipeline
  await ingestDocument(documentId, buffer, apiKey);
}
