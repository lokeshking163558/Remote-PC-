using System;
using System.IO;
using System.Text.Json;

namespace RemoteHub.Agent
{
    public class AgentConfig
    {
        public const string DefaultProductionServerUrl = "https://remote-pc-server.vercel.app";
        public const string DefaultLocalServerUrl = "http://localhost:5000";

        public string ServerUrl { get; set; } = DefaultProductionServerUrl;
        public string DeviceId { get; set; } = string.Empty;
        public string AuthToken { get; set; } = string.Empty;
        public string InstallationId { get; set; } = string.Empty;
        public string DeviceName { get; set; } = Environment.MachineName;
        public string AccountEmail { get; set; } = string.Empty;
        public bool AutoStart { get; set; } = true;
        public bool LaunchMinimized { get; set; } = true;
        public bool PauseRemoteAccess { get; set; } = false;
        public bool ShowNotifications { get; set; } = true;
        public int HeartbeatIntervalSeconds { get; set; } = 15;

        private static readonly string ConfigDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RemoteHub"
        );
        private static readonly string ConfigFilePath = Path.Combine(ConfigDir, "agent_config.json");
        private static readonly string InstallationIdFilePath = Path.Combine(ConfigDir, "installation.id");

        public static AgentConfig Load()
        {
            try
            {
                AgentConfig cfg = null!;
                if (File.Exists(ConfigFilePath))
                {
                    string json = File.ReadAllText(ConfigFilePath);
                    cfg = JsonSerializer.Deserialize<AgentConfig>(json) ?? new AgentConfig();
                }
                else
                {
                    cfg = new AgentConfig();
                }

                // Ensure a persistent stable InstallationId
                if (string.IsNullOrEmpty(cfg.InstallationId))
                {
                    if (File.Exists(InstallationIdFilePath))
                    {
                        cfg.InstallationId = File.ReadAllText(InstallationIdFilePath).Trim();
                    }
                    else
                    {
                        cfg.InstallationId = Guid.NewGuid().ToString("N");
                        try
                        {
                            if (!Directory.Exists(ConfigDir)) Directory.CreateDirectory(ConfigDir);
                            File.WriteAllText(InstallationIdFilePath, cfg.InstallationId);
                        }
                        catch {}
                    }
                    cfg.Save();
                }

                return cfg;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error loading config: {ex.Message}");
            }

            var fallback = new AgentConfig();
            fallback.InstallationId = Guid.NewGuid().ToString("N");
            return fallback;
        }

        public void Save()
        {
            try
            {
                if (!Directory.Exists(ConfigDir))
                {
                    Directory.CreateDirectory(ConfigDir);
                }

                if (!string.IsNullOrEmpty(InstallationId) && !File.Exists(InstallationIdFilePath))
                {
                    File.WriteAllText(InstallationIdFilePath, InstallationId);
                }

                string json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(ConfigFilePath, json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error saving config: {ex.Message}");
            }
        }

        public void ResetPairing()
        {
            DeviceId = string.Empty;
            AuthToken = string.Empty;
            AccountEmail = string.Empty;
            Save();
        }

        public bool IsConfigured => !string.IsNullOrEmpty(DeviceId) && !string.IsNullOrEmpty(AuthToken);
    }
}

