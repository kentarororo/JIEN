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
  if ($installed) {
    return $installed.Source
  }

  $searchRoots = @(
    (Join-Path $env:LOCALAPPDATA 'pnpm\store\v11\links\@supabase\cli-windows-x64'),
    (Join-Path $env:LOCALAPPDATA 'pnpm\store\v10\links\@supabase\cli-windows-x64'),
    (Join-Path $PSScriptRoot '..\node_modules\.pnpm')
  )

  foreach ($searchRoot in $searchRoots) {
    if (Test-Path -LiteralPath $searchRoot) {
      $candidate = Get-ChildItem -LiteralPath $searchRoot -Filter 'supabase.exe' -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
      if ($candidate) {
        return $candidate.FullName
      }
    }
  }

  throw 'Supabase CLI was not found. Install it once, or set SUPABASE_CLI_PATH to the full supabase.exe path, then rerun this script.'
}

$supabase = Resolve-SupabaseCli
Write-Host "Supabase CLI: $supabase"
& $supabase --version
if ($LASTEXITCODE -ne 0) {
  throw 'The resolved Supabase CLI could not start.'
}
if ($ResolveOnly) {
  Write-Host 'Supabase CLI resolution passed. No migration or function deployment was attempted.'
  exit 0
}

Write-Host 'Checking the linked Supabase project...'
& $supabase migration list
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Supabase needs a one-time browser login before deployment.'
  & $supabase login
  if ($LASTEXITCODE -ne 0) {
    throw 'Supabase login did not complete.'
  }
  & $supabase migration list
  if ($LASTEXITCODE -ne 0) {
    throw 'The linked Supabase project could not be checked after login.'
  }
}

Write-Host 'Applying the secure per-user AI key migration...'
& $supabase db push
if ($LASTEXITCODE -ne 0) {
  throw 'The Supabase database migration did not complete.'
}

foreach ($functionName in @('ai-settings', 'analyze-food-photo', 'wellness-chat')) {
  Write-Host "Deploying $functionName with Supabase server-side bundling (Docker is not required)..."
  & $supabase functions deploy $functionName --project-ref $ProjectRef --use-api
  if ($LASTEXITCODE -ne 0) {
    throw "The $functionName Edge Function did not deploy."
  }
}

Write-Host 'Verifying the remote Edge Function list...'
& $supabase functions list --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) {
  throw 'The functions were sent for deployment, but the remote function list could not be verified.'
}

Write-Host 'AI slice deployed: key connection, meal-photo analysis, and contextual wellness are ready.'
