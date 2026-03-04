import type { CapabilityName } from './types.js'

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityError'
  }
}

export class CapabilityNotFoundError extends CapabilityError {
  constructor(name: CapabilityName) {
    super(`Capability not found: ${name}`)
    this.name = 'CapabilityNotFoundError'
  }
}

export class CapabilityRegistrationError extends CapabilityError {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityRegistrationError'
  }
}
