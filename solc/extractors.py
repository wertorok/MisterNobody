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
    defined = set()
    fn_stack = []
    class_stack = []

    def walk(node):
        opened_fn = False
        opened_class = False

        if node.type == "class_definition":
            cn = node.child_by_field_name("name")
            if cn is not None:
                class_stack.append(cn.text.decode())
                defined.add(".".join(class_stack))
                opened_class = True

        if node.type == "function_definition":
            nn = node.child_by_field_name("name")
            if nn is not None:
                method = nn.text.decode()
                if class_stack:
                    qualified = ".".join(class_stack + [method])
                    edges.append((".".join(class_stack), qualified))
                else:
                    qualified = method
                defined.add(qualified)
                fn_stack.append(qualified)
                opened_fn = True

        if node.type == "call" and fn_stack:
            callee = _callee_name(node)
            if callee:
                edges.append((fn_stack[-1], callee))

        for child in node.children:
            walk(child)

        if opened_fn:
            fn_stack.pop()
        if opened_class:
            class_stack.pop()

    walk(tree.root_node)
    return edges, defined


def iter_python_files(repo_path):
    root = Path(repo_path)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for f in filenames:
            if f.endswith(".py"):
                yield Path(dirpath) / f


def extract_repo_calls(repo_path):
    edges = []
    defined = set()
    for path in iter_python_files(repo_path):
        try:
            code = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        e, d = extract_python_calls(code)
        edges.extend(e)
        defined.update(d)
    return edges, defined
