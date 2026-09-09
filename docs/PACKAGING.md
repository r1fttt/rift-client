# Installer builds

Source: https://github.com/r1fttt/rift-client. Build outputs go into `release/` and are excluded from Git.

Run `npm ci` with Node 22.12 or newer, then:

| Command | Outputs | Build host |
| --- | --- | --- |
| `npm run dist:win` | x64 NSIS EXE and MSI | Windows, or Linux with Wine |
| `npm run dist:mac` | Intel and Apple Silicon DMG and PKG | macOS |
| `npm run dist:linux` | x64 AppImage, DEB, RPM, Flatpak, Snap | Linux with RPM and Flatpak tools |
| `npm run dist:flatpak` | x64 Flatpak, repository and local flatpakref | Linux with Flatpak tools |

The EXE installer allows choosing an installation directory. MSI is an alternative installer for the same application. Install one format per machine. Windows and macOS builds are unsigned unless signing credentials are configured; macOS builds are not notarized by default.

The `Build installers` GitHub Actions workflow builds Windows, Linux, and both macOS architectures. Run it from the Actions tab, or push a version tag. Download the resulting Actions artifacts. Adding this workflow with a classic GitHub token requires the `workflow` scope as well as repository access. It does not publish a GitHub release or upload to the Snap Store or Flathub.

## Linux prerequisites

On Ubuntu, install `rpm`, `flatpak`, `flatpak-builder`, and `ostree`. Configure the user Flathub remote and install these refs:

```sh
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 org.electronjs.Electron2.BaseApp//25.08
```

Snap uses electron-builder's bundled template tools. Install the locally built package with `sudo snap install --dangerous release/R1FT-Client-0.68.1-linux-amd64.snap`. `--dangerous` is Snap's option for locally built packages without store assertions. The sandbox allows network, graphics, audio, and home-directory access. A host Java outside the sandbox may not be usable; use the launcher's Java download feature. Snap and Flatpak require testing on their target runtimes, especially Microsoft login and launching downloaded Java.

## Flatpak references and hosting

Install the standalone `.flatpak` bundle using `flatpak install --user ./release/R1FT-Client-0.68.1-linux-x86_64.flatpak`.

`node scripts/flatpak-repository.cjs` imports the bundle into `release/flatpak-repo/` and writes `release/R1FT-Client.flatpakref`. By default this reference uses the absolute local repository path; it works only while that directory remains there. A `.flatpakref` is a repository pointer, not a self-contained installer.

To prepare a reference for distribution:

```sh
node scripts/flatpak-repository.cjs https://YOUR-HOST/flatpak/
```

Upload the entire generated `flatpak-repo/` directory to that HTTPS location before sharing the reference. No public repository URL is invented or enabled by these scripts. Install a local unsigned reference with `flatpak install --user ./release/R1FT-Client.flatpakref`. The local repository is unsigned; a public production repository should be signed and the public key supplied in its reference.
