/**
 * dotnet.properties.js
 * ────────────────────
 * Project-language configuration for .NET Framework / .NET (C# + VB.NET) projects.
 *
 * To activate: swap the import in vite-plugin-filemap.js to
 *   import { ... } from './dotnet.properties.js'
 *
 * NOTE: Full dependency analysis (BRANCH_KINDS, DB_PACKAGES, API_PACKAGES)
 * requires a Roslyn-based parser. The current analyser uses ts-morph (TS/JS only).
 * These constants are defined for future .NET parser support — the filesystem
 * walk and file-map views work with any SOURCE_EXTS today.
 */

// Directories to skip during filesystem walk
export const IGNORE_DIRS = new Set([
  'bin', 'obj',          // build outputs
  '.vs',                 // Visual Studio local state
  'packages',            // NuGet packages (old-style)
  'TestResults',         // test runner output
  '.git', '.cache',
])

// Source file extensions to include in analysis
export const SOURCE_EXTS = [
  // C# / VB / F#
  '.cs', '.vb', '.fs',
  // ASP.NET Web Forms
  '.aspx', '.ascx', '.asax', '.ashx', '.master',
  // Razor / MVC
  '.razor', '.cshtml', '.vbhtml',
  // Data / config
  '.edmx', '.resx', '.xml', '.config', '.sql',
  // UI
  '.xaml', '.scss', '.less', '.css',
  // Code gen
  '.tt',
  // Scripting
  '.ps1', '.psd1', '.psm1',
]

// NuGet packages / namespaces that indicate database access (runtime scoring)
export const DB_PACKAGES = new Set([
  // Entity Framework
  'EntityFramework', 'Microsoft.EntityFrameworkCore',
  'Microsoft.EntityFrameworkCore.SqlServer',
  'Microsoft.EntityFrameworkCore.Sqlite',
  // Dapper
  'Dapper',
  // ADO.NET providers
  'System.Data.SqlClient', 'Microsoft.Data.SqlClient',
  'Npgsql', 'MySql.Data', 'Oracle.ManagedDataAccess',
  // NHibernate
  'NHibernate',
  // Cosmos / Mongo
  'Microsoft.Azure.Cosmos', 'MongoDB.Driver',
])

// NuGet packages / namespaces that indicate outbound HTTP / API calls (runtime scoring)
export const API_PACKAGES = new Set([
  'System.Net.Http',             // HttpClient (BCL)
  'RestSharp',
  'Flurl', 'Flurl.Http',
  'Refit',
  'Microsoft.AspNet.WebApi.Client',
  'Azure.Core',                  // Azure SDK base (covers all Azure.*  clients)
  'AWSSDK.Core',
])

// Roslyn SyntaxKind names that count as cyclomatic complexity branches
// (mirrors the ts-morph BRANCH_KINDS used for JS/TS)
export const BRANCH_KINDS = [
  'IfStatement', 'ConditionalExpression',
  'ForStatement', 'ForEachStatement',
  'WhileStatement', 'DoStatement',
  'CatchClause', 'CaseSwitchLabel', 'CasePatternSwitchLabel',
  'WhenClause',  // pattern-match guard
]

// Cyclomatic complexity thresholds (same scale as node.properties.js)
export const CC_BANDS = { wayTooHigh: 20, high: 10, med: 4 }

// Runtime heat-score weights per signal type
export const RUNTIME_WEIGHTS = { db: 3, api: 2, cyclo: 0.5 }

// Parser options (placeholder — Roslyn integration TBD)
// Shape mirrors TS_PROJECT_OPTS so the plugin can consume it generically.
export const TS_PROJECT_OPTS = null
