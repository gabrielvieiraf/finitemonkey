const SAFE_ENV = /^\.env\.(?:example|sample|template|dist|defaults|schema)$/i;
const ENV_FILE = /^\.env(?:\..+)?$/i;
const KEY_FILE = /\.(?:pem|key|p12|pfx)$/i;
const SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_[A-Za-z0-9_-]+)?$/;

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export const isSensitivePath = (path: string): boolean => {
  const name = basename(path.replace(/^["']|["']$/g, ""));
  if (ENV_FILE.test(name)) return !SAFE_ENV.test(name);
  return KEY_FILE.test(name) || SSH_KEY.test(name);
};
