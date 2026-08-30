import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED_TABLES, parseCsvText } from './verify-demo-data.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(root, 'public/demo-data')
const datasetRef = 'abhayayare/e-commerce-dataset'
const sourceUrl = `https://www.kaggle.com/datasets/${datasetRef}`
const downloadUrl = `https://www.kaggle.com/api/v1/datasets/download/${datasetRef}`
const metadataUrl = `https://www.kaggle.com/api/v1/datasets/view/${datasetRef}`
const maxBytes = 250 * 1024 * 1024
const expectedFiles = Object.keys(EXPECTED_TABLES).map((table) => `${table}.csv`)
const relationships = [
  { fromTable: 'users', fromColumn: 'user_id', toTable: 'orders', toColumn: 'user_id' },
  { fromTable: 'orders', fromColumn: 'order_id', toTable: 'order_items', toColumn: 'order_id' },
  { fromTable: 'products', fromColumn: 'product_id', toTable: 'order_items', toColumn: 'product_id' },
  { fromTable: 'users', fromColumn: 'user_id', toTable: 'reviews', toColumn: 'user_id' },
  { fromTable: 'products', fromColumn: 'product_id', toTable: 'reviews', toColumn: 'product_id' },
  { fromTable: 'users', fromColumn: 'user_id', toTable: 'events', toColumn: 'user_id' },
  { fromTable: 'products', fromColumn: 'product_id', toTable: 'events', toColumn: 'product_id' }
]

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  return response.json()
}

async function getKaggleMetadata(archiveWasProvided) {
  try {
    const payload = await fetchJson(metadataUrl)
    const creator = typeof payload.creatorName === 'string' ? payload.creatorName : payload.ownerName
    const license = payload.licenseName
    if (typeof creator !== 'string' || typeof license !== 'string') throw new Error('Kaggle metadata omitted creator or license')
    return { creator, license }
  } catch (error) {
    if (!archiveWasProvided) throw new Error(`Kaggle metadata request failed: ${errorMessage(error)}`)
    return { creator: 'Abhay Ayare', license: 'CC BY-SA 4.0' }
  }
}

function validateArchiveEntry(entry) {
  const normalized = entry.replaceAll('\\', '/')
  if (normalized === '' || normalized.endsWith('/')) return null
  if (normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Unsafe ZIP path: ${entry}`)
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '')) throw new Error(`Unsafe ZIP path: ${entry}`)
  const file = posix.basename(normalized)
  if (!expectedFiles.includes(file)) throw new Error(`Unexpected ZIP file: ${entry}`)
  return { entry, file }
}

async function listArchiveEntries(archivePath) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', archivePath], {
    encoding: 'utf8',
    maxBuffer: maxBytes + 1024
  })
  return String(stdout).split(/\r?\n/).filter(Boolean)
}

function normalizeCsv(bytes, file) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${file} is not valid UTF-8`)
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.endsWith('\n')) text += '\n'
  const records = parseCsvText(text)
  const expected = EXPECTED_TABLES[file.slice(0, -4)]
  const headers = records[0] ?? []
  for (const column of expected.requiredColumns) {
    if (!headers.includes(column)) throw new Error(`${file} is missing required column: ${column}`)
  }
  if (records.length < 2) throw new Error(`${file} contains no data rows`)
  return { text, rowCount: records.length - 1 }
}

async function extractCsvFiles(archivePath, tempDir) {
  const entries = await listArchiveEntries(archivePath)
  const selected = new Map()
  for (const entry of entries) {
    const result = validateArchiveEntry(entry)
    if (result === null) continue
    if (selected.has(result.file)) throw new Error(`Duplicate ZIP basename: ${result.file}`)
    selected.set(result.file, result.entry)
  }
  const missing = expectedFiles.filter((file) => !selected.has(file))
  if (missing.length > 0) throw new Error(`ZIP is missing expected tables: ${missing.join(', ')}`)
  if (selected.size !== expectedFiles.length) throw new Error('ZIP must contain exactly six CSV files')

  const tables = {}
  for (const file of expectedFiles) {
    const entry = selected.get(file)
    const { stdout } = await execFileAsync('unzip', ['-p', archivePath, entry], {
      encoding: 'buffer',
      maxBuffer: maxBytes + 1
    })
    const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
    const normalized = normalizeCsv(bytes, file)
    await writeFile(join(tempDir, file), normalized.text, 'utf8')
    tables[file.slice(0, -4)] = normalized.rowCount
  }
  return tables
}

