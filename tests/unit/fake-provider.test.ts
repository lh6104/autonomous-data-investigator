import { describe, expect, it } from 'vitest'
import { createFakeAnalystProvider } from '@/ai/fake-provider'

describe('fake provider', () => { it('captures calls', () => { expect(createFakeAnalystProvider().calls).toEqual([]) }) })
