import { Routes, Route, Navigate } from 'react-router-dom'
import { SetupPage } from '../pages/SetupPage'
import { DashboardPage } from '../pages/DashboardPage'
import { MediaPage } from '../pages/MediaPage'
import { MediaDetailPage } from '../pages/MediaDetailPage'
import { TranscriptPage } from '../pages/TranscriptPage'
import { SummaryPage } from '../pages/SummaryPage'
import { TasksPage } from '../pages/TasksPage'
import { IntegrationsPage } from '../pages/IntegrationsPage'
import { SettingsPage } from '../pages/SettingsPage'

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/media" element={<MediaPage />} />
      <Route path="/media/:id" element={<MediaDetailPage />} />
      <Route path="/media/:id/transcript" element={<TranscriptPage />} />
      <Route path="/media/:id/summary" element={<SummaryPage />} />
      <Route path="/media/:id/tasks" element={<TasksPage />} />
      <Route path="/integrations" element={<IntegrationsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  )
}
