[CmdletBinding()]
param(
  [string]$ProjectRef = 'vrgkkcunbngjgqfmlcuh',
  [string]$Model = 'gemini-3.5-flash-lite'
)

$ErrorActionPreference = 'Stop'

if ($ProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw 'ProjectRef must be a 20-character Supabase project reference.'
}
if ($Model -notmatch '^[A-Za-z0-9._-]{1,128}$') {
  throw 'Model contains unsupported characters.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $repoRoot

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  $bundledNodeDir = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
  $bundledNode = Join-Path $bundledNodeDir 'node.exe'
  if (-not (Test-Path -LiteralPath $bundledNode)) {
    throw 'Node.js was not found. Reopen this repository in Codex, or install Node.js LTS, then run this script again.'
  }
  $env:Path = "$bundledNodeDir;$env:Path"
}

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpmCommand) {
  $pnpmPath = $pnpmCommand.Source
} else {
  $pnpmPath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
  if (-not (Test-Path -LiteralPath $pnpmPath)) {
    throw 'pnpm was not found. Reopen this repository in Codex, or install pnpm, then run this script again.'
  }
}

Write-Host ''
Write-Host 'JIEN deployment-owned AI fallback setup' -ForegroundColor Cyan
Write-Host "Project: $ProjectRef"
Write-Host "Model:   $Model"
Write-Host 'Paste a JIEN-owned Gemini API key from Google AI Studio. The key is sent only to Supabase Secrets.'
Write-Host 'Normal testers can instead connect their own key inside Settings > AI connection.'

$secureKey = Read-Host 'Gemini API key' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$plainKey = $null
$tempSecretFile = Join-Path ([IO.Path]::GetTempPath()) ("jien-photo-ai-{0}.env" -f [Guid]::NewGuid().ToString('N'))

try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  if ($plainKey -notmatch '^[A-Za-z0-9_-]{20,256}$') {
    throw 'That does not look like a Gemini API key. Copy the key itself from Google AI Studio and try again.'
  }

  $secretFileContents = @(
    'PHOTO_AI_PROVIDER=gemini'
    'WELLNESS_AI_PROVIDER=gemini'
    "GEMINI_API_KEY=$plainKey"
    "GEMINI_MODEL=$Model"
  ) -join [Environment]::NewLine
  [IO.File]::WriteAllText($tempSecretFile, $secretFileContents, [Text.UTF8Encoding]::new($false))

  Write-Host ''
  Write-Host 'Saving server-only secrets...' -ForegroundColor Cyan
  & $pnpmPath dlx supabase@latest secrets set --env-file $tempSecretFile --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'Supabase could not save the photo-analysis secrets.' }

  Write-Host ''
  Write-Host 'Deploying the current AI functions...' -ForegroundColor Cyan
  foreach ($functionName in @('ai-settings', 'analyze-food-photo', 'wellness-chat')) {
    & $pnpmPath dlx supabase@latest functions deploy $functionName --project-ref $ProjectRef --use-api
    if ($LASTEXITCODE -ne 0) { throw "Supabase could not deploy $functionName." }
  }

  Write-Host ''
  Write-Host 'Configured secret names:' -ForegroundColor Cyan
  & $pnpmPath dlx supabase@latest secrets list --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'The function deployed, but Supabase could not list the configured secret names.' }

  Write-Host ''
  Write-Host 'The deployment-owned fallback is configured. Push the app build, then check Settings > AI connection.' -ForegroundColor Green
} finally {
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
  $plainKey = $null
  if (Test-Path -LiteralPath $tempSecretFile) {
    Remove-Item -LiteralPath $tempSecretFile -Force
  }
}
