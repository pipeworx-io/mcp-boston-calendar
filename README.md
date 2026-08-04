# mcp-boston-calendar

The Boston Calendar MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `events` | Upcoming Greater Boston events from The Boston Calendar. Defaults to a 2-week window from today. Filter by date range, keyword (title/description/tags), and free admission. Returns normalized events sorted by date/time. |
| `tags` | List the event tags/keywords in use on The Boston Calendar, with counts — useful as filterable facets for the events tool. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "boston-calendar": {
      "url": "https://gateway.pipeworx.io/boston-calendar/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Boston Calendar data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
