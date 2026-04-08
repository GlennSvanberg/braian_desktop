# MCP test workspace

This folder is a **minimal Braian workspace** used for fast MCP broker checks (`npm run mcp:dev`).

- Config: `.braian/mcp.json` (same shape as a real workspace).
- Edit paths here (e.g. `p360-rest` `--directory`) to match your machine, or point `MCP_TEST_WORKSPACE` at another folder that contains `.braian/mcp.json`.

## Expected probe outcomes (vary by machine)


| Server           | Notes                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **context7**     | Public remote MCP; should probe OK with network.                                                                                                                                                                                                      |
| **tanstack**     | May return **401** without TanStack API credentials in `headers`.                                                                                                                                                                                     |
| **p360-rest**    | Needs `uv`, valid `--directory`, and reachable `P360_`* env. In JSON, Windows paths use **doubled backslashes** in the file (e.g. `"C:\\git\\SKF\\..."`) — that is one `\` per segment in the real path, not “single vs double” as typed in Explorer. |
| **azure-devops** | Uses `npx` (on Windows the broker runs `cmd /c npx …`). May still need org auth / browser login for real tool calls; **probe** can still list tools if the package starts.                                                                            |


Do not commit production secrets; the checked-in file is for a shared test environment only.