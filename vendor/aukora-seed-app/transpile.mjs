#!/usr/bin/env node
// Genesis-authored: type-strip the pinned originals; only import specifiers change after emit.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--typescript')) {
  throw new Error('usage: node vendor/aukora-seed-app/transpile.mjs [--typescript <typescript/lib/typescript.js>]');
}
const compiler = args[1] ? resolve(args[1]) : join(root, 'vendor/dsh/node_modules/typescript/lib/typescript.js');
const ts = createRequire(import.meta.url)(compiler);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rel = (path) => relative(here, path).split('\\').join('/');
const provenancePath = join(here, 'PROVENANCE.json');
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
// The seed tsconfig leaves verbatimModuleSyntax disabled: ordinary imports used only as types
// (notably packages/evidence) must be erased too, rather than becoming nonexistent runtime exports.
const compilerOptions = { target: 'ES2022', module: 'ESNext', verbatimModuleSyntax: false, esModuleInterop: true };

// Refuse to regenerate from originals whose bytes no longer match the import manifest.
for (const file of provenance.files) {
  const bytes = readFileSync(join(here, file.path));
  if (sha256(bytes) !== file.sha256 || bytes.length !== file.bytes) {
    throw new Error(`upstream bytes changed: ${file.path}`);
  }
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
}).sort();
const sourceFiles = walk(join(here, 'src'));
const pinnedFiles = new Set(provenance.files.map((file) => resolve(here, file.path)));
for (const path of sourceFiles) {
  if (!pinnedFiles.has(path)) throw new Error(`unmeasured upstream file: ${rel(path)}`);
}
const outFor = (path) => join(here, 'lib', relative(join(here, 'src'), path).replace(/\.ts$/u, '.js'));
const workspace = new Map();
for (const path of sourceFiles.filter((path) => path.endsWith('/package.json'))) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    const imported = typeof target === 'string' ? target : target.import;
    if (!imported) continue;
    workspace.set(`${pkg.name}${subpath === '.' ? '' : subpath.slice(1)}`, outFor(resolve(dirname(path), imported)));
  }
}
const kernel = { '': 'index', authority: 'authority', canonical: 'canonical', evidence: 'evidence',
  merkle: 'merkle', reducer: 'reducer', registries: 'registry', schemas: 'schema', staleness: 'staleness' };
for (const [subpath, file] of Object.entries(kernel)) {
  workspace.set(`@aukora/kernel${subpath ? `/${subpath}` : ''}`, resolve(here, `../authority/lib/${file}.js`));
}
const noble = {
  '@noble/curves/ed25519.js': '../authority/deps/@noble/curves@2.2.0/ed25519.js',
  '@noble/hashes/sha2.js': '../authority/deps/@noble/hashes@2.2.0/sha2.js',
  '@noble/hashes/utils.js': '../authority/deps/@noble/hashes@2.2.0/utils.js',
  '@noble/post-quantum/ml-dsa.js': '../authority/deps/@noble/post-quantum@0.6.1/ml-dsa.js',
};
for (const [specifier, path] of Object.entries(noble)) workspace.set(specifier, resolve(here, path));
const dependencies = new Map();
const relativeImports = new Set();
const outputs = new Set(sourceFiles.filter((path) => /\.(ts|js)$/u.test(path)).map(outFor));

