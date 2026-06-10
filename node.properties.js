/**
 * node.properties.js
 * ──────────────────
 * Project-language configuration for Node / JavaScript / TypeScript projects.
 *
 * To adapt Codescape for another language ecosystem, create a sibling file
 * (e.g. python.properties.js) exporting the same shape and swap the import
 * in vite-plugin-filemap.js.
 */

// Directories to skip during filesystem walk
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.cache', 'coverage', '.vite',
])

// Source file extensions to include in dependency analysis
export const SOURCE_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

// npm packages that indicate database access (used for runtime scoring)
export const DB_PACKAGES = new Set([
  'pg', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3',
  'knex', 'sequelize', 'mongoose',
  '@prisma/client', 'typeorm', 'drizzle-orm',
])

// npm packages that indicate outbound HTTP / API calls (used for runtime scoring)
export const API_PACKAGES = new Set([
  'axios', 'ky', 'node-fetch', 'got', 'superagent', 'undici',
  'node:http', 'node:https', 'http', 'https',
])

// TypeScript AST node kinds that count as cyclomatic complexity branches
export const BRANCH_KINDS = [
  'IfStatement', 'ConditionalExpression',
  'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoStatement',
  'CatchClause', 'CaseClause',
]

// Cyclomatic complexity thresholds
export const CC_BANDS = { wayTooHigh: 20, high: 10, med: 4 }

// Runtime heat-score weights per signal type
export const RUNTIME_WEIGHTS = { db: 3, api: 2, cyclo: 0.5 }

// ts-morph Project options
export const TS_PROJECT_OPTS = {
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  useInMemoryFileSystem: false,
}
