import os
from pathlib import Path

import tree_sitter_python
from tree_sitter import Language, Parser

_PY_LANGUAGE = Language(tree_sitter_python.language())
_PY_PARSER = Parser(_PY_LANGUAGE)

_SKIP_DIRS = {"__pycache__", ".git", ".venv", "venv", "node_modules", "dist", "build"}


def _callee_name(call_node):
    fn = call_node.child_by_field_name("function")
    if fn is None and call_node.child_count:
        fn = call_node.child(0)
    if fn is None:
        return None
    if fn.type == "identifier":
        return fn.text.decode()
    if fn.type == "attribute":
        last = None
        for c in fn.children:
            if c.type == "identifier":
                last = c
        return last.text.decode() if last else None
    return None


def extract_python_calls(code: str):
    tree = _PY_PARSER.parse(code.encode("utf-8"))
    edges = []
    fn_stack = []

    def walk(node):
        opened = False
        if node.type == "function_definition":
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                fn_stack.append(name_node.text.decode())
                opened = True
        if node.type == "call" and fn_stack:
            callee = _callee_name(node)
            if callee:
                edges.append((fn_stack[-1], callee))
        for child in node.children:
            walk(child)
        if opened:
            fn_stack.pop()

    walk(tree.root_node)
    return edges


def iter_python_files(repo_path):
    root = Path(repo_path)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for f in filenames:
            if f.endswith(".py"):
                yield Path(dirpath) / f


def extract_repo_calls(repo_path):
    edges = []
    for path in iter_python_files(repo_path):
        try:
            code = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        edges.extend(extract_python_calls(code))
    return edges
