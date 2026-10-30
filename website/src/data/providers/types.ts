export interface SetupField {
  label: string
  requirement: string
  source: string
  path: string
  fill: string
  example: string
  mistake: string
  href: string
  step: string
}
export interface ProviderGuide {
  title: string
  prepare: string
  links: readonly { label: string; href: string }[]
  fields: readonly SetupField[]
}
