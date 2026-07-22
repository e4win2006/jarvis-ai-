import { SettingsDb, HistoryDb } from '../memory/db';
import { ToolRegistry } from '../tools/registry';
import { DesktopHelper } from '../automation/desktop';
import { SearchHelper, type SearchResult } from '../tools/search';
import { getSystemPrompt, handleIntent } from './jarvisPersona';
import { Scheduler } from '../calendar/scheduler';
import { LongTermMemory } from '../memory/vectorDb';

const DEFAULT_LMSTUDIO_URL = 'http://192.168.56.1:1234';

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function wantsToolUse(prompt: string): boolean {
  return /\b(search|look up|weather|news|stock|open|launch|browser|click|type|fill|screenshot|file|read|analy[sz]e|remind|alarm|timer|email|remember|recall|play|song|music)\b/i.test(prompt);
}

// Filter out <think> reasoning logs from output
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function tryExtractTextToolCall(message: any): any[] | null {
  if (!message || !message.content) return null;
  const content = message.content.trim();

  // 1. Check for JSON block in markdown
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.name && parsed.arguments) {
        return [{
          id: 'call_' + Math.random().toString(36).substring(2, 9),
          type: 'function',
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments)
          }
        }];
      }
      if (Array.isArray(parsed) && parsed[0]?.name) {
        return parsed.map((p: any) => ({
          id: 'call_' + Math.random().toString(36).substring(2, 9),
          type: 'function',
          function: {
            name: p.name,
            arguments: typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments)
          }
        }));
      }
    } catch (e) {}
  }

  // 2. Check for loose raw JSON object
  if (content.startsWith('{') && content.endsWith('}')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.name && parsed.arguments) {
        return [{
          id: 'call_' + Math.random().toString(36).substring(2, 9),
          type: 'function',
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments)
          }
        }];
      }
    } catch (e) {}
  }

  // 3. Check for pattern: [TOOL_CALL: name(argName="value")]
  const toolPattern = /\[(?:TOOL|TOOL_CALL):\s*(\w+)\(([\s\S]*?)\)\]/i;
  const match = content.match(toolPattern);
  if (match) {
    const toolName = match[1];
    const rawArgs = match[2];
    const args: Record<string, string> = {};
    const argPairs = rawArgs.matchAll(/(\w+)\s*=\s*"([^"]*)"/g);
    for (const pair of argPairs) {
      args[pair[1]] = pair[2];
    }
    return [{
      id: 'call_' + Math.random().toString(36).substring(2, 9),
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(args)
      }
    }];
  }

  return null;
}

async function queryOllama(prompt: string, history: any[], tools: any[], systemPrompt: string): Promise<any> {
  const ollamaUrl = SettingsDb.get('ollama_url', 'http://localhost:11434');
  const ollamaModel = SettingsDb.get('ollama_model', 'llama3');
  
  const url = `${ollamaUrl}/v1/chat/completions`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: prompt }
  ];

  const payload: any = {
    model: ollamaModel,
    messages,
    temperature: 0.7,
    stream: false
  };

  if (tools.length > 0) {
    payload.tools = tools;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000)
  });

  if (!response.ok) {
    throw new Error(`Ollama Chat Error: HTTP ${response.status}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message;
}

async function queryLMStudio(prompt: string, history: any[], tools: any[], systemPrompt: string): Promise<any> {
  const lmstudioUrl = normalizeBaseUrl(SettingsDb.get('lmstudio_url', DEFAULT_LMSTUDIO_URL));
  const useTools = wantsToolUse(prompt) && tools.length > 0;

  const nativeTools = useTools
    ? tools.filter(t => !t.function.name.includes('__')).slice(0, 12)
    : [];

  const toolsInfo = nativeTools.map(t =>
    `- ${t.function.name}: ${t.function.description} (params: ${Object.keys(t.function.parameters?.properties || {}).join(', ')})`
  ).join('\n');

  const toolPrompt = nativeTools.length > 0 ? `
Available tools:
${toolsInfo}

Call a tool by replying ONLY with:
\`\`\`json
{"name": "tool_name", "arguments": {"key": "value"}}
\`\`\`
No other text when calling a tool.` : '';

  const fullSystemPrompt = `${systemPrompt}\n${toolPrompt}`;
  const chatUrl = `${lmstudioUrl}/v1/chat/completions`;

  const messages = [
    { role: 'system', content: fullSystemPrompt },
    ...history,
    { role: 'user', content: prompt }
  ];

  const payload: any = {
    model: 'qwen/qwen3-8b',
    messages,
    temperature: 0.7,
    max_tokens: 512,
    stream: false
  };

  if (useTools && nativeTools.length > 0) {
    payload.tools = nativeTools;
    payload.tool_choice = 'auto';
  }

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000)
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`LM Studio Chat Error: HTTP ${response.status} - ${errBody}`);
  }

  const data = await response.json() as any;
  const message = data.choices?.[0]?.message;

  if (!message) return null;
  return message;
}

