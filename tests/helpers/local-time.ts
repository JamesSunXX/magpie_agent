function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export function formatExpectedLocalDateTime(value: Date | string): string {
  const date = toDate(value)
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function formatExpectedLocalDateTimeShort(value: Date | string): string {
  return formatExpectedLocalDateTime(value).slice(0, 16)
}

export function formatExpectedLocalDate(value: Date | string): string {
  return formatExpectedLocalDateTime(value).slice(0, 10)
}
