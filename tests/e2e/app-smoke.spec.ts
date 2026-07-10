import { expect, test } from '@playwright/test'

test('serves setup UI and local API from production server', async ({ page, request }) => {
  const health = await request.get('/api/health')
  await expect(health).toBeOK()
  await expect(await health.json()).toMatchObject({ status: 'ok' })

  const setupStatus = await request.get('/api/setup/status')
  await expect(setupStatus).toBeOK()
  await expect(await setupStatus.json()).toMatchObject({
    setupCompleted: false,
    status: 'IDLE',
  })

  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: 'WispLoc' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Install all required components|Установить все необходимые компоненты/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Setup log|Лог установки/i })).toBeVisible()

  await page.goto('/dashboard')
  await expect(page.getByRole('navigation').getByText('WispLoc')).toBeVisible()
  await expect(page.getByRole('button', { name: /Setup|Установка/i })).toBeVisible()

  await page.goto('/media/non-existent/transcript')
  await expect(page.getByRole('navigation').getByText('WispLoc')).toBeVisible()
})
