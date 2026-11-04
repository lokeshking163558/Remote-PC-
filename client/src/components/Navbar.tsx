import React from 'react';
import { Monitor, Shield, LogOut, User, Plus, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  onAddDevice: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, setCurrentView, onAddDevice }) => {
  const { user, logout, isAuthenticated } = useAuth();

  return (
    <nav className="border-b border-gray-800 bg-[#0d121f]/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <div
            onClick={() => setCurrentView(isAuthenticated ? 'dashboard' : 'landing')}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-lg text-white tracking-tight">RemoteHub</span>
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">PRO</span>
              </div>
              <p className="text-[11px] text-gray-400 -mt-1 hidden sm:block">Personal Remote Desktop</p>
            </div>
          </div>

          {/* Center Navigation Links (if authenticated) */}
          {isAuthenticated && (
            <div className="hidden md:flex items-center gap-1 bg-gray-900/60 p-1 rounded-lg border border-gray-800">
              <button
                onClick={() => setCurrentView('dashboard')}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'dashboard'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                Devices
              </button>
              <button
                onClick={() => setCurrentView('sessions')}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'sessions'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                Sessions
              </button>
              <button
                onClick={() => setCurrentView('settings')}
                className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'settings'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                Settings
              </button>
            </div>
          )}

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <button
                  onClick={onAddDevice}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-3.5 py-2 rounded-lg transition-all shadow-md shadow-blue-600/20 active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Add Computer</span>
                  <span className="sm:hidden">Add</span>
                </button>

                <div className="h-6 w-px bg-gray-800 mx-1 hidden sm:block" />

                <div className="flex items-center gap-2">
                  <div
                    onClick={() => setCurrentView('settings')}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-semibold text-xs">
                      {user?.fullName?.charAt(0) || 'U'}
                    </div>
                    <span className="text-sm font-medium text-gray-300 hidden lg:inline max-w-[120px] truncate">
                      {user?.fullName}
                    </span>
                  </div>

                  <button
                    onClick={logout}
                    title="Sign Out"
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentView('login')}
                  className="text-sm font-medium text-gray-300 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800/60 transition-colors"
                >
                  Sign In
                </button>
                <button
                  onClick={() => setCurrentView('register')}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all shadow-md shadow-blue-600/20"
                >
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

