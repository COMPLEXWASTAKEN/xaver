using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

namespace XaverSetup
{
    public static class Product
    {
        public const string Name = "Xaver";
        public const string ExeName = "Xaver.exe";
        public const string UninstallerName = "Uninstall Xaver.exe";
        public static readonly string Channel = (Environment.GetEnvironmentVariable("XAVER_SETUP_CHANNEL") ?? "").Trim();
        public static readonly string[] FormerNames = { "Profile Media Saver" };
        public static string Brand => Branded(Name);
        public static IEnumerable<string> AllBrands => new[] { Name }.Concat(FormerNames).Select(Branded);
        public static IEnumerable<string> AllExeNames => new[] { Name }.Concat(FormerNames).Select(n => n + ".exe");
        static string Branded(string name) => Channel.Length > 0 ? $"{name} ({Channel})" : name;
        public static string RegKeyName => "Xaver" + Regex.Replace(Channel, "[^A-Za-z0-9]", "");
        public const string UninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

        public static string Version
        {
            get
            {
                var attr = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>();
                var v = attr?.InformationalVersion ?? "0.0.0";
                var plus = v.IndexOf('+');
                return plus > 0 ? v.Substring(0, plus) : v;
            }
        }

        public static long PayloadBytes
        {
            get
            {
                var meta = Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>()
                    .FirstOrDefault(a => a.Key == "PayloadBytes");
                return meta != null && long.TryParse(meta.Value, out var n) ? n : 0;
            }
        }

        public static bool HasPayload =>
            Assembly.GetExecutingAssembly().GetManifestResourceInfo("payload.7z") != null;

        static string ProgramsDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");

        public static string DefaultDir => Path.Combine(ProgramsDir, Brand);

        public static bool IsFormerDefaultDir(string dir)
        {
            try
            {
                var full = Path.GetFullPath(dir).TrimEnd('\\');
                return FormerNames.Any(n => string.Equals(full, Path.Combine(ProgramsDir, Branded(n)), StringComparison.OrdinalIgnoreCase));
            }
            catch { return false; }
        }

        public static IEnumerable<string> DataDirs
        {
            get
            {
                if (Channel.Length > 0) yield break;
                var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                yield return Path.Combine(roaming, "profile-media-saver-desktop");
                yield return Path.Combine(roaming, Name);
                foreach (var n in FormerNames) yield return Path.Combine(roaming, n);
            }
        }
    }

