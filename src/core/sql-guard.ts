import type { Catalog, TableSchema } from './contracts'

export interface GuardOptions {
  readonly maxJoins?: number
  readonly maxCtes?: number
  readonly maxRows?: number
}

export interface SqlViolation {
  readonly code: string
  readonly message: string
}

export interface GuardedSql {
  readonly sql: string
  readonly violations: readonly SqlViolation[]
}

type TokenKind = 'word' | 'number' | 'string' | 'identifier' | 'symbol'

interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly value: string
}

interface TableRef {
  readonly table: string
  readonly alias: string
  readonly tokenIndex: number
  readonly endIndex: number
  readonly cte: boolean
}

interface ColumnRef {
  readonly qualifier?: string
  readonly column: string
}

const SQL_KEYWORDS = new Set([
  'all', 'and', 'as', 'asc', 'between', 'by', 'case', 'cast', 'collate', 'column', 'current',
  'current_date', 'current_time', 'current_timestamp', 'cross', 'date', 'desc', 'distinct',
  'else', 'end', 'escape', 'exists', 'explain', 'false', 'fetch', 'filter', 'following', 'for',
  'from', 'full', 'group', 'having', 'in', 'inner', 'interval', 'is', 'join', 'lateral', 'left',
  'like', 'limit', 'natural', 'not', 'null', 'offset', 'on', 'or', 'order', 'outer', 'over',
  'partition', 'preceding', 'range', 'recursive', 'right', 'row', 'rows', 'select', 'then',
  'true', 'union', 'using', 'when', 'where', 'window', 'with', 'without'
])

const DANGEROUS_KEYWORDS = new Set([
  'alter', 'attach', 'call', 'copy', 'create', 'delete', 'detach', 'drop', 'export', 'grant',
  'import', 'insert', 'install', 'load', 'merge', 'pragma', 'reindex', 'replace', 'reset',
  'revoke', 'truncate', 'update', 'vacuum'
])

const DANGEROUS_FUNCTIONS = new Set([
  'eval', 'glob', 'httpfs', 'http_get', 'http_post', 'parquet_scan', 'read_csv', 'read_csv_auto',
  'read_json', 'read_json_auto', 'read_parquet', 'read_text'
])

const AGGREGATE_FUNCTIONS = new Set([
  'any_value', 'arg_max', 'arg_min', 'array_agg', 'avg', 'bit_and', 'bit_or', 'bool_and',
  'bool_or', 'count', 'list', 'max', 'median', 'min', 'quantile', 'stddev', 'string_agg',
  'sum', 'var_pop', 'var_samp'
])

const CLAUSE_BOUNDARIES = new Set(['group', 'having', 'limit', 'order', 'qualify', 'union', 'where'])

function addViolation(violations: SqlViolation[], code: string, message: string): void {
  if (!violations.some((violation) => violation.code === code && violation.message === message)) {
    violations.push({ code, message })
  }
}

function normalizeSql(source: string): string {
  let output = ''
  let pendingSpace = false
  let index = 0

  while (index < source.length) {
    const character = source[index]
    if (character === undefined) break

    if (character === '-' && source[index + 1] === '-') {
      pendingSpace = true
      index += 2
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      pendingSpace = true
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      if (index < source.length) index += 2
      continue
    }
    if (/\s/.test(character)) {
      pendingSpace = true
      index += 1
      continue
    }

    if (pendingSpace && output.length > 0 && !/[(),.;]/.test(character) && !/[ (.,;]$/.test(output)) {
      output += ' '
    }
    pendingSpace = false

    if (character === "'" || character === '"' || character === '`') {
      const quote = character
      output += character
      index += 1
      while (index < source.length) {
        const quoted = source[index]
        if (quoted === undefined) break
        output += quoted
        index += 1
        if (quoted === quote) {
          if (source[index] === quote) {
            output += quote
            index += 1
          } else {
            break
          }
        }
      }
      continue
    }

    output += character
    index += 1
  }

  return output.trim()
}

function tokenize(sql: string): readonly Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < sql.length) {
    const character = sql[index]
    if (character === undefined) break
    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      const quote = character
      const start = index
      index += 1
      while (index < sql.length) {
        const quoted = sql[index]
        if (quoted === undefined) break
        index += 1
        if (quoted === quote) {
          if (sql[index] === quote) index += 1
          else break
        }
      }
      const text = sql.slice(start, index)
      const value = text.slice(1, text.endsWith(quote) ? -1 : undefined).replaceAll(`${quote}${quote}`, quote)
      tokens.push({ kind: quote === "'" ? 'string' : 'identifier', text, value })
      continue
    }

    if (/[A-Za-z_$]/.test(character)) {
      const start = index
      index += 1
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index] ?? '')) index += 1
      const text = sql.slice(start, index)
      tokens.push({ kind: 'word', text, value: text.toLowerCase() })
      continue
    }

    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(sql[index + 1] ?? ''))) {
      const start = index
      index += 1
      while (index < sql.length && /[0-9.eE+-]/.test(sql[index] ?? '')) index += 1
      const text = sql.slice(start, index)
      tokens.push({ kind: 'number', text, value: text })
      continue
    }

    const pair = sql.slice(index, index + 2)
    if (pair === '::' || pair === '>=' || pair === '<=' || pair === '<>' || pair === '!=' || pair === '||') {
      tokens.push({ kind: 'symbol', text: pair, value: pair })
      index += 2
      continue
    }
    tokens.push({ kind: 'symbol', text: character, value: character })
    index += 1
  }

  return tokens
}

