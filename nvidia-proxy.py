#!/usr/bin/env python3
"""
Minimal Anthropic → NVIDIA API proxy.
Translates /v1/messages (Anthropic format) to NVIDIA OpenAI-compatible API.
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.request, urllib.error

NVIDIA_API_KEY = "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"
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
MODEL = "qwen/qwen3.5-397b-a17b"
PORT = 4099


def anthropic_to_openai(body: dict) -> dict:
    """Convert Anthropic Messages API body to OpenAI Chat Completions body."""
    messages = []

    # system prompt
    if "system" in body:
        sys_content = body["system"]
        if isinstance(sys_content, list):
            sys_content = " ".join(
                b.get("text", "") for b in sys_content if b.get("type") == "text"
            )
        messages.append({"role": "system", "content": sys_content})

    # user/assistant turns
    for msg in body.get("messages", []):
        content = msg["content"]
        if isinstance(content, list):
            # extract text blocks
            content = " ".join(
                b.get("text", "") for b in content if b.get("type") == "text"
            )
        messages.append({"role": msg["role"], "content": content})

    return {
        "model": MODEL,
        "messages": messages,
        "max_tokens": body.get("max_tokens", 4096),
        "temperature": body.get("temperature", 0.6),
        "top_p": body.get("top_p", 0.95),
        "stream": body.get("stream", False),
    }


def openai_to_anthropic(body: dict, req_model: str) -> dict:
    """Convert OpenAI Chat Completions response to Anthropic Messages response."""
    choice = body["choices"][0]
    usage = body.get("usage", {})
    return {
        "id": body.get("id", "msg_nvidia"),
        "type": "message",
        "role": "assistant",
        "model": req_model,
        "content": [{"type": "text", "text": choice["message"]["content"]}],
        "stop_reason": "end_turn" if choice.get("finish_reason") == "stop" else choice.get("finish_reason"),
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence access logs

    def send_json(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "model": MODEL})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            req_body = json.loads(raw)
        except Exception:
            self.send_json(400, {"error": "invalid json"})
            return

        req_model = req_body.get("model", "claude-sonnet-4-6")
        oai_body = anthropic_to_openai(req_body)
        payload = json.dumps(oai_body).encode()

        nvidia_req = urllib.request.Request(
            NVIDIA_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {NVIDIA_API_KEY}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(nvidia_req, timeout=120) as resp:
                oai_resp = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            self.send_json(e.code, {"error": {"message": err, "type": "upstream_error"}})
            return
        except Exception as e:
            self.send_json(500, {"error": {"message": str(e), "type": "proxy_error"}})
            return

        anthropic_resp = openai_to_anthropic(oai_resp, req_model)
        self.send_json(200, anthropic_resp)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), ProxyHandler)
    print(f"nvidia-proxy listening on 127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
