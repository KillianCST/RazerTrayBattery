$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root 'out\razertraybattery-win32-x64'
$installerDir = Join-Path $root 'out\installer'
$stageDir = Join-Path $env:TEMP 'RazerTrayBatteryInstaller'
$payloadZip = Join-Path $stageDir 'RazerTrayBattery.zip'
$sourcePath = Join-Path $stageDir 'Installer.cs'
$stubExe = Join-Path $stageDir 'InstallerStub.exe'
$setupExe = Join-Path $installerDir 'RazerTrayBatterySetup.exe'

if (!(Test-Path $appDir)) {
  throw "Packaged app not found: $appDir. Run npm run package:win first."
}

New-Item -ItemType Directory -Force -Path $installerDir | Out-Null
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $stageDir
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $setupExe

Compress-Archive -Path (Join-Path $appDir '*') -DestinationPath $payloadZip -Force

@'
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;

class Installer
{
    const string Marker = "RTBZIP1";

    [STAThread]
    static int Main()
    {
        try
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string appDir = Path.Combine(localAppData, "Programs", "RazerTrayBattery");
            string exePath = Path.Combine(appDir, "razertraybattery.exe");
            string tempZip = Path.Combine(Path.GetTempPath(), "RazerTrayBatteryPayload.zip");

            ExtractPayload(tempZip);

            if (Directory.Exists(appDir))
            {
                Directory.Delete(appDir, true);
            }
            Directory.CreateDirectory(appDir);
            ZipFile.ExtractToDirectory(tempZip, appDir);
            File.Delete(tempZip);

            CreateShortcut(exePath, appDir);
            Process.Start(new ProcessStartInfo(exePath) { WorkingDirectory = appDir });
            return 0;
        }
        catch (Exception ex)
        {
            System.Windows.Forms.MessageBox.Show(
                ex.Message,
                "Razer Tray Battery installer",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Error
            );
            return 1;
        }
    }

    static void ExtractPayload(string destination)
    {
        string self = Process.GetCurrentProcess().MainModule.FileName;
        byte[] marker = Encoding.ASCII.GetBytes(Marker);

        using (FileStream stream = File.OpenRead(self))
        {
            if (stream.Length < marker.Length + 8)
            {
                throw new InvalidOperationException("Installer payload is missing.");
            }

            stream.Position = stream.Length - marker.Length - 8;
            byte[] footerMarker = new byte[marker.Length];
            stream.Read(footerMarker, 0, footerMarker.Length);

            for (int i = 0; i < marker.Length; i++)
            {
                if (footerMarker[i] != marker[i])
                {
                    throw new InvalidOperationException("Installer payload marker is invalid.");
                }
            }

            byte[] lengthBytes = new byte[8];
            stream.Read(lengthBytes, 0, lengthBytes.Length);
            long payloadLength = BitConverter.ToInt64(lengthBytes, 0);
            long payloadStart = stream.Length - marker.Length - 8 - payloadLength;

            if (payloadStart < 0)
            {
                throw new InvalidOperationException("Installer payload size is invalid.");
            }

            stream.Position = payloadStart;
            using (FileStream output = File.Create(destination))
            {
                byte[] buffer = new byte[1024 * 1024];
                long remaining = payloadLength;
                while (remaining > 0)
                {
                    int read = stream.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                    if (read <= 0) throw new EndOfStreamException();
                    output.Write(buffer, 0, read);
                    remaining -= read;
                }
            }
        }
    }

    static void CreateShortcut(string exePath, string workingDirectory)
    {
        string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        string shortcutPath = Path.Combine(programs, "Razer Tray Battery.lnk");
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = exePath;
        shortcut.WorkingDirectory = workingDirectory;
        shortcut.IconLocation = exePath;
        shortcut.Save();
        Marshal.FinalReleaseComObject(shortcut);
        Marshal.FinalReleaseComObject(shell);
    }
}
'@ | Set-Content -Path $sourcePath -Encoding ASCII

Add-Type `
  -TypeDefinition (Get-Content -Raw $sourcePath) `
  -OutputAssembly $stubExe `
  -OutputType WindowsApplication `
  -ReferencedAssemblies @('System.IO.Compression.FileSystem.dll', 'System.Windows.Forms.dll', 'Microsoft.CSharp.dll')

$markerBytes = [Text.Encoding]::ASCII.GetBytes('RTBZIP1')
$payloadBytes = [IO.File]::ReadAllBytes($payloadZip)
$lengthBytes = [BitConverter]::GetBytes([Int64]$payloadBytes.Length)

Copy-Item -Force $stubExe $setupExe
$stream = [IO.File]::Open($setupExe, [IO.FileMode]::Append, [IO.FileAccess]::Write)
try {
  $stream.Write($payloadBytes, 0, $payloadBytes.Length)
  $stream.Write($markerBytes, 0, $markerBytes.Length)
  $stream.Write($lengthBytes, 0, $lengthBytes.Length)
} finally {
  $stream.Dispose()
}

Write-Host "Created installer: $setupExe"
