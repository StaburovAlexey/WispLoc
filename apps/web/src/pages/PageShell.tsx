import type { ReactNode } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
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
  Select,
  SelectItem,
  Spinner,
} from '@heroui/react'
import { useI18n } from '../shared/i18n'

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
  { labelKey: 'nav.setup', href: '/setup' },
  { labelKey: 'nav.media', href: '/media' },
  { labelKey: 'nav.dictionary', href: '/dictionary' },
  { labelKey: 'nav.knowledge', href: '/knowledge' },
  { labelKey: 'nav.integrations', href: '/integrations' },
  { labelKey: 'nav.settings', href: '/settings' },
] as const

export function AppTopBar() {
  const location = useLocation()
  const { language, setLanguage, t } = useI18n()

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
                {t(item.labelKey)}
              </Button>
            </NavbarItem>
          )
        })}
        <NavbarItem>
          <Select
            aria-label={t('language.label')}
            size="sm"
            radius="sm"
            variant="faded"
            selectedKeys={[language]}
            className="w-24"
            onSelectionChange={(keys) => {
              const nextLanguage = String(Array.from(keys)[0] ?? 'ru')
              if (nextLanguage === 'ru' || nextLanguage === 'en') setLanguage(nextLanguage)
            }}
          >
            <SelectItem key="ru">{t('language.ru')}</SelectItem>
            <SelectItem key="en">{t('language.en')}</SelectItem>
          </Select>
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  )
}

export function LoadingPage({ label }: { label: string }) {
  const { t } = useI18n()

  return (
    <PageShell title={label} subtitle={t('common.loadingLocalData')} eyebrow="WispLoc">
      <div className="flex min-h-48 items-center justify-center">
        <Spinner size="lg" color="primary" />
      </div>
    </PageShell>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  const { t } = useI18n()

  return (
    <Card radius="sm" className="border border-default-100 bg-content2">
      <CardBody className="items-start gap-3 p-6">
        <Chip color="default" variant="flat" radius="sm">{t('common.empty')}</Chip>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-small text-default-500">{description}</p>
        </div>
        {action}
      </CardBody>
    </Card>
  )
}

export function BackButton({ fallback = '/media' }: { fallback?: string }) {
  const navigate = useNavigate()
  const { t } = useI18n()

  return (
    <Button
      variant="flat"
      radius="sm"
      onPress={() => {
        if (window.history.length > 1) {
          navigate(-1)
        } else {
          navigate(fallback)
        }
      }}
    >
      {t('common.back')}
    </Button>
  )
}
