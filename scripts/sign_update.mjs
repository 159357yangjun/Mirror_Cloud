// Ed25519 release signing. Private seed is read only from the step-scoped environment.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function publicKey(hex) {
  if (!/^[a-f0-9]{64}$/i.test(hex || '') || /^0+$/.test(hex)) throw new Error('Missing or invalid MIRROR_UPDATE_PUBLIC_KEY')
  return createPublicKey({ key: Buffer.from(`302a300506032b6570032100${hex}`, 'hex'), format: 'der', type: 'spki' })
}

export function signingKey(seedHex, expectedPublicHex) {
  const expected = publicKey(expectedPublicHex)
  if (!/^[a-f0-9]{64}$/i.test(seedHex || '')) throw new Error('Missing or invalid MIRROR_UPDATE_SIGNING_SEED')
  const seed = Buffer.from(seedHex, 'hex')
  try {
    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })
    if (!createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).equals(expected.export({ format: 'der', type: 'spki' }))) {
      throw new Error('Signing seed does not match the compiled public key')
    }
    return privateKey
  } finally { seed.fill(0) }
}

export async function signRelease(directory, version, seedHex, publicHex) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) throw new Error('Invalid release version')
  const key = signingKey(seedHex, publicHex)
  const assetName = `image-hosting-platform-v${version}-windows-x64-setup.exe`
  const path = join(directory, assetName)
  const size = (await stat(path)).size
  if (size < 1 || size > 64 * 1024 * 1024) throw new Error('Installer exceeds signed update size budget')
  const body = await readFile(path)
  const raw = Buffer.from(JSON.stringify({ schemaVersion: 1, version, target: 'windows-x86_64', assetName, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }) + '\n')
  const signature = sign(null, raw, key)
  if (!verify(null, raw, publicKey(publicHex), signature)) throw new Error('Signature self-check failed')
  await writeFile(join(directory, 'update-manifest.json'), raw)
  await writeFile(join(directory, 'update-manifest.json.sig'), signature.toString('hex') + '\n')
  return { raw, signature }
}

export async function verifyRelease(directory, version, publicHex) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || '')) throw new Error('Invalid release version')
  const raw = await readFile(join(directory, 'update-manifest.json'))
  const signatureHex = (await readFile(join(directory, 'update-manifest.json.sig'), 'utf8')).trim()
  if (raw.length > 16 * 1024 || !/^[a-f0-9]{128}$/i.test(signatureHex)
    || !verify(null, raw, publicKey(publicHex), Buffer.from(signatureHex, 'hex'))) throw new Error('Update signature verification failed')
  const m = JSON.parse(raw)
  if (Object.keys(m).sort().join(',') !== 'assetName,bytes,schemaVersion,sha256,target,version') throw new Error('Unknown update metadata fields')
  const expectedName = `image-hosting-platform-v${version}-windows-x64-setup.exe`
  if (m.schemaVersion !== 1 || m.version !== version || m.target !== 'windows-x86_64'
    || m.assetName !== expectedName || !Number.isSafeInteger(m.bytes) || m.bytes < 1
    || m.bytes > 64 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(m.sha256)) throw new Error('Signed update metadata mismatch')
  const path = join(directory, expectedName)
  if ((await stat(path)).size !== m.bytes) throw new Error('Installer size mismatch')
  const body = await readFile(path)
  if (createHash('sha256').update(body).digest('hex') !== m.sha256) throw new Error('Installer hash mismatch')
  return m
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const pinnedPublicKey = (await readFile(new URL('../apps/desktop/src-tauri/update-public-key.hex', import.meta.url), 'utf8')).trim()
    if (process.argv[2] === '--preflight') {
      signingKey(process.env.MIRROR_UPDATE_SIGNING_SEED, pinnedPublicKey)
    } else {
      const pkg = JSON.parse(await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'))
      if (process.argv[2] === '--verify') {
        await verifyRelease(resolve(process.argv[3] || 'release'), process.argv[4] || pkg.version, process.env.MIRROR_UPDATE_PUBLIC_KEY || pinnedPublicKey)
      } else {
        await signRelease(resolve(process.argv[2] || 'release'), pkg.version, process.env.MIRROR_UPDATE_SIGNING_SEED, pinnedPublicKey)
      }
    }
    console.log('Update signature validation passed')
  } catch (error) {
    // Errors contain fixed descriptions only; never print crypto objects or environment values.
    console.error(error instanceof Error ? error.message : 'Update signing failed')
    process.exitCode = 1
  } finally { delete process.env.MIRROR_UPDATE_SIGNING_SEED }
}
