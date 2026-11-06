using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RemoteHub.Agent
{
    public class AgentConfig
    {
        public const string DefaultProductionServerUrl = "https://remote-pc-server.vercel.app";
        public const string DefaultLocalServerUrl = "http://localhost:5000";

        public string ServerUrl { get; set; } = DefaultProductionServerUrl;
        public string DeviceId { get; set; } = string.Empty;

        // In-memory decrypted AuthToken (never stored as plaintext if DPAPI succeeds)
        [JsonIgnore]
        public string AuthToken { get; set; } = string.Empty;

        // DPAPI-encrypted token saved to disk
        public string AuthTokenProtected { get; set; } = string.Empty;

        // Legacy compatibility field for reading old configs
        [JsonPropertyName("AuthToken")]
        public string? LegacyAuthToken { get; set; }

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

                // Restore AuthToken from DPAPI protected field or migrate legacy plaintext
                if (!string.IsNullOrEmpty(cfg.AuthTokenProtected))
                {
                    cfg.AuthToken = UnprotectString(cfg.AuthTokenProtected);
                }
                else if (!string.IsNullOrEmpty(cfg.LegacyAuthToken))
                {
                    cfg.AuthToken = cfg.LegacyAuthToken;
                    cfg.AuthTokenProtected = ProtectString(cfg.AuthToken);
                    cfg.LegacyAuthToken = null;
                    cfg.Save();
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

                // Encrypt AuthToken with Windows DPAPI before writing to disk
                if (!string.IsNullOrEmpty(AuthToken))
                {
                    AuthTokenProtected = ProtectString(AuthToken);
                }
                else
                {
                    AuthTokenProtected = string.Empty;
                }

                LegacyAuthToken = null; // Clean up legacy plaintext

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
            AuthTokenProtected = string.Empty;
            LegacyAuthToken = null;
            AccountEmail = string.Empty;
            Save();
        }

        public bool IsConfigured => !string.IsNullOrEmpty(DeviceId) && !string.IsNullOrEmpty(AuthToken);

        private static string ProtectString(string plainText)
        {
            if (string.IsNullOrEmpty(plainText)) return string.Empty;
            try
            {
                byte[] plainBytes = Encoding.UTF8.GetBytes(plainText);
                byte[] cipherBytes = ProtectedData.Protect(plainBytes, null, DataProtectionScope.CurrentUser);
                return Convert.ToBase64String(cipherBytes);
            }
            catch
            {
                return plainText; // Fallback if DPAPI is unavailable
            }
        }

        private static string UnprotectString(string cipherText)
        {
            if (string.IsNullOrEmpty(cipherText)) return string.Empty;
            try
            {
                byte[] cipherBytes = Convert.FromBase64String(cipherText);
                byte[] plainBytes = ProtectedData.Unprotect(cipherBytes, null, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plainBytes);
            }
            catch
            {
                return cipherText; // Return as-is if plain
            }
        }
    }
}
