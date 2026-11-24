export async function computeBufferSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeBlobSha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return computeBufferSha256(buffer);
}

export async function computeStringSha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  return computeBufferSha256(encoded.buffer as ArrayBuffer);
}

export function verifyChecksumsMatch(expected?: string | null, actual?: string | null): boolean {
  if (!expected || !actual) return false;
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}
