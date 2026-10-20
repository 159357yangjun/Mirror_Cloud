import assert from 'node:assert/strict'
import { diagnoseR2Failure, r2EndpointPreview, validateR2Setup } from '../apps/desktop/src/lib/r2Diagnostics.ts'

const valid = {
  name: 'R2', accountId: '0123456789abcdef0123456789abcdef', bucket: 'my-images',
  region: 'auto', accessMode: 'private_requested', publicBaseUrl: '',
  accessKeyId: 'test-only', secretAccessKey: 'test-only-not-real',
}
let checks = 0
function check(label, run) { run(); checks++; console.log('R2_DIAG_TEST PASS ' + label) }
check('valid private default bucket uses no remote I/O', () => {
  assert.equal(validateR2Setup(valid).length, 0)
  assert.equal(r2EndpointPreview(valid.accountId), 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com')
})
check('bucket rejects uppercase, underscores, too short, unsafe edges', () => {
  for (const bucket of ['My-Images', 'my_images', 'a', '-abc', 'abc-', 'a'.repeat(64)]) {
    assert(validateR2Setup({ ...valid, bucket }).some((x) => x.field === 'bucket'), bucket)
  }
})
check('account id malformed, and jurisdiction not silently accepted', () => {
  assert(validateR2Setup({ ...valid, accountId: 'bad' }).some((x) => x.field === 'accountId'))
  assert.equal(r2EndpointPreview('bad'), null)
  assert(validateR2Setup({ ...valid, region: 'eu' }).some((x) => x.field === 'region'))
})
check('private public URL is rejected', () => {
  assert(validateR2Setup({ ...valid, publicBaseUrl: 'https://foo.com' }).some((x) => x.field === 'publicBaseUrl'))
})
check('public API endpoint is not an image URL', () => {
  assert(validateR2Setup({ ...valid, accessMode: 'public', publicBaseUrl: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com' }).some((x) => x.field === 'publicBaseUrl'))
  assert.equal(validateR2Setup({ ...valid, accessMode: 'public', publicBaseUrl: 'https://img.example.com' }).length, 0)
})
check('public URL strips credentials, query and fragments', () => {
  for (const url of ['https://user:pass@img.example.com', 'https://img.example.com/?sig=123', 'not-an-url']) {
    assert(validateR2Setup({ ...valid, accessMode: 'public', publicBaseUrl: url }).some((x) => x.field === 'publicBaseUrl'))
  }
})
check('empty keys rejected without revealing values', () => {
  const issues=validateR2Setup({ ...valid, secretAccessKey: '', accessKeyId: '' })
  assert(issues.some((x) => x.field === 'accessKeyId'))
  assert(issues.some((x) => x.field === 'secretAccessKey'))
})
check('diagnoses are constant and redact secrets/signed URL', () => {
  const secret = 'secret-never-show-this'
  for (const providerError of [
    'AccessDenied token=' + secret,
    'NoSuchBucket https://example.org/?X-Amz-Signature=' + secret,
    'SignatureDoesNotMatch secret=' + secret,
    'TLS error ' + secret,
    'unknown ' + secret,
  ]) {
    const verdict = diagnoseR2Failure(providerError)
    assert(!JSON.stringify(verdict).includes(secret))
    assert(!JSON.stringify(verdict).includes('X-Amz-Signature'))
  }
})
check('access denied cannot be described as proven root cause', () => {
  const v=diagnoseR2Failure('AccessDenied')
  assert.equal(v.kind, 'permission')
  assert.match(v.title, /可能/)
})
console.log('R2_OFFLINE_DIAGNOSTICS_GATE checks=' + checks + ' failed=0')
