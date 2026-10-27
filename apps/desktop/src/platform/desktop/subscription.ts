type Unlisten = () => void

/** Owns a native subscription whose cleanup may arrive after the React owner left. */
export function manageDesktopSubscription(
  subscribe: () => Promise<Unlisten>,
  onError?: (error: unknown) => void,
): Unlisten {
  let disposed = false
  let unlisten: Unlisten | undefined
  let registration: Promise<Unlisten>
  try {
    registration = subscribe()
  } catch (error) {
    registration = Promise.reject(error)
  }
  void registration.then((cleanup) => {
    if (disposed) cleanup()
    else unlisten = cleanup
  }).catch((error: unknown) => {
    if (!disposed) onError?.(error)
  })
  return () => {
    if (disposed) return
    disposed = true
    const cleanup = unlisten
    unlisten = undefined
    cleanup?.()
  }
}
