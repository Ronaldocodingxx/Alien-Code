// Names that are in scope in every Alien file. Derived from the runtime's exports,
// so adding a function to src/runtime.js is enough to make it a prelude name.

import * as RT from "./runtime.js";

export const INTERNAL = new Set(["tests", "test", "AssertError", "err", "noMatch", "show", "assertEq", "setArgs"]);
export const PRELUDE = new Set(Object.keys(RT).filter((k) => !INTERNAL.has(k)));
