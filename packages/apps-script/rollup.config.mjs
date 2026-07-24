import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

/**
 * Apps Script doesn't support import/export statements, and none of the
 * functions in src/Code.ts are referenced from within this bundle — they're
 * only ever called BY the Apps Script runtime (onEdit, doPost, etc).
 * Without this plugin, Rollup's tree-shaking would see nothing "used" and
 * produce an empty bundle. This disables tree-shaking on the entry module
 * and strips the trailing `export {};` statement Apps Script can't parse.
 */
function appsScriptEntryPoint() {
  return {
    name: 'apps-script-entry-point',
    async resolveId(source, importer, options) {
      if (!importer) {
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
