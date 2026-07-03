import type { ReactNode } from 'react'
import { Button, Card, CardBody, CardHeader, Chip, Divider, Spinner } from '@heroui/react'

interface PageShellProps {
  title: string
  subtitle?: string
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  width?: 'md' | 'lg' | 'xl'
}

const WIDTH_CLASS = {
  md: 'w-[760px]',
  lg: 'w-[980px]',
  xl: 'w-[1180px]',
}

export function PageShell({ title, subtitle, eyebrow, actions, children, width = 'lg' }: PageShellProps) {
  return (
    <main data-theme="dark" className="dark min-h-screen min-w-[1180px] bg-background text-foreground p-8">
      <div className={`mx-auto ${WIDTH_CLASS[width]}`}>
        <Card radius="sm" className="overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between p-6">
            <div className="space-y-2">
              {eyebrow && <Chip variant="flat" color="primary" radius="sm">{eyebrow}</Chip>}
              <div>
                <h1 className="text-4xl font-bold">{title}</h1>
                {subtitle && <p className="text-default-500">{subtitle}</p>}
              </div>
            </div>
            {actions}
          </CardHeader>
          <Divider />
          <CardBody className="flex flex-col gap-6 p-6">
            {children}
          </CardBody>
        </Card>
      </div>
    </main>
  )
}

export function LoadingPage({ label }: { label: string }) {
  return (
    <PageShell title={label} subtitle="Loading local data" eyebrow="WispLoc">
      <div className="flex min-h-48 items-center justify-center">
        <Spinner size="lg" color="primary" />
      </div>
    </PageShell>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="items-start gap-3 p-6">
        <Chip color="default" variant="flat" radius="sm">Empty</Chip>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-small text-default-500">{description}</p>
        </div>
        {action}
      </CardBody>
    </Card>
  )
}

export function BackButton() {
  return (
    <Button variant="flat" radius="sm" onPress={() => window.history.back()}>
      Back
    </Button>
  )
}
