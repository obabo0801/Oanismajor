using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

class Host
{
    const int Preshutdown = 15;
    static string root;
    static string account;
    static string log;
    static Native.Handler callback;
    IntPtr handle;
    IntPtr token;
    IntPtr profile;
    Timer timer;
    readonly object gate = new object();
    readonly ManualResetEvent stopped = new ManualResetEvent(false);
    Native.Main main;
    int busy;
    int checkpoint;

    public static void Main(string[] args)
    {
        root = args[0];
        account = args[1];
        log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "oanismajor", "handoff.log");
        Host host = new Host();
        host.main = host.Start;
        Native.Entry[] table = { new Native.Entry { name = "Oanismajor", main = host.main }, new Native.Entry() };
        Native.StartServiceCtrlDispatcher(table);
    }

    void Start(int count, IntPtr args)
    {
        callback = Control;
        handle = Native.RegisterServiceCtrlHandlerEx("Oanismajor", callback, IntPtr.Zero);
        Status(4, 0x101, 0);
        timer = new Timer(delegate { lock (gate) { if (token == IntPtr.Zero) Capture(); } }, null, 0, 5000);
        stopped.WaitOne();
        timer.Dispose();
        lock (gate)
        {
            if (profile != IntPtr.Zero) Native.UnloadUserProfile(token, profile);
            if (token != IntPtr.Zero) Native.CloseHandle(token);
        }
    }

    void Status(int state, int accepted, int wait)
    {
        Native.Service status = new Native.Service();
        status.type = 0x10;
        status.state = state;
        status.accepted = accepted;
        status.wait = wait;
        status.checkpoint = state == 3 ? Interlocked.Increment(ref checkpoint) : 0;
        Native.SetServiceStatus(handle, ref status);
    }

    int Control(int control, int type, IntPtr data, IntPtr context)
    {
        if (control != Preshutdown && control != 1 && control != 128) return 0;
        if (Interlocked.Exchange(ref busy, 1) != 0) return 0;
        Status(3, 0, 180000);
        ThreadPool.QueueUserWorkItem(delegate { Finish(control); });
        return 0;
    }

    void Finish(int control)
    {
        Timer progress = new Timer(delegate { Status(3, 0, 180000); }, null, 10000, 10000);
        try
        {
            if (control == Preshutdown || control == 128)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(log));
                if (control == Preshutdown)
                    File.WriteAllText(Path.Combine(Path.GetDirectoryName(log), "shutdown"), DateTime.UtcNow.ToString("o"));
                int result = Launch();
                File.AppendAllText(log, DateTime.UtcNow.ToString("o") + " handoff " + result + Environment.NewLine);
            }
        }
        catch (Exception error)
        {
            File.AppendAllText(log, DateTime.UtcNow.ToString("o") + " " + error.Message + Environment.NewLine);
        }
        progress.Dispose();
        Status(control == 128 ? 4 : 1, control == 128 ? 0x101 : 0, 0);
        Interlocked.Exchange(ref busy, 0);
        if (control != 128) stopped.Set();
    }

    void Capture()
    {
        IntPtr sessions;
        int count;
        if (!Native.WTSEnumerateSessions(IntPtr.Zero, 0, 1, out sessions, out count))
            return;
        try
        {
            int size = Marshal.SizeOf(typeof(Native.Session));
            for (int index = 0; index < count; index++)
            {
                Native.Session session = (Native.Session)Marshal.PtrToStructure(IntPtr.Add(sessions, index * size), typeof(Native.Session));
                IntPtr text;
                int length;
                if (!Native.WTSQuerySessionInformation(IntPtr.Zero, session.id, 5, out text, out length)) continue;
                string user = Marshal.PtrToStringUni(text);
                Native.WTSFreeMemory(text);
                if (!String.Equals(user, account, StringComparison.OrdinalIgnoreCase)) continue;
                IntPtr found;
                if (!Native.WTSQueryUserToken(session.id, out found)) continue;
                IntPtr duplicate;
                bool copied = Native.DuplicateTokenEx(found, 0x02000000, IntPtr.Zero, 2, 1, out duplicate);
                Native.CloseHandle(found);
                if (!copied) continue;
                found = duplicate;
                int target = 0;
                if (!Native.SetTokenInformation(found, 12, ref target, 4)) { Native.CloseHandle(found); continue; }
                Native.Profile info = new Native.Profile();
                info.size = Marshal.SizeOf(info);
                info.flags = 1;
                info.user = account;
                if (!Native.LoadUserProfile(found, ref info)) { Native.CloseHandle(found); continue; }
                token = found;
                profile = info.profile;
                return;
            }
        }
        finally { Native.WTSFreeMemory(sessions); }
    }

    int Launch()
    {
        lock (gate)
        {
            if (token == IntPtr.Zero) Capture();
            if (token == IntPtr.Zero) throw new Exception("User session unavailable");
            Native.Startup startup = new Native.Startup();
            startup.size = Marshal.SizeOf(startup);
            startup.flags = 1;
            startup.show = 0;
            Native.Process process;
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            string command = "\"" + shell + "\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "was", "handoff.ps1") + "\" -Action leave";
            IntPtr environment;
            if (!Native.CreateEnvironmentBlock(out environment, token, false))
                throw new Exception("User environment unavailable");
            try
            {
                if (!Native.CreateProcessAsUser(token, shell, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false,
                    0x08000400, environment, root, ref startup, out process))
                    throw new Exception("Handoff launch failed: " + Marshal.GetLastWin32Error());
            }
            finally { Native.DestroyEnvironmentBlock(environment); }
            try
            {
                if (Native.WaitForSingleObject(process.process, 165000) != 0) return 1460;
                int result;
                Native.GetExitCodeProcess(process.process, out result);
                return result;
            }
            finally { Native.CloseHandle(process.process); Native.CloseHandle(process.thread); }
        }
    }

    static class Native
    {
        public delegate int Handler(int control, int type, IntPtr data, IntPtr context);
        public delegate void Main(int count, IntPtr args);
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct Entry { public string name; public Main main; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct Profile { public int size, flags; public string user, path, defaultPath, server, policy; public IntPtr profile; }
        [StructLayout(LayoutKind.Sequential)] public struct Service { public int type, state, accepted, error, specific, checkpoint, wait; }
        [StructLayout(LayoutKind.Sequential)] public struct Session { public int id; public IntPtr name; public int state; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct Startup
        {
            public int size; public string reserved, desktop, title; public int x, y, width, height, columns, rows, fill, flags;
            public short show, count; public IntPtr bytes, input, output, error;
        }
        [StructLayout(LayoutKind.Sequential)] public struct Process { public IntPtr process, thread; public int id, threadId; }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr RegisterServiceCtrlHandlerEx(string name, Handler handler, IntPtr context);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] public static extern bool StartServiceCtrlDispatcher([In] Entry[] table);
        [DllImport("advapi32.dll")] public static extern bool SetServiceStatus(IntPtr handle, ref Service status);
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool DuplicateTokenEx(IntPtr token, int access, IntPtr attributes, int level, int type, out IntPtr duplicate);
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool SetTokenInformation(IntPtr token, int type, ref int value, int size);
        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)] public static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr sessions, out int count);
        [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode)] public static extern bool WTSQuerySessionInformation(IntPtr server, int session, int type, out IntPtr text, out int count);
        [DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr pointer);
        [DllImport("wtsapi32.dll", SetLastError = true)] public static extern bool WTSQueryUserToken(int session, out IntPtr token);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CreateProcessAsUser(IntPtr token, string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, int flags, IntPtr environment, string directory, ref Startup startup, out Process process);
        [DllImport("kernel32.dll")] public static extern int WaitForSingleObject(IntPtr handle, int milliseconds);
        [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr handle, out int code);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
        [DllImport("userenv.dll", SetLastError = true)] public static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);
        [DllImport("userenv.dll")] public static extern bool DestroyEnvironmentBlock(IntPtr environment);
        [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool LoadUserProfile(IntPtr token, ref Profile profile);
        [DllImport("userenv.dll")] public static extern bool UnloadUserProfile(IntPtr token, IntPtr profile);
    }
}