    public static class Log
    {
        static readonly object Gate = new object();
        public static readonly string FilePath = Path.Combine(Path.GetTempPath(), "Xaver-Setup.log");

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    File.AppendAllText(FilePath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}{Environment.NewLine}");
                }
            }
            catch { }
        }
    }

    public sealed class SetupException : Exception
    {
        public SetupException(string message, Exception inner = null) : base(message, inner) { }
    }

    public sealed class ExistingInstall
    {
        public string Dir;
        public string Version;
        public bool Legacy;
        public string KeyName;
    }

    public delegate void Progress(double fraction, string status, string detail);

    static class Native
    {
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

        public static string ImagePath(int pid)
        {
            var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                var size = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString(0, size) : null;
            }
            finally
            {
                CloseHandle(h);
            }
        }
    }

    public static class Detect
    {
        static string DirFromCommand(string cmd)
        {
            if (string.IsNullOrWhiteSpace(cmd)) return null;
            var m = Regex.Match(cmd, "^\\s*\"([^\"]+)\"|^\\s*(\\S+)");
            var exe = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
            try { return Path.GetDirectoryName(exe); } catch { return null; }
        }

        public static List<ExistingInstall> All()
        {
            var list = new List<ExistingInstall>();
            using (var root = Registry.CurrentUser.OpenSubKey(Product.UninstallRoot))
            {
                if (root == null) return list;
                foreach (var name in root.GetSubKeyNames())
                {
                    using (var k = root.OpenSubKey(name))
                    {
                        var display = k?.GetValue("DisplayName") as string;
                        if (display == null) continue;
                        var brand = Product.AllBrands.FirstOrDefault(b => display.StartsWith(b, StringComparison.OrdinalIgnoreCase));
                        if (brand == null) continue;
                        if (Product.Channel.Length == 0 && display.StartsWith(brand + " (", StringComparison.OrdinalIgnoreCase)) continue;
                        var dir = k.GetValue("InstallLocation") as string;
                        if (string.IsNullOrWhiteSpace(dir))
                        {
                            using (var side = Registry.CurrentUser.OpenSubKey(@"Software\" + name))
                            {
                                dir = side?.GetValue("InstallLocation") as string;
                            }
                        }
                        if (string.IsNullOrWhiteSpace(dir)) dir = DirFromCommand(k.GetValue("UninstallString") as string);
                        list.Add(new ExistingInstall
                        {
                            Dir = dir,
                            Version = k.GetValue("DisplayVersion") as string,
                            Legacy = !string.Equals(name, Product.RegKeyName, StringComparison.OrdinalIgnoreCase),
                            KeyName = name
                        });
                    }
                }
            }
            return list;
        }

        public static ExistingInstall Primary()
        {
            var all = All();
            return all.FirstOrDefault(e => !e.Legacy && IsAppDir(e.Dir))
                ?? all.FirstOrDefault(e => IsAppDir(e.Dir))
                ?? all.FirstOrDefault();
        }

        public static bool IsAppDir(string dir)
        {
            try
            {
                return !string.IsNullOrWhiteSpace(dir) && Product.AllExeNames.Any(n => File.Exists(Path.Combine(dir, n)));
            }
            catch { return false; }
        }
    }

    public static class Processes
    {
        static string Norm(string dir) =>
            Path.GetFullPath(dir).TrimEnd('\\') + "\\";

        public static List<Process> RunningFrom(IEnumerable<string> dirs)
        {
            var roots = dirs.Where(d => !string.IsNullOrWhiteSpace(d)).Select(Norm).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var me = Process.GetCurrentProcess().Id;
            var found = new List<Process>();
            if (roots.Count == 0) return found;
            foreach (var p in Process.GetProcesses())
            {
                if (p.Id == me || p.Id == 0 || p.Id == 4) { p.Dispose(); continue; }
                var path = Native.ImagePath(p.Id);
                if (path != null && roots.Any(r => path.StartsWith(r, StringComparison.OrdinalIgnoreCase))) found.Add(p);
                else p.Dispose();
            }
            return found;
        }

        public static int Close(IEnumerable<string> dirs, int graceMs = 4000)
        {
            var list = RunningFrom(dirs);
            if (list.Count == 0) return 0;
            Log.Write($"Closing {list.Count} running process(es)");
            foreach (var p in list)
            {
                try { if (p.MainWindowHandle != IntPtr.Zero) p.CloseMainWindow(); } catch { }
            }
            var deadline = DateTime.UtcNow.AddMilliseconds(graceMs);
            while (DateTime.UtcNow < deadline && list.Any(p => { try { return !p.HasExited; } catch { return false; } }))
                Thread.Sleep(150);
            foreach (var p in list)
            {
                try
                {
                    if (!p.HasExited)
                    {
                        p.Kill();
                        p.WaitForExit(5000);
                    }
                }
                catch (Exception e) { Log.Write($"Kill {p.Id} failed: {e.Message}"); }
                finally { p.Dispose(); }
            }
            return list.Count;
        }
    }

    public static class Shortcuts
    {
        public static string Desktop => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product.Brand + ".lnk");
        public static string StartMenu => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product.Brand + ".lnk");

        public static void RemoveAllPointingInto(string dir) => RemovePointingInto(dir, Product.AllBrands);

        public static void RemoveFormerPointingInto(string dir) =>
            RemovePointingInto(dir, Product.FormerNames.Select(n => Product.Channel.Length > 0 ? $"{n} ({Product.Channel})" : n));

        static void RemovePointingInto(string dir, IEnumerable<string> brands)
        {
            foreach (var brand in brands)
            {
                RemoveIfPointsInto(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), brand + ".lnk"), dir);
                RemoveIfPointsInto(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), brand + ".lnk"), dir);
            }
        }

        public static void Create(string lnk, string target)
        {
            var type = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(type);
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(lnk));
                dynamic sc = shell.CreateShortcut(lnk);
                sc.TargetPath = target;
                sc.WorkingDirectory = Path.GetDirectoryName(target);
                sc.IconLocation = target + ",0";
                sc.Description = Product.Brand;
                sc.Save();
                Marshal.FinalReleaseComObject(sc);
            }
            finally
            {
                Marshal.FinalReleaseComObject(shell);
            }
        }

        public static string Target(string lnk)
        {
            if (!File.Exists(lnk)) return null;
            var type = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(type);
            try
            {
                dynamic sc = shell.CreateShortcut(lnk);
                string t = sc.TargetPath;
                Marshal.FinalReleaseComObject(sc);
                return t;
            }
            catch { return null; }
            finally { Marshal.FinalReleaseComObject(shell); }
        }

        public static void RemoveIfPointsInto(string lnk, string dir)
        {
            try
            {
                var t = Target(lnk);
                if (t != null && Path.GetFullPath(t).StartsWith(Path.GetFullPath(dir).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase))
                    File.Delete(lnk);
            }
            catch (Exception e) { Log.Write($"Shortcut cleanup {lnk}: {e.Message}"); }
        }
    }

    public sealed class InstallOptions
    {
        public string Dir;
        public bool DesktopShortcut = true;
        public bool StartMenuShortcut = true;
    }

    public static class FileOps
    {
        public static void MoveDirWithRetry(string from, string to, IEnumerable<string> lockDirs, int attempts = 12)
        {
            for (var i = 1; ; i++)
            {
                try
                {
                    Directory.Move(from, to);
                    return;
                }
                catch (Exception e) when ((e is IOException || e is UnauthorizedAccessException) && i < attempts)
                {
                    Log.Write($"Move {from} -> {to} attempt {i} failed: {e.Message}");
                    Processes.Close(lockDirs, 1500);
                    Thread.Sleep(Math.Min(400 * i, 2000));
                }
            }
        }

        public static void DeleteDir(string dir, int attempts = 5)
        {
            for (var i = 1; i <= attempts; i++)
            {
                try
                {
                    if (!Directory.Exists(dir)) return;
                    foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                    {
                        try { File.SetAttributes(f, FileAttributes.Normal); } catch { }
                    }
                    Directory.Delete(dir, true);
                    return;
                }
                catch (Exception e)
                {
                    Log.Write($"Delete {dir} attempt {i}: {e.Message}");
                    if (i == attempts) throw;
                    Thread.Sleep(500 * i);
                }
            }
        }

        public static void DeleteQuietly(string dir)
        {
            try { DeleteDir(dir, 3); } catch { }
        }

        public static long DirSize(string dir)
        {
            try { return Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length); }
            catch { return 0; }
        }

        public static void CleanLeftovers(string parent)
        {
            try
            {
                if (!Directory.Exists(parent)) return;
                foreach (var d in Directory.GetDirectories(parent, ".xaver-*").Concat(Directory.GetDirectories(parent, ".pms-*")))
                {
                    Log.Write($"Removing leftover {d}");
                    DeleteQuietly(d);
                }
            }
            catch { }
        }
    }

    public static class Installer
    {
        static void Extract(string resource, string dest, Action<long, long> onBytes)
        {
            using (var src = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
            using (var dst = File.Create(dest))
            {
                if (src == null) throw new SetupException("This installer is damaged (missing " + resource + "). Please download it again.");
                var buf = new byte[1 << 20];
                long total = src.Length, done = 0;
                int n;
                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, n);
                    done += n;
                    onBytes?.Invoke(done, total);
                }
            }
        }

        static void Unpack(string sevenZip, string archive, string outDir, Progress report, CancellationToken ct)
        {
            var psi = new ProcessStartInfo(sevenZip, $"x \"{archive}\" -o\"{outDir}\" -y -bsp1 -bso0 -bse1 -mmt=on")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = false,
                StandardOutputEncoding = Encoding.UTF8
            };
            using (var p = Process.Start(psi))
            {
                using (ct.Register(() => { try { if (!p.HasExited) p.Kill(); } catch { } }))
                {
                    var re = new Regex(@"(\d{1,3})%(?:\s+\d+\s+-\s+([^\r\n\b]+))?");
                    var tail = new StringBuilder();
                    var buf = new char[512];
                    var errors = new StringBuilder();
                    int n;
                    while ((n = p.StandardOutput.Read(buf, 0, buf.Length)) > 0)
                    {
                        tail.Append(buf, 0, n);
                        if (tail.Length > 4096) tail.Remove(0, tail.Length - 2048);
                        var text = tail.ToString().Replace('\b', '\n');
                        var ms = re.Matches(text);
                        if (ms.Count > 0)
                        {
                            var m = ms[ms.Count - 1];
                            var pct = Math.Min(100, int.Parse(m.Groups[1].Value));
                            var file = m.Groups[2].Success ? m.Groups[2].Value.Trim() : "";
                            report(0.12 + 0.74 * pct / 100.0, "Unpacking files", file);
                        }
                        if (text.IndexOf("ERROR", StringComparison.OrdinalIgnoreCase) >= 0) errors.Append(text);
                    }
                    p.WaitForExit();
                    ct.ThrowIfCancellationRequested();
                    if (p.ExitCode > 1)
                    {
                        Log.Write("7za failed: " + errors);
                        throw new SetupException(p.ExitCode == 8
                            ? "There isn't enough disk space to unpack Xaver."
                            : $"Unpacking failed (code {p.ExitCode}). The installer may be damaged, so try downloading it again.");
                    }
                }
            }
        }

        public static void Run(InstallOptions opt, Progress report, CancellationToken ct, Action onPointOfNoReturn)
        {
            var dir = Path.GetFullPath(opt.Dir.Trim().TrimEnd('\\'));
            var parent = Path.GetDirectoryName(dir) ?? throw new SetupException("Choose a folder, not a drive root.");
            Log.Write($"Install {Product.Version} -> {dir}");

            var existing = Detect.All();
            var lockDirs = existing.Select(e => e.Dir).Where(Detect.IsAppDir).Append(dir).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            report(0.01, "Getting ready", "");
            Directory.CreateDirectory(parent);
            FileOps.CleanLeftovers(parent);

            var free = new DriveInfo(Path.GetPathRoot(dir)).AvailableFreeSpace;
            var need = Math.Max(Product.PayloadBytes, 400L << 20) + (200L << 20);
            if (free < need)
                throw new SetupException($"Not enough disk space on {Path.GetPathRoot(dir)}: {need >> 20} MB needed, {free >> 20} MB free.");

            var work = Path.Combine(Path.GetTempPath(), "xaver-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            var staging = Path.Combine(parent, ".xaver-staging-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            var old = Path.Combine(parent, ".xaver-old-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            var swapped = false;
            try
            {
                Directory.CreateDirectory(work);
                var sevenZip = Path.Combine(work, "7za.exe");
                var archive = Path.Combine(work, "payload.7z");
                Extract("7za.exe", sevenZip, null);
                Extract("payload.7z", archive, (d, t) => report(0.02 + 0.10 * d / Math.Max(1, t), "Preparing", ""));
                ct.ThrowIfCancellationRequested();

                Unpack(sevenZip, archive, staging, report, ct);
                if (!File.Exists(Path.Combine(staging, Product.ExeName)))
                    throw new SetupException("The unpacked app is incomplete. Please download the installer again.");
                ct.ThrowIfCancellationRequested();

                onPointOfNoReturn?.Invoke();
                report(0.88, "Closing Xaver", "");
                var closed = Processes.Close(lockDirs);
                if (closed > 0) Thread.Sleep(600);

                report(0.9, "Putting files in place", "");
                if (Directory.Exists(dir)) FileOps.MoveDirWithRetry(dir, old, lockDirs);
                try
                {
                    FileOps.MoveDirWithRetry(staging, dir, lockDirs);
                    swapped = true;
                }
                catch
                {
                    if (Directory.Exists(old) && !Directory.Exists(dir))
                    {
                        try { Directory.Move(old, dir); Log.Write("Rolled back to previous version"); } catch (Exception e) { Log.Write("Rollback failed: " + e.Message); }
                    }
                    throw;
                }

                report(0.93, "Creating shortcuts", "");
                var exe = Path.Combine(dir, Product.ExeName);
                if (opt.DesktopShortcut) TryDo(() => Shortcuts.Create(Shortcuts.Desktop, exe), "desktop shortcut");
                else Shortcuts.RemoveIfPointsInto(Shortcuts.Desktop, dir);
                if (opt.StartMenuShortcut) TryDo(() => Shortcuts.Create(Shortcuts.StartMenu, exe), "start menu shortcut");
                else Shortcuts.RemoveIfPointsInto(Shortcuts.StartMenu, dir);

                report(0.96, "Registering with Windows", "");
                Register(dir);
                CleanupLegacy(existing, dir);

                report(0.99, "Tidying up", "");
            }
            catch (OperationCanceledException)
            {
                Log.Write("Cancelled by user");
                throw;
            }
            catch (SetupException e)
            {
                Log.Write("Failed: " + e.Message + (e.InnerException != null ? " / " + e.InnerException : ""));
                throw;
            }
            catch (Exception e)
            {
                Log.Write("Failed: " + e);
                if (e is IOException || e is UnauthorizedAccessException)
                    throw new SetupException("Some files are still in use. Close Xaver (and any browser windows it opened) and try again.", e);
                throw new SetupException(e.Message, e);
            }
            finally
            {
                FileOps.DeleteQuietly(work);
                if (!swapped) FileOps.DeleteQuietly(staging);
                FileOps.DeleteQuietly(old);
            }
            report(1, "Installed", "");
            Log.Write("Install complete");
        }

        static void TryDo(Action a, string what)
        {
            try { a(); } catch (Exception e) { Log.Write($"Could not create {what}: {e.Message}"); }
        }

        static void Register(string dir)
        {
            var uninstaller = Path.Combine(dir, Product.UninstallerName);
            var exe = Path.Combine(dir, Product.ExeName);
            using (var k = Registry.CurrentUser.CreateSubKey(Product.UninstallRoot + "\\" + Product.RegKeyName))
            {
                k.SetValue("DisplayName", Product.Brand);
                k.SetValue("DisplayVersion", Product.Version);
                k.SetValue("Publisher", Product.Name);
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", $"\"{uninstaller}\" /uninstall");
                k.SetValue("QuietUninstallString", $"\"{uninstaller}\" /uninstall /S");
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, FileOps.DirSize(dir) / 1024), RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        static void CleanupLegacy(List<ExistingInstall> existing, string dir)
        {
            foreach (var e in existing.Where(x => x.Legacy))
            {
                try
                {
                    Registry.CurrentUser.DeleteSubKeyTree(Product.UninstallRoot + "\\" + e.KeyName, false);
                    if (Regex.IsMatch(e.KeyName, "^[0-9a-fA-F-]{36}$"))
                        Registry.CurrentUser.DeleteSubKeyTree(@"Software\" + e.KeyName, false);
                    Log.Write($"Retired old installer entry {e.KeyName} ({e.Version})");
                    if (!string.IsNullOrWhiteSpace(e.Dir)) Shortcuts.RemoveFormerPointingInto(e.Dir);
                    if (Detect.IsAppDir(e.Dir) && !string.Equals(Path.GetFullPath(e.Dir).TrimEnd('\\'), dir, StringComparison.OrdinalIgnoreCase))
                    {
                        Processes.Close(new[] { e.Dir });
                        Shortcuts.RemoveAllPointingInto(e.Dir);
                        FileOps.DeleteQuietly(e.Dir);
                        Log.Write($"Removed old copy at {e.Dir}");
                    }
                }
                catch (Exception ex) { Log.Write($"Legacy cleanup {e.KeyName}: {ex.Message}"); }
            }
        }

        public static void Launch(string dir)
        {
            var exe = Path.Combine(dir, Product.ExeName);
            var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = dir };
            psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(psi)?.Dispose();
        }
    }

    public static class Uninstaller
    {
        public static void Run(string dir, bool purge, Progress report)
        {
            dir = Path.GetFullPath(dir.TrimEnd('\\'));
            Log.Write($"Uninstall from {dir} (purge={purge})");
            report(0.05, "Closing Xaver", "");
            Processes.Close(new[] { dir });

            report(0.2, "Removing shortcuts", "");
            Shortcuts.RemoveAllPointingInto(dir);

            report(0.35, "Removing app files", "");
            if (Detect.IsAppDir(dir) || Directory.Exists(dir))
            {
                try
                {
                    FileOps.DeleteDir(dir);
                }
                catch (Exception e)
                {
                    Log.Write("Delete failed: " + e);
                    Processes.Close(new[] { dir });
                    try { FileOps.DeleteDir(dir); }
                    catch (Exception e2) { throw new SetupException("Some app files are still in use. Close Xaver and try again.", e2); }
                }
            }

            report(0.75, "Unregistering", "");
            foreach (var e in Detect.All().Where(x =>
                string.IsNullOrWhiteSpace(x.Dir) ||
                string.Equals(Path.GetFullPath(x.Dir).TrimEnd('\\'), dir, StringComparison.OrdinalIgnoreCase)))
            {
                try
                {
                    Registry.CurrentUser.DeleteSubKeyTree(Product.UninstallRoot + "\\" + e.KeyName, false);
                    if (Regex.IsMatch(e.KeyName, "^[0-9a-fA-F-]{36}$"))
                        Registry.CurrentUser.DeleteSubKeyTree(@"Software\" + e.KeyName, false);
                }
                catch (Exception ex) { Log.Write("Unregister: " + ex.Message); }
            }

            if (purge)
            {
                report(0.88, "Removing your settings and database", "");
                foreach (var d in Product.DataDirs) FileOps.DeleteQuietly(d);
            }
            report(1, "Removed", "");
            Log.Write("Uninstall complete");
        }

        public static void ScheduleSelfDelete()
        {
            try
            {
                var me = Assembly.GetExecutingAssembly().Location;
                var psi = new ProcessStartInfo("cmd.exe", $"/c ping -n 3 127.0.0.1 >nul & del /f /q \"{me}\"")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi)?.Dispose();
            }
            catch { }
        }
    }
}
