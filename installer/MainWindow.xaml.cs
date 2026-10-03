using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shell;
using System.Windows.Shapes;

namespace XaverSetup
{
    public partial class MainWindow : Window
    {
        enum Page { Welcome, Options, Progress, Done, Error }

        readonly Args args;
        readonly bool uninstall;
        readonly ExistingInstall existing;
        readonly List<(Border dot, TextBlock label)> stepItems = new List<(Border, TextBlock)>();
        CancellationTokenSource cts;
        Page current = Page.Welcome;
        FrameworkElement currentPage;
        bool busy;
        bool pastNoReturn;
        bool closingAllowed;
        string finalDir;
        double shownFraction;
        DateTime lastReport = DateTime.MinValue;

        public int ExitCode { get; private set; } = 2;

        static readonly IEasingFunction EaseOut = new CubicEase { EasingMode = EasingMode.EaseOut };

        public MainWindow(Args args, bool uninstall)
        {
            this.args = args;
            this.uninstall = uninstall;
            InitializeComponent();

            existing = Detect.Primary();
            VersionPill.Text = "v" + Product.Version;
            PathBox.Text = !string.IsNullOrEmpty(args.Dir) ? args.Dir
                : existing != null && Detect.IsAppDir(existing.Dir) && !Product.IsFormerDefaultDir(existing.Dir) ? existing.Dir
                : Product.DefaultDir;
            ChkDesktop.IsChecked = !args.NoDesktop;
            ChkStart.IsChecked = !args.NoStartMenu;
            ChkLaunch.IsChecked = !args.NoLaunch;
            ChkPurge.IsChecked = args.Purge;

            if (uninstall) ConfigureUninstall();
            else ConfigureInstall();

            BuildSteps();
            UpdateSpace();

            TitleBar.MouseLeftButtonDown += (s, e) => { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); };
            BtnMin.Click += (s, e) => WindowState = WindowState.Minimized;
            BtnClose.Click += (s, e) => RequestClose();
            BtnCancel.Click += (s, e) => RequestClose();
            BtnBack.Click += (s, e) => { if (current == Page.Options) Show(Page.Welcome, back: true); };
            BtnPrimary.Click += (s, e) => Primary();
            BtnBrowse.Click += (s, e) => Browse();
            BtnLog.Click += (s, e) => { try { Process.Start(new ProcessStartInfo(Log.FilePath) { UseShellExecute = true }); } catch { } };
            PathBox.TextChanged += (s, e) => UpdateSpace();
            KeyDown += (s, e) => { if (e.Key == Key.Escape) RequestClose(); };
            Closing += OnClosing;
            Loaded += (s, e) => Intro();

            currentPage = PageWelcome;
            Show(Page.Welcome, instant: true);
        }

        void ConfigureInstall()
        {
            var ver = Product.Version;
            WelcomeLead.Text = "Save photos, videos and GIFs from X profiles, with a searchable library, duplicate detection and an encrypted history.";
            if (existing != null && !string.IsNullOrEmpty(existing.Version))
            {
                var cmp = Compare(existing.Version, ver);
                UpgradeCard.Visibility = Visibility.Visible;
                FromVersion.Text = existing.Version;
                ToVersion.Text = ver;
                if (cmp < 0)
                {
                    WelcomeKicker.Text = "UPDATE READY";
                    WelcomeTitle.Text = "Update Xaver";
                    WelcomeLead.Text = "A newer version is ready to install. It only takes a few seconds.";
                }
                else if (cmp == 0)
                {
                    WelcomeKicker.Text = "ALREADY INSTALLED";
                    WelcomeTitle.Text = "Repair Xaver";
                    WelcomeLead.Text = $"Version {ver} is already installed. Running setup again replaces the app files with fresh copies.";
                }
                else
                {
                    WelcomeKicker.Text = "OLDER VERSION";
                    WelcomeTitle.Text = "Go back to " + ver + "?";
                    WelcomeLead.Text = $"You have {existing.Version} installed, which is newer than this installer.";
                    UpgradeNote.Text = "Your data is kept, but newer settings may not carry over.";
                }
            }
            AddFeature("Finds every photo, video and GIF", "Scans media, posts, reposts and more, and skips anything you already have.");
            AddFeature("Private by default", "Your login, settings and download history are encrypted with your Windows account.");
            AddFeature("Lock it your way", "Protect the app with a PIN or Windows Hello.");
        }

