using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class ScreenCaptureService
    {
        private static readonly ImageCodecInfo? _jpegEncoder;

        public static int LastCaptureWidth { get; private set; }
        public static int LastCaptureHeight { get; private set; }
        public static long LastCaptureDurationMs { get; private set; }

        static ScreenCaptureService()
        {
            _jpegEncoder = GetEncoder(ImageFormat.Jpeg);
        }

        public static Screen[] GetAvailableDisplays()
        {
            return Screen.AllScreens;
        }

        public static Rectangle GetDisplayBounds(int displayIndex)
        {
            try
            {
                Screen[] screens = Screen.AllScreens;
                if (screens != null && screens.Length > 0)
                {
                    if (displayIndex >= 0 && displayIndex < screens.Length)
                    {
                        return screens[displayIndex].Bounds;
                    }
                    if (Screen.PrimaryScreen != null)
                    {
                        return Screen.PrimaryScreen.Bounds;
                    }
                }
            }
            catch {}

            return SystemInformation.VirtualScreen;
        }

        public static byte[] CaptureDisplayJpeg(int displayIndex, int quality = 70, bool drawCursor = true)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            Rectangle bounds = GetDisplayBounds(displayIndex);

            if (bounds.Width <= 0 || bounds.Height <= 0)
            {
                bounds = new Rectangle(0, 0, 1920, 1080);
            }

            LastCaptureWidth = bounds.Width;
            LastCaptureHeight = bounds.Height;

            using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb))
            {
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.InterpolationMode = InterpolationMode.Bilinear;
                    g.PixelOffsetMode = PixelOffsetMode.HighSpeed;

                    // 1. Copy desktop screen
                    try
                    {
                        g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                    }
                    catch
                    {
                        // Fallback if desktop access is temporarily locked
                        g.Clear(Color.FromArgb(15, 23, 42));
                        using var brush = new SolidBrush(Color.White);
                        using var font = new Font("Segoe UI", 16);
                        g.DrawString("Desktop screen locked or temporarily unavailable.", font, brush, new PointF(50, 50));
                    }

                    // 2. Draw live hardware/software mouse cursor
                    if (drawCursor)
                    {
                        try
                        {
                            NativeMethods.CURSORINFO cursorInfo = new NativeMethods.CURSORINFO();
                            cursorInfo.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(cursorInfo);

                            if (NativeMethods.GetCursorInfo(out cursorInfo) && cursorInfo.flags == NativeMethods.CURSOR_SHOWING)
                            {
                                int curX = cursorInfo.ptScreenPos.X - bounds.X;
                                int curY = cursorInfo.ptScreenPos.Y - bounds.Y;

                                if (curX >= 0 && curX < bounds.Width && curY >= 0 && curY < bounds.Height)
                                {
                                    IntPtr hdc = g.GetHdc();
                                    try
                                    {
                                        if (NativeMethods.GetIconInfo(cursorInfo.hCursor, out NativeMethods.ICONINFO iconInfo))
                                        {
                                            curX -= iconInfo.xHotspot;
                                            curY -= iconInfo.yHotspot;

                                            if (iconInfo.hbmColor != IntPtr.Zero) NativeMethods.DeleteObject(iconInfo.hbmColor);
                                            if (iconInfo.hbmMask != IntPtr.Zero) NativeMethods.DeleteObject(iconInfo.hbmMask);
                                        }

                                        NativeMethods.DrawIcon(hdc, curX, curY, cursorInfo.hCursor);
                                    }
                                    finally
                                    {
                                        g.ReleaseHdc(hdc);
                                    }
                                }
                            }
                        }
                        catch {}
                    }
                }

                // 3. Compress to JPEG
                using (MemoryStream ms = new MemoryStream())
                {
                    if (_jpegEncoder != null)
                    {
                        using var encoderParameters = new EncoderParameters(1);
                        encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, (long)Math.Clamp(quality, 20, 95));
                        bitmap.Save(ms, _jpegEncoder, encoderParameters);
                    }
                    else
                    {
                        bitmap.Save(ms, ImageFormat.Jpeg);
                    }

                    sw.Stop();
                    LastCaptureDurationMs = sw.ElapsedMilliseconds;
                    return ms.ToArray();
                }
            }
        }

        private static ImageCodecInfo? GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageEncoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid)
                {
                    return codec;
                }
            }
            return null;
        }
    }
}
