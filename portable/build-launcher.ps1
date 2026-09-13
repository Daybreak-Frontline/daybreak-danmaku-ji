$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$png = Join-Path $here '..\web\public\zhuzhan.png'
$ico = Join-Path $here 'zhuzhan.ico'
$cs = Join-Path $here 'Launcher.cs'
$built = Join-Path $here 'DanmakuJi.exe'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile($png)
$sizes = @(16, 32, 48)
$images = New-Object System.Collections.Generic.List[byte[]]
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, $size, $size)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $images.Add($ms.ToArray())
    $bmp.Dispose()
    $ms.Dispose()
}
$src.Dispose()

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $out
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$images.Count)
$offset = 6 + (16 * $images.Count)
for ($i = 0; $i -lt $images.Count; $i++) {
    $size = $sizes[$i]
    $data = $images[$i]
    $bw.Write([byte]$size)
    $bw.Write([byte]$size)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$data.Length)
    $bw.Write([uint32]$offset)
    $offset += $data.Length
}
foreach ($data in $images) { $bw.Write($data) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($ico, $out.ToArray())
$bw.Dispose()
$out.Dispose()

& $csc /nologo /target:winexe /optimize+ /win32icon:$ico /r:System.Windows.Forms.dll /out:$built $cs
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
Write-Output $built
