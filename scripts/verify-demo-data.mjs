import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultDataDir = resolve(root, 'public/demo-data')
export const MAX_BYTES = 250 * 1024 * 1024
export const MAX_ROWS = 2_000_000

export const EXPECTED_TABLES = Object.freeze({
  users: {
    requiredColumns: ['user_id', 'name', 'email', 'gender', 'city', 'signup_date'],
    primaryKey: 'user_id',
    piiClasses: { user_id: 'identifier', name: 'quasi', email: 'direct', gender: 'quasi', city: 'quasi', signup_date: 'none' }
  },
  products: {
    requiredColumns: ['product_id', 'product_name', 'category', 'price', 'rating'],
    primaryKey: 'product_id',
    piiClasses: { product_id: 'identifier', product_name: 'none', category: 'none', price: 'none', rating: 'none' }
  },
  orders: {
    requiredColumns: ['order_id', 'user_id', 'order_date', 'order_status', 'total_amount'],
    primaryKey: 'order_id',
    piiClasses: { order_id: 'identifier', user_id: 'identifier', order_date: 'none', order_status: 'none', total_amount: 'none' }
  },
  order_items: {
    requiredColumns: ['order_item_id', 'order_id', 'product_id', 'quantity', 'item_price'],
    primaryKey: 'order_item_id',
    piiClasses: { order_item_id: 'identifier', order_id: 'identifier', product_id: 'identifier', quantity: 'none', item_price: 'none' }
  },
  reviews: {
    requiredColumns: ['review_id', 'user_id', 'product_id', 'rating', 'review_text', 'review_date'],
    primaryKey: 'review_id',
    piiClasses: { review_id: 'identifier', user_id: 'identifier', product_id: 'identifier', rating: 'none', review_text: 'none', review_date: 'none' }
  },
  events: {
    requiredColumns: ['event_id', 'user_id', 'product_id', 'event_type', 'event_timestamp'],
    primaryKey: 'event_id',
    piiClasses: { event_id: 'identifier', user_id: 'identifier', product_id: 'identifier', event_type: 'none', event_timestamp: 'none' }
  }
})

export const RELATIONSHIPS = Object.freeze([
  { fromTable: 'users', fromColumn: 'user_id', toTable: 'orders', toColumn: 'user_id' },
  { fromTable: 'orders', fromColumn: 'order_id', toTable: 'order_items', toColumn: 'order_id' },
  { fromTable: 'products', fromColumn: 'product_id', toTable: 'order_items', toColumn: 'product_id' },
  { fromTable: 'users', fromColumn: 'user_id', toTable: 'reviews', toColumn: 'user_id' },
  { fromTable: 'products', fromColumn: 'product_id', toTable: 'reviews', toColumn: 'product_id' },
  { fromTable: 'users', fromColumn: 'user_id', toTable: 'events', toColumn: 'user_id' },
  { fromTable: 'products', fromColumn: 'product_id', toTable: 'events', toColumn: 'product_id' }
])

const numericColumns = Object.freeze({
  products: ['price', 'rating'],
  orders: ['total_amount'],
  order_items: ['quantity', 'item_price'],
  reviews: ['rating']
})
const allowedOrderStatuses = new Set(['completed', 'cancelled', 'returned', 'processing', 'shipped'])

function valueOf(value) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function isBlankRow(record) {
  return record.length === 1 && valueOf(record[0]) === ''
}

export function parseCsvText(input) {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const records = []
  let record = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (quoted || field.length === 0) {
        quoted = !quoted
      } else {
        field += character
      }
    } else if (character === ',' && !quoted) {
      record.push(field)
      field = ''
    } else if (character === '\n' && !quoted) {
      record.push(field)
      if (!isBlankRow(record)) records.push(record)
      record = []
      field = ''
    } else {
      field += character
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  if (field.length > 0 || record.length > 0) {
    record.push(field)
    if (!isBlankRow(record)) records.push(record)
  }
  return records
}

