import React, { useState, useEffect } from 'react';
import { History, Laptop, Clock, Shield, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

export const SessionsPage: React.FC = () => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = async () => {
    try {
      const res = await api.getSessions();
      setSessions(res.sessions);
    } catch (err) {
      console.error('Failed to load sessions', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Remote Sessions History</h2>
          <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
            Audit logs of all remote connections established to your computers.
          </p>
        </div>

        <button
          onClick={fetchSessions}
          title="Refresh"
          className="p-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="p-16 text-center text-gray-400 border border-dashed border-gray-800 rounded-2xl">
          Loading session logs...
        </div>
      ) : sessions.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-[#0f1524] border border-gray-800">
          <History className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No sessions recorded yet</h3>
          <p className="text-xs text-gray-400">
            Whenever you establish a remote desktop connection, it will be logged here with duration and IP metadata.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#0f1524] border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-900/60 border-b border-gray-800 text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">Computer</th>
                  <th className="px-5 py-3.5">Started At</th>
                  <th className="px-5 py-3.5">Duration</th>
                  <th className="px-5 py-3.5">Transport</th>
                  <th className="px-5 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/80">
                {sessions.map((s) => {
                  const durationSec = s.ended_at
                    ? Math.round((s.ended_at - s.started_at) / 1000)
                    : null;

                  return (
                    <tr key={s.id} className="hover:bg-gray-900/40 transition-colors">
                      <td className="px-5 py-4 font-semibold text-white flex items-center gap-2">
                        <Laptop className="w-4 h-4 text-blue-400" />
                        <span>{s.device_name}</span>
                      </td>
                      <td className="px-5 py-4 text-gray-400 font-mono">
                        {new Date(s.started_at).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-gray-300 font-mono">
                        {durationSec !== null ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : 'Active'}
                      </td>
                      <td className="px-5 py-4 text-gray-400">
                        {s.connection_type}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                            s.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-gray-800 text-gray-400'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

