export const FIELD_PROPS = {
  variant: 'faded',
  labelPlacement: 'outside',
  radius: 'sm',
} as const

export const TEXT_FIELD_PROPS = {
  ...FIELD_PROPS,
  classNames: {
    input: '!outline-none focus:!outline-none focus-visible:!outline-none',
    inputWrapper: 'group-data-[focus-visible=true]:!ring-0 group-data-[focus-visible=true]:!ring-offset-0',
  },
} as const
