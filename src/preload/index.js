// Must be FIRST — the IDE sets ELECTRON_RUN_AS_NODE which breaks Electron's built-in modules
delete process.env.ELECTRON_RUN_AS_NODE;

import { contextBridge, ipcRenderer } from 'electron';

// Expose ipcRenderer to the renderer process securely
contextBridge.exposeInMainWorld('ipcRenderer', {
    on(...args) {
        const [channel, listener] = args;
        return ipcRenderer.on(channel, (event, ...a) => listener(event, ...a));
    },
    off(...args) {
        const [channel, ...omit] = args;
        return ipcRenderer.off(channel, ...omit);
    },
    send(...args) {
        const [channel, ...omit] = args;
        return ipcRenderer.send(channel, ...omit);
    },
    invoke(...args) {
        const [channel, ...omit] = args;
        return ipcRenderer.invoke(channel, ...omit);
    },
});
