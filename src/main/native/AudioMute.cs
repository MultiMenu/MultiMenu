// Per-process mute via the Windows Core Audio session API (the same mechanism as
// the Volume Mixer). Compiled at runtime by PowerShell's Add-Type.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace MMAudio
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorCom { }

    internal enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
    internal interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
    internal interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int pcDevices);
        [PreserveSig] int Item(int nDevice, out IMMDevice ppDevice);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
    internal interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
    internal interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr SessionControl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr AudioVolume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
    }

    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
    internal interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int SessionCount);
        [PreserveSig] int GetSession(int SessionCount, out IAudioSessionControl2 Session);
    }

    [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
    internal interface IAudioSessionControl2
    {
        // IAudioSessionControl (9 methods, unused here)
        [PreserveSig] int GetState(out int pRetVal);
        [PreserveSig] int GetDisplayName(out IntPtr pRetVal);
        [PreserveSig] int SetDisplayName(IntPtr Value, ref Guid EventContext);
        [PreserveSig] int GetIconPath(out IntPtr pRetVal);
        [PreserveSig] int SetIconPath(IntPtr Value, ref Guid EventContext);
        [PreserveSig] int GetGroupingParam(out Guid pRetVal);
        [PreserveSig] int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr NewNotifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr NewNotifications);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier(out IntPtr pRetVal);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr pRetVal);
        [PreserveSig] int GetProcessId(out uint pRetVal);
    }

    [Guid("87CE5498-68D6-44E5-9215-6F4D80F72D61"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
    internal interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float fLevel, ref Guid EventContext);
        [PreserveSig] int GetMasterVolume(out float pfLevel);
        [PreserveSig] int SetMute(bool bMute, ref Guid EventContext);
        [PreserveSig] int GetMute(out bool pbMute);
    }

    public static class Mixer
    {
        const int DEVICE_STATE_ACTIVE = 1;
        const int CLSCTX_ALL = 23;

        /// <summary>Mutes or unmutes every audio session owned by the given process IDs, on every active output device. Returns how many sessions changed.</summary>
        public static int SetMute(int[] pids, bool mute) { return Apply(pids, mute ? 1 : 0, -1f); }

        /// <summary>Sets the Volume Mixer level (0 to 1) of every audio session owned by the given process IDs. Returns how many sessions changed.</summary>
        public static int SetVolume(int[] pids, float level) { return Apply(pids, -1, Math.Max(0f, Math.Min(1f, level))); }

        // mute: 1 = mute, 0 = unmute, -1 = leave; level: 0..1, or below 0 to leave.
        static int Apply(int[] pids, int mute, float level)
        {
            var wanted = new HashSet<uint>();
            foreach (var p in pids) wanted.Add((uint)p);
            if (wanted.Count == 0) return 0;
            int changed = 0;
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
            IMMDeviceCollection devices;
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(EDataFlow.eRender, DEVICE_STATE_ACTIVE, out devices));
            int deviceCount;
            devices.GetCount(out deviceCount);
            Guid managerIid = typeof(IAudioSessionManager2).GUID;
            Guid ctx = Guid.Empty;
            for (int d = 0; d < deviceCount; d++)
            {
                IMMDevice device;
                if (devices.Item(d, out device) != 0 || device == null) continue;
                object o;
                if (device.Activate(ref managerIid, CLSCTX_ALL, IntPtr.Zero, out o) != 0 || o == null) continue;
                var manager = (IAudioSessionManager2)o;
                IAudioSessionEnumerator sessions;
                if (manager.GetSessionEnumerator(out sessions) != 0 || sessions == null) continue;
                int count;
                sessions.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    IAudioSessionControl2 control;
                    if (sessions.GetSession(i, out control) != 0 || control == null) continue;
                    uint pid;
                    if (control.GetProcessId(out pid) != 0 || !wanted.Contains(pid)) continue;
                    var volume = control as ISimpleAudioVolume;
                    if (volume == null) continue;
                    int hr = 0;
                    if (mute >= 0) hr |= volume.SetMute(mute == 1, ref ctx);
                    if (level >= 0f) hr |= volume.SetMasterVolume(level, ref ctx);
                    if (hr == 0) changed++;
                }
            }
            return changed;
        }
    }
}
