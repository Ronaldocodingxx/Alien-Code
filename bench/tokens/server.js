import express from "express";

const app = express();
app.use(express.json());
const items = [];
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

app.get("/", (req, res) => {
  const lis = items.map((i) => `<li>${esc(i)}</li>`).join("");
  res.send(`<!doctype html><html><head><title>Items</title></head><body><h1>Items</h1><ul>${lis}</ul></body></html>`);
});
app.get("/api/items", (req, res) => res.json(items));
app.post("/api/items", (req, res) => {
  items.push(req.body.name);
  res.json({ ok: true });
});
app.listen(8080);
