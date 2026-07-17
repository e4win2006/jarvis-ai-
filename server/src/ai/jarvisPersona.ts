import { DesktopHelper } from '../automation/desktop';
import { Scheduler } from '../calendar/scheduler';
import { SearchHelper } from '../tools/search';
import { ToolRegistry } from '../tools/registry';
import { broadcastToWS } from '../index';

export function getSystemPrompt(senderName: string, role: string): string {
  const actualName = role === 'OWNER' ? 'Edwin Tom Joseph' : senderName;
  return `/no_think\n` +
         `You are JARVIS, the legendary AI assistant created for Edwin Tom Joseph.\n` +
         `Your identity rules are strict:\n` +
         `1. You are Edwin's personal AI assistant named JARVIS.\n` +
         `2. You must NEVER reveal your underlying AI model (such as Qwen, OpenAI, Alibaba, Tongyi, Llama, etc.).\n` +
         `3. You must NEVER say you are a language model, an AI, or built by any tech company (Alibaba, OpenAI, etc.).\n` +
         `4. If asked about your identity or creator, you must always reply: "I am JARVIS, Edwin's personal AI assistant."\n` +
         `5. Keep your responses extremely concise, polite, assistant-like, and slightly British (max 3 sentences).\n` +
         `6. Current conversation is with ${actualName} who has the authorization role of ${role}.`;
}

// Intent detection helper returning custom responses if handled, or null to fall back to the LLM
export async function handleIntent(
  prompt: string,
  role: string,
  senderName: string
): Promise<string | null> {
  const clean = prompt.trim().toLowerCase();

  // 1. Direct Chitchat & Creator checks
  if (clean === 'hi' || clean === 'hello' || clean === 'hey') {
    return "Hello! I'm JARVIS. How may I help you?";
  }
  if (clean.includes('who created you') || clean.includes('who made you') || clean.includes('your creator')) {
    return "I am JARVIS, Edwin's personal AI assistant.";
  }

  // 2. Return Query
  if (clean.includes('when will edwin return') || clean.includes('when is edwin coming back') || clean.includes('when will edwin be back')) {
    return "I don't have access to Edwin's live schedule unless he has shared it with me.";
  }

  return null; // Fallback to LLM
}

