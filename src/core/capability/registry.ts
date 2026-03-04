import { CapabilityNotFoundError, CapabilityRegistrationError } from './errors.js'
import type { AnyCapabilityModule, CapabilityModule, CapabilityName } from './types.js'

export interface CapabilityRegistry {
  register(module: AnyCapabilityModule): void
  get(name: CapabilityName): AnyCapabilityModule
  has(name: CapabilityName): boolean
  list(): CapabilityName[]
}

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly modules = new Map<CapabilityName, AnyCapabilityModule>()

  register(module: AnyCapabilityModule): void {
    if (!module?.name) {
      throw new CapabilityRegistrationError('Capability module name is required')
    }

    if (this.modules.has(module.name)) {
      throw new CapabilityRegistrationError(`Capability already registered: ${module.name}`)
    }

    this.modules.set(module.name, module)
  }

  get(name: CapabilityName): AnyCapabilityModule {
    const module = this.modules.get(name)
    if (!module) {
      throw new CapabilityNotFoundError(name)
    }
    return module
  }

  has(name: CapabilityName): boolean {
    return this.modules.has(name)
  }

  list(): CapabilityName[] {
    return [...this.modules.keys()]
  }
}

export function createCapabilityRegistry(modules: AnyCapabilityModule[] = []): CapabilityRegistry {
  const registry = new InMemoryCapabilityRegistry()
  for (const module of modules) {
    registry.register(module)
  }
  return registry
}

export function getTypedCapability<TInput, TPrepared, TResult, TOutput>(
  registry: CapabilityRegistry,
  name: CapabilityName
): CapabilityModule<TInput, TPrepared, TResult, TOutput> {
  return registry.get(name) as CapabilityModule<TInput, TPrepared, TResult, TOutput>
}
