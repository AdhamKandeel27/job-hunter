# One daily run: make sure Postgres is up, then run the agent and keep a log.
# Schedule it with scripts\register-daily-task.ps1.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force logs | Out-Null
$log = "logs\run-$(Get-Date -Format yyyy-MM-dd).log"

"=== $(Get-Date -Format s) ===" | Out-File $log -Append -Encoding utf8
docker compose up -d --wait *>> $log
npm run agent *>> $log
