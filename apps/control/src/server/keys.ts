import { randomBytes, webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;

/** A fresh 32-byte service DEK, extractable only for the wrap. */
export async function newDek(): Promise<webcrypto.CryptoKey> {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function wrapDek(
  dek: webcrypto.CryptoKey,
  wrappingKey: Buffer,
): Promise<Buffer> {
  const key = await subtle.importKey("raw", wrappingKey, "AES-KW", false, ["wrapKey"]);
  return Buffer.from(await subtle.wrapKey("raw", dek, key, "AES-KW"));
}

export async function unwrapDek(
  wrapped: Buffer,
  wrappingKey: Buffer,
): Promise<webcrypto.CryptoKey> {
  const key = await subtle.importKey("raw", wrappingKey, "AES-KW", false, ["unwrapKey"]);
  return subtle.unwrapKey(
    "raw",
    wrapped,
    key,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/** 32-byte link signing secret. */
export function newSecret(): Buffer {
  return randomBytes(32);
}

export const KEK_KID = "local-dev-1";
