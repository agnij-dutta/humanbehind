# Dev fixtures (TEST ONLY, NOT SECRETS)

These files exist so the dev flow can mint fresh **test** Aadhaar QR payloads
without anyone ever touching real Aadhaar data.

| File | What it is |
|---|---|
| `uidai-sample-v1-qr.txt` | UIDAI's own published sample Secure QR (a fictitious resident), as shipped in the anon-aadhaar repo. |
| `testPrivateKey.pem` | anon-aadhaar's **public** test RSA key (`circuits/assets/testPrivateKey.pem` in github.com/anon-aadhaar/anon-aadhaar). Everyone has it. |
| `testCertificate.pem` | The matching test certificate. Its key hash is `15134874015316324267425466444584014077184337590635665158241104437045239495873`. |

Because the test private key is public, a proof made with it proves nothing
about a real person. That is why:

- `HumanBindingRegistry` reads its trust anchor from the verifier at deploy
  time and exposes `isTestAnchor()`; there is no runtime switch.
- `@humanbehind/verifier`'s `isHumanBacked()` returns `false` for a
  test-anchored registry unless the caller explicitly passes
  `allowTestAnchor: true`.
- The web app only serves the test-QR endpoint when the **server** env
  `HB_DEV_MODE=true`, and the UI labels every test artifact as TEST.
