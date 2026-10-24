todos = []

def add(title):
    todos.append({"id": len(todos) + 1, "title": title, "done": False})

def complete(id):
    next(t for t in todos if t["id"] == id)["done"] = True

def pending():
    return [t["title"] for t in todos if not t["done"]]

add("write spec")
add("ship it")
complete(1)
print(pending())
