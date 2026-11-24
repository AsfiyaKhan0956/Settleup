import { compare } from "bcryptjs";
import scryptJs from "scrypt-js";

const encoder = new TextEncoder();
const COOKIE_NAME = "settleup_sid";
const KEY_LENGTH = 64;

export function generateOpaqueToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error("Invalid hexadecimal value");
  }

  return new Uint8Array(
    hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Compatible with the original Node.js crypto.scryptSync settings.
export async function hashPassword(password: string): Promise<string> {
  const salt = generateOpaqueToken(16);

  const derived = await scryptJs.scrypt(
    encoder.encode(password),
    encoder.encode(salt),
    16384,
    8,
    1,
    KEY_LENGTH
  );

  return `${salt}:${bytesToHex(derived)}`;
}


export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  // Support original bcrypt password hashes.
  if (/^\$2[aby]\$/.test(storedHash)) {
    try {
      return await compare(password, storedHash);
    } catch {
      return false;
    }
  }

  // Support current Cloudflare scrypt hashes.
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;

  const [salt, keyHex] = parts;

  try {
    const expected = hexToBytes(keyHex);
    if (expected.length !== KEY_LENGTH) return false;

    const actual = await scryptJs.scrypt(
      encoder.encode(password),
      encoder.encode(salt),
      16384,
      8,
      1,
      KEY_LENGTH
    );

    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
      difference |= expected[i] ^ actual[i];
    }

    return difference === 0;
  } catch {
    return false;
  }
}


export async function hashToken(
  rawToken: string,
  secret: string
): Promise<string> {
  if (!secret?.trim()) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawToken)
  );

  return bytesToHex(new Uint8Array(signature));
}

export function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie") ?? "";

  const cookie = cookieHeader
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith(`${COOKIE_NAME}=`));

  if (cookie) {
    return decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1));
  }

  const authorization = request.headers.get("Authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim() || null;
  }

  return null;
}

export function setSessionCookie(
  request: Request,
  rawToken: string,
  rememberMe: boolean
): string {
  const secure = new URL(request.url).protocol === "https:";
  const maxAge = rememberMe ? 30 * 86400 : 86400;

  return `${COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:";

  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function passwordStrengthErrors(password: string): string[] {
  const errors: string[] = [];

  if (password.length < 8) errors.push("At least 8 characters");
  if (!/[A-Z]/.test(password)) errors.push("One uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("One lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("One number");

  return errors;
}

export function normalizePhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, "");

  if (!cleaned) return null;
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) return cleaned;
  if (/^[0-9]{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^[1-9]\d{9,14}$/.test(cleaned)) return `+${cleaned}`;

  return null;
}
