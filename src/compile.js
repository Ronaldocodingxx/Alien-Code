// Public compiler API.
//   compile(src, { displayFile, runtimeUrl, sourceUrl?, alnExt?, printLast?, map? })
//   -> { code, deps: [{ path, line, col }] }    throws AlienError on invalid code
//
// displayFile: path used in diagnostics
// runtimeUrl:  module specifier the generated code imports the runtime from
// alnExt:      rewrite `use "x.aln"` to this extension (".mjs" for `alien build`)
// printLast:   print the value of the last top-level expression (`alien eval`)

import { parse } from "./parser.js";
import { generate } from "./codegen.js";

export function compile(src, opts) {
  const ast = parse(src, opts.displayFile);
  return generate(ast, { ...opts, src });
}

export { parse, generate };
export { AlienError } from "./errors.js";
