# FLOW · the pill's eyes on the desktop.
# main.js spawns it (from a userData copy: Windows PowerShell 5.1 can't read app.asar)
# while the pill is on. JSON lines out, commands in on stdin; it exits when stdin closes.
#   in:  hwnd <n>     the pill's window handle
#        guard 1|0    keep the pill above the taskbar (on while it sits on it)
#        ctrl 1|0     report the Ctrl key (click-through mode: Ctrl makes the pill reachable)
#        spots        where the taskbar's icon group and tray are (UI Automation)
#   out: {"t":"bars","list":[{x,y,w,h,primary}]}      taskbar rects, physical px, on change
#        {"t":"fs","on":bool,"mon":{x,y,w,h}}         a full-screen window is in front, on change
#        {"t":"spots","icons":[l,r]|null,"tray":x|null}
#        {"t":"ctrl","on":bool}                       on change, while asked
#        {"t":"raise"}                               the taskbar had covered the pill; it is back on top
# Closing the Start menu puts the taskbar back over every topmost window: the guard walks
# the z-order up from the pill every 120 ms and lifts it again when a taskbar is above it.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$refs = @([System.Windows.Automation.AutomationElement].Assembly.Location,
          [System.Windows.Automation.ControlType].Assembly.Location,
          [System.Windows.Rect].Assembly.Location)
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class FlowPill {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);

  static volatile int pill = 0;
  static volatile bool guard = false, watchCtrl = false;
  static readonly object outLock = new object();

  static void Say(string json) { lock (outLock) { Console.Out.WriteLine(json); Console.Out.Flush(); } }
  static string Cls(IntPtr h) { var sb = new StringBuilder(64); GetClassName(h, sb, 64); return sb.ToString(); }
  static bool IsBar(string c) { return c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd"; }
  static string Rect(RECT r) { return "\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T); }
  static string N(double v) { return Math.Round(v).ToString(CultureInfo.InvariantCulture); }

  // the taskbars, primary first; a hidden one (no taskbar on that screen) is left out
  static string Bars() {
    var parts = new List<string>();
    IntPtr h = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Shell_TrayWnd", null);
    RECT r;
    if (h != IntPtr.Zero && IsWindowVisible(h) && GetWindowRect(h, out r)) parts.Add("{" + Rect(r) + ",\"primary\":true}");
    IntPtr s = IntPtr.Zero;
    while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
      if (IsWindowVisible(s) && GetWindowRect(s, out r)) parts.Add("{" + Rect(r) + ",\"primary\":false}");
    return "{\"t\":\"bars\",\"list\":[" + string.Join(",", parts) + "]}";
  }

  // walks up the z-order from the pill: a taskbar above it means it was covered
  static bool Covered(IntPtr p) {
    IntPtr h = GetWindow(p, 3 /* GW_HWNDPREV */);
    for (int i = 0; h != IntPtr.Zero && i < 400; i++, h = GetWindow(h, 3))
      if (IsWindowVisible(h) && IsBar(Cls(h))) return true;
    return false;
  }

  // the window in front covers its whole monitor (a game, a video, F11) and is not just maximised
  static string FullScreen() {
    IntPtr f = GetForegroundWindow();
    if (f == IntPtr.Zero || f == new IntPtr(pill)) return null;
    string c = Cls(f);
    if (c == "Progman" || c == "WorkerW" || IsBar(c)) return null;
    RECT r; if (!GetWindowRect(f, out r) || IsZoomed(f)) return null;
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(f, 2), ref mi)) return null;
    RECT m = mi.rcMonitor;
    if (r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B) return "{" + Rect(m) + "}";
    return null;
  }

  // the primary taskbar's buttons: the biggest run of non-tray buttons is the icon group
  // (start, search, the apps); the tray starts at its leftmost button
  static string Spots() {
    try {
      IntPtr bar = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Shell_TrayWnd", null);
      if (bar == IntPtr.Zero) return "{\"t\":\"spots\",\"icons\":null,\"tray\":null}";
      var all = AutomationElement.FromHandle(bar).FindAll(TreeScope.Descendants,
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
      var runs = new List<double[]>();
      double tray = double.MaxValue;
      foreach (AutomationElement e in all) {
        System.Windows.Rect r; string c;
        try { r = e.Current.BoundingRectangle; c = e.Current.ClassName ?? ""; } catch { continue; }
        if (r.IsEmpty || r.Width <= 0) continue;
        if (c.StartsWith("SystemTray.")) { if (c != "SystemTray.ShowDesktopButton" && r.X < tray) tray = r.X; continue; }
        runs.Add(new[] { r.X, r.X + r.Width });
      }
      runs.Sort((a, b) => a[0].CompareTo(b[0]));
      double bl = 0, br = 0; int bn = 0;
      for (int i = 0; i < runs.Count; ) {
        double l = runs[i][0], rr = runs[i][1]; int n = 1, j = i + 1;
        while (j < runs.Count && runs[j][0] - rr < 60) { rr = Math.Max(rr, runs[j][1]); n++; j++; }
        if (n > bn) { bn = n; bl = l; br = rr; }
        i = j;
      }
      return "{\"t\":\"spots\",\"icons\":" + (bn > 0 ? "[" + N(bl) + "," + N(br) + "]" : "null") +
             ",\"tray\":" + (tray < double.MaxValue ? N(tray) : "null") + "}";
    } catch (Exception ex) {
      return "{\"t\":\"spots\",\"icons\":null,\"tray\":null,\"err\":\"" + ex.GetType().Name + "\"}";
    }
  }

  public static void Run() {
    var reader = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        var a = line.Trim().Split(' ');
        if (a[0] == "hwnd" && a.Length > 1) { long v; if (long.TryParse(a[1], out v)) pill = (int)v; }
        else if (a[0] == "guard" && a.Length > 1) guard = a[1] == "1";
        else if (a[0] == "ctrl" && a.Length > 1) watchCtrl = a[1] == "1";
        else if (a[0] == "spots") Say(Spots());
        else if (a[0] == "bars") Say(Bars());
      }
      Environment.Exit(0);
    });
    reader.IsBackground = true;
    reader.Start();
    string lastBars = null, lastFs = "";
    bool lastCtrl = false;
    for (int tick = 0; ; tick++) {
      IntPtr p = new IntPtr(pill);
      if (guard && p != IntPtr.Zero && IsWindow(p) && IsWindowVisible(p) && Covered(p)) {
        SetWindowPos(p, new IntPtr(-1) /* HWND_TOPMOST */, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 /* NOSIZE NOMOVE NOACTIVATE */);
        Say("{\"t\":\"raise\"}");
      }
      bool ctrl = watchCtrl && (GetAsyncKeyState(0x11) & 0x8000) != 0;
      if (ctrl != lastCtrl) { lastCtrl = ctrl; Say("{\"t\":\"ctrl\",\"on\":" + (ctrl ? "true" : "false") + "}"); }
      if (tick % 6 == 0) {
        string b = Bars();
        if (b != lastBars) { lastBars = b; Say(b); }
        string fs = FullScreen() ?? "";
        if (fs != lastFs) { lastFs = fs; Say(fs == "" ? "{\"t\":\"fs\",\"on\":false}" : "{\"t\":\"fs\",\"on\":true,\"mon\":" + fs + "}"); }
      }
      Thread.Sleep(120);
    }
  }
}
'@
[FlowPill]::Run()
