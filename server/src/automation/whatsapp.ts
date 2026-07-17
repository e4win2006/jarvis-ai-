import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import { SettingsDb, HistoryDb } from '../memory/db';
import { Orchestrator } from '../ai/orchestrator';
import { ToolRegistry } from '../tools/registry';
// @ts-ignore
import pdfParse from 'pdf-parse';
import { getAuthPath } from '../utils/appPaths';
import { MCPManager } from '../mcp/client';
import path from 'path';

let client: Client | null = null;
let status = 'DISCONNECTED';
let qrCodeBase64 = '';

interface PendingChatReply {
  timer: NodeJS.Timeout;
  messages: string[];
  role: string;
  senderName: string;
  sessionId: string;
  originalMessage: any;
}

const pendingReplies = new Map<string, PendingChatReply>();
const sentMessagesCache = new Set<string>();

export const WhatsAppService = {
  getStatus() {
    return {
      status,
      qrCodeBase64,
      enabled: SettingsDb.get('whatsapp_enabled', 'false') === 'true',
      delaySeconds: Number(SettingsDb.get('whatsapp_delay_seconds', '360')),
      contacts: this.getContacts(),
      mcpStatus: {
        playwright: MCPManager.getConnectionStatus('playwright'),
        filesystem: MCPManager.getConnectionStatus('filesystem'),
        sqlite: true,
        github: MCPManager.getConnectionStatus('github')
      }
    };
  },

  getContacts() {
    const raw = SettingsDb.get('whatsapp_contacts', '[]');
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  setContacts(contacts: any[]) {
    SettingsDb.set('whatsapp_contacts', JSON.stringify(contacts));
  },

  async start(): Promise<void> {
    if (client) return;

    if (process.env.SAFE_MODE === 'true') {
      console.warn('[WhatsApp] Safe Mode active. Skipping WhatsApp connection.');
      status = 'DISCONNECTED';
      return;
    }

    status = 'INITIALIZING';
    qrCodeBase64 = '';

    try {
      client = new Client({
        authStrategy: new LocalAuth({ 
          clientId: "jarvis-whatsapp",
          dataPath: getAuthPath()
        }),
        puppeteer: {
          executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      });

      client.on('qr', async (qr) => {
        status = 'SCANNING_QR';
        try {
          qrCodeBase64 = await qrcode.toDataURL(qr);
        } catch (err) {
          console.error('[WhatsApp] QR Code generation failed:', err);
        }
      });

      client.on('ready', () => {
        status = 'CONNECTED';
        qrCodeBase64 = '';
        console.log('[WhatsApp] Central Link active.');
      });

      client.on('auth_failure', (msg) => {
        status = 'DISCONNECTED';
        console.error('[WhatsApp] Authentication failure:', msg);
        this.stop();
      });

      client.on('disconnected', (reason) => {
        status = 'DISCONNECTED';
        console.log('[WhatsApp] Session disconnected:', reason);
        this.stop();
      });

      client.on('message_create', async (message) => {
        const enabled = SettingsDb.get('whatsapp_enabled', 'false') === 'true';
        if (!enabled) return;

        console.log(`[WhatsApp Debug] message_create event: body="${message.body}" from=${message.from} to=${message.to} fromMe=${message.fromMe}`);

        // Ignore messages sent by ourselves to other numbers (only allow self-chats)
        const cleanRemote = message.id.remote.replace(/\D/g, '');
        const cleanTo = message.to.replace(/\D/g, '');
        const cleanSelf = client?.info?.wid?.user || '';
        const isSelfChat = message.fromMe && (cleanRemote === cleanSelf || cleanTo === cleanSelf);

        if (message.fromMe && !isSelfChat) {
          const recipientJid = message.to;
          if (pendingReplies.has(recipientJid)) {
            const pending = pendingReplies.get(recipientJid)!;
            clearTimeout(pending.timer);
            pendingReplies.delete(recipientJid);
            console.log(`[WhatsApp Log - system] Skipped because Edwin replied manually.`);
          }
          return;
        }

        // Loop protection for self-messaging JID
        if (sentMessagesCache.has(message.body)) {
          return;
        }

        try {
          let senderNumber = message.from.replace(/\D/g, ''); // E.g. "919988776655"
          let senderName = 'Unknown Contact';
          try {
            const contact = await message.getContact();
            senderName = contact.name || contact.pushname || 'Unknown Contact';
            if (contact.id && contact.id.user) {
              senderNumber = contact.id.user.replace(/\D/g, '');
            }
          } catch (contactErr) {
            console.log('[WhatsApp Debug] Failed to resolve contact details via WhatsApp API. Using fallback.');
          }

          // Match contact
          const contacts = this.getContacts();
          let matchedContact = contacts.find((c: any) => {
            const cleanCNumber = String(c.number || '').replace(/\D/g, '');
            const cleanCName = String(c.name || '').trim().toLowerCase();
            return (cleanCNumber && senderNumber.includes(cleanCNumber)) || 
                   (cleanCName && senderName.toLowerCase().includes(cleanCName));
          });

          if (isSelfChat && !matchedContact) {
            const ownerContact = contacts.find((c: any) => c.role === 'OWNER');
            matchedContact = ownerContact || { name: 'Owner', number: cleanSelf, role: 'OWNER' };
          }

          if (!matchedContact) {
            // Ignore unlisted contact
            return;
          }

          const role = matchedContact.role || 'GUEST';
          const sessionId = isSelfChat ? `whatsapp_${cleanSelf}` : `whatsapp_${senderNumber}`;

          const sendSignedReply = async (replyText: string) => {
            const signed = `${replyText}\n\n_Replied by JARVIS AI_`;
            sentMessagesCache.add(signed);
            if (sentMessagesCache.size > 50) {
              const first = sentMessagesCache.values().next().value;
              if (first) sentMessagesCache.delete(first);
            }
            await message.reply(signed);
          };

          const executeDelayedReply = async (key: string) => {
            try {
              const pending = pendingReplies.get(key);
              if (!pending) return;

              const combinedPrompt = pending.messages.join('\n');
              console.log(`[WhatsApp] Wait expired for ${pending.senderName}. Processing unified prompt: ${combinedPrompt}`);
              
              const innerLog = (type: string, text: string) => {
                console.log(`[WhatsApp Log - ${type}] ${text}`);
              };

              const result = await Orchestrator.processCommand(combinedPrompt, innerLog, pending.sessionId, pending.role, pending.senderName);
              
              const signed = `${result.response}\n\n_Replied by JARVIS AI_`;
              sentMessagesCache.add(signed);
              if (sentMessagesCache.size > 50) {
                const first = sentMessagesCache.values().next().value;
                if (first) sentMessagesCache.delete(first);
              }
              await pending.originalMessage.reply(signed);
            } catch (err) {
              console.error('[WhatsApp] Delayed message processor failed:', err);
            } finally {
              pendingReplies.delete(key);
            }
          };

          let prompt = message.body || '';

          // Support media attachments
          if (message.hasMedia) {
            const media = await message.downloadMedia();
            if (media && media.mimetype) {
              if (media.mimetype === 'application/pdf') {
                try {
                  const pdfBuffer = Buffer.from(media.data, 'base64');
                  const pdfData = await pdfParse(pdfBuffer);
                  prompt = `[Parsed PDF Attachment: ${media.filename || 'document.pdf'}]\n\n${pdfData.text}\n\nUser request: ${prompt}`;
                } catch (pdfErr: any) {
                  prompt = `[Failed to parse PDF: ${pdfErr.message}]\n\nUser request: ${prompt}`;
                }
              } else if (media.mimetype.startsWith('text/') || media.mimetype.includes('document')) {
                const text = Buffer.from(media.data, 'base64').toString('utf8');
                prompt = `[Text Attachment: ${media.filename || 'document.txt'}]\n\nContent:\n${text}\n\nUser request: ${prompt}`;
              } else if (media.mimetype.startsWith('image/')) {
                // Image descriptions placeholder:
                prompt = `[Image attachment received: ${media.filename || 'image.jpg'}]\n\nUser request: ${prompt}`;
              }
            }
          }

          // Handle Rich Slash commands directly to avoid LLM cost/time
          const cleanPrompt = prompt.trim().toLowerCase();
          if (cleanPrompt.startsWith('/status')) {
            const statusMsg = await WhatsAppService.getSystemStatusMessage();
            await sendSignedReply(statusMsg);
            return;
          } else if (cleanPrompt.startsWith('/help')) {
            let helpMsg = `JARVIS Assistant (Role: ${role})\n` +
                          `Available commands:\n` +
                          `- /status : Check IoT system status\n` +
                          `- /search [q] : Force web search\n` +
                          `- /weather [c] : Check weather in city\n` +
                          `- /help : Display this message\n`;
            if (role === 'OWNER') {
              helpMsg += `- /music [track] : Play music on desktop\n` +
                         `- Any natural language command (Full desktop automation rights enabled).`;
            } else {
              helpMsg += `- Any natural language command (Restricted chat access).`;
            }
            await sendSignedReply(helpMsg);
            return;
          } else if (cleanPrompt.startsWith('/weather ')) {
            const city = prompt.slice(9).trim();
            const weatherResult = await ToolRegistry.executeTool('get_weather', { location: city }, role);
            await sendSignedReply(weatherResult);
            return;
          } else if (cleanPrompt.startsWith('/search ')) {
            const q = prompt.slice(8).trim();
            const searchResult = await ToolRegistry.executeTool('internet_search', { query: q }, role);
            await sendSignedReply(searchResult);
            return;
          } else if (cleanPrompt.startsWith('/music ') && role === 'OWNER') {
            const track = prompt.slice(7).trim();
            const musicResult = await ToolRegistry.executeTool('play_song', { query: track }, role);
            await sendSignedReply(musicResult);
            return;
          }

          const logCallback = (type: string, text: string) => {
            console.log(`[WhatsApp Log - ${type}] ${text}`);
          };

          // 1. Wake phrase check
          const WAKE_PHRASES = ['hi jarvis', 'hello jarvis', 'hey jarvis', 'jarvis', 'ji jarvis', 'ok jarvis', 'okay jarvis'];
          const hasWakePhrase = WAKE_PHRASES.some(phrase => prompt.trim().toLowerCase().startsWith(phrase));
          const chatKey = message.from;

          if (hasWakePhrase || isSelfChat) {
            // Cancel any pending timer for this chat
            if (pendingReplies.has(chatKey)) {
              const pending = pendingReplies.get(chatKey)!;
              clearTimeout(pending.timer);
              pendingReplies.delete(chatKey);
            }
            // Process immediately
            const result = await Orchestrator.processCommand(prompt, logCallback, sessionId, role, senderName);
            await sendSignedReply(result.response);
          } else {
            // Delayed response sequence
            const delaySeconds = Number(SettingsDb.get('whatsapp_delay_seconds', '360'));
            
            if (pendingReplies.has(chatKey)) {
              const pending = pendingReplies.get(chatKey)!;
              clearTimeout(pending.timer);
              pending.messages.push(prompt);
              pending.originalMessage = message; // Keep reference to the latest message object
              
              // Restart timer
              pending.timer = setTimeout(async () => {
                await executeDelayedReply(chatKey);
              }, delaySeconds * 1000);
              console.log(`[WhatsApp] Appended message to ${senderName} buffer. Timer reset to ${delaySeconds} seconds.`);
            } else {
              // Create new delayed entry
              const messages = [prompt];
              const timer = setTimeout(async () => {
                await executeDelayedReply(chatKey);
              }, delaySeconds * 1000);
              
              pendingReplies.set(chatKey, {
                timer,
                messages,
                role,
                senderName,
                sessionId,
                originalMessage: message
              });
              console.log(`[WhatsApp] Silently waiting ${delaySeconds} seconds for Edwin to reply to ${senderName}...`);
            }
          }
        } catch (msgErr) {
          console.error('[WhatsApp] Message handler failed:', msgErr);
        }
      });

      await client.initialize();
    } catch (err: any) {
      status = 'DISCONNECTED';
      console.error('[WhatsApp] Central Link initialization failed:', err);
      client = null;
    }
  },

  async stop() {
    if (client) {
      try {
        await client.destroy();
      } catch {}
      client = null;
    }
    status = 'DISCONNECTED';
    qrCodeBase64 = '';
  },

  async getSystemStatusMessage(): Promise<string> {
    try {
      // Return a status overview
      return `JARVIS Central Link operational.\n` +
             `- AI Brain Backend: ${SettingsDb.get('ai_backend', 'OFFLINE')}\n` +
             `- Security access locks: SECURED\n` +
             `- Meteorological sensors: ONLINE\n` +
             `- Central power consumption grid nominal.`;
    } catch {
      return `JARVIS Core Status: Systems operating normally.`;
    }
  },

  async sendMessage(to: string, text: string): Promise<string> {
    if (status !== 'CONNECTED' || !client) {
      throw new Error('WhatsApp service is not connected.');
    }

    let targetJid = to;
    if (!to.endsWith('@c.us') && !to.endsWith('@g.us')) {
      const cleanNumber = to.replace(/\D/g, '');
      if (cleanNumber) {
        targetJid = `${cleanNumber}@c.us`;
      } else {
        const contacts = this.getContacts();
        const found = contacts.find((c: any) => c.name.toLowerCase().includes(to.toLowerCase()));
        if (found && found.number) {
          targetJid = `${found.number.replace(/\D/g, '')}@c.us`;
        } else {
          throw new Error(`Contact "${to}" was not found in authorized list.`);
        }
      }
    }

    const signedText = `${text}\n\n_Replied by JARVIS AI_`;
    sentMessagesCache.add(signedText);
    await client.sendMessage(targetJid, signedText);
    return `Successfully sent WhatsApp message to ${to}.`;
  }
};
