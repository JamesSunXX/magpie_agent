function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatParts(date: Date) {
  return {
    year: date.getFullYear(),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hours: pad(date.getHours()),
    minutes: pad(date.getMinutes()),
    seconds: pad(date.getSeconds()),
  }
}

export function formatLocalDateTime(value: Date | string): string {
  const date = toDate(value)
  if (!date) return String(value)

  const parts = formatParts(date)
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hours}:${parts.minutes}:${parts.seconds}`
}

export function formatLocalDateTimeShort(value: Date | string): string {
  return formatLocalDateTime(value).slice(0, 16)
}

export function formatLocalDate(value: Date | string): string {
  return formatLocalDateTime(value).slice(0, 10)
}
