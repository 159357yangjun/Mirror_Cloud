export const taskQueryKeys = {
  root: ['tasks'] as const,
  list: (limit: number) => ['tasks', limit] as const,
  publishRecent: ['tasks', 'publish-recent'] as const,
}
