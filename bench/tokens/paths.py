def paths(v, p=""):
    if isinstance(v, list):
        return [x for i, item in enumerate(v) for x in paths(item, f"{p}[{i}]")]
    if isinstance(v, dict):
        return [x for k, item in v.items() for x in paths(item, k if p == "" else f"{p}.{k}")]
    return [f"{p}: {type(v).__name__}"]

data = {"a": {"b": [1, {"c": "x"}]}, "d": True}
for line in paths(data):
    print(line)
