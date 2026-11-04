using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Windows.Forms;

namespace RemoteHub.Agent
{
    public class DeviceMetricsData
    {
        public double CpuUsage { get; set; }
        public double MemoryUsage { get; set; }
        public double MemoryTotalMb { get; set; }
        public double MemoryUsedMb { get; set; }
        public double StorageUsage { get; set; }
        public double StorageTotalGb { get; set; }
        public double StorageFreeGb { get; set; }
        public double? BatteryPercent { get; set; }
        public bool IsCharging { get; set; }
        public string IpAddress { get; set; } = string.Empty;
        public string MacAddress { get; set; } = string.Empty;
        public string OsName { get; set; } = Environment.OSVersion.ToString();
    }

    public static class MetricsCollector
    {
        private static long _prevIdleTime = 0;
        private static long _prevKernelTime = 0;
        private static long _prevUserTime = 0;

        public static DeviceMetricsData Collect()
        {
            var data = new DeviceMetricsData();

            // 1. CPU Usage
            data.CpuUsage = GetCpuPercentage();

            // 2. RAM Usage
            var mem = new NativeMethods.MEMORYSTATUSEX();
            if (NativeMethods.GlobalMemoryStatusEx(mem))
            {
                data.MemoryUsage = mem.dwMemoryLoad;
                data.MemoryTotalMb = Math.Round((double)mem.ullTotalPhys / (1024 * 1024), 0);
                data.MemoryUsedMb = Math.Round((double)(mem.ullTotalPhys - mem.ullAvailPhys) / (1024 * 1024), 0);
            }

            // 3. Storage
            try
            {
                var systemDrive = DriveInfo.GetDrives().FirstOrDefault(d => d.IsReady && d.Name.StartsWith("C", StringComparison.OrdinalIgnoreCase));
                if (systemDrive != null)
                {
                    double totalGb = Math.Round((double)systemDrive.TotalSize / (1024 * 1024 * 1024), 1);
                    double freeGb = Math.Round((double)systemDrive.AvailableFreeSpace / (1024 * 1024 * 1024), 1);
                    double usedPercent = Math.Round(((totalGb - freeGb) / totalGb) * 100, 1);

                    data.StorageTotalGb = totalGb;
                    data.StorageFreeGb = freeGb;
                    data.StorageUsage = usedPercent;
                }
            }
            catch {}

            // 4. Battery
            var power = SystemInformation.PowerStatus;
            if (power.BatteryChargeStatus != BatteryChargeStatus.NoSystemBattery)
            {
                data.BatteryPercent = Math.Round(power.BatteryLifePercent * 100, 0);
                data.IsCharging = power.PowerLineStatus == PowerLineStatus.Online;
            }

            // 5. Network (IP & MAC)
            try
            {
                var activeNic = NetworkInterface.GetAllNetworkInterfaces()
                    .FirstOrDefault(n => n.OperationalStatus == OperationalStatus.Up &&
                                         n.NetworkInterfaceType != NetworkInterfaceType.Loopback);

                if (activeNic != null)
                {
                    data.MacAddress = string.Join(":", activeNic.GetPhysicalAddress().GetAddressBytes().Select(b => b.ToString("X2")));

                    var ipProp = activeNic.GetIPProperties();
                    var ipv4 = ipProp.UnicastAddresses.FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetwork);
                    if (ipv4 != null)
                    {
                        data.IpAddress = ipv4.Address.ToString();
                    }
                }

                if (string.IsNullOrEmpty(data.IpAddress))
                {
                    var host = Dns.GetHostEntry(Dns.GetHostName());
                    var ip = host.AddressList.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork);
                    if (ip != null) data.IpAddress = ip.ToString();
                }
            }
            catch {}

            return data;
        }

        private static double GetCpuPercentage()
        {
            try
            {
                if (NativeMethods.GetSystemTimes(out var idle, out var kernel, out var user))
                {
                    long idleTime = ((long)idle.dwHighDateTime << 32) | (uint)idle.dwLowDateTime;
                    long kernelTime = ((long)kernel.dwHighDateTime << 32) | (uint)kernel.dwLowDateTime;
                    long userTime = ((long)user.dwHighDateTime << 32) | (uint)user.dwLowDateTime;

                    if (_prevKernelTime != 0 || _prevUserTime != 0)
                    {
                        long sysTimeDelta = (kernelTime - _prevKernelTime) + (userTime - _prevUserTime);
                        long idleTimeDelta = idleTime - _prevIdleTime;

                        if (sysTimeDelta > 0)
                        {
                            double cpu = (1.0 - ((double)idleTimeDelta / sysTimeDelta)) * 100.0;
                            _prevIdleTime = idleTime;
                            _prevKernelTime = kernelTime;
                            _prevUserTime = userTime;
                            return Math.Round(Math.Clamp(cpu, 0.0, 100.0), 1);
                        }
                    }

                    _prevIdleTime = idleTime;
                    _prevKernelTime = kernelTime;
                    _prevUserTime = userTime;
                }
            }
            catch {}

            return 5.0; // fallback reasonable reading
        }
    }
}

