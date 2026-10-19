/**
 * Development-only R2 UI fixture.
 * The Tauri bridge is local, simulated, and rejects every operation; it cannot
 * reach Cloudflare, create a token, or write an object. Never ship as a Tauri UI route.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StorageSetupDialog } from './components/StorageSetupDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ToastViewport } from './components/ToastViewport'
import { notifyError } from './store/useToastStore'
import './styles.css'

declare global {
  interface Window { __R2_QA_INVOKES?: string[]; __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<never> } }
}

window.__R2_QA_INVOKES = []
// This secret-like sentinel is in memory only, never a real user credential.
const SECRET_SENTINEL = 'QA-SECRET-DO-NOT-RENDER-7b83'
window.__TAURI_INTERNALS__ = {
  invoke: async (command: string) => {
    window.__R2_QA_INVOKES?.push(command)
    throw new Error(`AccessDenied simulated token=${SECRET_SENTINEL} https://example.invalid/?X-Amz-Signature=${SECRET_SENTINEL}`)
  },
}

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (typeof mutation.options.onError === 'function') return
      // Use the exact production global error behaviour: unhandled provider errors leak here.
      notifyError(`操作失败：${String(error)}`)
    },
  }),
  defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
})

function Fixture() {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <h1 className="text-lg font-semibold">R2 QA only — local simulated backend</h1>
      <button type="button" id="r2-qa-open" onClick={() => setOpen(true)}
        className="mt-4 min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm">
        打开 R2 配置向导
      </button>
      {open && <StorageSetupDialog provider="r2" onClose={() => setOpen(false)} />}
      <ToastViewport />
      <ConfirmDialog />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Fixture />
    </QueryClientProvider>
  </StrictMode>,
)