function isWord(token: Token | undefined, value: string): boolean {
  return token?.kind === 'word' && token.value === value
}

function identifierValue(token: Token | undefined): string | undefined {
  if (token?.kind !== 'word' && token?.kind !== 'identifier') return undefined
  return token.value.toLowerCase()
}

function matchingParenthesis(tokens: readonly Token[], openingIndex: number): number {
  let depth = 0
  for (let index = openingIndex; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token?.value === '(') depth += 1
    if (token?.value === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return tokens.length - 1
}

function extractCtes(tokens: readonly Token[]): { readonly names: ReadonlySet<string>; readonly count: number } {
  let index = isWord(tokens[0], 'explain') ? 1 : 0
  if (!isWord(tokens[index], 'with')) return { names: new Set(), count: 0 }
  index += 1
  if (isWord(tokens[index], 'recursive')) index += 1

  const names = new Set<string>()
  let count = 0
  while (index < tokens.length) {
    const name = identifierValue(tokens[index])
    if (name === undefined) break
    names.add(name)
    index += 1

    if (tokens[index]?.value === '(') index = matchingParenthesis(tokens, index) + 1
    if (!isWord(tokens[index], 'as') || tokens[index + 1]?.value !== '(') break
    count += 1
    index = matchingParenthesis(tokens, index + 1) + 1
    if (tokens[index]?.value !== ',') break
    index += 1
  }
  return { names, count }
}

function catalogTable(catalog: Catalog, name: string): TableSchema | undefined {
  return catalog.tables.find((table) => table.name.toLowerCase() === name)
}

function hasTableColumn(table: TableSchema | undefined, column: string): boolean {
  return table?.columns.some((item) => item.name.toLowerCase() === column) ?? false
}

function parseTableRef(
  tokens: readonly Token[],
  startIndex: number,
  ctes: ReadonlySet<string>
): { readonly ref?: TableRef; readonly nextIndex: number } {
  let index = startIndex
  if (isWord(tokens[index], 'lateral')) index += 1
  const table = identifierValue(tokens[index])
  if (table === undefined || tokens[index]?.kind === 'string' || tokens[index]?.value === '(') {
    return { nextIndex: startIndex }
  }
  index += 1

  let alias = table
  if (isWord(tokens[index], 'as')) {
    const aliasValue = identifierValue(tokens[index + 1])
    if (aliasValue !== undefined) {
      alias = aliasValue
      index += 2
    }
  } else {
    const aliasValue = identifierValue(tokens[index])
    if (aliasValue !== undefined && !SQL_KEYWORDS.has(aliasValue)) {
      alias = aliasValue
      index += 1
    }
  }

  return {
    ref: { table, alias, tokenIndex: startIndex, endIndex: index - 1, cte: ctes.has(table) },
    nextIndex: index
  }
}

function extractTableRefs(
  tokens: readonly Token[],
  ctes: ReadonlySet<string>,
  catalog: Catalog,
  violations: SqlViolation[]
): readonly TableRef[] {
  const refs: TableRef[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isWord(tokens[index], 'from') && !isWord(tokens[index], 'join')) continue
    const parsed = parseTableRef(tokens, index + 1, ctes)
    if (parsed.ref === undefined) {
      addViolation(violations, 'invalid_table_reference', `missing table after ${tokens[index]?.text ?? 'clause'}`)
      continue
    }
    refs.push(parsed.ref)
    if (!parsed.ref.cte && catalogTable(catalog, parsed.ref.table) === undefined) {
      addViolation(violations, 'unknown_table', `unknown table '${parsed.ref.table}'`)
    }
  }
  return refs
}

