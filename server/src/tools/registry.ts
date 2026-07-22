import { SearchHelper } from './search';
import { runBrowserAutomation } from '../automation/browser';
import { DesktopHelper } from '../automation/desktop';
import { parseLocalFile } from './files';
import { Scheduler } from '../calendar/scheduler';
import { EmailSender } from '../calendar/scheduler';
import { LongTermMemory } from '../memory/vectorDb';
import { MCPManager } from '../mcp/client';
import { WhatsAppService } from '../automation/whatsapp';
import { runPythonScript } from '../utils/pythonRunner';
import { getDataPath } from '../utils/appPaths';
import path from 'path';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

// Path to python scripts
const PYTHON_DIR = path.join(__dirname, 'python_tools');

// System tool handlers mapping
const handlers: Record<string, (args: any) => Promise<any>> = {
  internet_search: async (args: { query: string; provider?: string }) => {
    try {
      const script = path.join(PYTHON_DIR, 'search.py');
      const result = await runPythonScript(script, [
        '--query', args.query,
        '--provider', args.provider || 'auto'
      ]);
      return result;
    } catch (e) {
      console.warn("Python internet_search failed, falling back to pure Node.js search:", e);
      const results = await SearchHelper.search(args.query);
      return JSON.stringify(results);
    }
  },

  web_search: async (args: { query: string }) => {
    try {
      const results = await SearchHelper.search(args.query);
      return JSON.stringify(results);
    } catch (e: any) {
      return JSON.stringify({ success: false, error: e.message || e });
    }
  },
  
  browser_automation: async (args: { url: string; action: 'extract' | 'screenshot' | 'click' | 'fill'; selector?: string; textToFill?: string }) => {
    return await runBrowserAutomation(args.url, args.action, args.selector || 'body', args.textToFill || '');
  },

  desktop_control: async (args: { action: 'launch' | 'volume' | 'clipboard_set' | 'clipboard_get' | 'keys' | 'open_pdfs' | 'media_control'; appName?: string; keys?: string; volumeAction?: 'up' | 'down' | 'mute'; text?: string; folder?: string; mediaAction?: 'play_pause' | 'stop' | 'next' | 'previous' }) => {
    const script = path.join(PYTHON_DIR, 'desktop.py');
    if (args.action === 'open_pdfs') {
      const result = await runPythonScript(script, [
        '--action', 'open_pdfs',
        '--folder', args.folder || 'desktop'
      ]);
      return result;
    } else if (args.action === 'launch' && args.appName) {
      const result = await runPythonScript(script, [
        '--action', 'launch',
        '--app_name', args.appName
      ]);
      return result;
    } else if (args.action === 'volume' && args.volumeAction) {
      const msg = await DesktopHelper.setVolume(args.volumeAction);
      return JSON.stringify({ success: true, message: msg });
    } else if (args.action === 'clipboard_set' && args.text) {
      const msg = await DesktopHelper.setClipboard(args.text);
      return JSON.stringify({ success: true, message: msg });
    } else if (args.action === 'clipboard_get') {
      const msg = await DesktopHelper.getClipboard();
      return JSON.stringify({ success: true, text: msg });
    } else if (args.action === 'keys' && args.keys) {
      const msg = await DesktopHelper.pressKeys(args.keys);
      return JSON.stringify({ success: true, message: msg });
    } else if (args.action === 'media_control' && args.mediaAction) {
      const msg = await DesktopHelper.controlMedia(args.mediaAction);
      return JSON.stringify({ success: true, message: msg, mediaControl: args.mediaAction });
    }
    return JSON.stringify({ success: false, reason: 'Invalid desktop control arguments.' });
  },

  system_notifications: async (args: { title: string; message: string }) => {
    return await DesktopHelper.showNotification(args.title, args.message);
  },

  file_analysis: async (args: { filePath: string }) => {
    return await parseLocalFile(args.filePath);
  },

  manage_scheduler: async (args: { action: 'add' | 'list' | 'dismiss'; type?: 'alarm' | 'reminder' | 'timer'; targetTime?: string; label?: string; id?: number }) => {
    const script = path.join(PYTHON_DIR, 'schedule.py');
    const dbPath = path.join(getDataPath(), 'jarvis.db');
    const cmdArgs = ['--db', dbPath, '--action', args.action];
    
    if (args.action === 'add' && args.type && args.targetTime && args.label) {
      cmdArgs.push('--type', args.type, '--target_time', args.targetTime, '--label', args.label);
    } else if (args.action === 'dismiss' && args.id !== undefined) {
      cmdArgs.push('--id', args.id.toString());
    }

    try {
      const result = await runPythonScript(script, cmdArgs);
      return result;
    } catch (e: any) {
      return JSON.stringify({ success: false, error: e.message || e });
    }
  },

  send_email: async (args: { to: string; subject: string; body: string }) => {
    return await EmailSender.sendEmail(args.to, args.subject, args.body);
  },

  remember_info: async (args: { text: string; category?: string }) => {
    await LongTermMemory.remember(args.text, { category: args.category || 'general' });
    return JSON.stringify({ success: true, message: `Saved to long-term memory: "${args.text}"` });
  },

  recall_info: async (args: { query: string }) => {
    const memories = await LongTermMemory.query(args.query);
    return JSON.stringify(memories);
  },

  get_weather: async (args: { location: string }) => {
    const script = path.join(PYTHON_DIR, 'search.py');
    const result = await runPythonScript(script, [
      '--query', args.location,
      '--provider', 'weather'
    ]);
    return result;
  },

  get_news: async (args: { topic: string }) => {
    const script = path.join(PYTHON_DIR, 'search.py');
    const result = await runPythonScript(script, [
      '--query', args.topic,
      '--provider', 'news'
    ]);
    return result;
  },

  get_stocks: async (args: { ticker: string }) => {
    const results = await SearchHelper.search(`${args.ticker} stock price history`);
    return JSON.stringify(results);
  },

  play_song: async (args: { query: string }) => {
    const cleanQuery = (args.query || 'top songs playlist').trim();
    const candidates = await SearchHelper.search(`${cleanQuery} site:music.youtube.com`);
    let videoId = '';
    // Look for v= video identifier
    const ytMusicMatch = candidates.find(c => c.link.includes('music.youtube.com/watch?v='));
    if (ytMusicMatch) {
      const vMatch = ytMusicMatch.link.match(/[?&]v=([^&#]+)/);
      if (vMatch) videoId = vMatch[1];
    }
    
    // Fallback to desktop.ts scraping
    if (!videoId) {
      const scrapeResults = await DesktopHelper.playSong(cleanQuery);
      // It opens in default browser. We return success.
      return JSON.stringify({
        success: true,
        message: scrapeResults,
        title: cleanQuery
      });
    }

    const msg = await DesktopHelper.playSong(cleanQuery, videoId);
    return JSON.stringify({
      success: true,
      message: msg,
      videoId,
      title: cleanQuery
    });
  },

  send_whatsapp_message: async (args: { to: string; message: string }) => {
    return await WhatsAppService.sendMessage(args.to, args.message);
  }
};

// System declarations
const systemDeclarations: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Perform a web search for the given query to retrieve live information, websites, and summaries from the internet.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search term or question.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'internet_search',
      description: 'Search the internet for information. Uses Wikipedia, Google/DuckDuckGo, News, YouTube, GitHub, or Weather based on request.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query string.' },
          provider: { type: 'string', enum: ['auto', 'wikipedia', 'google', 'news', 'youtube', 'github', 'weather'], description: 'Search provider target.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'play_song',
      description: 'Play music or a song. Use this ALWAYS when the user asks to play a song, music, or artist. Opens YouTube Music with a search. Do NOT use browser_automation for music.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Song name, artist, or genre to play.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_automation',
      description: 'Automate web browsing: extract text, screenshot pages, fill forms, click links. Do NOT use for playing music or songs — use play_song instead.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Web page URL.' },
          action: { type: 'string', enum: ['extract', 'screenshot', 'click', 'fill'], description: 'Browser action.' },
          selector: { type: 'string', description: 'HTML/CSS selector target.' },
          textToFill: { type: 'string', description: 'Input text value.' }
        },
        required: ['url', 'action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'desktop_control',
      description: 'Automate local Windows applications, keyboard input typing, audio volume, clipboard tasks, and opening PDFs.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['launch', 'volume', 'clipboard_set', 'clipboard_get', 'keys', 'open_pdfs', 'media_control'] },
          appName: { type: 'string', description: 'Application name e.g. notepad, calc.' },
          keys: { type: 'string', description: 'Keystroke triggers (SendKeys format).' },
          volumeAction: { type: 'string', enum: ['up', 'down', 'mute'] },
          text: { type: 'string', description: 'Copy text to clipboard.' },
          folder: { type: 'string', description: 'Folder target for opening PDFs (e.g., desktop, downloads).' },
          mediaAction: { type: 'string', enum: ['play_pause', 'stop', 'next', 'previous'], description: 'Media control action to dispatch.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'system_notifications',
      description: 'Dispatch native OS desktop toast/balloon alerts.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Alert title.' },
          message: { type: 'string', description: 'Alert message content.' }
        },
        required: ['title', 'message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_analysis',
      description: 'Parse content and extract plain text from local disk files (PDF, DOCX, XLSX, text, code).',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute file path.' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_scheduler',
      description: 'Create, list, and dismiss scheduling items (alarms, timers, and reminders).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'dismiss'] },
          type: { type: 'string', enum: ['alarm', 'reminder', 'timer'] },
          targetTime: { type: 'string', description: 'ISO date string or timestamp.' },
          label: { type: 'string', description: 'Task label.' },
          id: { type: 'integer', description: 'The schedule ID to dismiss.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Dispatch email transmissions to recipient list (runs local simulation if SMTP keys are absent).',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address.' },
          subject: { type: 'string', description: 'Email subject header.' },
          body: { type: 'string', description: 'Email body contents.' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember_info',
      description: 'Save information to vector memory index (long-term memory).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Fact or note to persist.' },
          category: { type: 'string', description: 'Optional category tags.' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recall_info',
      description: 'Search long-term vector database using semantic query checks.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Topic or question search query.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Retrieve current local weather reports.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Target city/coordinates.' }
        },
        required: ['location']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: 'Look up headlines for a given topic.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'News topic.' }
        },
        required: ['topic']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_stocks',
      description: 'Retrieve current stock valuations and price sweeps.',
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Stock symbol (e.g. AAPL, TSLA).' }
        },
        required: ['ticker']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_whatsapp_message',
      description: 'Send a WhatsApp message to a specific contact name or phone number.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Contact name (e.g. "Joseph") or phone number (e.g. "918281313928").' },
          message: { type: 'string', description: 'The text message content to send.' }
        },
        required: ['to', 'message']
      }
    }
  }
];

