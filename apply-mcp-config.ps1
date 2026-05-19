# Copies supabase-mcp-config.json -> .cursor/mcp.json
$src = Join-Path $PSScriptRoot "supabase-mcp-config.json"
$dst = Join-Path $PSScriptRoot ".cursor\mcp.json"
if (-not (Test-Path $src)) { Write-Error "Missing supabase-mcp-config.json"; exit 1 }
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Copy-Item -Force $src $dst
Write-Host "Copied to .cursor\mcp.json. Restart Cursor, then enable supabase in Tools and MCP."
