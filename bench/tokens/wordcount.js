const text = "the cat and the dog and the bird";
const counts = {};
for (const w of text.split(" ")) counts[w] = (counts[w] || 0) + 1;
const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
for (const [w, n] of top) console.log(`${w}: ${n}`);