function collectOutputAliases(tokens: readonly Token[]): ReadonlySet<string> {
  const aliases = new Set<string>()
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (isWord(tokens[index], 'as')) {
      const alias = identifierValue(tokens[index + 1])
      if (alias !== undefined) aliases.add(alias)
    }
  }
  return aliases
}

function columnFromTokens(tokens: readonly Token[], index: number): ColumnRef | undefined {
  const column = identifierValue(tokens[index])
  if (column === undefined) return undefined
  const next = tokens[index + 1]
  if (next?.value === '.' && tokens[index + 2] !== undefined) {
    const qualifiedColumn = identifierValue(tokens[index + 2])
    if (qualifiedColumn !== undefined) return { qualifier: column, column: qualifiedColumn }
  }
  return { column }
}

function validateColumns(
  tokens: readonly Token[],
  refs: readonly TableRef[],
  catalog: Catalog,
  ctes: ReadonlySet<string>,
  violations: SqlViolation[]
): void {
  const aliases = new Map<string, string>()
  const skipped = new Set<number>()
  for (const ref of refs) {
    aliases.set(ref.alias, ref.table)
    skipped.add(ref.tokenIndex)
    if (ref.endIndex !== ref.tokenIndex) skipped.add(ref.endIndex)
  }
  const outputAliases = collectOutputAliases(tokens)
  const referencedTables = refs
    .filter((ref) => !ref.cte)
    .map((ref) => catalogTable(catalog, ref.table))
    .filter((table): table is TableSchema => table !== undefined)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || token.kind !== 'word' && token.kind !== 'identifier') continue
    const value = token.value.toLowerCase()
    const qualifiedRef = tokens[index + 1]?.value === '.' ? columnFromTokens(tokens, index) : undefined
    if (qualifiedRef !== undefined) {
      const tableName = aliases.get(qualifiedRef.qualifier ?? '') ?? qualifiedRef.qualifier
      const table = tableName === undefined ? undefined : catalogTable(catalog, tableName)
      if (table === undefined) {
        if (!ctes.has(tableName ?? '')) addViolation(violations, 'unknown_table_alias', `unknown table or alias '${qualifiedRef.qualifier ?? value}'`)
      } else if (!hasTableColumn(table, qualifiedRef.column)) {
        addViolation(violations, 'unknown_column', `unknown column '${qualifiedRef.qualifier ?? value}.${qualifiedRef.column}'`)
      }
      continue
    }
    if (skipped.has(index) || SQL_KEYWORDS.has(value) || outputAliases.has(value) || ctes.has(value) || aliases.has(value)) continue
    if (tokens[index - 1]?.value === '.' || tokens[index - 1]?.value === '::') continue
    if (tokens[index + 1]?.value === '(') continue

    const ref = columnFromTokens(tokens, index)
    if (ref === undefined) continue
    if (ref.qualifier !== undefined) {
      const tableName = aliases.get(ref.qualifier) ?? ref.qualifier
      const table = catalogTable(catalog, tableName)
      if (table === undefined) {
        if (!ctes.has(tableName)) addViolation(violations, 'unknown_table_alias', `unknown table or alias '${ref.qualifier}'`)
      } else if (!hasTableColumn(table, ref.column)) {
        addViolation(violations, 'unknown_column', `unknown column '${ref.qualifier}.${ref.column}'`)
      }
      continue
    }

    if (referencedTables.length > 0 && !referencedTables.some((table) => hasTableColumn(table, ref.column))) {
      addViolation(violations, 'unknown_column', `unknown column '${ref.column}'`)
    }
  }
}

