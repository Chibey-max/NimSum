// Wallet identity.
//
// A score is only worth something if it is tied to a real wallet. The client
// asks for a challenge, has Nimiq Pay sign it, and returns the signature plus
// the public key. The server verifies the signature, derives the address from
// the public key itself, and only then accepts the identity. Nothing here
// trusts an address the client simply claims to own.

import * as Nimiq from '@nimiq/core'
import { createHash, randomBytes } from 'node:crypto'

/** Challenges are single-use and short-lived. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000

interface Challenge {
  nonce: string
  issuedAt: number
  used: boolean
}

const challenges = new Map<string, Challenge>()

export function issueChallenge(): { nonce: string; message: string; expiresIn: number } {
  const nonce = randomBytes(16).toString('hex')
  challenges.set(nonce, { nonce, issuedAt: Date.now(), used: false })
  pruneChallenges()
  return {
    nonce,
    message: challengeMessage(nonce),
    expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
  }
}

/** The exact string the wallet is asked to sign. */
export function challengeMessage(nonce: string): string {
  return `NimSum daily puzzle\nSign in to record your streak.\nNonce: ${nonce}`
}

function pruneChallenges(): void {
  const cutoff = Date.now() - CHALLENGE_TTL_MS
  for (const [nonce, c] of challenges) {
    if (c.issuedAt < cutoff) challenges.delete(nonce)
  }
}

export function consumeChallenge(nonce: string): { ok: true } | { ok: false; reason: string } {
  const c = challenges.get(nonce)
  if (!c) return { ok: false, reason: 'Challenge not found or expired. Request a new one.' }
  if (c.used) return { ok: false, reason: 'Challenge already used. Request a new one.' }
  if (Date.now() - c.issuedAt > CHALLENGE_TTL_MS) {
    challenges.delete(nonce)
    return { ok: false, reason: 'Challenge expired. Request a new one.' }
  }
  c.used = true
  return { ok: true }
}

/**
 * Nimiq wallets sign a framed message rather than raw bytes, in the same
 * spirit as Ethereum's personal_sign, so that a signature obtained for one
 * purpose cannot be replayed as a transaction. We accept either framing and
 * report which one matched, so the exact behaviour of a given wallet build is
 * observable rather than assumed.
 */
const NIMIQ_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'

export function framedMessageBytes(message: string): Uint8Array {
  const body = Buffer.from(message, 'utf8')
  const prefix = Buffer.from(NIMIQ_MESSAGE_PREFIX + String(body.length), 'utf8')
  const hash = createHash('sha256').update(Buffer.concat([prefix, body])).digest()
  return new Uint8Array(hash)
}

export function rawMessageBytes(message: string): Uint8Array {
  return new Uint8Array(Buffer.from(message, 'utf8'))
}

export interface VerifiedIdentity {
  address: string
  publicKey: string
  framing: 'framed' | 'raw'
}

export type VerifyResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: string }

/**
 * Verify a signature over the challenge message and derive the signer's
 * address from the public key. The caller gets back the address the key
 * actually controls, never one the client asserted.
 */
export function verifySignature(
  message: string,
  publicKeyHex: string,
  signatureHex: string,
): VerifyResult {
  let publicKey: Nimiq.PublicKey
  let signature: Nimiq.Signature
  try {
    publicKey = Nimiq.PublicKey.fromHex(publicKeyHex.replace(/^0x/, ''))
  } catch {
    return { ok: false, reason: 'Public key is not valid.' }
  }
  try {
    signature = Nimiq.Signature.fromHex(signatureHex.replace(/^0x/, ''))
  } catch {
    return { ok: false, reason: 'Signature is not valid.' }
  }

  for (const framing of ['framed', 'raw'] as const) {
    const bytes = framing === 'framed' ? framedMessageBytes(message) : rawMessageBytes(message)
    if (publicKey.verify(signature, bytes)) {
      return {
        ok: true,
        identity: {
          address: publicKey.toAddress().toUserFriendlyAddress(),
          publicKey: publicKeyHex,
          framing,
        },
      }
    }
  }

  return { ok: false, reason: 'Signature does not match this public key.' }
}

/**
 * Normalise an address for storage and comparison. Accepts the spaced
 * user-friendly form, an unspaced form, and any casing, because those are all
 * shapes people paste. Returns the canonical spaced uppercase form, or null
 * if the string is not a Nimiq address at all.
 */
export function canonicalAddress(address: string): string | null {
  const compact = address.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (!/^NQ[0-9]{2}[0-9A-Z]{32}$/.test(compact)) return null
  const spaced = compact.match(/.{1,4}/g)!.join(' ')
  try {
    return Nimiq.Address.fromString(spaced).toUserFriendlyAddress()
  } catch {
    return null
  }
}
