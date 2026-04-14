import { describe, expect, it } from 'vitest'
import { formatLocalDate, formatLocalDateTime, formatLocalDateTimeShort } from '../../../src/shared/utils/time.js'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function expectedLocalDateTime(value: string): string {
  const date = new Date(value)
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ')
}

describe('time display helpers', () => {
  it('formats a UTC timestamp in local time', () => {
    const input = '2026-04-11T00:00:07.000Z'

    expect(formatLocalDateTime(input)).toBe(expectedLocalDateTime(input))
    expect(formatLocalDateTimeShort(input)).toBe(expectedLocalDateTime(input).slice(0, 16))
    expect(formatLocalDate(input)).toBe(expectedLocalDateTime(input).slice(0, 10))
  })

  it('leaves invalid input untouched', () => {
    expect(formatLocalDateTime('not-a-date')).toBe('not-a-date')
  })
})
