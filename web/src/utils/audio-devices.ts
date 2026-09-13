export type AudioOutput = {
  deviceId: string;
  label: string;
  virtual: boolean;
};

const VIRTUAL_RE =
  /vb-?audio|vb-?cable|cable input|cable output|voicemeeter|virtual\s*(cable|speaker)|nvidia broadcast|虚拟(音频|声卡|音箱|扬声器)/i;

export function isVirtualOutput(label: string) {
  return VIRTUAL_RE.test(String(label || ''));
}

export function sanitizeOutputId(id: string, devices: AudioOutput[]) {
  const value = String(id || '');
  if (!value || value === 'default' || value === 'communications') return value === 'communications' ? value : '';
  return devices.some(item => item.deviceId === value) ? value : '';
}

export async function listAudioOutputs(): Promise<AudioOutput[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter(item => item.kind === 'audiooutput')
      .map(item => ({
        deviceId: item.deviceId,
        label:
          item.label ||
          (item.deviceId === 'default'
            ? '系统默认输出'
            : `输出设备 ${item.deviceId.slice(0, 8)}`),
        virtual: isVirtualOutput(item.label)
      }));
  } catch {
    return [];
  }
}
