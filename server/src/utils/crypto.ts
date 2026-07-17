

let ipcCallbackMap: Record<number, (val: string) => void> = {};
let ipcRequestId = 1;

if (process.send) {
  process.on('message', (msg: any) => {
    if (msg && msg.type === 'crypto_response' && ipcCallbackMap[msg.id]) {
      ipcCallbackMap[msg.id](msg.data);
      delete ipcCallbackMap[msg.id];
    }
  });
}

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.endsWith('_key') || k.endsWith('_token') || k === 'gemini_key' || k.includes('secret');
}

export function encryptSecret(plainText: string): Promise<string> {
  if (!process.send || !plainText) {
    return Promise.resolve(plainText);
  }
  return Promise.race([
    new Promise<string>((resolve) => {
      const id = ipcRequestId++;
      ipcCallbackMap[id] = resolve;
      process.send!({ type: 'encrypt', data: plainText, id });
    }),
    new Promise<string>((resolve) => setTimeout(() => resolve(plainText), 5000))
  ]);
}

export function decryptSecret(cipherText: string): Promise<string> {
  if (!process.send || !cipherText) {
    return Promise.resolve(cipherText);
  }
  // If the ciphertext is not actually encrypted (e.g. plain text saved in dev), return it directly
  if (!cipherText.startsWith('enc:')) {
    return Promise.resolve(cipherText);
  }
  return Promise.race([
    new Promise<string>((resolve) => {
      const id = ipcRequestId++;
      ipcCallbackMap[id] = resolve;
      process.send!({ type: 'decrypt', data: cipherText.slice(4), id }); // slice off 'enc:' prefix
    }),
    new Promise<string>((resolve) => setTimeout(() => resolve(cipherText), 5000))
  ]);
}
