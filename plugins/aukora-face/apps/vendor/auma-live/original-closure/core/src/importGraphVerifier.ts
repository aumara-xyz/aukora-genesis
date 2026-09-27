import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export interface ImportEdge {
  toModule: string;
  importedSymbols: string[];
  lineNumber: number;
  raw: string;
}

/**
 * 24Z.33 red-team (HIGH): the line-by-line `parseImportEdges` below is BLIND to multi-line imports, `export {..}
 * from` re-exports, and dynamic import-expressions / require-calls — a multi-line evidence import into an authority module
 * compiled clean AND passed the firewall. `parseModuleEdges` uses the TypeScript AST instead, so every import form
 * is seen regardless of formatting. Type-only edges are flagged (`typeOnly`) — they erase at compile time and carry
 * no runtime influence, so the firewall may choose to ignore them.
 */
export type ModuleEdgeKind = 'import' | 'export-from' | 'dynamic' | 'require' | 'import-equals';
export interface ModuleEdge { module: string; symbols: string[]; kind: ModuleEdgeKind; typeOnly: boolean }

export function parseModuleEdges(source: string): ModuleEdge[] {
  const sf = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
  const edges: ModuleEdge[] = [];
  const visit = (node: ts.Node): void => {
    // static `import ... from '...'` (named / default / namespace), multi-line safe
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const symbols: string[] = [];
      const ic = node.importClause;
      const typeOnly = !!ic?.isTypeOnly;
      if (ic?.name) symbols.push(ic.name.text);
      const nb = ic?.namedBindings;
      if (nb) {
        if (ts.isNamespaceImport(nb)) symbols.push(nb.name.text);
        else if (ts.isNamedImports(nb)) for (const el of nb.elements) symbols.push((el.propertyName ?? el.name).text);
      }
      edges.push({ module: node.moduleSpecifier.text, symbols, kind: 'import', typeOnly });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      // re-export laundering: `export { x } from './evidence'`
      const symbols: string[] = [];
      if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const el of node.exportClause.elements) symbols.push((el.propertyName ?? el.name).text);
      edges.push({ module: node.moduleSpecifier.text, symbols, kind: 'export-from', typeOnly: !!node.isTypeOnly });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      edges.push({ module: node.moduleReference.expression.text, symbols: [node.name.text], kind: 'import-equals', typeOnly: false });
    } else if (ts.isCallExpression(node)) {
      const isDyn = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isReq = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDyn || isReq) && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
        edges.push({ module: node.arguments[0].text, symbols: [], kind: isDyn ? 'dynamic' : 'require', typeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return edges;
}

export function parseImportEdges(source: string): ImportEdge[] {
  const results: ImportEdge[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    const match = trimmed.match(
      /^import\s+(?:\{([^}]+)\}|(\*\s+as\s+\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/
    );
    if (!match) continue;

    const [, namedImports, starImport, defaultImport, modulePath] = match;
    let symbols: string[] = [];
    if (namedImports) {
      symbols = namedImports.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    } else if (starImport) {
      symbols = [starImport.replace(/\*\s+as\s+/, '').trim()];
    } else if (defaultImport) {
      symbols = [defaultImport];
    }

    results.push({ toModule: modulePath, importedSymbols: symbols, lineNumber: i + 1, raw: lines[i] });
  }

  return results;
}

export function stripCommentsAndStrings(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i];
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (source[i] === '`') {
      i++;
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    result += source[i];
    i++;
  }
  return result;
}

export function symbolUsedInCode(source: string, symbol: string): boolean {
  const stripped = stripCommentsAndStrings(source);
  const nonImportLines = stripped.split('\n').filter(l => !/^\s*import\s/.test(l));
  const code = nonImportLines.join('\n');
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\s*\\(`).test(code);
}

export function fileImportsSymbol(rootDir: string, relFile: string, symbol: string): boolean {
  const absPath = path.resolve(rootDir, relFile);
  if (!fs.existsSync(absPath)) return false;
  const source = fs.readFileSync(absPath, 'utf-8');
  return parseImportEdges(source).some(e => e.importedSymbols.includes(symbol));
}

export function fileImportsModule(rootDir: string, relFile: string, moduleSubstring: string): boolean {
  const absPath = path.resolve(rootDir, relFile);
  if (!fs.existsSync(absPath)) return false;
  const source = fs.readFileSync(absPath, 'utf-8');
  return parseImportEdges(source).some(e => e.toModule.includes(moduleSubstring));
}

export function symbolForbiddenInFile(rootDir: string, relFile: string, symbol: string): {
  violated: boolean;
  evidence: 'import' | 'code_call' | 'none';
} {
  const absPath = path.resolve(rootDir, relFile);
  if (!fs.existsSync(absPath)) return { violated: false, evidence: 'none' };
  const source = fs.readFileSync(absPath, 'utf-8');
  if (parseImportEdges(source).some(e => e.importedSymbols.includes(symbol))) {
    return { violated: true, evidence: 'import' };
  }
  if (symbolUsedInCode(source, symbol)) {
    return { violated: true, evidence: 'code_call' };
  }
  return { violated: false, evidence: 'none' };
}
