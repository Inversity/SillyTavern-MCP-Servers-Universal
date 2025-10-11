# MCP Servers Universal

Manage and auto‑register Model Context Protocol (MCP) servers inside SillyTavern. Start/stop servers, enable or disable their tools, and bulk import new server definitions directly from pasted JSON snippets.

---
## ⚠️ WARNING
**MCP servers can execute arbitrary commands and access your system resources. Using MCP servers without understanding what they do can be DANGEROUS. Always review server configurations before adding them. USE AT YOUR OWN RISK.**

---
## Features
- Server list with live status (Running / Stopped)
- Start, Stop, Reload tools buttons per server
- Enable/disable server (checkbox)
- View & toggle individual tools per server
- Auto‑registration of MCP tools as function calling tools (`mcp__<server>__<tool>`)
- Add single server from raw snippet
- Bulk import multiple servers at once
- Edit server configuration JSON in place
- Delete server entries
- Automatic tool cache refresh after changes

---
## Installation
1. In SillyTavern open the **Extensions** panel.
2. Use **Install from Git** and provide the repository URL:
	 ```
	 https://github.com/Inversity/SillyTavern-MCP-Servers-Universal
	 ```
3. Reload / restart SillyTavern if the panel does not appear automatically.
4. Look for the drawer titled **MCP Servers Universal**.

---
## Quick Start
1. Open the **MCP Servers Universal** panel.
2. Click **Add server** and paste a config snippet (examples below) then press **Add**.
3. Ensure the server's checkbox is ON (enabled). If not running, click **Start**.
4. Click the **Tools** button to enable/disable specific tools (Save to apply).
5. Initiate a generation with a tool‑capable model (OpenAI/Claude/etc.) and function calling enabled; tools will appear under `/tools-list`.

---
## Snippet Formats Accepted
You can paste any of the following into the **Add server** popup:

### 1. Named Key + Object
```json
"OpenMemory": {
	"type": "stdio",
	"command": "npx",
	"args": ["-y", "openmemory"],
	"env": {"OPENMEMORY_API_KEY": "sk_your_key", "CLIENT_NAME": "openmemory"}
}
```

### 2. Bare Object (provide name field or fill the name input)
```json
{
	"type": "http",
	"url": "https://mcp.deepwiki.com/sse"
}
```
Provide a name in the separate input if not embedded.

### 3. Multi‑Import (Import button)
```json
"playwright": {"type": "stdio", "command": "npx", "args": ["@playwright/mcp@latest", "--browser=chromium", "--headless"]},
"filesystem": {"type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "%ST%", "%APPDATA%/Code - Insiders"]}
```
Or wrap them:
```json
{
	"playwright": {"type": "stdio", "command": "npx", "args": ["@playwright/mcp@latest"]},
	"deepwiki": {"type": "http", "url": "https://mcp.deepwiki.com/sse"}
}
```

---
## Editing a Server
1. Click **Edit** next to a server.
2. Modify the JSON (must remain valid).
3. Save to overwrite the stored configuration.

## Deleting a Server
Click **Del** → confirm. Tools from that server are unregistered automatically.

---
## Tool Registration Details
- Naming pattern: `mcp__<serverName>__<toolName>` (non‑alphanumerics replaced by `_`).
- Parameters schema comes directly from the MCP tool's advertised input schema (defaults to empty object if missing).
- Action: Calls `/api/plugins/mcp/servers/<name>/call-tool` which proxies to the MCP server.
- Display name: `<Server>: <Tool>`.

Tools unregister automatically if a server or tool is disabled/removed on reload.

---
## Validation Logic
- `type` defaults to `stdio` if omitted and no `url` provided; becomes `http` if `url` exists.
- For `stdio`: `command` required.
- For `http`/`sse`: `url` required.
- Import silently overwrites existing servers with the same name (delete + recreate).

---
## Troubleshooting
| Symptom | Resolution |
|---------|------------|
| Server shows *Stopped* after Add | Click **Start**; ensure command/path is accessible in environment. |
| Tools not appearing in `/tools-list` | Press **Reload tools** or ensure function calling + tool model active. |
| Tool invocation fails | Check server logs / run command manually; verify environment variables. |
| Import says *No valid server blocks* | Ensure pasted text is valid JSON snippets; see formats section. |

---
## Security Notes
- Environment variables entered in configs are stored in the MCP settings file. Avoid committing secrets to version control. Prefer referencing externally injected environment variables where possible.
- Rotating a key? Edit server → update env → Save → Restart server.

---
## Versioning
| Version | Notes |
|---------|-------|
| 0.2.0 | Universal naming, bulk import, edit/delete, improved validation |
| 0.1.0 | Initial implementation |

---
## Roadmap / Ideas
- Schema-driven form builder (fields instead of raw JSON)
- Export selected servers as snippet
- Per-tool usage metrics
- Group actions (start/stop all)

---
## License
MIT License – see [LICENSE](./LICENSE).

---
## Contributing
1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit changes + tests where applicable
4. Open a PR describing rationale & screenshots

---
## Acknowledgements
Built for the SillyTavern ecosystem by **Inversity**. Inspired by the emerging Model Context Protocol specification.
