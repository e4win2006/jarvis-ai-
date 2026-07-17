import { exec } from 'child_process';
import path from 'path';

export function runPythonScript(scriptPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Escaping argument values for safety in command execution
    const escapedArgs = args.map(arg => {
      // Escape inner double quotes
      const escaped = arg.replace(/"/g, '\\"');
      return `"${escaped}"`;
    }).join(' ');

    const cmd = `python "${scriptPath}" ${escapedArgs}`;
    
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        // If there's stdout output (like JSON error details), prefer that over raw stderr
        if (stdout && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          reject(stderr || error.message);
        }
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
