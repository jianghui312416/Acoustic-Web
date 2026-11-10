/** 16-bit PCM 单声道 WAV 编码，输入样本归一化到 [-1, 1]。 */
export function encodeWavBlob(samples, sampleRate = 16000) {
  const frames = Math.max(0, samples?.length || 0)
  const rate = Math.max(1, Math.round(Number(sampleRate) || 16000))
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const dataSize = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let index = 0; index < frames; index += 1) {
    const value = Math.max(-1, Math.min(1, Number(samples[index]) || 0))
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
    offset += bytesPerSample
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
