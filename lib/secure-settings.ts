import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const SETTINGS_ENCRYPTION_PREFIX = 'enc:v1:';
const SETTINGS_ENCRYPTION_ALGORITHM = 'aes-256-gcm';

let cachedSettingsKey: Buffer | null | undefined;

function getDefaultSettingsKeyFilePath() {
  const configuredSqliteFilename = process.env.SQLITE_FILENAME?.trim();
  const baseDir = configuredSqliteFilename
    ? path.dirname(path.resolve(configuredSqliteFilename))
    : path.resolve(process.cwd(), 'runtime-data');

  return path.resolve(
    process.env.USER_SETTINGS_ENCRYPTION_KEY_FILE?.trim() ||
      path.join(baseDir, '.user-settings.key'),
  );
}

function readOrCreateSettingsKeyMaterial() {
  const envKey = process.env.USER_SETTINGS_ENCRYPTION_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const keyFilePath = getDefaultSettingsKeyFilePath();
  try {
    if (fs.existsSync(keyFilePath)) {
      return fs.readFileSync(keyFilePath, 'utf8').trim();
    }

    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
    const generated = randomBytes(32).toString('base64url');

    try {
      fs.writeFileSync(keyFilePath, generated, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      return generated;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
        return fs.readFileSync(keyFilePath, 'utf8').trim();
      }
      throw error;
    }
  } catch (error) {
    console.error('[secure-settings] CRITICAL: Failed to load or create encryption key — API keys will be stored in plaintext:', error);
    return '';
  }
}

function getSettingsEncryptionKey() {
  if (cachedSettingsKey !== undefined) {
    return cachedSettingsKey;
  }

  const material = readOrCreateSettingsKeyMaterial();
  if (!material) {
    cachedSettingsKey = null;
    return cachedSettingsKey;
  }

  cachedSettingsKey = createHash('sha256').update(material).digest();
  return cachedSettingsKey;
}

export function isEncryptedSettingsPayload(value: string) {
  return value.startsWith(SETTINGS_ENCRYPTION_PREFIX);
}

export function encryptStoredSettings(plaintext: string) {
  const key = getSettingsEncryptionKey();
  if (!key) {
    return plaintext;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(SETTINGS_ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${SETTINGS_ENCRYPTION_PREFIX}${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptStoredSettings(payload: string) {
  if (!isEncryptedSettingsPayload(payload)) {
    return {
      plaintext: payload,
      encrypted: false,
    };
  }

  const key = getSettingsEncryptionKey();
  if (!key) {
    throw new Error('User settings encryption key is unavailable.');
  }

  const body = payload.slice(SETTINGS_ENCRYPTION_PREFIX.length);
  let ivPart: string | undefined;
  let authTagPart: string | undefined;
  let encryptedPart: string | undefined;

  const separatedParts = body.split(':');
  if (separatedParts.length >= 3) {
    [ivPart, authTagPart, encryptedPart] = separatedParts;
  } else if (body.length > 38) {
    // Backward compatibility for the initial v1 payload format that was
    // mistakenly written without separators between IV and auth tag.
    ivPart = body.slice(0, 16);
    authTagPart = body.slice(16, 38);
    encryptedPart = body.slice(38);
  }

  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error('Encrypted user settings payload is malformed.');
  }

  const decipher = createDecipheriv(
    SETTINGS_ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');

  return {
    plaintext,
    encrypted: true,
  };
}

export function canEncryptStoredSettings() {
  return Boolean(getSettingsEncryptionKey());
}
