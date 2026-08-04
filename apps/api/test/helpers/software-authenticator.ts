import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

/**
 * A minimal in-process WebAuthn authenticator, so the passkey routes can be
 * exercised through a real ceremony — real ES256 signatures over real
 * authenticator data — instead of stubbing out the verification we most want to
 * be sure about.
 *
 * Only what the routes need is implemented: ES256 keys, "none" attestation, and
 * discoverable credentials.
 */

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

function toBase64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** CBOR: unsigned/negative integer, definite-length byte and text strings, maps. */
function cborUint(major: number, value: number): Buffer {
  if (value < 24) {
    return Buffer.from([(major << 5) | value]);
  }
  if (value < 0x100) {
    return Buffer.from([(major << 5) | 24, value]);
  }
  if (value < 0x10000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = (major << 5) | 25;
    buffer.writeUInt16BE(value, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = (major << 5) | 26;
  buffer.writeUInt32BE(value, 1);
  return buffer;
}

function cborNegativeInt(value: number): Buffer {
  return cborUint(1, -value - 1);
}

function cborBytes(bytes: Buffer): Buffer {
  return Buffer.concat([cborUint(2, bytes.length), bytes]);
}

function cborText(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([cborUint(3, bytes.length), bytes]);
}

function cborMap(entries: Array<[Buffer, Buffer]>): Buffer {
  return Buffer.concat([cborUint(5, entries.length), ...entries.flatMap(([key, value]) => [key, value])]);
}

/** COSE_Key for an ES256 public key: kty=EC2, alg=ES256, crv=P-256, x, y. */
function toCoseKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return cborMap([
    [cborUint(0, 1), cborUint(0, 2)],
    [cborUint(0, 3), cborNegativeInt(-7)],
    [cborNegativeInt(-1), cborUint(0, 1)],
    [cborNegativeInt(-2), cborBytes(Buffer.from(jwk.x, 'base64url'))],
    [cborNegativeInt(-3), cborBytes(Buffer.from(jwk.y, 'base64url'))],
  ]);
}

function buildClientDataJSON(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

function buildAuthData(rpId: string, flags: number, signCount: number, attestedCredentialData?: Buffer): Buffer {
  const rpIdHash = createHash('sha256').update(rpId, 'utf8').digest();
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(signCount, 1);
  return Buffer.concat([rpIdHash, header, attestedCredentialData ?? Buffer.alloc(0)]);
}

export interface SoftwareAuthenticatorOptions {
  /** Set to advance the signature counter on each assertion. Real passkeys often stay at 0. */
  useSignCounter?: boolean;
}

export interface AuthenticatorResponseOptions {
  /** Set to false to exercise ceremonies where the authenticator did not verify the user. */
  userVerified?: boolean;
}

function withUserVerification(flags: number, userVerified: boolean): number {
  return userVerified ? flags | FLAG_USER_VERIFIED : flags;
}

export class SoftwareAuthenticator {
  readonly credentialId: Buffer;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly useSignCounter: boolean;
  private signCount = 0;

  constructor(options: SoftwareAuthenticatorOptions = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.credentialId = randomBytes(32);
    this.useSignCounter = options.useSignCounter ?? false;
  }

  get credentialIdBase64Url(): string {
    return toBase64Url(this.credentialId);
  }

  private nextSignCount(): number {
    if (this.useSignCounter) {
      this.signCount += 1;
    }
    return this.signCount;
  }

  /** Replays the previous counter value, as a cloned authenticator would. */
  rewindSignCounter(): void {
    this.signCount = Math.max(0, this.signCount - 1);
  }

  createAttestationResponse(
    challenge: string,
    rpId: string,
    origin: string,
    options: AuthenticatorResponseOptions = {},
  ) {
    const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, origin);
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length, 0);
    const attestedCredentialData = Buffer.concat([
      Buffer.alloc(16), // all-zero AAGUID, as privacy-preserving authenticators report
      credentialIdLength,
      this.credentialId,
      toCoseKey(this.publicKey),
    ]);
    const authData = buildAuthData(
      rpId,
      withUserVerification(FLAG_USER_PRESENT | FLAG_ATTESTED_CREDENTIAL_DATA, options.userVerified ?? true),
      this.nextSignCount(),
      attestedCredentialData,
    );
    const attestationObject = cborMap([
      [cborText('fmt'), cborText('none')],
      [cborText('attStmt'), cborMap([])],
      [cborText('authData'), cborBytes(authData)],
    ]);

    return {
      id: this.credentialIdBase64Url,
      rawId: this.credentialIdBase64Url,
      type: 'public-key' as const,
      response: {
        clientDataJSON: toBase64Url(clientDataJSON),
        attestationObject: toBase64Url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  createAssertionResponse(
    challenge: string,
    rpId: string,
    origin: string,
    userHandle: string | null,
    options: AuthenticatorResponseOptions = {},
  ) {
    const clientDataJSON = buildClientDataJSON('webauthn.get', challenge, origin);
    const authData = buildAuthData(
      rpId,
      withUserVerification(FLAG_USER_PRESENT, options.userVerified ?? true),
      this.nextSignCount(),
    );
    const signatureBase = Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]);
    const signature = createSign('sha256').update(signatureBase).sign(this.privateKey);

    return {
      id: this.credentialIdBase64Url,
      rawId: this.credentialIdBase64Url,
      type: 'public-key' as const,
      response: {
        clientDataJSON: toBase64Url(clientDataJSON),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(signature),
        userHandle: userHandle === null ? undefined : Buffer.from(userHandle, 'utf8').toString('base64url'),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