function relationExists(catalog: Catalog, leftTable: string, leftColumn: string, rightTable: string, rightColumn: string): boolean {
  return catalog.relationships.some((relationship) => {
    if (relationship.status === 'rejected') return false
    return (relationship.fromTable.toLowerCase() === leftTable && relationship.fromColumn.toLowerCase() === leftColumn && relationship.toTable.toLowerCase() === rightTable && relationship.toColumn.toLowerCase() === rightColumn)
      || (relationship.fromTable.toLowerCase() === rightTable && relationship.fromColumn.toLowerCase() === rightColumn && relationship.toTable.toLowerCase() === leftTable && relationship.toColumn.toLowerCase() === leftColumn)
  })
}

function resolveJoinOperand(
  operand: ColumnRef,
  candidates: readonly TableRef[],
  aliases: ReadonlyMap<string, string>,
  catalog: Catalog
): readonly { readonly table: string; readonly column: string }[] {
  if (operand.qualifier !== undefined) {
    const table = aliases.get(operand.qualifier) ?? operand.qualifier
    return [{ table, column: operand.column }]
  }
  return candidates
    .filter((candidate) => !candidate.cte && hasTableColumn(catalogTable(catalog, candidate.table), operand.column))
    .map((candidate) => ({ table: candidate.table, column: operand.column }))
}

function joinOperand(tokens: readonly Token[], equalityIndex: number, side: 'left' | 'right'): ColumnRef | undefined {
  const index = side === 'left' && tokens[equalityIndex - 2]?.value === '.'
    ? equalityIndex - 3
    : equalityIndex + 1
  return columnFromTokens(tokens, index)
}

function validateJoins(
  tokens: readonly Token[],
  refs: readonly TableRef[],
  catalog: Catalog,
  violations: SqlViolation[]
): void {
  const aliases = new Map<string, string>(refs.map((ref) => [ref.alias, ref.table]))
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isWord(tokens[index], 'join')) continue
    if (isWord(tokens[index - 1], 'cross')) {
      addViolation(violations, 'cross_join', 'CROSS JOIN is not allowed without a declared relationship')
    }

    const right = refs.find((ref) => ref.tokenIndex > index)
    if (right === undefined) {
      addViolation(violations, 'invalid_join', 'join has no valid right-hand table')
      continue
    }
    const previous = refs.filter((ref) => ref.tokenIndex < right.tokenIndex)
    if (previous.length === 0) {
      addViolation(violations, 'invalid_join', `join to '${right.table}' has no left-hand table`)
      continue
    }

    let cursor = right.endIndex + 1
    while (cursor < tokens.length && tokens[cursor]?.value !== 'on' && tokens[cursor]?.value !== 'using' && !isWord(tokens[cursor], 'join')) cursor += 1
    if (isWord(tokens[cursor], 'using')) {
      const column = identifierValue(tokens[cursor + 2])
      const valid = column !== undefined && previous.some((left) => relationExists(catalog, left.table, column, right.table, column))
      if (!valid) addViolation(violations, 'invalid_join', `join to '${right.table}' does not follow a catalog relationship`)
      continue
    }
    if (!isWord(tokens[cursor], 'on')) {
      addViolation(violations, 'invalid_join', `join to '${right.table}' requires ON or USING`)
      continue
    }

    const onStart = cursor + 1
    let onEnd = onStart
    let depth = 0
    while (onEnd < tokens.length) {
      const token = tokens[onEnd]
      if (token?.value === '(') depth += 1
      if (token?.value === ')') depth -= 1
      if (depth === 0 && onEnd > onStart && (isWord(token, 'join') || CLAUSE_BOUNDARIES.has(token?.value ?? ''))) break
      onEnd += 1
    }

    let valid = false
    for (let equality = onStart; equality < onEnd; equality += 1) {
      if (tokens[equality]?.value !== '=') continue
      const leftOperand = joinOperand(tokens, equality, 'left')
      const rightOperand = joinOperand(tokens, equality, 'right')
      if (leftOperand === undefined || rightOperand === undefined) continue
      const leftCandidates = resolveJoinOperand(leftOperand, previous, aliases, catalog)
      const rightCandidates = resolveJoinOperand(rightOperand, [right], aliases, catalog)
      if (leftCandidates.some((left) => rightCandidates.some((candidate) => relationExists(catalog, left.table, left.column, candidate.table, candidate.column)))) {
        valid = true
        break
      }
    }
    if (!valid) addViolation(violations, 'invalid_join', `join to '${right.table}' does not follow a catalog relationship`)
  }
}

