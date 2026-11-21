import { pbkdf2 as pbkdf2Cb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Cb);

/** arch/security.md: PBKDF2-SHA-256, 310k iterations, 128-bit salt, 32B out. */
const ITERATIONS = 310_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export interface Verifier {
  readonly hash: Buffer;
  readonly salt: Buffer;
}

/** The derived key is both the verifier and the DEK wrapping key. */
export async function derive(passcode: string, salt: Buffer): Promise<Buffer> {
  return pbkdf2(passcode.normalize("NFKC"), salt, ITERATIONS, KEY_BYTES, "sha256");
}

export async function createVerifier(passcode: string): Promise<Verifier> {
  const salt = randomBytes(SALT_BYTES);
  return { hash: await derive(passcode, salt), salt };
}

export async function verifyPasscode(
  passcode: string,
  stored: Verifier,
): Promise<boolean> {
  const candidate = await derive(passcode, stored.salt);
  return (
    candidate.length === stored.hash.length && timingSafeEqual(candidate, stored.hash)
  );
}