export const ToolRegistry = {
  // Compile all system tools + active MCP tools based on user role
  getDeclarations(role: string = 'OWNER'): ToolDefinition[] {
    let list: ToolDefinition[] = [];
    
    if (role === 'OWNER') {
      list = [...systemDeclarations];
      
      // Inject MCP Tools
      const mcpTools = MCPManager.getAllTools();
      for (const mt of mcpTools) {
        list.push({
          type: 'function',
          function: {
            name: mt.name,
            description: mt.description,
            parameters: mt.inputSchema
          }
        });
      }
    } else {
      // Non-owner roles only get safe public information tools
      const allowedNames = ['internet_search', 'web_search', 'play_song', 'manage_scheduler', 'remember_info', 'recall_info', 'get_weather', 'get_news', 'get_stocks'];
      list = systemDeclarations.filter(t => allowedNames.includes(t.function.name));
    }

    return list;
  },

  async executeTool(name: string, args: any, role: string = 'OWNER'): Promise<string> {
    try {
      // Restrict tool execution by role
      if (role !== 'OWNER') {
        const allowedNames = ['internet_search', 'web_search', 'play_song', 'manage_scheduler', 'remember_info', 'recall_info', 'get_weather', 'get_news', 'get_stocks'];
        if (!allowedNames.includes(name)) {
          return JSON.stringify({ success: false, error: `Access Denied: Tool '${name}' requires OWNER permissions, but you are authorized as ${role}.` });
        }
      }

      // 1. Check native system handlers
      if (handlers[name]) {
        return await handlers[name](args);
      }
      
      // 2. Check MCP handlers
      const mcpTools = MCPManager.getAllTools();
      const isMcp = mcpTools.find(mt => mt.name === name);
      if (isMcp) {
        return await MCPManager.callMCPTool(name, args);
      }

      return JSON.stringify({ success: false, error: `Tool ${name} is unregistered in Jarvis Registry.` });
    } catch (e: any) {
      return JSON.stringify({ success: false, error: `Execution error on tool ${name}: ${e.message || e}` });
    }
  }
};

