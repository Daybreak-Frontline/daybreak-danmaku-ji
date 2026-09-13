using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var node = Path.Combine(root, "runtime", "node.exe");
        var electron = Path.Combine(root, "app", "node_modules", "electron", "dist", "electron.exe");
        var main = Path.Combine(root, "app", "electron", "main.mjs");
        var ui = Path.Combine(root, "app", "web", "dist", "index.html");
        var data = Path.Combine(root, "data");
        var appDir = Path.Combine(root, "app");

        if (!File.Exists(node))
        {
            Fail("缺少 runtime\\node.exe");
            return;
        }
        if (!File.Exists(electron))
        {
            Fail("缺少 Electron");
            return;
        }
        if (!File.Exists(ui))
        {
            Fail("缺少前端 web\\dist");
            return;
        }

        Directory.CreateDirectory(data);

        var start = new ProcessStartInfo
        {
            FileName = electron,
            Arguments = "\"" + main + "\"",
            WorkingDirectory = appDir,
            UseShellExecute = false
        };

        var env = start.EnvironmentVariables;
        env["MUSICHE_NODE"] = node;
        env["MUSICHE_DATA"] = data;
        env["PORT"] = "54821";
        env["MUSICHE_CLOUD_COOKIE"] = "";
        env["HTTP_PROXY"] = "";
        env["HTTPS_PROXY"] = "";
        env["http_proxy"] = "";
        env["https_proxy"] = "";
        env["ALL_PROXY"] = "";
        env["all_proxy"] = "";

        try
        {
            Process.Start(start);
        }
        catch (Exception error)
        {
            Fail("无法启动点歌姬：\n" + error.Message);
        }
    }

    private static void Fail(string message)
    {
        MessageBox.Show(message, "弹幕点歌姬", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
