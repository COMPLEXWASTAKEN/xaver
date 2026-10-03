import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const HELLO_PS = (mode: "check" | "verify") => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
${
  mode === "check"
    ? "Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])"
    : "Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('Unlock Xaver')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])"
}
`;

function powershellPath(): string {
  const root = process.env.SystemRoot || "C:\\Windows";
  const p = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return fs.existsSync(p) ? p : "powershell.exe";
}

export function runHello(mode: "check" | "verify"): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      resolve("DeviceNotPresent");
      return;
    }
    const encoded = Buffer.from(HELLO_PS(mode), "utf16le").toString("base64");
    const child = spawn(
      powershellPath(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Windows Hello timed out"));
    }, mode === "check" ? 20_000 : 120_000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const verdict = out.trim().split(/\r?\n/).pop() || "";
      if (code === 0 && verdict) resolve(verdict);
      else reject(new Error(err.trim().split(/\r?\n/)[0] || `Windows Hello exited ${code}`));
    });
  });
}
