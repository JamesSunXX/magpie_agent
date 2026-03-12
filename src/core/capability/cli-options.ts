function toFlagName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`
}

export function serializeCliOptions(options?: Record<string, unknown>): string[] {
  if (!options) return []

  const args: string[] = []
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === false) continue

    const flag = toFlagName(key)
    if (value === true) {
      args.push(flag)
      continue
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue
      args.push(flag, ...value.map((item) => String(item)))
      continue
    }

    args.push(flag, String(value))
  }

  return args
}
