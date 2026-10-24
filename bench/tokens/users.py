def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

users = [{"name": "ada", "age": 36}, {"name": "bob", "age": 12}, {"name": "cy", "age": 51}]
adults = ", ".join(sorted(u["name"].upper() for u in users if u["age"] >= 18))
print(fib(20), adults)
