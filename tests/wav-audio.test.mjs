import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeWavBlob } from '../src/utils/wavAudio.js'

test('encodes normalized samples into a 16-bit PCM mono wav blob', async () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
  const blob = encodeWavBlob(samples, 16000)
  assert.equal(blob.type, 'audio/wav')
  const buffer = Buffer.from(await blob.arrayBuffer())
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE')
  assert.equal(buffer.toString('ascii', 36, 40), 'data')
  assert.equal(buffer.readUInt16LE(20), 1)
  assert.equal(buffer.readUInt16LE(22), 1)
  assert.equal(buffer.readUInt32LE(24), 16000)
  assert.equal(buffer.readUInt16LE(34), 16)
  assert.equal(buffer.readUInt32LE(40), samples.length * 2)
  assert.equal(buffer.length, 44 + samples.length * 2)
  assert.equal(buffer.readInt16LE(44), 0)
  assert.equal(buffer.readInt16LE(46), Math.trunc(0.5 * 0x7fff))
  assert.equal(buffer.readInt16LE(48), -16384)
  assert.equal(buffer.readInt16LE(50), 32767)
  assert.equal(buffer.readInt16LE(52), -32768)
})
