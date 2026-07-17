import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface YouTubeMusicResult {
  videoId: string;
  title: string;
  url: string;
}

// Helper to run a PowerShell command
export function runPowerShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function psSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

async function openUrlInReusableBrowser(url: string): Promise<void> {
  const safeUrl = psSingleQuoted(url);
  const psCommand = `
    $url = '${safeUrl}';
    $shell = New-Object -ComObject WScript.Shell;
    $activated = $false;
    foreach ($title in @('YouTube Music', 'YouTube', 'Google Chrome', 'Microsoft Edge', 'Chrome', 'Edge')) {
      if ($shell.AppActivate($title)) {
        $activated = $true;
        break;
      }
    }
    if ($activated) {
      Start-Sleep -Milliseconds 180;
      Set-Clipboard -Value $url;
      $shell.SendKeys('^l');
      Start-Sleep -Milliseconds 80;
      $shell.SendKeys('^v');
      Start-Sleep -Milliseconds 80;
      $shell.SendKeys('{ENTER}');
    } else {
      Start-Process $url;
    }
  `;
  await runPowerShell(psCommand.replace(/\n/g, ' '));
}

export async function searchYouTubeMusic(query: string, limit: number = 8): Promise<YouTubeMusicResult[]> {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) return [];

    const html = await response.text();
    const matches = html.matchAll(/"videoId":"([^"]{11})"/g);
    const seen = new Set<string>();
    const results: YouTubeMusicResult[] = [];

    for (const match of matches) {
      const videoId = match[1];
      if (seen.has(videoId)) continue;

      seen.add(videoId);
      const start = Math.max(0, match.index - 1500);
      const end = Math.min(html.length, match.index + 2500);
      const chunk = html.slice(start, end);
      const titleMatch =
        chunk.match(/"title":\{"runs":\[\{"text":"([^"]+)"/) ||
        chunk.match(/"title":\{"simpleText":"([^"]+)"/);
      const title = titleMatch?.[1]
        ? titleMatch[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"')
        : query;

      results.push({
        videoId,
        title,
        url: `https://music.youtube.com/watch?v=${videoId}`
      });

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  } catch {
    return [];
  }
}

export const DesktopHelper = {
  // Launch Windows Apps
  async launchApp(appName: string): Promise<string> {
    try {
      // Maps common names to executable paths or system shortcuts
      const appMap: Record<string, string> = {
        notepad: 'notepad.exe',
        calculator: 'calc.exe',
        paint: 'mspaint.exe',
        cmd: 'cmd.exe',
        powershell: 'powershell.exe',
        browser: 'start http://google.com',
        spotify: 'spotify'
      };

      const target = appMap[appName.toLowerCase()] || appName;
      await runPowerShell(`Start-Process "${target}" -ErrorAction Stop`);
      return `Launched ${appName} successfully.`;
    } catch (e: any) {
      return `Failed to launch ${appName}: ${e}`;
    }
  },

  // Clipboard Operations
  async getClipboard(): Promise<string> {
    try {
      const text = await runPowerShell('Get-Clipboard');
      return text || 'Clipboard is empty.';
    } catch (e: any) {
      return `Failed to read clipboard: ${e}`;
    }
  },

  async setClipboard(text: string): Promise<string> {
    try {
      await runPowerShell(`Set-Clipboard -Value "${text}"`);
      return 'Content copied to system clipboard.';
    } catch (e: any) {
      return `Failed to write clipboard: ${e}`;
    }
  },

  // Native Windows Toast Notification
  async showNotification(title: string, message: string): Promise<string> {
    try {
      // PowerShell script to trigger toast notification
      const psCommand = `
        [void] [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms");
        $toast = New-Object System.Windows.Forms.NotifyIcon;
        $toast.Icon = [System.Drawing.SystemIcons]::Information;
        $toast.BalloonTipTitle = "${title}";
        $toast.BalloonTipText = "${message}";
        $toast.Visible = $true;
        $toast.ShowBalloonTip(5000);
      `;
      await runPowerShell(psCommand.replace(/\n/g, ' '));
      return 'Notification dispatched to Windows shell.';
    } catch (e: any) {
      return `Failed to display notification: ${e}`;
    }
  },

  // System Keystrokes Automation
  async pressKeys(keys: string): Promise<string> {
    try {
      // Example keys: "%{F4}" (Alt+F4), "^C" (Ctrl+C), "{ENTER}"
      const psCommand = `
        $wshell = New-Object -ComObject WScript.Shell;
        $wshell.SendKeys('${keys}')
      `;
      await runPowerShell(psCommand.replace(/\n/g, ' '));
      return `Triggered keystrokes: ${keys}`;
    } catch (e: any) {
      return `Failed sending keystrokes: ${e}`;
    }
  },

  // Volume control automation via native virtual key codes
  async setVolume(action: 'up' | 'down' | 'mute'): Promise<string> {
    try {
      const keys = action === 'up' ? '[char]175' : action === 'down' ? '[char]174' : '[char]173';
      const psCommand = `
        $wsh = New-Object -ComObject WScript.Shell;
        $wsh.SendKeys(${keys})
      `;
      await runPowerShell(psCommand.replace(/\n/g, ' '));
      return `Audio Volume adjusted: ${action}`;
    } catch (e: any) {
      return `Failed setting volume: ${e}`;
    }
  },

  // Global media key controls for browsers and music players.
  async controlMedia(action: 'play_pause' | 'stop' | 'next' | 'previous'): Promise<string> {
    try {
      const virtualKeys: Record<typeof action, string> = {
        play_pause: '0xB3',
        stop: '0xB2',
        next: '0xB0',
        previous: '0xB1'
      };
      const key = virtualKeys[action];
      const psCommand = `
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MediaKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }';
        [MediaKeys]::keybd_event(${key}, 0, 0, [UIntPtr]::Zero);
        Start-Sleep -Milliseconds 60;
        [MediaKeys]::keybd_event(${key}, 0, 2, [UIntPtr]::Zero);
      `;
      await runPowerShell(psCommand.replace(/\n/g, ' '));
      return `Media control triggered: ${action}.`;
    } catch (e: any) {
      return `Failed media control: ${e}`;
    }
  },

  // Native Screenshot capture
  async captureScreenshot(): Promise<string> {
    const filename = `screenshot_${Date.now()}.png`;
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const savePath = path.join(dataDir, filename);

    try {
      const psCommand = `
        Add-Type -AssemblyName System.Windows.Forms;
        Add-Type -AssemblyName System.Drawing;
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
        $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height;
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
        $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size);
        $bitmap.Save("${savePath.replace(/\\/g, '/')}", [System.Drawing.Imaging.ImageFormat]::Png);
        $graphics.Dispose();
        $bitmap.Dispose();
      `;
      await runPowerShell(psCommand.replace(/\n/g, ' '));
      return savePath;
    } catch (e: any) {
      throw new Error(`Failed to capture screenshot: ${e}`);
    }
  },

  // Play a song via YouTube Music in the default browser.
  async playSong(query: string, selectedVideoId?: string): Promise<string> {
    try {
      const cleanQuery = (query || 'top songs playlist').trim();
      const videoId = selectedVideoId || (await searchYouTubeMusic(cleanQuery, 1))[0]?.videoId;
      const ytUrl = videoId
        ? `https://music.youtube.com/watch?v=${videoId}`
        : `https://music.youtube.com/search?q=${encodeURIComponent(cleanQuery)}`;

      await openUrlInReusableBrowser(ytUrl);
      return videoId
        ? `Opening YouTube Music and playing: "${cleanQuery}".`
        : `Opening YouTube Music search for: "${cleanQuery}".`;
    } catch (e: any) {
      return `Failed to play song: ${e}`;
    }
  },

  // Play a regular YouTube video, useful for news and non-music video requests.
  async playYouTubeVideo(query: string, selectedVideoId?: string): Promise<string> {
    try {
      const cleanQuery = (query || 'latest news').trim();
      const videoId = selectedVideoId || (await searchYouTubeMusic(cleanQuery, 1))[0]?.videoId;
      const ytUrl = videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;

      await openUrlInReusableBrowser(ytUrl);
      return videoId
        ? `Opening YouTube and playing: "${cleanQuery}".`
        : `Opening YouTube search for: "${cleanQuery}".`;
    } catch (e: any) {
      return `Failed to play YouTube video: ${e}`;
    }
  }
};
