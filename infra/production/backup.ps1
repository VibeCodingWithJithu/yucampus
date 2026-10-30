# Nightly backup on a Windows computer (docs/DEPLOY_HOME.md, step 8): the database and the evidence files.
# Keeps 14 days in the folder. Copy that folder somewhere else too (another drive or computer in India): a backup on
# the same computer does not survive losing the computer.
#   powershell -ExecutionPolicy Bypass -File backup.ps1 [-Dir D:\YuCampus-backups]
param([string]$Dir = "$env:USERPROFILE\YuCampus-backups")
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force $Dir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd'

function Run([string]$what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "Backup failed while $what (exit code $LASTEXITCODE)." }
}

# The dump is written inside the container and copied out: piping binary output through PowerShell would damage it.
Run 'dumping the database' { docker compose exec -T postgres pg_dump -U yucampus -d yucampus -Fc -f /tmp/backup.dump }
Run 'copying the database dump' { docker compose cp postgres:/tmp/backup.dump "$Dir\database-$stamp.dump" }
Run 'cleaning up' { docker compose exec -T postgres rm /tmp/backup.dump }
Run 'archiving the files' { docker run --rm -v yucampus-live_storage-data:/data:ro -v "${Dir}:/backup" alpine:3.22 tar czf "/backup/files-$stamp.tar.gz" -C /data . }

Get-ChildItem $Dir -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item
"Backup written to $Dir ($stamp)"