function createMetadata(kaggle, rowCounts) {
  const tableNames = Object.keys(EXPECTED_TABLES)
  const tables = tableNames.map((name) => ({
    name,
    file: `${name}.csv`,
    rowCount: rowCounts[name],
    columns: EXPECTED_TABLES[name].requiredColumns,
    piiClasses: EXPECTED_TABLES[name].piiClasses
  }))
  return {
    sourceUrl,
    datasetRef,
    creator: kaggle.creator,
    attribution: `E-commerce Dataset by ${kaggle.creator} (Kaggle dataset ${datasetRef}), licensed under ${kaggle.license}.`,
    license: kaggle.license,
    retrievalDate: new Date().toISOString().slice(0, 10),
    retrievedAt: new Date().toISOString(),
    tableNames,
    rowCounts,
    tables,
    relationships,
    privacy: {
      synthetic: true,
      piiManifest: Object.fromEntries(tableNames.map((name) => [name, EXPECTED_TABLES[name].piiClasses])),
      rawRowsIncluded: false
    }
  }
}

async function installAtomically(tempDir, metadata) {
  await writeFile(join(tempDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  const backupDir = `${outputDir}.backup-${process.pid}-${Date.now()}`
  let movedExisting = false
  try {
    try {
      await rename(outputDir, backupDir)
      movedExisting = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(tempDir, outputDir)
    if (movedExisting) await rm(backupDir, { recursive: true, force: true })
  } catch (error) {
    if (movedExisting) {
      try { await rename(backupDir, outputDir) } catch {}
    }
    throw error
  }
}

async function downloadArchive(tempDir) {
  const archivePath = join(tempDir, 'dataset.zip')
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw new Error(`Downloaded archive exceeds ${maxBytes} byte limit`)
  await writeFile(archivePath, bytes)
  return archivePath
}

export async function prepareDemoData(archiveArgument = process.argv[2]) {
  const archiveWasProvided = archiveArgument !== undefined
  const metadata = await getKaggleMetadata(archiveWasProvided)
  const archiveTempDir = await mkdtemp(join(root, '.demo-data-download-'))
  const outputTempDir = await mkdtemp(join(dirname(outputDir), '.demo-data-'))
  let archivePath = archiveArgument === undefined ? undefined : resolve(archiveArgument)
  try {
    if (archivePath === undefined) {
      archivePath = await downloadArchive(archiveTempDir)
    } else {
      const archiveStat = await stat(archivePath)
      if (!archiveStat.isFile()) throw new Error(`Archive path is not a file: ${archivePath}`)
    }
    const rowCounts = await extractCsvFiles(archivePath, outputTempDir)
    const manifest = createMetadata(metadata, rowCounts)
    await installAtomically(outputTempDir, manifest)
    return manifest
  } finally {
    await rm(archiveTempDir, { recursive: true, force: true })
    await rm(outputTempDir, { recursive: true, force: true })
  }
}

if (isMain()) {
  try {
    const metadata = await prepareDemoData()
    process.stdout.write(`Prepared ${metadata.tableNames.length} demo tables in ${outputDir}\n`)
  } catch (error) {
    process.stderr.write(`Demo dataset preparation failed: ${errorMessage(error)}\n`)
    if (process.argv[2] === undefined) {
      process.stderr.write(`Download the archive manually, then rerun: npm run prepare:demo-data -- /absolute/path/to/e-commerce-dataset.zip\n`)
    }
    process.exitCode = 1
  }
}