export async function readCsvFile(filePath) {
  const records = parseCsvText(await readFile(filePath, 'utf8'))
  if (records.length === 0) throw new Error('CSV is empty')
  const headers = records[0]
  const uniqueHeaders = new Set(headers)
  if (uniqueHeaders.size !== headers.length) throw new Error('CSV contains duplicate headers')
  const rows = []
  for (const record of records.slice(1)) {
    if (record.length !== headers.length) throw new Error(`CSV row has ${record.length} fields; expected ${headers.length}`)
    rows.push(Object.fromEntries(headers.map((header, index) => [header, record[index]])))
  }
  return { headers, rows }
}

function addError(errors, message) {
  errors.push(message)
}

function validateMetadata(metadata, tables, errors) {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    addError(errors, 'metadata.json must contain an object')
    return
  }
  if (metadata.datasetRef !== 'abhayayare/e-commerce-dataset') addError(errors, 'metadata.datasetRef is incorrect')
  if (metadata.creator !== 'Abhay Ayare') addError(errors, 'metadata.creator must be Abhay Ayare')
  if (metadata.license !== 'CC BY-SA 4.0') addError(errors, 'metadata.license must be CC BY-SA 4.0')
  if (typeof metadata.sourceUrl !== 'string' || !metadata.sourceUrl.includes('kaggle.com')) addError(errors, 'metadata.sourceUrl must identify Kaggle')
  if (typeof metadata.attribution !== 'string' || !metadata.attribution.includes('Abhay Ayare')) addError(errors, 'metadata.attribution is missing creator credit')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(metadata.retrievalDate ?? ''))) addError(errors, 'metadata.retrievalDate must be an ISO date')

  const names = Array.isArray(metadata.tables) ? metadata.tables.map((table) => table?.name) : []
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(EXPECTED_TABLES))) addError(errors, 'metadata.tables must list the six expected tables in order')
  const tableByName = new Map(Array.isArray(metadata.tables) ? metadata.tables.map((table) => [table?.name, table]) : [])
  for (const [name, spec] of Object.entries(EXPECTED_TABLES)) {
    const table = tableByName.get(name)
    if (table === undefined) {
      addError(errors, `metadata is missing table: ${name}`)
      continue
    }
    if (table.file !== `${name}.csv`) addError(errors, `metadata file mismatch for ${name}`)
    if (!Number.isInteger(table.rowCount) || table.rowCount !== tables[name]?.rows.length) addError(errors, `metadata row count mismatch for ${name}`)
    if (JSON.stringify(table.columns) !== JSON.stringify(spec.requiredColumns)) addError(errors, `metadata columns mismatch for ${name}`)
    if (JSON.stringify(table.piiClasses) !== JSON.stringify(spec.piiClasses)) addError(errors, `metadata PII manifest mismatch for ${name}`)
  }
  if (metadata.rawRowsIncluded === true || metadata.samples !== undefined || metadata.sampleRows !== undefined) addError(errors, 'metadata must not include raw row samples')
  const serialized = JSON.stringify(metadata)
  if (/@[^\s"']+\.[^\s"']+/.test(serialized)) addError(errors, 'metadata must not contain email-shaped values')
}

function validateHeaders(name, headers, errors) {
  const spec = EXPECTED_TABLES[name]
  for (const column of spec.requiredColumns) {
    if (!headers.includes(column)) addError(errors, `${name}.csv is missing required column: ${column}`)
  }
}

function validatePrimaryKey(name, table, errors) {
  const key = EXPECTED_TABLES[name].primaryKey
  const seen = new Set()
  for (let index = 0; index < table.rows.length; index += 1) {
    const value = valueOf(table.rows[index][key])
    if (value === '') addError(errors, `${name}.${key} contains an empty value at row ${index + 2}`)
    else if (seen.has(value)) addError(errors, `${name}.${key} contains duplicate value: ${value}`)
    else seen.add(value)
  }
}

function validateNumeric(name, table, errors) {
  for (const column of numericColumns[name] ?? []) {
    for (let index = 0; index < table.rows.length; index += 1) {
      const raw = valueOf(table.rows[index][column])
      const number = Number(raw)
      if (raw === '' || !Number.isFinite(number)) addError(errors, `${name}.${column} contains a non-numeric value at row ${index + 2}`)
    }
  }
}

function validateRelationships(tables, errors) {
  return RELATIONSHIPS.map((relationship) => {
    const parentRows = tables[relationship.fromTable]?.rows ?? []
    const childRows = tables[relationship.toTable]?.rows ?? []
    const parentValues = new Set(parentRows.map((row) => valueOf(row[relationship.fromColumn])).filter(Boolean))
    let referenced = 0
    let matched = 0
    for (const row of childRows) {
      const value = valueOf(row[relationship.toColumn])
      if (value === '') continue
      referenced += 1
      if (parentValues.has(value)) matched += 1
    }
    const matchRate = referenced === 0 ? 1 : matched / referenced
    if (matchRate !== 1) addError(errors, `${relationship.fromTable}.${relationship.fromColumn} → ${relationship.toTable}.${relationship.toColumn} match rate is ${matchRate}`)
    return { ...relationship, referenced, matched, matchRate }
  })
}

export async function verifyDemoData(directory = defaultDataDir) {
  const errors = []
  const tables = {}
  let totalBytes = 0
  let totalRows = 0

  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const allowedFiles = new Set([...Object.keys(EXPECTED_TABLES).map((name) => `${name}.csv`), 'metadata.json'])
    for (const entry of entries) {
      if (!allowedFiles.has(entry.name)) addError(errors, `unexpected file in demo-data: ${entry.name}`)
      if (!entry.isFile() && allowedFiles.has(entry.name)) addError(errors, `demo-data entry is not a regular file: ${entry.name}`)
    }
  } catch (error) {
    addError(errors, `cannot read demo-data directory: ${error instanceof Error ? error.message : String(error)}`)
  }

  for (const [name, spec] of Object.entries(EXPECTED_TABLES)) {
    const filePath = join(directory, `${name}.csv`)
    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) throw new Error('not a regular file')
      totalBytes += fileStat.size
      const table = await readCsvFile(filePath)
      validateHeaders(name, table.headers, errors)
      if (table.rows.length === 0) addError(errors, `${name}.csv contains no data rows`)
      validatePrimaryKey(name, table, errors)
      validateNumeric(name, table, errors)
      if (name === 'orders') {
        for (let index = 0; index < table.rows.length; index += 1) {
          const status = valueOf(table.rows[index].order_status)
          if (!allowedOrderStatuses.has(status.toLowerCase())) addError(errors, `orders.order_status has invalid value at row ${index + 2}: ${status}`)
        }
      }
      tables[name] = table
      totalRows += table.rows.length
    } catch (error) {
      addError(errors, `cannot validate ${name}.csv: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (totalBytes > MAX_BYTES) addError(errors, `demo-data exceeds ${MAX_BYTES} byte limit`)
  if (totalRows > MAX_ROWS) addError(errors, `demo-data exceeds ${MAX_ROWS} row limit`)

  const relationships = validateRelationships(tables, errors)
  let metadata = null
  try {
    metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'))
    validateMetadata(metadata, tables, errors)
  } catch (error) {
    addError(errors, `cannot validate metadata.json: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { ok: errors.length === 0, errors, tables, metadata, relationships, totalBytes, totalRows }
}

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMain()) {
  const report = await verifyDemoData(process.argv[2] === undefined ? defaultDataDir : resolve(process.argv[2]))
  if (!report.ok) {
    const displayedErrors = report.errors.slice(0, 20)
    const suffix = report.errors.length > displayedErrors.length ? `\n- ...and ${report.errors.length - displayedErrors.length} more errors` : ''
    process.stderr.write(`Demo data verification failed:\n${displayedErrors.map((error) => `- ${error}`).join('\n')}${suffix}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`Demo data verified: ${Object.keys(EXPECTED_TABLES).length} tables, ${report.totalRows} rows, ${report.totalBytes} bytes\n`)
  }
}
