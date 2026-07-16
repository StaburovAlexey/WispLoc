import { Routes, Route, Navigate } from 'react-router-dom'
import { SetupPage } from '../pages/SetupPage'
import { MediaPage } from '../pages/MediaPage'
import { MediaDetailPage } from '../pages/MediaDetailPage'
import { TranscriptPage } from '../pages/TranscriptPage'
import { SummaryPage } from '../pages/SummaryPage'
import { TasksPage } from '../pages/TasksPage'
import { IntegrationsPage } from '../pages/IntegrationsPage'
import { SettingsPage } from '../pages/SettingsPage'
import { DictionaryPage } from '../pages/DictionaryPage'
import { TermSuggestionsPage } from '../pages/TermSuggestionsPage'
import { FactsPage } from '../pages/FactsPage'

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/media" element={<MediaPage />} />
      <Route path="/media/:id" element={<MediaDetailPage />} />
      <Route path="/media/:id/transcript" element={<TranscriptPage />} />
      <Route path="/media/:id/summary" element={<SummaryPage />} />
      <Route path="/media/:id/tasks" element={<TasksPage />} />
      <Route path="/media/:id/terms" element={<TermSuggestionsPage />} />
      <Route path="/media/:id/facts" element={<FactsPage />} />
      <Route path="/dictionary" element={<DictionaryPage />} />
      <Route path="/integrations" element={<IntegrationsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  )
}
