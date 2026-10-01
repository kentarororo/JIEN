# Creates a synthetic nutrition label, never a user's photo or health record.
Add-Type -AssemblyName System.Drawing
$fixtureDirectory = Join-Path $PSScriptRoot '..\e2e\fixtures'
[System.IO.Directory]::CreateDirectory($fixtureDirectory) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 700, 600
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$font = New-Object System.Drawing.Font 'Arial', 24
try {
  $graphics.Clear([System.Drawing.Color]::White)
  $lines = @('TEST CEREAL', 'Synthetic QA label - not a real product', 'Serving size: 50 g', 'Calories: 200 kcal', 'Protein: 10 g', 'Carbohydrate: 30 g', 'Fat: 4 g', 'Fibre: 3 g')
  $y = 30
  foreach ($line in $lines) {
    $graphics.DrawString($line, $font, [System.Drawing.Brushes]::Black, 24, $y)
    $y += 65
  }
  $bitmap.Save((Join-Path $fixtureDirectory 'nutrition-label.png'), [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
