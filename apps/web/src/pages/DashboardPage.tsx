import { Alert, Button, Card, CardBody, Chip, Divider } from '@heroui/react'
import { PageShell } from './PageShell'

export function DashboardPage() {
  return (
    <PageShell
      title="WispLoc"
      subtitle="Local media processing center"
      eyebrow="Dashboard"
      actions={<Chip color="success" variant="flat" radius="sm">Local only</Chip>}
      width="xl"
    >
      <div className="grid grid-cols-[1fr_360px] gap-6">
        <Card radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-5 p-6">
            <div>
              <h2 className="font-semibold">Current work</h2>
              <p className="text-small text-default-500">Upload media and run local transcription, summary, and task extraction.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ActionButton label="Upload media" href="/media" color="primary" />
              <ActionButton label="Integrations" href="/integrations" />
              <ActionButton label="Settings" href="/settings" />
            </div>
            <Divider />
            <Alert
              color="default"
              variant="flat"
              title="No active processing job"
              description="New uploads will appear here after processing starts."
            />
          </CardBody>
        </Card>

        <Card radius="sm" className="border border-default-100 bg-content2">
          <CardBody className="gap-4 p-6">
            <div>
              <h2 className="font-semibold">Setup health</h2>
              <p className="text-small text-default-500">FFmpeg, whisper.cpp, Ollama, and qwen3:4b are checked in setup.</p>
            </div>
            <Button color="primary" variant="flat" radius="sm" onPress={() => (window.location.href = '/setup')}>
              Open setup
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card radius="sm" className="border border-default-100 bg-content2">
        <CardBody className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Recent media</h2>
              <p className="text-small text-default-500">No recent media files.</p>
            </div>
            <Button variant="flat" radius="sm" onPress={() => (window.location.href = '/media')}>
              View media
            </Button>
          </div>
        </CardBody>
      </Card>
    </PageShell>
  )
}

function ActionButton({ label, href, color }: { label: string; href: string; color?: 'primary' }) {
  return (
    <Button color={color} variant={color ? 'solid' : 'flat'} radius="sm" onPress={() => (window.location.href = href)}>
      {label}
    </Button>
  )
}
