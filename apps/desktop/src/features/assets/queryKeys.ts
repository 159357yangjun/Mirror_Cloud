export const assetQueryKeys = {
  root: ['assets'] as const,
  list: (limit: number) => ['assets', limit] as const,
  publishRecent: ['assets', 'publish-recent'] as const,
}
