[CmdletBinding()]
param(
  [string]$ProjectRef = 'vrgkkcunbngjgqfmlcuh',
  [string]$SupabaseCliPath = $env:SUPABASE_CLI_PATH,
  [switch]$ResolveOnly
)

$ErrorActionPreference = 'Stop'
$env:SUPABASE_TELEMETRY_DISABLED = '1'
$env:DO_NOT_TRACK = '1'

function Resolve-SupabaseCli {
  if ($SupabaseCliPath) {
    if (-not (Test-Path -LiteralPath $SupabaseCliPath -PathType Leaf)) {
      throw "SUPABASE_CLI_PATH does not point to a file: $SupabaseCliPath"
    }
    return (Resolve-Path -LiteralPath $SupabaseCliPath).Path
  }

  $installed = Get-Command supabase -ErrorAction SilentlyContinue
  if ($installed) { return $installed.Source }

  $searchRoots = @(
    (Join-Path $env:LOCALAPPDATA 'pnpm\store\v11\links\@supabase\cli-windows-x64'),
    (Join-Path $env:LOCALAPPDATA 'pnpm\store\v10\links\@supabase\cli-windows-x64'),
    (Join-Path $PSScriptRoot '..\node_modules\.pnpm')
  )
  foreach ($searchRoot in $searchRoots) {
    if (-not (Test-Path -LiteralPath $searchRoot)) { continue }
    $candidate = Get-ChildItem -LiteralPath $searchRoot -Filter 'supabase.exe' -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  throw 'Supabase CLI was not found. Install it once, or set SUPABASE_CLI_PATH to the full supabase.exe path.'
}

$supabase = Resolve-SupabaseCli
Write-Host "Supabase CLI: $supabase"
& $supabase --version
if ($LASTEXITCODE -ne 0) { throw 'The resolved Supabase CLI could not start.' }
if ($ResolveOnly) {
  Write-Host 'Supabase CLI resolution passed. No function deployment was attempted.'
  exit 0
}

Write-Host 'Deploying delete-account with Supabase server-side bundling...'
& $supabase functions deploy delete-account --project-ref $ProjectRef --use-api
if ($LASTEXITCODE -ne 0) { throw 'The delete-account Edge Function did not deploy.' }

Write-Host 'Verifying the remote Edge Function list...'
& $supabase functions list --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw 'delete-account was sent for deployment, but the remote list could not be verified.' }

Write-Host 'Account deletion deployed.'
