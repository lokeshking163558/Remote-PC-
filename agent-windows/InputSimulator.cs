using System;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public static class InputSimulator
    {
        public static void ProcessInput(JsonElement inputElement, int displayIndex = 0)
        {
            if (!inputElement.TryGetProperty("type", out var typeProp)) return;
            string type = typeProp.GetString() ?? string.Empty;

            Screen[] screens = Screen.AllScreens;
            Screen screen = (displayIndex >= 0 && displayIndex < screens.Length) ? screens[displayIndex] : Screen.PrimaryScreen!;
            Rectangle bounds = screen.Bounds;

            switch (type)
            {
                case "mouse-move":
                {
                    double x = inputElement.GetProperty("x").GetDouble();
                    double y = inputElement.GetProperty("y").GetDouble();
                    bool normalized = inputElement.TryGetProperty("normalized", out var normProp) && normProp.GetBoolean();

                    int targetX = normalized ? bounds.X + (int)(x * bounds.Width) : bounds.X + (int)x;
                    int targetY = normalized ? bounds.Y + (int)(y * bounds.Height) : bounds.Y + (int)y;

                    NativeMethods.SetCursorPos(targetX, targetY);
                    break;
                }

                case "mouse-down":
                {
                    string button = inputElement.TryGetProperty("button", out var btn) ? btn.GetString() ?? "left" : "left";
                    SendMouseButton(button, true);
                    break;
                }

                case "mouse-up":
                {
                    string button = inputElement.TryGetProperty("button", out var btn) ? btn.GetString() ?? "left" : "left";
                    SendMouseButton(button, false);
                    break;
                }

                case "mouse-click":
                {
                    string button = inputElement.TryGetProperty("button", out var btn) ? btn.GetString() ?? "left" : "left";
                    bool isDouble = inputElement.TryGetProperty("double", out var dbl) && dbl.GetBoolean();

                    SendMouseButton(button, true);
                    SendMouseButton(button, false);

                    if (isDouble)
                    {
                        System.Threading.Thread.Sleep(50);
                        SendMouseButton(button, true);
                        SendMouseButton(button, false);
                    }
                    break;
                }

                case "mouse-wheel":
                {
                    int deltaY = inputElement.TryGetProperty("deltaY", out var dy) ? dy.GetInt32() : 0;
                    if (deltaY != 0)
                    {
                        var inputs = new NativeMethods.INPUT[1];
                        inputs[0].type = NativeMethods.INPUT_MOUSE;
                        inputs[0].u.mi.dwFlags = NativeMethods.MOUSEEVENTF_WHEEL;
                        inputs[0].u.mi.mouseData = (uint)(-deltaY);
                        NativeMethods.SendInput(1, inputs, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
                    }
                    break;
                }

                case "touch-tap":
                {
                    double x = inputElement.GetProperty("x").GetDouble();
                    double y = inputElement.GetProperty("y").GetDouble();
                    bool normalized = inputElement.TryGetProperty("normalized", out var normProp) && normProp.GetBoolean();
                    string button = inputElement.TryGetProperty("button", out var btn) ? btn.GetString() ?? "left" : "left";

                    int targetX = normalized ? bounds.X + (int)(x * bounds.Width) : bounds.X + (int)x;
                    int targetY = normalized ? bounds.Y + (int)(y * bounds.Height) : bounds.Y + (int)y;

                    NativeMethods.SetCursorPos(targetX, targetY);
                    SendMouseButton(button, true);
                    System.Threading.Thread.Sleep(20);
                    SendMouseButton(button, false);
                    break;
                }

                case "touch-drag":
                {
                    double x = inputElement.GetProperty("x").GetDouble();
                    double y = inputElement.GetProperty("y").GetDouble();
                    bool normalized = inputElement.TryGetProperty("normalized", out var normProp) && normProp.GetBoolean();

                    int targetX = normalized ? bounds.X + (int)(x * bounds.Width) : bounds.X + (int)x;
                    int targetY = normalized ? bounds.Y + (int)(y * bounds.Height) : bounds.Y + (int)y;

                    NativeMethods.SetCursorPos(targetX, targetY);
                    break;
                }

                case "key-down":
                {
                    SendKey(inputElement, isKeyDown: true);
                    break;
                }

                case "key-up":
                {
                    SendKey(inputElement, isKeyDown: false);
                    break;
                }
            }
        }

        private static void SendMouseButton(string button, bool isDown)
        {
            uint flag = 0;
            switch (button.ToLowerInvariant())
            {
                case "left":
                    flag = isDown ? NativeMethods.MOUSEEVENTF_LEFTDOWN : NativeMethods.MOUSEEVENTF_LEFTUP;
                    break;
                case "right":
                    flag = isDown ? NativeMethods.MOUSEEVENTF_RIGHTDOWN : NativeMethods.MOUSEEVENTF_RIGHTUP;
                    break;
                case "middle":
                    flag = isDown ? NativeMethods.MOUSEEVENTF_MIDDLEDOWN : NativeMethods.MOUSEEVENTF_MIDDLEUP;
                    break;
            }

            if (flag != 0)
            {
                var inputs = new NativeMethods.INPUT[1];
                inputs[0].type = NativeMethods.INPUT_MOUSE;
                inputs[0].u.mi.dwFlags = flag;
                NativeMethods.SendInput(1, inputs, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
            }
        }

        private static void SendKey(JsonElement inputElement, bool isKeyDown)
        {
            string key = inputElement.TryGetProperty("key", out var k) ? k.GetString() ?? "" : "";
            string code = inputElement.TryGetProperty("code", out var c) ? c.GetString() ?? "" : "";

            ushort vk = MapCodeToVk(code, key);
            if (vk == 0 && key.Length == 1)
            {
                short scan = NativeMethods.VkKeyScan(key[0]);
                vk = (ushort)(scan & 0xFF);
            }

            if (vk != 0)
            {
                var inputs = new NativeMethods.INPUT[1];
                inputs[0].type = NativeMethods.INPUT_KEYBOARD;
                inputs[0].u.ki.wVk = vk;
                inputs[0].u.ki.dwFlags = isKeyDown ? NativeMethods.KEYEVENTF_KEYDOWN : NativeMethods.KEYEVENTF_KEYUP;
                NativeMethods.SendInput(1, inputs, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
            }
        }

        private static ushort MapCodeToVk(string code, string key)
        {
            switch (code)
            {
                case "Backspace": return (ushort)Keys.Back;
                case "Tab": return (ushort)Keys.Tab;
                case "Enter": return (ushort)Keys.Enter;
                case "ShiftLeft":
                case "ShiftRight": return (ushort)Keys.ShiftKey;
                case "ControlLeft":
                case "ControlRight": return (ushort)Keys.ControlKey;
                case "AltLeft":
                case "AltRight": return (ushort)Keys.Menu;
                case "Escape": return (ushort)Keys.Escape;
                case "Space": return (ushort)Keys.Space;
                case "PageUp": return (ushort)Keys.PageUp;
                case "PageDown": return (ushort)Keys.PageDown;
                case "End": return (ushort)Keys.End;
                case "Home": return (ushort)Keys.Home;
                case "ArrowLeft": return (ushort)Keys.Left;
                case "ArrowUp": return (ushort)Keys.Up;
                case "ArrowRight": return (ushort)Keys.Right;
                case "ArrowDown": return (ushort)Keys.Down;
                case "Delete": return (ushort)Keys.Delete;
                case "MetaLeft":
                case "MetaRight": return (ushort)Keys.LWin;
                case "F1": return (ushort)Keys.F1;
                case "F2": return (ushort)Keys.F2;
                case "F3": return (ushort)Keys.F3;
                case "F4": return (ushort)Keys.F4;
                case "F5": return (ushort)Keys.F5;
                case "F6": return (ushort)Keys.F6;
                case "F7": return (ushort)Keys.F7;
                case "F8": return (ushort)Keys.F8;
                case "F9": return (ushort)Keys.F9;
                case "F10": return (ushort)Keys.F10;
                case "F11": return (ushort)Keys.F11;
                case "F12": return (ushort)Keys.F12;
            }

            if (code.StartsWith("Key") && code.Length == 4)
            {
                char ch = code[3];
                if (ch >= 'A' && ch <= 'Z') return (ushort)ch;
            }

            if (code.StartsWith("Digit") && code.Length == 6)
            {
                char ch = code[5];
                if (ch >= '0' && ch <= '9') return (ushort)ch;
            }

            return 0;
        }
    }
}

