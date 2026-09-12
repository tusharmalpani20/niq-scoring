const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: bigint, length: number): string {
  let encoded = "";
  for (let index = 0; index < length; index += 1) {
    encoded = crockfordBase32[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

/** Generate entity identifiers at the application boundary before persistence. */
export function createEntityId(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 281_474_976_710_655) {
    throw new RangeError("ULID timestamp must fit in 48 bits");
  }

  const randomBytes = crypto.getRandomValues(new Uint8Array(10));
  let randomness = 0n;
  for (const byte of randomBytes) randomness = (randomness << 8n) | BigInt(byte);

  return `${encodeBase32(BigInt(now), 10)}${encodeBase32(randomness, 16)}`;
}
