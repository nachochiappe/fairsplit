# Fairsplit MCP server

The MCP server lets compatible agents list, create, update, and delete Fairsplit expenses and income entries. It is a thin client of the Fairsplit API, so validation, currency conversion, recurring-expense behavior, installment behavior, and household isolation remain in one place.

## 1. Create a token

Open **Fairsplit → Settings → Security → Agent integrations**. Create a token and copy it immediately; only its hash is stored.

Integration tokens are deliberately limited to these transaction routes:

- list household members and categories
- list one month's expenses and incomes
- create, update, and delete expenses
- create, update, and delete individual income entries

They cannot change profile, household, passkey, session, or category settings. Revoking a token takes effect on its next API request.

## 2. Build

```bash
pnpm --filter @fairsplit/mcp build
```

## Local stdio transport

Use stdio with Codex, Claude, Claude Code, and other local MCP hosts. Every host needs the same three values:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/fairsplit/apps/mcp/dist/stdio.js"],
  "env": {
    "FAIRSPLIT_API_URL": "https://your-fairsplit-api.example.com/api",
    "FAIRSPLIT_API_TOKEN": "fsp_..."
  }
}
```

For Codex, the equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.fairsplit]
command = "node"
args = ["/absolute/path/to/fairsplit/apps/mcp/dist/stdio.js"]

[mcp_servers.fairsplit.env]
FAIRSPLIT_API_URL = "https://your-fairsplit-api.example.com/api"
FAIRSPLIT_API_TOKEN = "fsp_..."
```

For Claude Desktop, put the JSON shape under `mcpServers.fairsplit` in the Claude Desktop configuration. Claude Code can use the same command, arguments, and environment through its MCP configuration or `claude mcp add-json`.

## Remote Streamable HTTP transport

Remote clients use `https://your-mcp-host.example.com/mcp` and send the integration token as an HTTP header:

```text
Authorization: Bearer fsp_...
```

Run locally with:

```bash
MCP_HOST=127.0.0.1 \
MCP_PORT=4101 \
FAIRSPLIT_API_URL=http://localhost:4000/api \
pnpm --filter @fairsplit/mcp dev:http
```

For a public deployment, bind `MCP_HOST=0.0.0.0` and set `MCP_ALLOWED_HOSTS` to a comma-separated hostname allowlist. TLS should terminate at the deployment platform or reverse proxy.

The OpenAI Responses API can pass the bearer value with the remote MCP tool's `headers` option. ChatGPT custom apps connect to the same remote endpoint; if the workspace requires interactive per-user authorization rather than an administrator-managed bearer credential, place an OAuth 2.1 authorization gateway in front of this endpoint.

ChatGPT cannot connect directly to a local stdio server. Deploy the HTTPS endpoint or use OpenAI's Secure MCP Tunnel. At the time of writing, full write-capable custom MCP apps are available to ChatGPT Business and Enterprise/Edu workspaces; consult the [current ChatGPT MCP availability notes](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) before rollout.

## Tools

- `get_household_context`
- `list_month`
- `create_income`
- `update_income`
- `delete_income`
- `create_expense`
- `update_expense`
- `delete_expense`

Write tools accept an exact household-member or category name as well as an id. Ambiguous or missing names fail instead of guessing.
