import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { notifyError } from './store/useToastStore'
import './styles.css'

// Mutations that already report their own failure keep that wording; the rest still has to
// reach the user instead of failing silently. Queries have no per-call handler in TanStack v5.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      notifyError(`数据加载失败：${String(error)}`)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (typeof mutation.options.onError === 'function') return
      notifyError(`操作失败：${String(error)}`)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