async function queryCustomOpenAI(prompt: string, history: any[], tools: any[], systemPrompt: string): Promise<any> {
  const baseUrl = normalizeBaseUrl(SettingsDb.get('custom_api_url', 'http://192.168.56.1:1234/v1'));
  const apiKey = SettingsDb.get('custom_api_key', '');
  const modelName = SettingsDb.get('custom_api_model', 'qwen/qwen3-8b');

  const useTools = wantsToolUse(prompt) && tools.length > 0;
  const nativeTools = useTools
    ? tools.filter(t => !t.function.name.includes('__')).slice(0, 12)
    : [];

  const toolsInfo = nativeTools.map(t =>
    `- ${t.function.name}: ${t.function.description} (params: ${Object.keys(t.function.parameters?.properties || {}).join(', ')})`
  ).join('\n');

  const toolPrompt = nativeTools.length > 0 ? `
Available tools:
${toolsInfo}

Call a tool by replying ONLY with:
\`\`\`json
{"name": "tool_name", "arguments": {"key": "value"}}
\`\`\`
No other text when calling a tool.` : '';

  const fullSystemPrompt = `${systemPrompt}\n${toolPrompt}`;
  const chatUrl = `${baseUrl}/chat/completions`;

  const messages = [
    { role: 'system', content: fullSystemPrompt },
    ...history,
    { role: 'user', content: prompt }
  ];

  const payload: any = {
    model: modelName,
    messages,
    temperature: 0.7,
    max_tokens: 512,
    stream: false
  };

  if (useTools && nativeTools.length > 0) {
    payload.tools = nativeTools;
    payload.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000)
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Custom OpenAI Chat Error: HTTP ${response.status} - ${errBody}`);
  }

  const data = await response.json() as any;
  const message = data.choices?.[0]?.message;
  return message;
}

async function answerFromSearchResults(prompt: string, query: string, results: SearchResult[], isNews: boolean = false): Promise<string> {
  if (results.length === 0) {
    return `I searched for "${query}", but no web results came back.`;
  }

  const lmstudioUrl = normalizeBaseUrl(SettingsDb.get('lmstudio_url', DEFAULT_LMSTUDIO_URL));
  const chatUrl = `${lmstudioUrl}/v1/chat/completions`;
  const sources = results.map((result, index) => ({
    index: index + 1,
    title: result.title,
    link: result.link,
    snippet: result.snippet
  }));

  const systemInstruction = isNews
    ? `/no_think\nYou are JARVIS. Summarize these current news search results in a few polite, concise, and informative sentences. Summarize the facts naturally in a unified paragraph instead of listing news websites, links, or sources.`
    : `/no_think\nAnswer the user using only these web search results. Be concise. Include source numbers like [1], [2] when useful. If results are insufficient, say so.`;

  const payload = {
    model: 'qwen/qwen3-8b',
    messages: [
      {
        role: 'system',
        content: systemInstruction
      },
      {
        role: 'user',
        content: JSON.stringify({ question: prompt, searchQuery: query, results: sources })
      }
    ],
    temperature: 0.3,
    max_tokens: 350,
    stream: false
  };

  try {
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90000)
    });

    if (response.ok) {
      const data = await response.json() as any;
      const content = stripThinking(data.choices?.[0]?.message?.content || '').trim();
      if (content) return content;
    }
  } catch {}

  const topResults = results.slice(0, 3).map((result, index) =>
    `[${index + 1}] ${result.title}: ${result.snippet || result.link}`
  ).join('\n');
  return `I found these results for "${query}":\n${topResults}`;
}

async function queryGemini(prompt: string, history: any[], tools: any[], systemPrompt: string): Promise<any> {
  const apiKey = SettingsDb.get('gemini_key', '');
  if (!apiKey) {
    throw new Error('Gemini API Key missing.');
  }

  // Use Gemini 2.5 Flash as standard tool calling engine
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const systemInstruction = systemPrompt;

  // Map system/history to Gemini contents payload supporting tool loops
  const contents: any[] = [];
  for (const h of history) {
    if (h.tool_calls && h.tool_calls.length > 0) {
      contents.push({
        role: 'model',
        parts: h.tool_calls.map((tc: any) => ({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments)
          }
        }))
      });
    } else if (h.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: h.name,
            response: {
              output: h.content
            }
          }
        }]
      });
    } else {
      contents.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      });
    }
  }
  contents.push({
    role: 'user',
    parts: [{ text: prompt }]
  });

  const geminiTools = tools.map(t => ({
    functionDeclarations: [
      {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }
    ]
  }));

  const payload: any = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 250
    }
  };

  if (geminiTools.length > 0) {
    payload.tools = geminiTools;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000)
  });

  if (!response.ok) {
    throw new Error(`Gemini API Error: HTTP ${response.status}`);
  }

  const data = await response.json() as any;
  const candidate = data.candidates?.[0];
  const functionCalls = candidate?.content?.parts?.filter((p: any) => p.functionCall);
  
  if (functionCalls && functionCalls.length > 0) {
    return {
      role: 'assistant',
      tool_calls: functionCalls.map((fc: any, index: number) => ({
        id: `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: fc.functionCall.name,
          arguments: JSON.stringify(fc.functionCall.args)
        }
      }))
    };
  }

  return {
    role: 'assistant',
    content: candidate?.content?.parts?.[0]?.text || ''
  };
}