        void ConfigureUninstall()
        {
            Title = "Uninstall Xaver";
            HeroFoot.Text = "Your downloaded media is always kept";
            WelcomeKicker.Text = "UNINSTALL";
            WelcomeTitle.Text = "Remove Xaver?";
            WelcomeLead.Text = existing != null && !string.IsNullOrEmpty(existing.Version)
                ? $"This removes version {existing.Version} from this PC, along with its shortcuts."
                : "This removes the app from this PC, along with its shortcuts.";
            OptionsKicker.Text = "BEFORE YOU GO";
            OptionsTitle.Text = "Keep your data?";
            LocationGroup.Visibility = Visibility.Collapsed;
            InstallSwitches.Visibility = Visibility.Collapsed;
            UninstallSwitches.Visibility = Visibility.Visible;
            ProgressKicker.Text = "UNINSTALLING";
            ProgressTitle.Text = "Removing Xaver";
            AddFeature("Your photos and videos stay", "Anything you downloaded remains in your output folder.");
            AddFeature("Come back any time", "Keep your settings and reinstall later to pick up where you left off.");
        }

        static int Compare(string a, string b)
        {
            var pa = (a ?? "").Split(new[] { '-' }, 2);
            var pb = (b ?? "").Split(new[] { '-' }, 2);
            Version va, vb;
            if (!Version.TryParse(pa[0], out va) || !Version.TryParse(pb[0], out vb))
                return string.Compare(a, b, StringComparison.OrdinalIgnoreCase);
            var core = va.CompareTo(vb);
            if (core != 0) return core;
            if (pa.Length == 1 || pb.Length == 1) return pb.Length - pa.Length;
            return string.Compare(pa[1], pb[1], StringComparison.OrdinalIgnoreCase);
        }

