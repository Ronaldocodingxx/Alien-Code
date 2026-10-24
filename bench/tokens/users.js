function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
const users = [{ name: "ada", age: 36 }, { name: "bob", age: 12 }, { name: "cy", age: 51 }];
const adults = users.filter((u) => u.age >= 18).map((u) => u.name.toUpperCase()).sort().join(", ");
console.log(fib(20), adults);
