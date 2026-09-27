// Bun globals φ actually uses. Narrow on purpose: this is a typecheck stand-in, not a description of
// Bun, and a broad shim would let code assume APIs nobody has verified exist.
declare const Bun: {
  serve(options: { hostname?: string; port?: number; idleTimeout?: number;
                   fetch(req: Request): Response | Promise<Response> }): unknown;
  spawn(...args: unknown[]): { exited: Promise<number>; kill(): void };
  file(...args: unknown[]): { text(): Promise<string>; exists(): Promise<boolean> };
  Transpiler: new (o?: { loader?: 'js' | 'jsx' | 'ts' | 'tsx' }) => { transformSync(code: string): string };
};
interface ImportMeta { dir: string; path: string; file: string }
