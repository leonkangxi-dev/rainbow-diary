using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class SevenZipWrapper
{
    static int Main(string[] args)
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string real7za = Path.Combine(exeDir, "7za-real.exe");
        if (!File.Exists(real7za))
        {
            Console.Error.WriteLine("ERROR: 7za-real.exe not found");
            return 2;
        }
        var sb = new StringBuilder();
        bool first = true;
        foreach (string arg in args)
        {
            if (!first) sb.Append(' ');
            first = false;
            string a = arg;
            if (a.Equals("-snld", StringComparison.OrdinalIgnoreCase))
                a = "-snl";
            if (a.IndexOf(' ') >= 0 || a.IndexOf('\t') >= 0)
                sb.Append('"').Append(a).Append('"');
            else
                sb.Append(a);
        }
        Process proc = new Process();
        proc.StartInfo.FileName = real7za;
        proc.StartInfo.Arguments = sb.ToString();
        proc.StartInfo.UseShellExecute = false;
        proc.StartInfo.RedirectStandardOutput = true;
        proc.StartInfo.RedirectStandardError = true;
        proc.StartInfo.CreateNoWindow = true;
        proc.Start();
        string stdout = proc.StandardOutput.ReadToEnd();
        string stderr = proc.StandardError.ReadToEnd();
        proc.WaitForExit();
        if (!string.IsNullOrEmpty(stdout)) Console.Write(stdout);
        if (!string.IsNullOrEmpty(stderr)) Console.Error.Write(stderr);
        if (proc.ExitCode == 2 && stderr.Contains("Cannot create symbolic link"))
        {
            foreach (string line in stderr.Split('\n'))
            {
                if (line.Contains("Cannot create symbolic link"))
                {
                    int ci = line.LastIndexOf(" : ");
                    if (ci > 0)
                    {
                        string symPath = line.Substring(ci + 3).Trim();
                        string target = symPath.Replace(".dylib", ".1.0.0.dylib");
                        if (File.Exists(target)) { try { File.Copy(target, symPath, true); } catch { } }
                    }
                }
            }
            return 0;
        }
        return proc.ExitCode;
    }
}
