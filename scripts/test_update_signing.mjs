import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify, createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { signRelease, verifyRelease, signingKey, publicKey } from './sign_update.mjs'

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    seed: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex'),
    publicHex: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
  }
}

test('independent Python signature vector verifies in Node', async () => {
  const vector = JSON.parse(await readFile(new URL('./fixtures/update-signature-vector.json', import.meta.url), 'utf8'))
  assert(verify(null, Buffer.from(vector.manifestHex, 'hex'), publicKey(vector.publicKey), Buffer.from(vector.signature, 'hex')))
  const productionKey = (await readFile(new URL('../apps/desktop/src-tauri/update-public-key.hex', import.meta.url), 'utf8')).trim()
  publicKey(productionKey)
  assert.notEqual(productionKey, vector.publicKey, 'the production trust root must not be the public fixture key')
})

test('release signer emits a verifiable manifest binding version, target, size and bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-signing-test-'))
  try {
    const key = keyPair()
    const file = 'image-hosting-platform-v2.0.0-windows-x64-setup.exe'
    const body = Buffer.from('test fixture, never executable')
    await writeFile(join(dir, file), body)
    const { raw, signature } = await signRelease(dir, '2.0.0', key.seed, key.publicHex)
    assert(verify(null, raw, publicKey(key.publicHex), signature))
    await verifyRelease(dir, '2.0.0', key.publicHex)
    await assert.rejects(verifyRelease(dir, '2.0.1', key.publicHex))
    await assert.rejects(verifyRelease(dir, '2.0.0', keyPair().publicHex))
    assert.deepEqual(JSON.parse(raw), { schemaVersion: 1, version: '2.0.0', target: 'windows-x86_64', assetName: file, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })
    assert.equal((await readFile(join(dir, 'update-manifest.json.sig'), 'utf8')).trim(), signature.toString('hex'))
    const changed = Buffer.from(raw)
    changed[0] ^= 1
    assert.equal(verify(null, changed, publicKey(key.publicHex), signature), false)
    assert.equal(verify(null, raw, publicKey(keyPair().publicHex), signature), false)
    const modified = Buffer.from(body)
    modified[0] ^= 1
    await writeFile(join(dir, file), modified)
    await assert.rejects(verifyRelease(dir, '2.0.0', key.publicHex))
    await writeFile(join(dir, file), body.subarray(1))
    await assert.rejects(verifyRelease(dir, '2.0.0', key.publicHex))
    await writeFile(join(dir, 'update-manifest.json.sig'), '')
    await assert.rejects(verifyRelease(dir, '2.0.0', key.publicHex))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('missing/mismatched trust configuration and unsafe release versions fail closed', async () => {
  const key = keyPair()
  for (const bad of ['', 'zz', '00'.repeat(32)]) assert.throws(() => publicKey(bad))
  assert.throws(() => signingKey('', key.publicHex))
  assert.throws(() => signingKey(key.seed, keyPair().publicHex))
  for (const version of ['../2.0.0', '02.0.0', 'v2.0.0', '2.0.0-rc1']) {
    await assert.rejects(signRelease('.', version, key.seed, key.publicHex))
  }
})

test('missing and empty installers are not signed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-signing-test-'))
  try {
    const key = keyPair()
    await assert.rejects(signRelease(dir, '2.0.0', key.seed, key.publicHex))
    await writeFile(join(dir, 'image-hosting-platform-v2.0.0-windows-x64-setup.exe'), '')
    await assert.rejects(signRelease(dir, '2.0.0', key.seed, key.publicHex))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('release asset verifier requires a valid signature for the sidecar metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mirror-signing-test-'))
  try {
    const key = keyPair()
    const exe = 'image-hosting-platform-v2.0.0-windows-x64-setup.exe'
    const msi = 'image-hosting-platform-v2.0.0-windows-x64.msi'
    const source = 'image-hosting-platform-v2.0.0-source.zip'
    await writeFile(join(dir, exe), 'fixture installer, never executable')
    await writeFile(join(dir, msi), 'fixture MSI, never executable')
    const archive = spawnSync('python', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("Cargo.toml",\'version = "2.0.0"\\n\'); z.writestr("apps/desktop/package.json",\'{"version":"2.0.0"}\'); z.writestr("apps/desktop/src-tauri/tauri.conf.json",\'{"version":"2.0.0"}\'); z.close()', join(dir, source)], { encoding: 'utf8' })
    assert.equal(archive.status, 0, archive.stderr)
    const sums = []
    for (const name of [exe, msi, source].sort()) sums.push(`${createHash('sha256').update(await readFile(join(dir, name))).digest('hex')}  ${name}`)
    await writeFile(join(dir, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
    await signRelease(dir, '2.0.0', key.seed, key.publicHex)
    const command = [fileURLToPath(new URL('./verify_release_assets.py', import.meta.url)), '--tag', 'v2.0.0', '--dir', dir, '--repo', join(dir, 'no-checkout'), '--require-signature', '--public-key', key.publicHex]
    const env = { ...process.env, PYTHONUTF8: '1' }
    const good = spawnSync('python', command, { encoding: 'utf8', env })
    assert.equal(good.status, 0, good.stdout + good.stderr)
    await writeFile(join(dir, 'update-manifest.json.sig'), '00'.repeat(64))
    const bad = spawnSync('python', command, { encoding: 'utf8', env })
    assert.notEqual(bad.status, 0)
    assert.match(bad.stdout, /FAIL release signature and signed installer metadata verify/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
