"""
TM Robot HMI — MCP server.

Exposes the robot HTTP API as MCP tools so external agents (Claude Code,
Claude Desktop, Langflow Agent canvas, ...) can drive the robots.

Architecture
------------
This is a *thin wrapper* around the Langflow backend's REST API. It does NOT
talk to the robot adapters directly — that way the Langflow UI and external
agents share the same single source of truth (the registry inside the running
backend), instead of forking state across processes.

Prerequisites
-------------
- Langflow backend running at ``ROBOT_API_BASE`` (default ``http://localhost:7860/api/v1/robots``).

Usage
-----
Run as a stdio MCP server (used by Claude Desktop / Claude Code / mcp inspect):

    .venv/bin/python mcp_server.py

Claude Desktop config example (``~/Library/Application Support/Claude/claude_desktop_config.json``)::

    {
      "mcpServers": {
        "tm-robot": {
          "command": "/abs/path/to/robot-hmi/.venv/bin/python",
          "args": ["/abs/path/to/robot-hmi/mcp_server.py"],
          "env": {"ROBOT_API_BASE": "http://localhost:7860/api/v1/robots"}
        }
      }
    }
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

API_BASE = os.environ.get("ROBOT_API_BASE", "http://localhost:7860/api/v1/robots").rstrip("/")
HTTP_TIMEOUT = float(os.environ.get("ROBOT_API_TIMEOUT", "15"))

server: Server = Server("tm-robot-hmi")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="list_robots",
            description="List all configured robots and their connection status.",
            inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
        ),
        Tool(
            name="get_robot_status",
            description=(
                "Get the live status of a specific robot — joint angles (degrees), "
                "gripper state, operating mode."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "robot_id": {"type": "string", "description": "Robot ID, e.g. robot_01"},
                },
                "required": ["robot_id"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="send_command",
            description=(
                "Send a single command to a robot. Supported commands: "
                "HOME (no params), MOVE (j1..j6 in degrees), GRIPPER (state=open|close), "
                "WAIT (duration in seconds), JOG (joint=J1..J6, delta in degrees)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "robot_id": {"type": "string"},
                    "cmd": {
                        "type": "string",
                        "enum": ["HOME", "MOVE", "GRIPPER", "WAIT", "JOG"],
                    },
                    "params": {"type": "object", "additionalProperties": True},
                },
                "required": ["robot_id", "cmd"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="run_program",
            description=(
                "Execute a multi-line robot script. Each non-empty, non-comment line is "
                "`COMMAND key=value key=value ...`. Returns a per-line execution log."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "robot_id": {"type": "string"},
                    "code": {
                        "type": "string",
                        "description": "Robot script. Lines starting with # are comments.",
                    },
                },
                "required": ["robot_id", "code"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="generate_program_from_nl",
            description=(
                "Translate a natural-language instruction into a robot script using "
                "the backend's AI assistant. Returns the generated script — call "
                "run_program to actually execute it."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "robot_id": {"type": "string"},
                    "instruction": {
                        "type": "string",
                        "description": "Natural language description of the desired motion.",
                    },
                },
                "required": ["robot_id", "instruction"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="list_robot_configs",
            description="List robot configurations (adapter / host / port) and available adapters.",
            inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
        ),
    ]


def _text(payload: Any) -> list[TextContent]:
    if isinstance(payload, str):
        return [TextContent(type="text", text=payload)]
    return [TextContent(type="text", text=json.dumps(payload, ensure_ascii=False, indent=2))]


def _error(msg: str, status: int | None = None) -> list[TextContent]:
    prefix = f"[HTTP {status}] " if status else ""
    return [TextContent(type="text", text=f"ERROR: {prefix}{msg}")]


async def _request(client: httpx.AsyncClient, method: str, path: str, **kwargs):
    url = f"{API_BASE}{path}"
    try:
        r = await client.request(method, url, **kwargs)
    except httpx.RequestError as e:
        return None, _error(f"connection to {url} failed: {e}")
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail", r.text)
        except Exception:
            detail = r.text
        return None, _error(detail, r.status_code)
    return r, None


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    arguments = arguments or {}
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        if name == "list_robots":
            r, err = await _request(client, "GET", "")
            return err or _text(r.json())

        if name == "get_robot_status":
            robot_id = arguments["robot_id"]
            r, err = await _request(client, "GET", f"/{robot_id}/status")
            return err or _text(r.json())

        if name == "send_command":
            robot_id = arguments["robot_id"]
            body = {"cmd": arguments["cmd"], "params": arguments.get("params") or {}}
            r, err = await _request(client, "POST", f"/{robot_id}/command", json=body)
            return err or _text(r.json())

        if name == "run_program":
            body = {"robot_id": arguments["robot_id"], "code": arguments["code"]}
            r, err = await _request(client, "POST", "/run", json=body)
            return err or _text(r.json())

        if name == "generate_program_from_nl":
            body = {
                "robot_id": arguments["robot_id"],
                "instruction": arguments["instruction"],
            }
            r, err = await _request(client, "POST", "/nl-program", json=body)
            return err or _text(r.json())

        if name == "list_robot_configs":
            r, err = await _request(client, "GET", "/config")
            return err or _text(r.json())

        return _error(f"Unknown tool: {name}")


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
