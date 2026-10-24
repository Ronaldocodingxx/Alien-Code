from flask import Flask, request, jsonify
from html import escape

app = Flask(__name__)
items = []

@app.get("/")
def home():
    lis = "".join(f"<li>{escape(i)}</li>" for i in items)
    return f"<!doctype html><html><head><title>Items</title></head><body><h1>Items</h1><ul>{lis}</ul></body></html>"

@app.get("/api/items")
def list_items():
    return jsonify(items)

@app.post("/api/items")
def add_item():
    items.append(request.json["name"])
    return jsonify(ok=True)
