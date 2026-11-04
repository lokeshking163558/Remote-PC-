using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class ScreenCaptureService
    {
        private static ImageCodecInfo? _jpegEncoder;

        static ScreenCaptureService()
        {
            _jpegEncoder = GetEncoder(ImageFormat.Jpeg);
        }

        public static Screen[] GetAvailableDisplays()
        {
            return Screen.AllScreens;
        }

        public static byte[] CaptureDisplayJpeg(int displayIndex, int quality = 70)
        {
            Screen[] screens = Screen.AllScreens;
            Screen targetScreen = (displayIndex >= 0 && displayIndex < screens.Length) ? screens[displayIndex] : Screen.PrimaryScreen!;

            Rectangle bounds = targetScreen.Bounds;

            using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb))
            {
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                }

                using (MemoryStream ms = new MemoryStream())
                {
                    if (_jpegEncoder != null)
                    {
                        var encoderParameters = new EncoderParameters(1);
                        encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, (long)Math.Clamp(quality, 20, 95));
                        bitmap.Save(ms, _jpegEncoder, encoderParameters);
                    }
                    else
                    {
                        bitmap.Save(ms, ImageFormat.Jpeg);
                    }
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

