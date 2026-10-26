import assert from 'node:assert/strict';
import ts from 'typescript';

/** HTTP-only development resource check; does not execute UI code or drive a browser. */
export async function verifyDevModuleGraph(base: string) {
  const origin = new URL(base).origin;
  const queue = [new URL('/main.ts', base).href];
  const visited = new Set<string>();
  while (queue.length) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    assert.ok(visited.size <= 100, 'Unexpectedly large local development module graph');
    const response = await fetch(url);
    assert.equal(response.status, 200, `Development module failed: ${new URL(url).pathname}`);
    const source = await response.text();
    assert.match(response.headers.get('content-type') ?? '', /(?:text|application)\/javascript/, `Expected JavaScript module: ${new URL(url).pathname}`);
    const parsed = ts.createSourceFile(url, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports: string[] = [];
    function inspect(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, inspect);
    }
    inspect(parsed);
    for (const specifier of imports) {
      if (!specifier.startsWith('/') && !specifier.startsWith('.')) continue;
      const dependency = new URL(specifier, url);
      if (dependency.origin !== origin || dependency.pathname.includes('/node_modules/') || dependency.pathname.startsWith('/@vite/') || dependency.pathname.startsWith('/@id/')) continue;
      if (/\.(css|svg|png|jpe?g|webp)$/.test(dependency.pathname)) continue;
      queue.push(dependency.href);
    }
  }
  return [...visited].map(url => new URL(url).pathname);
}