function isPathLiteral(value: string): boolean {
  return /(?:https?|ftp):\/\//i.test(value)
    || /^(?:[A-Za-z]:[\\/]|[\\/]|\.\.?[\\/])/.test(value)
    || /\.(?:csv|parquet|json|jsonl|avro|orc|gz)(?:$|[?#])/i.test(value)
    || /[\\/]/.test(value)
}

function inspectTokens(
  tokens: readonly Token[],
  catalog: Catalog,
  options: Required<GuardOptions>,
  violations: SqlViolation[]
): void {
  const first = tokens[0]
  const explain = isWord(first, 'explain')
  const statementStart = explain ? tokens[1] : first
  if (!isWord(statementStart, 'select') && !isWord(statementStart, 'with')) {
    addViolation(violations, 'invalid_statement', 'only SELECT, WITH, or EXPLAIN SELECT statements are allowed')
  }
  if (explain && tokens[1] === undefined) addViolation(violations, 'invalid_statement', 'EXPLAIN requires a SELECT or WITH statement')

  for (const token of tokens) {
    if (token.kind === 'word' && DANGEROUS_KEYWORDS.has(token.value)) {
      addViolation(violations, 'dangerous_keyword', `forbidden SQL keyword '${token.text}'`)
    }
    if (token.kind === 'word' && DANGEROUS_FUNCTIONS.has(token.value)) {
      addViolation(violations, 'dangerous_function', `forbidden SQL function or extension '${token.text}'`)
    }
    if (token.kind === 'string' && isPathLiteral(token.value)) {
      addViolation(violations, 'path_literal', 'path and URL literals are not allowed')
    }
  }

  const { names: ctes, count: cteCount } = extractCtes(tokens)
  if (cteCount > options.maxCtes) addViolation(violations, 'complexity', `query uses ${cteCount} CTEs; maximum is ${options.maxCtes}`)
  const refs = extractTableRefs(tokens, ctes, catalog, violations)
  validateColumns(tokens, refs, catalog, ctes, violations)
  validateJoins(tokens, refs, catalog, violations)

  const joinCount = tokens.filter((token) => isWord(token, 'join')).length
  if (joinCount > options.maxJoins) addViolation(violations, 'complexity', `query uses ${joinCount} joins; maximum is ${options.maxJoins}`)

  if (explain) return
  const aggregate = tokens.some((token) => token.kind === 'word' && AGGREGATE_FUNCTIONS.has(token.value))
    || tokens.some((token, index) => isWord(token, 'group') && isWord(tokens[index + 1], 'by'))
  const limitIndex = tokens.findIndex((token) => isWord(token, 'limit'))
  if (limitIndex >= 0) {
    const limitToken = tokens[limitIndex + 1]
    const limit = limitToken?.kind === 'number' ? Number(limitToken.value) : Number.NaN
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > options.maxRows) {
      addViolation(violations, 'row_limit', `LIMIT must be an integer from 0 to ${options.maxRows}`)
    }
  } else if (!aggregate) {
    addViolation(violations, 'missing_limit', `detail queries require LIMIT ${options.maxRows} or less`)
  }
}

export function guardSql(sql: string, catalog: Catalog, options: GuardOptions = {}): GuardedSql {
  const normalized = normalizeSql(sql)
  const tokens = tokenize(normalized)
  const violations: SqlViolation[] = []
  const limits: Required<GuardOptions> = {
    maxJoins: options.maxJoins ?? 8,
    maxCtes: options.maxCtes ?? 6,
    maxRows: options.maxRows ?? 10_000
  }

  if (tokens.length === 0) {
    addViolation(violations, 'empty_sql', 'SQL must not be empty')
    return { sql: normalized, violations }
  }

  const semicolonIndexes = tokens.flatMap((token, index) => token.value === ';' ? [index] : [])
  if (semicolonIndexes.length > 1 || (semicolonIndexes.length === 1 && semicolonIndexes[0] !== tokens.length - 1)) {
    addViolation(violations, 'multiple_statements', 'exactly one SQL statement is allowed')
  }
  inspectTokens(tokens.filter((token) => token.value !== ';'), catalog, limits, violations)
  return { sql: normalized, violations }
}
