# Arch Linux package

Until the desktop app is on the AUR, build and install it from here:

```sh
git clone https://github.com/Serraniel/nepfleet-ui && cd nepfleet-ui/packaging/arch/nepfleet-desktop-git
makepkg -si
```

- **`nepfleet-desktop-git`** builds the app from the latest commit and installs it with its menu entry and icon.
- **It needs the `nepfleet` command,** which starts the local control daemon. Install it from the [`nepfleet-bin`](https://github.com/Serraniel/nepfleet/tree/main/packaging/arch) package first, or `makepkg -si` will ask for it.
- **To update,** run `makepkg -si` again: the version comes from git.
