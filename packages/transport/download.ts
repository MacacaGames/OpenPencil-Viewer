export async function readDownload(
  response: Response,
  expected: number,
  max: number,
  signal: AbortSignal,
  progress: (read: number, total: number) => void
) {
  if (!response.ok || !response.body) throw new Error('文件不可讀或來源離線')
  if (expected > max || expected < 1) throw new Error('檔案大小超過限制')
  const announced = Number(response.headers.get('Content-Length'))
  if (announced !== expected) throw new Error('文件已變更，請重載')
  const bytes = new Uint8Array(expected),
    reader = response.body.getReader()
  let offset = 0
  const abort = () => void reader.cancel()
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      if (offset + part.value.length > expected) throw new Error('文件已變更')
      bytes.set(part.value, offset)
      offset += part.value.length
      progress(offset, expected)
    }
    signal.throwIfAborted()
    if (offset !== expected) throw new Error('文件已變更或傳輸中斷')
    return bytes.buffer
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel()
  }
}
