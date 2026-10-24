function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
const t = Date.now(); const r = fib(32);
console.log(`js    fib(32) = ${r} in ${Date.now() - t}ms`);
