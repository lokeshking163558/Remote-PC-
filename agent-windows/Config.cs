using System;
using System.IO;
using System.Text.Json;

namespace RemoteHub.Agent
{
    public class AgentConfig
    {
        public string ServerUrl { get; set; } = "http://localhost:5000";
        public string DeviceId { get; set; } = string.Empty;
        public string AuthToken { get; set; } = string.Empty;
        public string DeviceName { get; set; } = Environment.MachineName;
        public bool AutoStart { get; set; } = true;

        private static readonly string ConfigDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RemoteHub"
        );
        private static readonly string ConfigFilePath = Path.Combine(ConfigDir, "agent_config.json");

        public static AgentConfig Load()
        {
            try
            {
                if (File.Exists(ConfigFilePath))
                {
                    string json = File.ReadAllText(ConfigFilePath);
                    var cfg = JsonSerializer.Deserialize<AgentConfig>(json);
                    if (cfg != null) return cfg;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error loading config: {ex.Message}");
            }
            return new AgentConfig();
        }

        public void Save()
        {
            try
            {
                if (!Directory.Exists(ConfigDir))
                {
                    Directory.CreateDirectory(ConfigDir);
                }
                string json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(ConfigFilePath, json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error saving config: {ex.Message}");
            }
        }

        public bool IsConfigured => !string.IsNullOrEmpty(DeviceId) && !string.IsNullOrEmpty(AuthToken);
    }
}

