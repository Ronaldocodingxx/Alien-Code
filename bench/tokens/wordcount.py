from collections import Counter

text = "the cat and the dog and the bird"
for w, n in Counter(text.split(" ")).most_common(3):
    print(f"{w}: {n}")
