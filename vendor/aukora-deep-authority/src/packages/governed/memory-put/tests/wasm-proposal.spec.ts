/** Product-route consumption of the pinned proposal-only WebAssembly cell. */
import { describe, expect, it } from 'vitest'
import { canonicalJSON } from '@aukora/core/kernel-seed/canonical-json.mjs'
import { MEMORY_PUT_PROPOSAL_WASM_SHA256 } from '@aukora/core/guest/wasm-proposal-cell.mjs'
import {
  consumeMemoryPutCellProposal,
  proposeMemoryPutThroughCell,
} from '../src/wasm-proposal.ts'

const executing = {
  key: 'wasm-product-route',
  value: { nested: ['detached', 37], exact: true },
}
const proposal = {
  toolName: 'memory.put',
  argumentsJson: canonicalJSON(executing),
  moduleSha256: MEMORY_PUT_PROPOSAL_WASM_SHA256,
}

describe('product WebAssembly proposal route', () => {
  it('runs the pinned cell and returns only a detached exact argument snapshot', () => {
    const detached = proposeMemoryPutThroughCell(executing, executing)

    expect(detached).toEqual(executing)
    expect(detached).not.toBe(executing)
    expect(detached.value).not.toBe(executing.value)
    expect(Reflect.ownKeys(detached)).toEqual(['key', 'value'])
  })

  it.each([
    ['proposal rider', { ...proposal, rider: true }, executing, executing, 'proposal-fields-not-exact'],
    ['wrong tool', { ...proposal, toolName: 'memory.get' }, executing, executing, 'tool-name-mismatch'],
    ['wrong module', { ...proposal, moduleSha256: '0'.repeat(64) }, executing, executing, 'module-digest-mismatch'],
    ['invalid JSON', { ...proposal, argumentsJson: '{' }, executing, executing, 'arguments-json-invalid'],
    [
      'argument rider',
      { ...proposal, argumentsJson: '{"key":"wasm-product-route","rider":true,"value":null}' },
      executing,
      executing,
      'arguments-not-exact',
    ],
    [
      'noncanonical arguments',
      { ...proposal, argumentsJson: '{"value":{"exact":true,"nested":["detached",37]},"key":"wasm-product-route"}' },
      executing,
      executing,
      'arguments-json-not-canonical',
    ],
    [
      'changed execution',
      proposal,
      { key: 'wasm-product-route', value: { exact: false } },
      executing,
      'arguments-binding-mismatch',
    ],
    [
      'changed review',
      proposal,
      executing,
      { key: 'wasm-product-route', value: { exact: false } },
      'arguments-binding-mismatch',
    ],
  ])('refuses %s from the cell output', (_label, output, current, reviewed, reason) => {
    expect(() => consumeMemoryPutCellProposal(output, current, reviewed)).toThrow(reason)
  })

  it.each([
    ['a primitive', 'proposal'],
    ['null', null],
    ['an array', []],
    ['an accessor', Object.defineProperty({ ...proposal }, 'toolName', {
      enumerable: true,
      get: () => 'memory.put',
    })],
    ['a non-enumerable field', Object.defineProperty({ ...proposal }, 'toolName', {
      enumerable: false,
      value: 'memory.put',
    })],
    ['a missing field hidden by a rider', {
      argumentsJson: proposal.argumentsJson,
      moduleSha256: proposal.moduleSha256,
      rider: true,
    }],
    ['a symbol rider', { ...proposal, [Symbol('rider')]: true }],
    ['a custom prototype', Object.assign(Object.create({ inherited: true }) as object, proposal)],
    ['a missing descriptor', new Proxy(proposal, {
      getOwnPropertyDescriptor: (target, field) => field === 'toolName'
        ? undefined
        : Reflect.getOwnPropertyDescriptor(target, field),
    })],
    ['a hostile proxy', new Proxy(proposal, {
      ownKeys: () => { throw new Error('proxy trap') },
    })],
  ])('refuses %s before observing proposal values', (_label, output) => {
    expect(() => consumeMemoryPutCellProposal(output, executing, executing))
      .toThrow('proposal-fields-not-exact')
  })

  it.each([
    ['arguments JSON', { ...proposal, argumentsJson: 37 }],
    ['module digest', { ...proposal, moduleSha256: 37 }],
    ['tool name', { ...proposal, toolName: 37 }],
  ])('refuses a non-string %s', (_label, output) => {
    expect(() => consumeMemoryPutCellProposal(output, executing, executing))
      .toThrow('proposal-fields-not-exact')
  })

  it('accepts a null-prototype wire record and returns ordinary detached data', () => {
    const output = Object.assign(Object.create(null) as object, proposal)

    const detached = consumeMemoryPutCellProposal(output, executing, executing)

    expect(detached).toEqual(executing)
    expect(Object.getPrototypeOf(detached)).toBe(Object.prototype)
  })

  it('refuses a path-like key after decoding the cell proposal', () => {
    const pathLike = {
      ...proposal,
      argumentsJson: canonicalJSON({ key: '../issuer.pem', value: null }),
    }

    expect(() => consumeMemoryPutCellProposal(pathLike, executing, executing))
      .toThrow('key-not-a-name')
  })
})
