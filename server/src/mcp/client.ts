import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { SettingsDb } from '../memory/db';
import path from 'path';
import fs from 'fs';
import { getConfigPath } from '../utils/appPaths';

export interface MCPConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  startupPolicy?: 'enabled' | 'disabled' | 'manual';
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  serverName: string;
}

class MCPClientConnection {
  private process: ChildProcessWithoutNullStreams | null = null;
  private requestId = 1;
  private pendingRequests: Record<number, { resolve: (res: any) => void; reject: (err: any) => void }> = {};
  private stdoutBuffer = '';
  public tools: MCPTool[] = [];
  public name: string;

  constructor(private config: MCPConfig) {
    this.name = config.name;
  }

  public isConnected(): boolean {
    return this.process !== null;
  }

  public async connect(): Promise<boolean> {
    try {
      const escapedArgs = this.config.args.map(arg => {
        if (arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
          return `"${arg}"`;
        }
        return arg;
      });

      this.process = spawn(this.config.command, escapedArgs, {
        shell: true,
        env: { ...process.env, ...(this.config.env || {}) }
      });

      this.process.stdout.on('data', (data) => {
        this.stdoutBuffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr.on('data', (data) => {
        console.warn(`[MCP Server ${this.name} stderr]:`, data.toString().trim());
      });

      this.process.on('close', (code) => {
        console.log(`[MCP Server ${this.name}] closed with code ${code}`);
        this.process = null;
      });

      // 1. Initialize with timeout
      await Promise.race([
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'JarvisClient', version: '1.0' }
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('initialize timeout (5s)')), 5000))
      ]);

      // Send initialized notification
      this.sendNotification('notifications/initialized', {});

      // 2. Fetch Tools with timeout
      const toolsResponse = (await Promise.race([
        this.sendRequest('tools/list', {}),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('tools/list timeout (5s)')), 5000))
      ])) as any;
      const rawTools = toolsResponse?.tools || [];
      
      this.tools = rawTools.map((t: any) => ({
        name: `${this.name}__${t.name}`, // prefix tool name to avoid collisions
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        serverName: this.name
      }));

      console.log(`[MCP Server ${this.name}] Linked successfully. Registered ${this.tools.length} tools.`);
      return true;
    } catch (e) {
      console.error(`[MCP Server ${this.name}] Connection failed:`, e);
      this.disconnect();
      return false;
    }
  }

  public async callTool(originalToolName: string, args: any): Promise<string> {
    if (!this.process) return `MCP Server ${this.name} is offline.`;
    try {
      const response = await this.sendRequest('tools/call', {
        name: originalToolName,
        arguments: args
      });
      
      const contents = response?.content || [];
      const texts = contents
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
        
      return texts.join('\n') || JSON.stringify(response);
    } catch (e: any) {
      return `MCP call error: ${e.message || e}`;
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process) return reject('Process not running');
      const id = this.requestId++;
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.pendingRequests[id] = { resolve, reject };
      this.process.stdin.write(payload);
    });
  }

  private sendNotification(method: string, params: any): void {
    if (!this.process) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(payload);
  }

  private processBuffer(): void {
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || ''; // Keep remainder

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line.trim());
        if (msg.id !== undefined && this.pendingRequests[msg.id]) {
          const { resolve, reject } = this.pendingRequests[msg.id];
          delete this.pendingRequests[msg.id];
          if (msg.error) {
            reject(msg.error);
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {
        // Log errors but continue parsing buffer stream
        console.error('Error parsing line:', line, e);
      }
    }
  }

  public disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// Global Manager holding all connections
