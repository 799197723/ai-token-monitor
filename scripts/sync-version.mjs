import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// tauri.conf.json
const tauriConfPath = join(root, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// Cargo.toml
const cargoPath = join(root, 'src-tauri/Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
writeFileSync(cargoPath, cargo.replace(/^version = ".*"/m, `version = "${version}"`));

// package-lock.json
const packageLockPath = join(root, 'package-lock.json');
const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
packageLock.version = version;
if (packageLock.packages?.['']) {
  packageLock.packages[''].version = version;
}
writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');

// Cargo.lock
const cargoLockPath = join(root, 'src-tauri/Cargo.lock');
const cargoLock = readFileSync(cargoLockPath, 'utf8');
writeFileSync(
  cargoLockPath,
  cargoLock.replace(
    /(\[\[package\]\]\nname = "ai-token-monitor"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  ),
);

console.log(`Synced version to ${version}`);
