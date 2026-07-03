import type { ReactNode } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  Spinner,
} from '@heroui/react'

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
    <main data-theme="dark" className="dark min-h-screen min-w-[1180px] bg-background text-foreground">
      <AppTopBar />
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

const NAV_ITEMS = [
  { label: 'Setup', href: '/setup' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Media', href: '/media' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Settings', href: '/settings' },
]

export function AppTopBar() {
  const location = useLocation()

  return (
    <Navbar
      maxWidth="xl"
      className="mb-8 border-b border-divider bg-background"
      classNames={{ wrapper: 'min-w-[1180px] px-8' }}
    >
      <NavbarBrand>
        <p className="font-semibold">WispLoc</p>
      </NavbarBrand>
      <NavbarContent justify="end">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.href || (item.href !== '/setup' && location.pathname.startsWith(`${item.href}/`))
          return (
            <NavbarItem key={item.href} isActive={active}>
              <Button
                as={RouterLink}
                to={item.href}
                color={active ? 'primary' : 'default'}
                variant={active ? 'flat' : 'light'}
                radius="sm"
              >
                {item.label}
              </Button>
            </NavbarItem>
          )
        })}
      </NavbarContent>
    </Navbar>
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
  return null
}
