import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInsideDirectory, validateUpload } from '../apps/api/src/routes/media'

describe('media route guards', () => {
  it('accepts supported audio and video uploads', () => {
    expect(validateUpload('meeting.mp4', 'video/mp4')).toBeNull()
    expect(validateUpload('call.wav', 'audio/wav')).toBeNull()
    expect(validateUpload('recording.mkv', 'application/octet-stream')).toBeNull()
  })

  it('rejects unsupported upload formats', () => {
    expect(validateUpload('payload.exe', 'application/octet-stream')).toBe('Unsupported media format')
    expect(validateUpload('notes.txt', 'text/plain')).toBe('Unsupported media format')
  })

  it('keeps delete operations inside uploads directory', () => {
    const root = path.resolve('/tmp/wisploc/uploads')

    expect(isInsideDirectory(path.join(root, 'file.mp4'), root)).toBe(true)
    expect(isInsideDirectory(path.join(root, 'nested/file.mp4'), root)).toBe(true)
    expect(isInsideDirectory(path.resolve(root, '../outside.mp4'), root)).toBe(false)
    expect(isInsideDirectory('/etc/passwd', root)).toBe(false)
  })
})
