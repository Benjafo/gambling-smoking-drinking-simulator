/* Injected by the desktop shell's preload (desktop/preload.cjs). Absent in a
   browser — every use must tolerate undefined. */
interface Window {
  desktop?: {
    /* where the shell says the lobby server lives (an app:// page has no
       origin to derive it from) */
    serverUrl: string | null;
    /* Steam persona name; null when Steam isn't running */
    personaName: string | null;
    quit(): void;
    toggleFullscreen(): void;
  };
}
