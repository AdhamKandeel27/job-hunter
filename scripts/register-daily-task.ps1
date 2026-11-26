# Registers a Windows scheduled task that runs the agent once a day.
# Usage:  .\scripts\register-daily-task.ps1 -At 09:00
# Remove: Unregister-ScheduledTask -TaskName "Job agent daily run" -Confirm:$false
param([string]$At = "09:00")

$script = Join-Path $PSScriptRoot "run-daily.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
# If the machine was off at the set time, run as soon as it is back on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName "Job agent daily run" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
"Registered: the agent runs daily at $At (Docker Desktop must be running)."
