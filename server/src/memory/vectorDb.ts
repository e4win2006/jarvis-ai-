import { VectorDb } from './db';
import { SettingsDb } from './db';

const DEFAULT_LMSTUDIO_URL = 'http://localhost:1234';

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// Cosine similarity computation
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Generate Embeddings via configured active backend
async function generateEmbedding(text: string): Promise<number[]> {
  const backend = SettingsDb.get('ai_backend', 'OFFLINE');
  
  if (backend === 'GEMINI') {
    const key = SettingsDb.get('gemini_key', '');
    if (key) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "models/text-embedding-004",
            content: { parts: [{ text }] }
          })
        });
        if (response.ok) {
          const data = await response.json() as any;
          return data.embedding?.values || [];
        }
      } catch (e) {
        console.error("Gemini embedding error:", e);
      }
    }
  } else if (backend === 'OLLAMA') {
    const ollamaUrl = SettingsDb.get('ollama_url', 'http://localhost:11434');
    try {
      const response = await fetch(`${ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: SettingsDb.get('ollama_model', 'llama3'),
          prompt: text
        })
      });
      if (response.ok) {
        const data = await response.json() as any;
        return data.embedding || [];
      }
    } catch (e) {
      console.error("Ollama embedding error:", e);
    }
  } else if (backend === 'LMSTUDIO') {
    const lmstudioUrl = normalizeBaseUrl(SettingsDb.get('lmstudio_url', DEFAULT_LMSTUDIO_URL));
    try {
      const response = await fetch(`${lmstudioUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "text-embedding-nomic-embed-text-v1.5",
          input: [text]
        })
      });
      if (response.ok) {
        const data = await response.json() as any;
        return data.data?.[0]?.embedding || [];
      }
    } catch (e) {
      console.error("LM Studio embedding error:", e);
    }
  }
  
  // Return empty vector (keyword overlapping fallback handles matching score)
  return [];
}

export const LongTermMemory = {
  async remember(text: string, metadata: Record<string, any> = {}): Promise<void> {
    const embedding = await generateEmbedding(text);
    VectorDb.insert(text, metadata, embedding);
  },

  async query(queryText: string, limit: number = 3): Promise<Array<{ text: string; score: number; metadata: Record<string, any> }>> {
    const queryVector = await generateEmbedding(queryText);
    const allItems = VectorDb.getAll();

    const scored = allItems.map(item => {
      let score = cosineSimilarity(queryVector, item.embedding);
      
      // Word overlap boost fallback
      const queryWords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const itemWords = item.text.toLowerCase().split(/\s+/);
      const common = queryWords.filter(w => itemWords.includes(w)).length;
      if (queryWords.length > 0 && common > 0) {
        score += (common / queryWords.length) * 0.6;
      }

      return {
        text: item.text,
        score,
        metadata: item.metadata
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
};
