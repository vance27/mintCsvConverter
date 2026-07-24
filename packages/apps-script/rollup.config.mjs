import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

/**
 * Apps Script doesn't support import/export statements, and several
 * exported functions (onEdit, doPost, etc.) are never referenced from
 * within this bundle at all — they're only ever called BY the Apps Script
 * runtime by name. Rollup's tree-shaking would otherwise see them as
 * unreachable and strip them.
 *
 * Every local module (relative import — i.e. our own src/*.ts files, not
 * node_modules dependencies like tslib) is marked `no-treeshake` as a
 * safety net covering all of them, on top of src/Code.ts's own
 * `export * from './...'` re-exports (which alone would satisfy ordinary
 * tree-shaking, since re-exported bindings count as "used" — this is
 * belt-and-suspenders in case a future export is added without also being
 * re-exported from the entry point). node_modules imports are left to
 * normal tree-shaking.
 *
 * This plugin also strips the trailing `export { ... };` statement Rollup
 * generates for the entry's re-exports, since Apps Script can't parse ESM
 * export syntax.
 */
function appsScriptEntryPoint() {
  return {
    name: 'apps-script-entry-point',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('.')) {
        const resolution = await this.resolve(source, importer, { skipSelf: true, ...options });
        if (resolution) {
          resolution.moduleSideEffects = 'no-treeshake';
        }
        return resolution;
      }
      return null;
    },
    renderChunk(code) {
      return code.replace(/\nexport\s*\{[^}]*\};?\n?/g, '\n');
    },
  };
}

export default {
  input: 'src/Code.ts',
  output: {
    dir: 'dist',
    format: 'es',
  },
  plugins: [appsScriptEntryPoint(), nodeResolve(), commonjs(), typescript()],
};
