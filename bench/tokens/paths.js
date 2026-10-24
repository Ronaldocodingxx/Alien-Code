function paths(v, p = "") {
  if (Array.isArray(v)) return v.flatMap((x, i) => paths(x, `${p}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => paths(x, p === "" ? k : `${p}.${k}`));
  return [`${p}: ${typeof v}`];
}
const data = { a: { b: [1, { c: "x" }] }, d: true };
for (const line of paths(data)) console.log(line);