async function queryGroq(prompt: string, history: any[], tools: any[], systemPrompt: string): Promise<any> {
  const apiKey = SettingsDb.get('groq_key', process.env.GROQ_API_KEY || '');
  const modelName = SettingsDb.get('groq_model', process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');

  if (!apiKey) {
    throw new Error('Groq API key missing. Set GROQ_API_KEY on the server or save groq_key in settings.');
  }

  const useTools = wantsToolUse(prompt) && tools.length > 0;
  const nativeTools = useTools
    ? tools.filter(t => !t.function.name.includes('__')).slice(0, 12)
    : [];

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: prompt }
  ];

  const payload: any = {
    model: modelName,
    messages,
    temperature: 0.7,
    max_tokens: 700,
    stream: false
  };

  if (nativeTools.length > 0) {
    payload.tools = nativeTools;
    payload.tool_choice = 'auto';
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000)
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Groq Chat Error: HTTP ${response.status} - ${errBody}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message;
}

export const Orchestrator = {
  // Main chat route coordinating history, vector recall, tools, and execution loops
  async processCommand(
    prompt: string,
    addLog: (type: string, text: string) => void,
    sessionId: string = 'default',
    role: string = 'OWNER',
    senderName: string = 'Owner'
  ): Promise<{ response: string; logs: string[]; mediaAction?: any }> {
    const backend = SettingsDb.get('ai_backend', 'OFFLINE');
    const localLogs: string[] = [];
    const pushLog = (type: string, text: string) => {
      localLogs.push(`[${type.toUpperCase()}] ${text}`);
      addLog(type, text);
    };

    let mediaAction: any = undefined;

    // Save user message to history
    HistoryDb.add('user', prompt, sessionId);

    // 1. Direct Intent Routing & Personality checks
    const directReply = await handleIntent(prompt, role, senderName);
    if (directReply !== null) {
      HistoryDb.add('assistant', directReply, sessionId);
      return { response: directReply, logs: localLogs };
    }

    if (backend === 'OFFLINE') {
      pushLog('neural', 'Offline engine selected. Executing fallback...');
      const fallbackMsg = "Jarvis system is fully operational. How may I assist you, sir?";
      HistoryDb.add('assistant', fallbackMsg, sessionId);
      return { response: fallbackMsg, logs: localLogs };
    }

    try {
      const historyLimit = backend === 'LMSTUDIO' && !wantsToolUse(prompt) ? 4 : 10;
      const history: any[] = HistoryDb.getRecent(historyLimit, sessionId);
      const tools = ToolRegistry.getDeclarations(role);

      // Memory and Active Schedules lookup
      let memoryStr = '';
      try {
        const memories = await LongTermMemory.query(prompt, 3);
        memoryStr = memories.map(m => `- ${m.text}`).join('\n');
      } catch (err) {
        pushLog('warning', `Failed to query long term memory: ${err}`);
      }

      let scheduleStr = '';
      try {
        const activeSchedules = Scheduler.getAll();
        scheduleStr = activeSchedules.map(s => `- ID ${s.id}: ${s.type} "${s.label}" scheduled for ${s.target_time}`).join('\n');
      } catch (err) {
        pushLog('warning', `Failed to query schedules database: ${err}`);
      }

      const contextPrompt = `
[Context Memory]
${memoryStr ? `Memories of past conversations:\n${memoryStr}` : 'No specific past memories match the current prompt.'}

Current active schedules in database:
${scheduleStr || 'No active schedules.'}
`;

      const systemPrompt = `${getSystemPrompt(senderName, role)}\n${contextPrompt}`;

      pushLog('neural', `Dispatching query to ${backend} engine...`);

      let responseMessage: any = null;
      let executionLoopLimit = 3;
      const toolCallCounts = new Map<string, number>();

      const executeQuery = async (activeBackend: string): Promise<any> => {
        if (activeBackend === 'OLLAMA') {
          return await queryOllama(prompt, history, tools, systemPrompt);
        } else if (activeBackend === 'LMSTUDIO') {
          return await queryLMStudio(prompt, history, tools, systemPrompt);
        } else if (activeBackend === 'GEMINI') {
          return await queryGemini(prompt, history, tools, systemPrompt);
        } else if (activeBackend === 'GROQ') {
          return await queryGroq(prompt, history, tools, systemPrompt);
        } else if (activeBackend === 'CUSTOM') {
          return await queryCustomOpenAI(prompt, history, tools, systemPrompt);
        } else {
          throw new Error(`Unsupported backend option: ${activeBackend}`);
        }
      };

      while (executionLoopLimit > 0) {
        try {
          responseMessage = await executeQuery(backend);
        } catch (err: any) {
          pushLog('warning', `Primary backend (${backend}) failed: ${err.message || err}. Attempting auto-connection to local AI...`);
          
          try {
            pushLog('neural', `Fallback: Attempting to connect to local LM Studio...`);
            responseMessage = await queryLMStudio(prompt, history, tools, systemPrompt);
            pushLog('system', `Auto-connected to local LM Studio successfully.`);
          } catch (lmErr: any) {
            pushLog('warning', `Local LM Studio connection failed: ${lmErr.message || lmErr}. Trying local Ollama...`);
            
            try {
              pushLog('neural', `Fallback: Attempting to connect to local Ollama...`);
              responseMessage = await queryOllama(prompt, history, tools, systemPrompt);
              pushLog('system', `Auto-connected to local Ollama successfully.`);
            } catch (ollamaErr: any) {
              pushLog('warning', `Local Ollama connection failed: ${ollamaErr.message || ollamaErr}. Trying web search fallback...`);
              
              try {
                pushLog('action', `Fallback: Searching the internet for prompt context...`);
                const searchResults = await SearchHelper.search(prompt);
                if (searchResults.length > 0) {
                  const answer = await answerFromSearchResults(prompt, prompt, searchResults, false);
                  responseMessage = { role: 'assistant', content: answer };
                  pushLog('system', `Answered using web search results fallback.`);
                } else {
                  throw new Error("No search results returned");
                }
              } catch (searchErr: any) {
                pushLog('error', `Web search fallback failed: ${searchErr.message || searchErr}`);
                throw new Error("All backends and fallbacks exhausted.");
              }
            }
          }
        }

        // Check for text-based tool extraction fallback if native tool calls are absent
        if (responseMessage && (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0)) {
          const extractedCalls = tryExtractTextToolCall(responseMessage);
          if (extractedCalls) {
            responseMessage.tool_calls = extractedCalls;
            responseMessage.content = '';
          }
        }

        // Handle function calling
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          pushLog('action', `Model requested ${responseMessage.tool_calls.length} tool invocation(s).`);
          
          for (const call of responseMessage.tool_calls) {
            const toolName = call.function.name;
            let args: any = {};
            try {
              args = JSON.parse(call.function.arguments);
            } catch (err) {
              args = call.function.arguments;
            }

            const callSignature = `${toolName}:${JSON.stringify(args)}`;
            const callCount = (toolCallCounts.get(callSignature) || 0) + 1;
            toolCallCounts.set(callSignature, callCount);
            if (callCount > 1) {
              pushLog('error', `Repeated tool call blocked: ${callSignature}`);
              responseMessage = {
                role: 'assistant',
                content: 'I stopped the repeated tool loop, sir. The command may need a direct local handler.'
              };
              executionLoopLimit = 0;
              break;
            }

            pushLog('action', `Executing local tool: ${toolName}(${JSON.stringify(args)})`);
            const result = await ToolRegistry.executeTool(toolName, args, role);
            pushLog('system', `Tool response: ${result.slice(0, 300)}...`);

            // Check if this tool returned a media action payload to route to frontend
            if (toolName === 'play_song') {
              try {
                const parsedResult = JSON.parse(result);
                if (parsedResult.success && parsedResult.videoId) {
                  mediaAction = {
                    type: 'play',
                    videoId: parsedResult.videoId,
                    title: parsedResult.title || args.query,
                    artist: 'YouTube Music'
                  };
                }
              } catch {}
            } else if (toolName === 'desktop_control') {
              try {
                const parsedResult = JSON.parse(result);
                if (parsedResult.success && parsedResult.mediaControl) {
                  mediaAction = {
                    type: 'control',
                    command: parsedResult.mediaControl
                  };
                }
              } catch {}
            }

            // Append response to history to guide next steps
            history.push({
              role: 'assistant',
              content: '',
              tool_calls: [call]
            });
            history.push({
              role: 'tool',
              tool_call_id: call.id,
              name: toolName,
              content: result
            });
          }
          
          executionLoopLimit--;
        } else {
          // No more tool calls, return final message
          break;
        }
      }

      let rawContent = responseMessage?.content || '';

      if (!rawContent) {
        rawContent = "Command acknowledged. Awaiting your next directive, sir.";
      }

      const cleanReply = stripThinking(rawContent);

      // Save assistant response to history
      HistoryDb.add('assistant', cleanReply, sessionId);

      return { response: cleanReply, logs: localLogs, mediaAction };
    } catch (e: any) {
      pushLog('error', `Cognitive dispatch failed: ${e.message}`);
      const fallback = "My neural connections timed out. Jarvis offline core is operating as fallback.";
      HistoryDb.add('assistant', fallback, sessionId);
      return { response: fallback, logs: localLogs };
    }
  }
};
