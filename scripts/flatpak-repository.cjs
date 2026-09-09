// Turn the bundle into a repository and a matching install reference.
// Pass an HTTPS repository URL when deploying the repository to a web host.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { version } = require('../package.json');
const release = path.resolve(__dirname, '../release');
const repo = path.join(release, 'flatpak-repo');
const bundle = fs.readdirSync(release).find(name => name.startsWith(`R1FT-Client-${version}-linux-`) && name.endsWith('.flatpak'));
if (!bundle) throw new Error('Build the Linux Flatpak bundle first.');
const url = new URL(process.argv[2] || pathToFileURL(repo + path.sep).href);
if (!['https:', 'file:'].includes(url.protocol)) throw new Error('Use an HTTPS URL or a local file URL.');
if (!fs.existsSync(path.join(repo, 'config'))) execFileSync('ostree', ['init', '--repo=' + repo, '--mode=archive-z2'], { stdio: 'inherit' });
execFileSync('flatpak', ['build-import-bundle', repo, path.join(release, bundle)], { stdio: 'inherit' });
execFileSync('flatpak', ['build-update-repo', repo], { stdio: 'inherit' });
const ref = path.join(release, 'R1FT-Client.flatpakref');
fs.writeFileSync(ref, `[Flatpak Ref]\nName=com.r1ft.client\nBranch=stable\nTitle=R1FT Client\nIsRuntime=false\nUrl=${url.href}\nRuntimeRepo=https://flathub.org/repo/flathub.flatpakrepo\nSuggestRemoteName=r1ft-client\n`);
console.log(`Created ${ref}\nRepository: ${repo}\n${url.protocol === 'file:' ? 'Local reference: keep the repository at this path. Regenerate with an HTTPS URL before sharing the reference.' : 'Upload the complete flatpak-repo directory to the configured URL before distributing this reference.'}`);
