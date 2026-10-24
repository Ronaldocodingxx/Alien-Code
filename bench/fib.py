import time
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
t = time.time(); r = fib(32)
print(f"python fib(32) = {r} in {int((time.time() - t) * 1000)}ms")
