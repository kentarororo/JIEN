[CmdletBinding()]
param(
  [string]$ProjectRef = 'vrgkkcunbngjgqfmlcuh'
)

$ErrorActionPreference = 'Stop'
$env:SUPABASE_TELEMETRY_DISABLED = '1'
$env:DO_NOT_TRACK = '1'

function Resolve-SupabaseCli {
  $installed = Get-Command supabase -ErrorAction SilentlyContinue
  if ($installed) {
    return $installed.Source
  }

  $linksRoot = Join-Path $env:LOCALAPPDATA 'pnpm\store\v11\links\@supabase\cli-windows-x64'
  if (Test-Path -LiteralPath $linksRoot) {
    $candidate = Get-ChildItem -LiteralPath $linksRoot -Directory |
      Sort-Object { [version]$_.Name } -Descending |
      ForEach-Object {
        Join-Path $_.FullName 'node_modules\@supabase\cli-windows-x64\bin\supabase.exe'
      } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1
    if ($candidate) {
      return $candidate
    }
  }

  throw 'Supabase CLI was not found. Run the Supabase login setup once, then rerun this script.'
}

$supabase = Resolve-SupabaseCli
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
  Write-Host "Deploying $functionName..."
  & $supabase functions deploy $functionName --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) {
    throw "The $functionName Edge Function did not deploy."
  }
}

Write-Host 'AI slice deployed: key connection, meal-photo analysis, and contextual wellness are ready.'