function rewriteSpecifiers(code, outPath) {
  // Parse emitted JavaScript so multiline imports, re-exports and dynamic imports are all covered,
  // without matching comments, string contents, or the tests' deliberately literal source checks.
  const ast = ts.createSourceFile(outPath, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const edits = [];
  const externals = new Set();
  function rewrite(literal) {
    const specifier = literal.text;
    let target;
    if (workspace.has(specifier)) {
      const path = workspace.get(specifier);
      target = relative(dirname(outPath), path).split('\\').join('/');
      if (!target.startsWith('.')) target = `./${target}`;
      dependencies.set(specifier, path);
    } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      target = specifier.replace(/\.ts$/u, '.js');
      const resolved = resolve(dirname(outPath), target);
      if (!outputs.has(resolved)) {
        if (outputs.has(`${resolved}.js`)) target += '.js';
        else if (outputs.has(join(resolved, 'index.js'))) target = `${target}/index.js`;
        else throw new Error(`${rel(outPath)}: unresolved relative import ${specifier}`);
      }
      relativeImports.add(resolve(dirname(outPath), target));
    } else if (specifier.startsWith('node:')) return;
    else if (builtinModules.includes(specifier)) target = `node:${specifier}`;
    else if ((specifier === 'vitest' && outPath.includes('/test/')) ||
             (specifier === 'vitest/config' && outPath.endsWith('/vitest.config.js'))) {
      externals.add(specifier); // Resolved to the explicitly supplied Vitest installation by the test config.
      return;
    } else throw new Error(`${rel(outPath)}: unmapped bare specifier ${specifier}`);
    if (target === specifier) return;
    const start = literal.getStart(ast);
    const from = code.slice(start, literal.end);
    const quote = from[0];
    edits.push({ start, end: literal.end, from, to: `${quote}${target}${quote}` });
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) rewrite(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
        throw new Error(`${rel(outPath)}: nonliteral dynamic import requires an explicit mapping`);
      }
      rewrite(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  let out = code;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.to + out.slice(edit.end);
  return { out, rewrites: edits.map(({ from, to }) => ({ from, to })), externals: [...externals].sort() };
}

const generated = sourceFiles.filter((path) => /\.(ts|js)$/u.test(path)).map((path) => {
  const outPath = outFor(path);
  const result = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false, esModuleInterop: true },
  });
  if (result.diagnostics.length) throw new Error(`${rel(path)}: ${result.diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
  const { out, rewrites, externals } = rewriteSpecifiers(result.outputText, outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);
  const bytes = Buffer.from(out);
  return { path: rel(outPath), from: rel(path), transpiled: true, sha256: sha256(bytes), bytes: bytes.length,
    specifierRewrites: rewrites, ...(externals.length ? { externalSpecifiers: externals } : {}) };
});

// All runtime imports must resolve to existing vendored bytes. Test-runner imports are explicit above.
for (const [specifier, path] of dependencies) {
  if (!existsSync(path)) throw new Error(`missing vendored dependency for ${specifier}: ${rel(path)}`);
}
for (const path of relativeImports) {
  if (!existsSync(path)) throw new Error(`missing generated relative import: ${rel(path)}`);
}
provenance.transpile = {
  command: 'node vendor/aukora-seed-app/transpile.mjs --typescript <Genesis vendor/dsh>/node_modules/typescript/lib/typescript.js',
  compiler: `typescript ${ts.version} (ts.transpileModule; type stripping only)`,
  compilerOptions,
  rule: 'emitted bytes are exactly the compiler output except import specifiers, each listed under generated[].specifierRewrites; original src bytes are checked against their existing pins before emit',
  layout: 'lib/<upstream path>, .ts changed to .js; tests and scripts are generated alongside runtime modules',
  testRunnerExternals: 'vitest and vitest/config are test-only imports resolved from the explicitly selected installed Vitest by run-tests.vitest.config.mjs; Vitest is not copied into the runtime closure',
};
provenance.generated = generated;
provenance.generatedDependencies = [...dependencies].sort(([a], [b]) => a.localeCompare(b)).map(([specifier, path]) => ({
  specifier, resolvesTo: rel(path), sha256: sha256(readFileSync(path)),
}));
for (const path of ['package.json', 'transpile.mjs', 'run-tests.vitest.config.mjs', 'run-tests.mjs']) {
  if (!existsSync(join(here, path))) continue;
  const bytes = readFileSync(join(here, path));
  const entry = { path, sha256: sha256(bytes), bytes: bytes.length };
  const index = provenance.genesisAuthored.findIndex((entry) => entry.path === path);
  if (index === -1) provenance.genesisAuthored.push(entry);
  else provenance.genesisAuthored[index] = entry;
}
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
process.stdout.write(`typescript ${ts.version}: ${generated.length} files emitted, ${generated.reduce((n, file) => n + file.specifierRewrites.length, 0)} specifier rewrites; ${provenance.files.length} original file pins verified\n`);
