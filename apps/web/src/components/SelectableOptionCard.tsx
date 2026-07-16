import type { ReactNode } from 'react'
import { Alert, Button, Card, CardBody } from '@heroui/react'

interface SelectableOptionCardProps {
  title: string
  subtitle?: string
  description: string
  selected: boolean
  statusTitle: string
  statusColor: 'default' | 'success' | 'warning' | 'primary'
  showStatus?: boolean
  actionLabel: string
  actionDisabled?: boolean
  actionLoading?: boolean
  onAction: () => void
  extra?: ReactNode
}

export function SelectableOptionCard({
  title, subtitle, description, selected, statusTitle, statusColor,
  actionLabel, actionDisabled, actionLoading, onAction, extra, showStatus = true,
}: SelectableOptionCardProps) {
  return (
    <Card radius="sm" className={selected ? 'h-full border border-primary bg-content2' : 'h-full border border-default-100 bg-content2'}>
      <CardBody className="flex h-full flex-col gap-3 p-4">
        <div>
          <p className="font-medium">{title}</p>
          {subtitle && <p className="text-small text-default-500">{subtitle}</p>}
        </div>
        <p className="min-h-10 flex-1 text-small text-default-500">{description}</p>
        {extra}
        {showStatus && <Alert className="!flex-none h-12 min-h-12" color={statusColor} variant="flat" title={statusTitle} />}
        <Button
          className="mt-auto"
          color={selected ? 'primary' : 'default'}
          variant={selected ? 'solid' : 'flat'}
          radius="sm"
          isDisabled={actionDisabled ?? selected}
          isLoading={actionLoading}
          onPress={onAction}
        >
          {actionLabel}
        </Button>
      </CardBody>
    </Card>
  )
}
