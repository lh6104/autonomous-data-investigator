import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const dataDir = resolve(root, 'public/demo-data')
const verifier = resolve(root, 'scripts/verify-demo-data.mjs')

async function readMetadata() {
  return JSON.parse(await readFile(resolve(dataDir, 'metadata.json'), 'utf8'))
}

describe('prepared demo data', () => {
  it('contains stable attribution, license, schema, and PII manifest', async () => {
    const metadata = await readMetadata()
    expect(metadata).toMatchObject({
      datasetRef: 'abhayayare/e-commerce-dataset',
      creator: 'Abhay Ayare',
      license: 'CC BY-SA 4.0',
      tableNames: ['users', 'products', 'orders', 'order_items', 'reviews', 'events']
    })
    expect(metadata.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'users',
        piiClasses: expect.objectContaining({ name: 'quasi', email: 'direct' })
      })
    ]))
    const serialized = JSON.stringify(metadata)
    expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)
    expect(serialized).not.toContain('Synthetic User')
    expect(serialized).not.toContain('Another User')
    expect(metadata.privacy).toMatchObject({ synthetic: true, rawRowsIncluded: false })
  })

  it('passes the offline verifier without network access', () => {
    const output = execFileSync(process.execPath, [verifier], { cwd: root, encoding: 'utf8' })
    expect(output).toMatch(/Demo data verified: 6 tables, \d+ rows, \d+ bytes/)
  })
})
