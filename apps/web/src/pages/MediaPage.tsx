import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, CardBody, Chip, Progress, Spinner } from '@heroui/react'
import type { JobProgressEvent, MediaFileDto } from '@wisploc/shared'
import { EmptyState, PageShell } from './PageShell'

export function MediaPage() {
  const [files, setFiles] = useState<MediaFileDto[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState(0)
  const [jobStep, setJobStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/media')
      setFiles(await res.json())
    } catch {}
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  useEffect(() => {
    if (!activeJobId) return
    const es = new EventSource(`/api/jobs/${activeJobId}/events`)
    es.onmessage = (e) => {
      try {
        const evt: JobProgressEvent = JSON.parse(e.data)
        setJobProgress(evt.progress)
        setJobStep(evt.currentStep ?? null)
        if (evt.status === 'DONE' || evt.status === 'FAILED' || evt.status === 'CANCELLED') {
          setActiveJobId(null)
          loadFiles()
          if (evt.status === 'FAILED') setError(evt.error ?? 'Processing failed')
        }
      } catch {}
    }
    return () => es.close()
  }, [activeJobId, loadFiles])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadProgress(0)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) setUploadProgress(Math.round((evt.loaded / evt.total) * 100))
      }
      await new Promise<void>((resolve, reject) => {
        xhr.open('POST', '/api/media/upload')
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`))
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.send(formData)
      })
      setUploading(false)
      setUploadProgress(0)
      loadFiles()
    } catch (err: any) {
      setError(err.message)
      setUploading(false)
    }
  }

  const handleProcess = async (id: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/media/${id}/process`, { method: 'POST' })
      const data = await res.json()
      setActiveJobId(data.jobId)
      setJobProgress(0)
      setJobStep(null)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/media/${id}`, { method: 'DELETE' })
    loadFiles()
  }

  return (
    <PageShell title="Media" subtitle="Upload video or audio files for local processing" eyebrow="Library" width="xl">
      {error && <Alert color="danger" variant="flat" title="Media error" description={error} />}

      <Card radius="sm" className="border border-default-100 bg-content2">
        <CardBody className="gap-4 p-6">
          <label className="block cursor-pointer rounded-small border border-dashed border-default-300 bg-content1 p-8 text-center data-[disabled=true]:cursor-not-allowed">
            <input type="file" accept="audio/*,video/*" onChange={handleUpload} disabled={uploading} className="hidden" />
            {uploading ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <Spinner size="sm" color="primary" />
                  <span className="font-medium">Uploading {uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} color="primary" radius="sm" />
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold">Click to upload</p>
                <p className="text-small text-default-500">Supported: MP3, WAV, MP4, WebM, MKV, MOV, and more</p>
              </div>
            )}
          </label>
        </CardBody>
      </Card>

      {activeJobId && (
        <Alert
          color="primary"
          variant="flat"
          title={`Processing ${jobProgress}%`}
          description={jobStep?.replace(/_/g, ' ') ?? 'Starting local worker job'}
          icon={<Spinner size="sm" color="primary" />}
          endContent={<Progress aria-label="Processing progress" value={jobProgress} color="primary" radius="sm" className="w-48" />}
        />
      )}

      {files.length === 0 ? (
        <EmptyState title="No files yet" description="Uploaded media files will appear here." />
      ) : (
        <div className="grid gap-3">
          {files.map((file) => (
            <Card key={file.id} radius="sm" className="border border-default-100 bg-content2">
              <CardBody className="flex flex-row items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{file.originalName}</p>
                  <p className="text-small text-default-500">
                    {formatSize(file.sizeBytes)} · {formatDuration(file.durationSec)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Chip color={statusColor(file.status)} variant="flat" radius="sm">{file.status}</Chip>
                  <Button size="sm" variant="flat" radius="sm" onPress={() => (window.location.href = `/media/${file.id}`)}>Open</Button>
                  <Button size="sm" color="primary" variant="flat" radius="sm" onPress={() => handleProcess(file.id)}>Process</Button>
                  <Button size="sm" color="danger" variant="flat" radius="sm" onPress={() => handleDelete(file.id)}>Delete</Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(sec: number | null) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function statusColor(status: string): 'default' | 'primary' | 'success' | 'danger' | 'warning' {
  if (status === 'DONE') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'default'
  if (status === 'UPLOADED') return 'default'
  return 'primary'
}
