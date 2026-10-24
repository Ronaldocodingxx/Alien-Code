const todos = [];
function add(title) {
  todos.push({ id: todos.length + 1, title, done: false });
}
function complete(id) {
  todos.find((t) => t.id === id).done = true;
}
function pending() {
  return todos.filter((t) => !t.done).map((t) => t.title);
}
add("write spec");
add("ship it");
complete(1);
console.log(pending());