export const MCPManager = {
  loadedConfigs: [] as MCPConfig[],
  connections: [] as MCPClientConnection[],

  getConnectionStatus(name: string): boolean {
    const conn = this.connections.find(c => c.name === name);
    return conn ? conn.isConnected() : false;
  },

  async startServer(name: string): Promise<boolean> {
    const existing = this.connections.find(c => c.name === name);
    if (existing && existing.isConnected()) return true;

    const conf = this.loadedConfigs.find(c => c.name === name);
    if (!conf) return false;

    console.log(`[MCP] Manually starting server: ${name}`);
    const conn = new MCPClientConnection(conf);
    const ok = await conn.connect();
    if (ok) {
      this.connections.push(conn);
      return true;
    }
    return false;
  },

  async loadAndConnectAll(): Promise<void> {
    this.disconnectAll();
    this.loadedConfigs = [];

    if (process.env.SAFE_MODE === 'true') {
      console.warn('[MCP] Safe Mode active. Skipping all MCP startup servers.');
      return;
    }

    const defaultMcpPath = path.join(__dirname, '../../../mcp.json');
    const mcpConfigPath = path.join(getConfigPath(), 'mcp.json');

    // Copy default template on first boot if missing
    if (!fs.existsSync(mcpConfigPath) && fs.existsSync(defaultMcpPath)) {
      try {
        fs.copyFileSync(defaultMcpPath, mcpConfigPath);
        console.log(`[MCP] Copied default mcp.json config template to ${mcpConfigPath}`);
      } catch (err) {
        console.error('[MCP] Failed copying default mcp.json:', err);
      }
    }

    let configs: MCPConfig[] = [];
    if (fs.existsSync(mcpConfigPath)) {
      try {
        const raw = fs.readFileSync(mcpConfigPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          for (const [name, cfg] of Object.entries<any>(parsed.mcpServers)) {
            const resolvedArgs = (cfg.args || []).map((arg: string) => {
              return arg.replace(/%(\w+)%/g, (_: string, key: string) => process.env[key] || _);
            });
            configs.push({
              name,
              command: cfg.command,
              args: resolvedArgs,
              env: cfg.env,
              startupPolicy: cfg.startupPolicy || 'enabled'
            });
          }
        } else if (Array.isArray(parsed)) {
          configs = parsed.map(c => ({ ...c, startupPolicy: c.startupPolicy || 'enabled' }));
        }
        console.log(`[MCP] Parsed ${configs.length} server configuration(s) from mcp.json`);
      } catch (e) {
        console.error('[MCP] Failed parsing mcp.json:', e);
      }
    }

    // Fallback: Load config from SQLite settings DB
    if (configs.length === 0) {
      const mcpConfigStr = SettingsDb.get('mcp_servers_json', '[]');
      try {
        configs = JSON.parse(mcpConfigStr).map((c: any) => ({ ...c, startupPolicy: c.startupPolicy || 'enabled' }));
      } catch (e) {
        console.error('Failed parsing MCP server configurations from DB:', e);
      }
    }

    // Default sample filesystem server if nothing configured
    if (configs.length === 0) {
      const username = process.env.USERNAME || process.env.USER || 'EDWIN TOM JOSEPH';
      configs = [
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', `C:\\Users\\${username}`],
          startupPolicy: 'enabled'
        }
      ];
    }

    this.loadedConfigs = configs;

    // Connect auto-started servers
    for (const conf of configs) {
      if (conf.startupPolicy === 'disabled' || conf.startupPolicy === 'manual') {
        console.log(`[MCP] Skipping connection of server ${conf.name} (Policy: ${conf.startupPolicy})`);
        continue;
      }

      const conn = new MCPClientConnection(conf);
      const ok = await conn.connect();
      if (ok) {
        this.connections.push(conn);
      }
    }
  },

  getAllTools(): MCPTool[] {
    return this.connections.flatMap(c => c.tools);
  },

  async callMCPTool(prefixedName: string, args: any): Promise<string> {
    const [serverName, ...toolParts] = prefixedName.split('__');
    const toolName = toolParts.join('__');
    const conn = this.connections.find(c => c.name === serverName);
    if (!conn) {
      return `No active MCP connection found for server: ${serverName}`;
    }
    return conn.callTool(toolName, args);
  },

  disconnectAll(): void {
    for (const c of this.connections) {
      c.disconnect();
    }
    this.connections = [];
  }
};
