// Identity tests. These generate a real Nimiq keypair, sign a real challenge,
// and push it through the exact verification path the server uses, so the
// claim "scores are cryptographically bound to a wallet" is demonstrated
// rather than asserted.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Nimiq from '@nimiq/core'
import {
  canonicalAddress,
  challengeMessage,
  consumeChallenge,
  framedMessageBytes,
  issueChallenge,
  rawMessageBytes,
  verifySignature,
} from './auth'

function keypair() {
  const priv = Nimiq.PrivateKey.generate()
  const pub = Nimiq.PublicKey.derive(priv)
  return { priv, pub }
}

function signRaw(priv: Nimiq.PrivateKey, pub: Nimiq.PublicKey, bytes: Uint8Array) {
  return Nimiq.Signature.create(priv, pub, bytes)
}

test('a real signature verifies and yields the signer address', () => {
  const { priv, pub } = keypair()
  const { nonce } = issueChallenge()
  const message = challengeMessage(nonce)

  const sig = signRaw(priv, pub, framedMessageBytes(message))
  const result = verifySignature(message, pub.toHex(), sig.toHex())

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.identity.framing, 'framed')
    // Address must be derived from the key, and match what the key says.
    assert.equal(result.identity.address, pub.toAddress().toUserFriendlyAddress())
  }
})

test('raw framing is also accepted, and reported as such', () => {
  const { priv, pub } = keypair()
  const message = challengeMessage('abc123')
  const sig = signRaw(priv, pub, rawMessageBytes(message))
  const result = verifySignature(message, pub.toHex(), sig.toHex())

  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.identity.framing, 'raw')
})

test('a signature over a different message is rejected', () => {
  const { priv, pub } = keypair()
  const signed = challengeMessage('nonce-one')
  const claimed = challengeMessage('nonce-two')

  const sig = signRaw(priv, pub, framedMessageBytes(signed))
  const result = verifySignature(claimed, pub.toHex(), sig.toHex())

  assert.equal(result.ok, false)
})

test('you cannot claim someone else key with your own signature', () => {
  const alice = keypair()
  const mallory = keypair()
  const message = challengeMessage('shared-nonce')

  // Mallory signs, but presents Alice's public key.
  const sig = signRaw(mallory.priv, mallory.pub, framedMessageBytes(message))
  const result = verifySignature(message, alice.pub.toHex(), sig.toHex())

  assert.equal(result.ok, false, 'signature from a different key must not verify')
})

test('malformed keys and signatures fail closed', () => {
  const message = challengeMessage('x')
  assert.equal(verifySignature(message, 'nonsense', 'nonsense').ok, false)
  assert.equal(verifySignature(message, '00'.repeat(32), 'zz').ok, false)
})

test('challenges are single use and unknown nonces are refused', () => {
  const { nonce } = issueChallenge()
  assert.equal(consumeChallenge(nonce).ok, true, 'first use should succeed')
  assert.equal(consumeChallenge(nonce).ok, false, 'replay must be refused')
  assert.equal(consumeChallenge('never-issued').ok, false)
})

test('challenges are unique per request', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) seen.add(issueChallenge().nonce)
  assert.equal(seen.size, 200)
})

test('address canonicalisation accepts valid and rejects invalid', () => {
  const { pub } = keypair()
  const friendly = pub.toAddress().toUserFriendlyAddress()
  assert.equal(canonicalAddress(friendly), friendly)
  assert.equal(canonicalAddress(friendly.toLowerCase().replace(/\s/g, '')), friendly)
  assert.equal(canonicalAddress('NQ00 NOT A REAL ADDRESS'), null)
  assert.equal(canonicalAddress(''), null)
})
