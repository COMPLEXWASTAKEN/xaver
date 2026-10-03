using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows;

namespace XaverSetup
{
    public sealed class Args
    {
        public bool Silent;
        public bool Uninstall;
        public bool Purge;
        public bool Relocated;
        public bool NoLaunch;
        public bool NoDesktop;
        public bool NoStartMenu;
        public int ParentPid;
        public string Dir;

        public static Args Parse(string[] argv)
        {
            var a = new Args();
            foreach (var raw in argv)
            {
                var s = raw.Trim();
                var lower = s.ToLowerInvariant();
                if (lower == "/s" || lower == "--silent" || lower == "/silent") a.Silent = true;
                else if (lower == "/uninstall" || lower == "--uninstall") a.Uninstall = true;
                else if (lower == "/purge") a.Purge = true;
                else if (lower == "/relocated") a.Relocated = true;
                else if (lower == "/nolaunch") a.NoLaunch = true;
                else if (lower == "/nodesktop") a.NoDesktop = true;
                else if (lower == "/nostartmenu") a.NoStartMenu = true;
                else if (lower.StartsWith("/parent=")) int.TryParse(s.Substring(8), out a.ParentPid);
                else if (lower.StartsWith("/d=")) a.Dir = s.Substring(3).Trim('"');
                else if (lower.StartsWith("/dir=")) a.Dir = s.Substring(5).Trim('"');
            }
            return a;
        }

        public string ToCommandLine()
        {
            var parts = new System.Collections.Generic.List<string>();
            if (Silent) parts.Add("/S");
            if (Uninstall) parts.Add("/uninstall");
            if (Purge) parts.Add("/purge");
            if (Relocated) parts.Add("/relocated");
            if (ParentPid > 0) parts.Add("/parent=" + ParentPid);
            if (!string.IsNullOrEmpty(Dir)) parts.Add($"\"/dir={Dir}\"");
            return string.Join(" ", parts);
        }
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] argv)
        {
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Log.Write("Fatal: " + e.ExceptionObject);
            var args = Args.Parse(argv);
            var uninstallMode = args.Uninstall || !Product.HasPayload;
            Log.Write($"Start v{Product.Version} mode={(uninstallMode ? "uninstall" : "install")} args=[{string.Join(" ", argv)}]");

            if (uninstallMode)
            {
                var self = Assembly.GetExecutingAssembly().Location;
                var selfDir = Path.GetDirectoryName(self);
                if (string.IsNullOrEmpty(args.Dir))
                    args.Dir = Detect.IsAppDir(selfDir) ? selfDir : Detect.Primary()?.Dir;
                if (!args.Relocated && !string.IsNullOrEmpty(args.Dir) &&
                    string.Equals(Path.GetFullPath(selfDir).TrimEnd('\\'), Path.GetFullPath(args.Dir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                {
                    var temp = Path.Combine(Path.GetTempPath(), "xaver-uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
                    File.Copy(self, temp, true);
                    args.Relocated = true;
                    args.ParentPid = Process.GetCurrentProcess().Id;
                    Process.Start(new ProcessStartInfo(temp, args.ToCommandLine()) { UseShellExecute = false })?.Dispose();
                    return 0;
                }
            }

            if (args.ParentPid > 0)
            {
                try
                {
                    using (var parent = Process.GetProcessById(args.ParentPid))
                        parent.WaitForExit(15000);
                }
                catch { }
            }

            using (var mutex = new Mutex(true, @"Local\XaverSetup" + Product.RegKeyName, out var owned))
            {
                if (!owned)
                {
                    if (!args.Silent)
                        MessageBox.Show("Xaver setup is already running.", "Xaver", MessageBoxButton.OK, MessageBoxImage.Information);
                    return 3;
                }
                try
                {
                    return args.Silent ? RunSilent(args, uninstallMode) : RunUi(args, uninstallMode);
                }
                finally
                {
                    if (uninstallMode && args.Relocated) Uninstaller.ScheduleSelfDelete();
                }
            }
        }

        static int RunSilent(Args args, bool uninstallMode)
        {
            try
            {
                if (uninstallMode)
                {
                    if (string.IsNullOrEmpty(args.Dir)) { Log.Write("Nothing to uninstall"); return 0; }
                    Uninstaller.Run(args.Dir, args.Purge, (f, s, d) => { });
                    return 0;
                }
                var dir = args.Dir ?? (Detect.Primary() is ExistingInstall e && Detect.IsAppDir(e.Dir) ? e.Dir : Product.DefaultDir);
                Installer.Run(new InstallOptions { Dir = dir, DesktopShortcut = !args.NoDesktop, StartMenuShortcut = !args.NoStartMenu },
                    (f, s, d) => { }, CancellationToken.None, null);
                return 0;
            }
            catch (Exception e)
            {
                Log.Write("Silent run failed: " + e);
                return 1;
            }
        }

        static int RunUi(Args args, bool uninstallMode)
        {
            var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            app.DispatcherUnhandledException += (s, e) =>
            {
                Log.Write("Unexpected error: " + e.Exception);
                e.Handled = true;
                MessageBox.Show("Setup hit an unexpected problem and has to close.\n\n" + e.Exception.Message + "\n\nDetails were saved to:\n" + Log.FilePath,
                    "Xaver", MessageBoxButton.OK, MessageBoxImage.Error);
                app.Shutdown(1);
            };
            app.Resources.MergedDictionaries.Add(new ResourceDictionary
            {
                Source = new Uri("pack://application:,,,/XaverSetup;component/Theme.xaml", UriKind.Absolute)
            });
            var win = new MainWindow(args, uninstallMode);
            app.Run(win);
            return win.ExitCode;
        }
    }
}
