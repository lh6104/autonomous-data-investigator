import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = resolve(root, 'node_modules/@duckdb/duckdb-wasm/dist')
const destinationDir = resolve(root, 'public/duckdb')
const assets = ['duckdb-mvp.wasm', 'duckdb-browser-mvp.worker.js']

await mkdir(destinationDir, { recursive: true })
for (const asset of assets) {
  const source = resolve(sourceDir, asset)
  try {
    await stat(source)
  } catch {
    throw new Error(`DuckDB asset missing: ${source}. Install @duckdb/duckdb-wasm@1.32.0 before preparing local assets.`)
  }
  await copyFile(source, resolve(destinationDir, asset))
}

process.stdout.write(`Copied ${assets.length} DuckDB assets to ${destinationDir}\n`)
