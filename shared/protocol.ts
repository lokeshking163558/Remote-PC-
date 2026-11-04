export interface DisplayInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor?: number;
}

export interface DeviceMetrics {
  cpuUsage: number;        // percentage 0 - 100
  memoryUsage: number;     // percentage 0 - 100
  memoryTotalMb?: number;
  memoryUsedMb?: number;
  storageUsage?: number;   // percentage 0 - 100
  storageTotalGb?: number;
  storageFreeGb?: number;
  batteryPercent?: number; // 0 - 100 or null if desktop
  isCharging?: boolean;
  ipAddress?: string;
  osName?: string;
  uptimeSeconds?: number;
}

export type InputEvent =
  | {
      type: 'mouse-move';
      x: number;          // relative 0.0 - 1.0 or absolute coordinate
      y: number;
      normalized: boolean;
      displayIndex?: number;
    }
  | {
      type: 'mouse-down';
      button: 'left' | 'right' | 'middle';
      x?: number;
      y?: number;
      normalized?: boolean;
    }
  | {
      type: 'mouse-up';
      button: 'left' | 'right' | 'middle';
      x?: number;
      y?: number;
      normalized?: boolean;
    }
  | {
      type: 'mouse-click';
      button: 'left' | 'right' | 'middle';
      double?: boolean;
      x?: number;
      y?: number;
      normalized?: boolean;
    }
  | {
      type: 'mouse-wheel';
      deltaX: number;
      deltaY: number;
    }
  | {
      type: 'key-down';
      key: string;
      code: string;
      keyCode?: number;
      altKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      metaKey?: boolean;
    }
  | {
      type: 'key-up';
      key: string;
      code: string;
      keyCode?: number;
      altKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      metaKey?: boolean;
    }
  | {
      type: 'touch-tap';
      x: number;
      y: number;
      button: 'left' | 'right';
      normalized: boolean;
    }
  | {
      type: 'touch-drag';
      x: number;
      y: number;
      normalized: boolean;
    };

export interface RemoteSessionConfig {
  displayIndex: number;
  quality: number;         // 1 - 100 (default 75)
  targetFps: number;       // 15 - 60 (default 30)
  maxBitrateKbps?: number;
}

