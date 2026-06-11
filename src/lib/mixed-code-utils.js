/**
 * mixed-code-utils.js
 *
 * Utilities for files that embed code inside HTML markup ("server-side templates").
 * Extracts <script> blocks and sanitizes template expressions so that
 * ts-morph / AST tools can parse the resulting JavaScript without errors.
 *
 * Supported formats:
 *   ASP.NET Web Forms  .aspx .ascx .asax .ashx .master   <%...%>
 *   Razor              .cshtml .vbhtml .razor              @expr
 *   Java JSP           .jsp .jspx                          <%...%>  ${...}
 *   PHP                .php .phtml                          <?php...?>
 *   Ruby ERB           .erb                                 <%...%>
 *   EJS (Node.js)      .ejs                                 <%...%>
 *   Twig / Jinja2      .twig .j2 .jinja .jinja2             {{...}}  {%...%}
 *   Handlebars         .hbs .handlebars                     {{...}}  {{#...}}
 */

/** Extensions that are known server-side template formats. */
export const MIXED_CODE_EXTS = new Set([
  // ASP.NET Web Forms
  '.aspx', '.ascx', '.asax', '.ashx', '.master',
  // Razor (ASP.NET Core)
  '.cshtml', '.vbhtml', '.razor',
  // Java Server Pages
  '.jsp', '.jspx',
  // PHP
  '.php', '.phtml',
  // Ruby ERB
  '.erb',
  // EJS (Node.js)
  '.ejs',
  // Twig / Jinja2
  '.twig', '.j2', '.jinja', '.jinja2',
  // Handlebars / Mustache
  '.hbs', '.handlebars',
])

/**
 * Returns true if the given file path is a server-side template file.
 * @param {string} filePath
 */
export function isMixedCodeFile(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return MIXED_CODE_EXTS.has(ext)
}

/**
 * Sanitize template expressions in a JavaScript string so that ts-morph
 * can parse it without syntax errors.  Each template syntax is replaced
 * with a valid JS string literal placeholder.
 *
 * @param {string} js  Raw JS text that may contain template expressions.
 * @param {string} ext Lower-cased file extension including the dot, e.g. '.aspx'.
 * @returns {string}   Sanitized JS text.
 */
export function sanitizeTemplateExpressions(js, ext) {
  let s = js

  // ── <%...%> family (ASP.NET, JSP, ERB, EJS) ──────────────────────────────
  // Must run before Razor @ replacements to avoid double-processing.
  // Handles  <%  <%=  <%:  <%#  <%--  etc.
  if (['.aspx', '.ascx', '.asax', '.ashx', '.master',
       '.jsp', '.jspx', '.erb', '.ejs'].includes(ext)) {
    s = s.replace(/<%[\s\S]*?%>/g, '"__TMPL__"')
  }

  // ── Razor @(...) and @identifier ─────────────────────────────────────────
  if (['.cshtml', '.vbhtml', '.razor'].includes(ext)) {
    // Razor block expressions  @(...)
    s = s.replace(/@\([^)]*\)/g, '"__RAZOR__"')
    // Razor inline member access  @Model.Foo  @ViewBag.Bar  @item  etc.
    s = s.replace(/@[\w.[\]()]+/g, '"__RAZOR__"')
    // Also handle <%...%> which can appear in older .cshtml
    s = s.replace(/<%[\s\S]*?%>/g, '"__TMPL__"')
  }

  // ── PHP <?php...?> ────────────────────────────────────────────────────────
  if (['.php', '.phtml'].includes(ext)) {
    s = s.replace(/<\?(?:php|=)[\s\S]*?\?>/gi, '"__PHP__"')
  }

  // ── JSP EL  ${...}  #{...} ───────────────────────────────────────────────
  if (['.jsp', '.jspx'].includes(ext)) {
    s = s.replace(/[#$]\{[^}]*\}/g, '"__JSP__"')
  }

  // ── Twig / Jinja2  {{ }}  {% %}  {# #} ──────────────────────────────────
  if (['.twig', '.j2', '.jinja', '.jinja2'].includes(ext)) {
    s = s.replace(/\{#[\s\S]*?#\}/g, '')               // comments → empty
    s = s.replace(/\{%[\s\S]*?%\}/g, '"__TWIG_TAG__"')
    s = s.replace(/\{\{[\s\S]*?\}\}/g, '"__TWIG_VAR__"')
  }

  // ── Handlebars / Mustache  {{ }}  {{# }}  {{> }} ─────────────────────────
  if (['.hbs', '.handlebars'].includes(ext)) {
    s = s.replace(/\{\{[\s\S]*?\}\}/g, '"__HBS__"')
  }

  return s
}

/**
 * Extract all inline `<script>` block contents from an HTML/template string,
 * sanitize template expressions, and return a single concatenated JS string
 * suitable for feeding into ts-morph.
 *
 * Skips `<script src="...">` references (external resources).
 *
 * @param {string} html  Full source text of the template file.
 * @param {string} ext   Lower-cased file extension, e.g. '.aspx'.
 * @returns {string|null}  Concatenated JS text, or null if no inline scripts found.
 */
export function extractInlineScripts(html, ext) {
  const blocks = []
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi
  let m
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs = m[1]
    const body  = m[2]
    // Skip external script tags (those with src= attribute)
    if (/\bsrc\s*=/i.test(attrs)) continue
    // Skip non-JS type attributes (e.g. type="text/template")
    const typeM = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)
    if (typeM && !/javascript|module/i.test(typeM[1])) continue

    blocks.push(sanitizeTemplateExpressions(body, ext))
  }
  return blocks.length ? blocks.join('\n\n') : null
}