        void AddFeature(string title, string body)
        {
            var row = new Grid { Margin = new Thickness(0, 0, 0, 14) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var dot = new Border
            {
                Width = 22, Height = 22, CornerRadius = new CornerRadius(11), Margin = new Thickness(0, 1, 14, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Background = (Brush)FindResource("AccentSoft"),
                Child = new System.Windows.Shapes.Path
                {
                    Data = Geometry.Parse("M 6,11 L 9.5,14.5 L 16,8"),
                    Stroke = (Brush)FindResource("Accent"), StrokeThickness = 2,
                    StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round
                }
            };
            var text = new StackPanel();
            text.Children.Add(new TextBlock { Text = title, FontSize = 13.5, FontWeight = FontWeights.SemiBold });
            text.Children.Add(new TextBlock { Text = body, FontSize = 12.5, Foreground = (Brush)FindResource("Dim"), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) });
            Grid.SetColumn(text, 1);
            row.Children.Add(dot);
            row.Children.Add(text);
            Features.Children.Add(row);
        }

        string[] StepNames => uninstall
            ? new[] { "Confirm", "Options", "Removing", "Done" }
            : new[] { "Welcome", "Options", "Installing", "Finished" };

        void BuildSteps()
        {
            foreach (var name in StepNames)
            {
                var dot = new Border
                {
                    Width = 8, Height = 8, CornerRadius = new CornerRadius(4), VerticalAlignment = VerticalAlignment.Center,
                    Background = new SolidColorBrush(Color.FromArgb(0x40, 0xF4, 0xEF, 0xE6))
                };
                var label = new TextBlock { Text = name, FontSize = 13, Margin = new Thickness(14, 0, 0, 0), Foreground = (Brush)FindResource("Mute") };
                var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 16), Height = 20 };
                var holder = new Grid { Width = 26 };
                dot.HorizontalAlignment = HorizontalAlignment.Left;
                holder.Children.Add(dot);
                row.Children.Add(holder);
                row.Children.Add(label);
                Steps.Children.Add(row);
                stepItems.Add((dot, label));
            }
        }

        void SetStep(int index)
        {
            var accent = (Color)FindResource("AccentColor");
            for (var i = 0; i < stepItems.Count; i++)
            {
                var (dot, label) = stepItems[i];
                var active = i == index;
                var done = i < index;
                dot.BeginAnimation(WidthProperty, new DoubleAnimation(active ? 24 : 8, TimeSpan.FromMilliseconds(360)) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.5 } });
                var target = active || done ? accent : Color.FromArgb(0x40, 0xF4, 0xEF, 0xE6);
                if (done) target = Color.FromArgb(0x99, accent.R, accent.G, accent.B);
                ((SolidColorBrush)dot.Background).BeginAnimation(SolidColorBrush.ColorProperty, new ColorAnimation(target, TimeSpan.FromMilliseconds(260)));
                label.Foreground = active ? (Brush)FindResource("Ink") : done ? (Brush)FindResource("Dim") : (Brush)FindResource("Mute");
                label.FontWeight = active ? FontWeights.SemiBold : FontWeights.Normal;
            }
        }

        void Intro()
        {
            var scale = (ScaleTransform)Shell.RenderTransform;
            var ease = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.35 };
            Shell.BeginAnimation(OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(260)));
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(520)) { EasingFunction = ease });
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(520)) { EasingFunction = ease });

            Drift((TranslateTransform)GlowA.RenderTransform, 38, 26, 9);
            Drift((TranslateTransform)GlowB.RenderTransform, -30, -22, 12);
            var logo = (TranslateTransform)Logo.RenderTransform;
            logo.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(-4, 4, TimeSpan.FromSeconds(2.6))
            {
                AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            });

            var i = 0;
            foreach (FrameworkElement row in Features.Children)
            {
                row.Opacity = 0;
                var t = new TranslateTransform(0, 10);
                row.RenderTransform = t;
                var delay = TimeSpan.FromMilliseconds(260 + 90 * i++);
                row.BeginAnimation(OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(420)) { BeginTime = delay });
                t.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(520)) { BeginTime = delay, EasingFunction = EaseOut });
            }
        }

        static void Drift(TranslateTransform t, double x, double y, double seconds)
        {
            var ease = new SineEase { EasingMode = EasingMode.EaseInOut };
            t.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(0, x, TimeSpan.FromSeconds(seconds)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = ease });
            t.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, y, TimeSpan.FromSeconds(seconds * 1.3)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = ease });
        }

        FrameworkElement PageElement(Page p)
        {
            switch (p)
            {
                case Page.Welcome: return PageWelcome;
                case Page.Options: return PageOptions;
                case Page.Progress: return PageProgress;
                case Page.Done: return PageDone;
                default: return PageError;
            }
        }

        void Show(Page page, bool back = false, bool instant = false)
        {
            var next = PageElement(page);
            var prev = currentPage;
            current = page;
            currentPage = next;

            if (prev != null && prev != next)
            {
                if (instant) prev.Visibility = Visibility.Collapsed;
                else
                {
                    var fade = new DoubleAnimation(0, TimeSpan.FromMilliseconds(140));
                    fade.Completed += (s, e) => { if (currentPage != prev) prev.Visibility = Visibility.Collapsed; };
                    prev.BeginAnimation(OpacityProperty, fade);
                }
            }

            next.Visibility = Visibility.Visible;
            if (instant)
            {
                next.BeginAnimation(OpacityProperty, null);
                next.Opacity = 1;
            }
            else
            {
                var t = new TranslateTransform(back ? -28 : 28, 0);
                next.RenderTransform = t;
                next.Opacity = 0;
                var delay = TimeSpan.FromMilliseconds(110);
                next.BeginAnimation(OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(300)) { BeginTime = delay });
                t.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(420)) { BeginTime = delay, EasingFunction = EaseOut });
            }

            UpdateFooter();
            SetStep(page == Page.Welcome ? 0 : page == Page.Options ? 1 : page == Page.Progress ? 2 : page == Page.Done ? 3 : 2);
            if (page == Page.Done) CelebrateDone();
        }

        void UpdateFooter()
        {
            BtnBack.Visibility = current == Page.Options ? Visibility.Visible : Visibility.Collapsed;
            BtnCancel.Visibility = current == Page.Done ? Visibility.Collapsed : Visibility.Visible;
            BtnCancel.IsEnabled = !(busy && pastNoReturn);
            BtnClose.IsEnabled = !(busy && pastNoReturn);
            BtnPrimary.Visibility = current == Page.Progress ? Visibility.Collapsed : Visibility.Visible;
            BtnLog.Visibility = current == Page.Error || current == Page.Done ? Visibility.Visible : Visibility.Collapsed;
            BtnPrimary.Style = (Style)FindResource(uninstall && current == Page.Options ? "DangerButton" : "PrimaryButton");
            switch (current)
            {
                case Page.Welcome:
                    BtnPrimary.Content = uninstall ? "Continue" : existing != null ? "Continue" : "Get started";
                    break;
                case Page.Options:
                    BtnPrimary.Content = uninstall ? "Uninstall" : existing != null && Detect.IsAppDir(existing.Dir) ? "Update" : "Install";
                    break;
                case Page.Done:
                    BtnPrimary.Content = uninstall ? "Close" : ChkLaunch.IsChecked == true ? "Open Xaver" : "Finish";
                    break;
                case Page.Error:
                    BtnPrimary.Content = "Try again";
                    break;
            }
        }

        void CelebrateDone()
        {
            var s = (ScaleTransform)DoneBadge.RenderTransform;
            var pop = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.6 };
            s.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(0.4, 1, TimeSpan.FromMilliseconds(560)) { EasingFunction = pop, BeginTime = TimeSpan.FromMilliseconds(120) });
            s.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(0.4, 1, TimeSpan.FromMilliseconds(560)) { EasingFunction = pop, BeginTime = TimeSpan.FromMilliseconds(120) });
            DoneCheck.BeginAnimation(Shape.StrokeDashOffsetProperty, new DoubleAnimation(10, 0, TimeSpan.FromMilliseconds(520)) { BeginTime = TimeSpan.FromMilliseconds(380), EasingFunction = EaseOut });
        }

        void Primary()
        {
            switch (current)
            {
                case Page.Welcome:
                    Show(Page.Options);
                    break;
                case Page.Options:
                    if (uninstall) _ = RunUninstall();
                    else _ = RunInstall();
                    break;
                case Page.Done:
                    if (!uninstall && ChkLaunch.IsChecked == true && finalDir != null)
                    {
                        try { Installer.Launch(finalDir); } catch (Exception e) { Log.Write("Launch failed: " + e.Message); }
                    }
                    FadeClose();
                    break;
                case Page.Error:
                    Show(Page.Options, back: true);
                    break;
            }
        }

        void Browse()
        {
            using (var dlg = new System.Windows.Forms.FolderBrowserDialog
            {
                Description = "Choose where to install Xaver",
                SelectedPath = Directory.Exists(PathBox.Text) ? PathBox.Text : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                ShowNewFolderButton = true
            })
            {
                if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    var chosen = dlg.SelectedPath;
                    if (!chosen.TrimEnd('\\').EndsWith(Product.Name, StringComparison.OrdinalIgnoreCase))
                        chosen = System.IO.Path.Combine(chosen, Product.Name);
                    PathBox.Text = chosen;
                }
            }
        }

        void UpdateSpace()
        {
            try
            {
                var p = PathBox.Text.Trim();
                if (!System.IO.Path.IsPathRooted(p)) { SpaceText.Text = "Enter a full folder path."; return; }
                var drive = new DriveInfo(System.IO.Path.GetPathRoot(p));
                var need = Math.Max(Product.PayloadBytes, 1);
                SpaceText.Text = $"Needs {Fmt(need)}  ·  {Fmt(drive.AvailableFreeSpace)} free on {drive.Name.TrimEnd('\\')}";
                SpaceText.Foreground = (Brush)FindResource(drive.AvailableFreeSpace < need + (200L << 20) ? "Err" : "Mute");
            }
            catch
            {
                SpaceText.Text = "That drive isn't available.";
                SpaceText.Foreground = (Brush)FindResource("Err");
            }
        }

        static string Fmt(long bytes)
        {
            if (bytes >= 1L << 30) return $"{bytes / (double)(1L << 30):0.#} GB";
            return $"{bytes / (double)(1L << 20):0} MB";
        }

        string ValidateDir(string raw)
        {
            var p = (raw ?? "").Trim().Trim('"');
            if (!System.IO.Path.IsPathRooted(p)) return "Choose a full folder path, like C:\\Apps\\Xaver.";
            string full;
            try { full = System.IO.Path.GetFullPath(p).TrimEnd('\\'); } catch { return "That folder path isn't valid."; }
            if (System.IO.Path.GetPathRoot(full).TrimEnd('\\') == full) return "Pick a folder instead of a whole drive.";
            var win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (full.StartsWith(win, StringComparison.OrdinalIgnoreCase)) return "Windows' own folder can't be used.";
            if (Directory.Exists(full) && Directory.EnumerateFileSystemEntries(full).Any() && !Detect.IsAppDir(full))
                return "That folder already has other files in it. Pick an empty folder or a new one.";
            try
            {
                var parent = System.IO.Path.GetDirectoryName(full);
                Directory.CreateDirectory(parent);
                var probe = System.IO.Path.Combine(parent, ".xaver-write-test-" + Guid.NewGuid().ToString("N").Substring(0, 6));
                File.WriteAllText(probe, "");
                File.Delete(probe);
            }
            catch
            {
                return "Setup can't write there without admin rights. Choose a folder in your user profile instead.";
            }
            return null;
        }

        void Report(double fraction, string status, string detail)
        {
            var now = DateTime.UtcNow;
            if ((now - lastReport).TotalMilliseconds < 60 && fraction < 1) return;
            lastReport = now;
            Dispatcher.BeginInvoke(new Action(() =>
            {
                fraction = Math.Max(shownFraction, Math.Min(1, fraction));
                shownFraction = fraction;
                Bar.BeginAnimation(ProgressBar.ValueProperty, new DoubleAnimation(fraction, TimeSpan.FromMilliseconds(260)) { EasingFunction = EaseOut });
                PercentText.Text = ((int)Math.Round(fraction * 100)).ToString();
                if (!string.IsNullOrEmpty(status)) StatusText.Text = status + (fraction < 1 ? "…" : "");
                DetailText.Text = detail ?? "";
                Taskbar.ProgressState = TaskbarItemProgressState.Normal;
                Taskbar.ProgressValue = fraction;
            }));
        }

        void BeginWork()
        {
            busy = true;
            pastNoReturn = false;
            shownFraction = 0;
            Bar.BeginAnimation(ProgressBar.ValueProperty, null);
            Bar.Value = 0;
            PercentText.Text = "0";
            StatusText.Text = "Getting ready…";
            DetailText.Text = "";
            Show(Page.Progress);
        }

        void EndWork()
        {
            busy = false;
            Taskbar.ProgressState = TaskbarItemProgressState.None;
        }

        async Task RunInstall()
        {
            var problem = ValidateDir(PathBox.Text);
            if (problem != null)
            {
                SpaceText.Text = problem;
                SpaceText.Foreground = (Brush)FindResource("Err");
                PathBox.Focus();
                return;
            }
            var opt = new InstallOptions
            {
                Dir = System.IO.Path.GetFullPath(PathBox.Text.Trim().Trim('"')),
                DesktopShortcut = ChkDesktop.IsChecked == true,
                StartMenuShortcut = ChkStart.IsChecked == true
            };
            cts = new CancellationTokenSource();
            BeginWork();
            try
            {
                await Task.Run(() => Installer.Run(opt, Report, cts.Token, () => Dispatcher.Invoke(() =>
                {
                    pastNoReturn = true;
                    UpdateFooter();
                })));
                finalDir = opt.Dir;
                ExitCode = 0;
                EndWork();
                ProgressKicker.Text = "DONE";
                DoneTitle.Text = existing != null && Detect.IsAppDir(existing.Dir) ? "Updated to " + Product.Version : "You're all set";
                DoneLead.Text = "Xaver is installed" + (opt.DesktopShortcut ? " and on your desktop." : ".") + " Your library, settings and login were kept.";
                if (existing == null) DoneLead.Text = "Xaver is installed" + (opt.DesktopShortcut ? " and on your desktop." : ".") + " Sign in on the Account page to start saving media.";
                Show(Page.Done);
            }
            catch (OperationCanceledException)
            {
                EndWork();
                ExitCode = 2;
                ShowError("Setup was cancelled", "Nothing was changed.");
            }
            catch (Exception e)
            {
                EndWork();
                ExitCode = 1;
                Taskbar.ProgressState = TaskbarItemProgressState.Error;
                ShowError("That didn't work", e.Message);
            }
            finally
            {
                cts.Dispose();
                cts = null;
            }
        }

        async Task RunUninstall()
        {
            var dir = args.Dir ?? existing?.Dir;
            if (string.IsNullOrEmpty(dir))
            {
                ShowError("Nothing to remove", "Xaver doesn't seem to be installed.");
                return;
            }
            var purge = ChkPurge.IsChecked == true;
            if (purge && MessageBox.Show(this,
                    "Delete your settings, saved login and download history too? This can't be undone.\n\nYour downloaded photos and videos are not affected.",
                    "Xaver", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
                return;
            BeginWork();
            pastNoReturn = true;
            UpdateFooter();
            try
            {
                await Task.Run(() => Uninstaller.Run(dir, purge, Report));
                ExitCode = 0;
                EndWork();
                DoneTitle.Text = "Xaver was removed";
                DoneLead.Text = purge
                    ? "The app and your settings are gone. Your downloaded media is still in your output folder."
                    : "Your settings and download history are kept in case you come back.";
                Show(Page.Done);
            }
            catch (Exception e)
            {
                EndWork();
                ExitCode = 1;
                ErrorSafe.Text = "You can run the uninstaller again once the app is closed.";
                ShowError("Couldn't finish removing it", e.Message);
            }
        }

        void ShowError(string title, string message)
        {
            ErrorTitle.Text = title;
            ErrorText.Text = message;
            Show(Page.Error);
        }

        void RequestClose()
        {
            if (busy && pastNoReturn) return;
            if (busy)
            {
                if (MessageBox.Show(this, "Stop setup? Nothing will be changed.", "Xaver", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
                    cts?.Cancel();
                return;
            }
            FadeClose();
        }

        bool fading;

        void FadeClose()
        {
            if (fading) return;
            fading = true;
            var scale = (ScaleTransform)Shell.RenderTransform;
            var d = TimeSpan.FromMilliseconds(170);
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(0.97, d));
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(0.97, d));
            var fade = new DoubleAnimation(0, d);
            fade.Completed += (s, a) =>
            {
                closingAllowed = true;
                Close();
            };
            Shell.BeginAnimation(OpacityProperty, fade);
        }

        void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (closingAllowed) return;
            e.Cancel = true;
            RequestClose();
        }
    }
}
