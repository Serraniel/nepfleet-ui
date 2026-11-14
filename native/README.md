# NepFleet native (prototype)

A desktop app with the operating system's own controls (Qt 6 Widgets, through [miqt](https://github.com/mappu/miqt)), to compare with the Tauri app ([#81](https://github.com/Serraniel/nepfleet-ui/issues/81)). Like the web UI, it is a client of the local control daemon (`nepfleet control`): it holds no logic of its own, and talks to the daemon's owner-only Unix socket.

What it does so far:

- **Machines:** list, add, check again, remove, connect and disconnect.
- **Setting a machine up:** prepare it (Docker), then install NepFleet, each as a reviewed plan with root steps marked. It asks for the sudo password when sudo needs one, and shows the log while it runs.
- **SSH keys with a passphrase:** asks for the passphrase and unlocks the key in the daemon's agent, then tries again.
- **Stacks** of a connected fleet: list, plan, and apply with the job's log. Destructive plans ask for the stack's name.
- **Tray icon** (closing hides the window), a single instance, and starting the daemon if it isn't running.

## Build

It needs Go and Qt 6 (`qt6-base` on Arch, `qt6-base-dev` on Debian and Ubuntu). The first build compiles the Qt bindings, which takes several minutes.

```sh
cd native
go build -trimpath -ldflags '-s -w' -o nepfleet-native .
./nepfleet-native
```

On Arch, `packaging/arch/nepfleet-native-git` builds and installs it next to the Tauri app.

`NEPFLEET_NATIVE_SCREENSHOT=<file.png>` saves the window as an image after a few seconds, then quits: for docs and CI (`QT_QPA_PLATFORM=offscreen` runs it without a display).
