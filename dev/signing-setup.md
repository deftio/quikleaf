# Code Signing & Notarization Setup for qudown

Step-by-step guide to obtaining all credentials needed for signed releases on macOS, Windows, and Linux.

## Overview

| Platform | What you need | Cost | Time |
|----------|--------------|------|------|
| macOS | Apple Developer account + certificates | $99/year | ~1 day (notarization approval) |
| Windows | EV code signing certificate | $200-400/year | 1-2 weeks (identity verification) |
| Linux | GPG key (optional, for .deb signing) | Free | ~10 min |

---

## 1. macOS Code Signing & Notarization

Without this, users see "qudown is damaged and can't be opened" and must run `xattr -cr`.

### Step 1: Enroll in Apple Developer Program

1. Go to https://developer.apple.com/programs/
2. Click "Enroll" — sign in with your Apple ID
3. Pay $99/year (individual account is fine)
4. Wait for approval (usually same day, sometimes 24-48h)

### Step 2: Create Certificates

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Click "+" to create a new certificate
3. Create **two** certificates:
   - **Developer ID Application** — signs the .app bundle
   - **Developer ID Installer** — signs the .dmg / .pkg
4. For each:
   - Open Keychain Access on your Mac
   - Keychain Access > Certificate Assistant > Request a Certificate from a CA
   - Enter your email, select "Saved to disk", click Continue
   - Upload the `.certSigningRequest` file to Apple's portal
   - Download the `.cer` file and double-click to install in Keychain

### Step 3: Export as .p12

1. Open Keychain Access
2. Find your "Developer ID Application" certificate under "My Certificates"
3. Right-click > Export — save as `.p12` format
4. Set a strong password (you'll need this as a GitHub secret)
5. Save the .p12 file to `dev/signing/` (gitignored)

### Step 4: Create an App-Specific Password

1. Go to https://appleid.apple.com/account/manage
2. Sign In & Security > App-Specific Passwords
3. Click "+" — label it "qudown-notarization"
4. Copy the generated password

### Step 5: Get your Team ID

1. Go to https://developer.apple.com/account/#/membership
2. Copy the "Team ID" (10-character string like `ABC1234DEF`)

### Step 6: Set GitHub Secrets

Go to your repo Settings > Secrets and variables > Actions, and add:

| Secret name | Value |
|------------|-------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 file: `base64 -i dev/signing/certificate.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the .p12 |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | The app-specific password from Step 4 |
| `APPLE_TEAM_ID` | The 10-character Team ID from Step 5 |

### Verify locally (optional)

```bash
# Check certificate is installed
security find-identity -v -p codesigning

# Should show something like:
# 1) ABCDEF123... "Developer ID Application: Your Name (TEAM_ID)"
```

---

## 2. Windows Code Signing

Without this, SmartScreen shows "Windows protected your PC" warning.

### Option A: OV Certificate (cheaper, still shows warning briefly)

OV (Organization Validation) certificates are cheaper but SmartScreen still warns until the binary builds reputation (many downloads).

### Option B: EV Certificate (recommended, instant trust)

EV (Extended Validation) certificates get immediate SmartScreen trust. They require a hardware token (USB key).

### Step 1: Purchase a Certificate

Recommended providers (EV certificates):

| Provider | Price | Notes |
|----------|-------|-------|
| SignPath (via certum.pl) | Free for OSS | https://signpath.io — free for open source projects |
| SSL.com | ~$240/year | EV code signing, cloud-based signing available |
| Sectigo (Comodo) | ~$300/year | Traditional EV with USB token |
| DigiCert | ~$400/year | Premium, fast validation |

**For open source:** Try SignPath first — they provide free EV signing for OSS projects.

### Step 2: Identity Verification

The CA will verify your identity:
- **OV**: Business registration docs or personal ID
- **EV**: Business registration + phone verification + may require notarized docs

This takes 1-5 business days for OV, 1-2 weeks for EV.

### Step 3: Set GitHub Secrets

The exact secrets depend on the provider. For cloud-based signing (SSL.com):

| Secret name | Value |
|------------|-------|
| `WINDOWS_CERTIFICATE` | Base64-encoded .pfx file |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password |

For SignPath:

| Secret name | Value |
|------------|-------|
| `SIGNPATH_API_TOKEN` | Your API token from SignPath |

### Step 4: Update tauri.conf.json

Add signing configuration:

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "YOUR_THUMBPRINT",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.sectigo.com"
    }
  }
}
```

---

## 3. Linux Package Signing (Optional)

Linux packages (.deb, .AppImage) don't strictly need signing, but it's good practice for .deb repos.

### Step 1: Create a GPG Key

```bash
gpg --full-generate-key
# Select: RSA and RSA, 4096 bits, does not expire
# Name: deftio
# Email: deftio@deftio.com
```

### Step 2: Export and Set Secrets

```bash
# Export private key
gpg --armor --export-secret-keys deftio@deftio.com > dev/signing/gpg-private.asc

# Get key ID
gpg --list-secret-keys --keyid-format=long
```

| Secret name | Value |
|------------|-------|
| `GPG_PRIVATE_KEY` | Contents of gpg-private.asc |
| `GPG_PASSPHRASE` | Your GPG key passphrase |

---

## 4. Update release.yml

Once you have the credentials, the release workflow needs these env vars added to the Tauri build step:

```yaml
- name: Build Tauri app
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # macOS signing
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    # Windows signing (if using pfx)
    # WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
    # WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
```

Tauri's build action picks these up automatically and handles signing + notarization.

---

## Checklist

- [ ] Apple Developer account enrolled ($99/year)
- [ ] Developer ID Application certificate created and exported as .p12
- [ ] Developer ID Installer certificate created
- [ ] App-specific password generated for notarization
- [ ] Apple Team ID noted
- [ ] All 5 APPLE_* secrets added to GitHub repo
- [ ] Windows code signing certificate obtained (or SignPath OSS application submitted)
- [ ] Windows secrets added to GitHub repo
- [ ] release.yml updated with signing env vars
- [ ] Test: push a tag, verify signed installers in draft release
- [ ] (Optional) GPG key created for Linux .deb signing

---

## Local Credential Storage

Store any credential files in `dev/signing/` — this directory is gitignored.

```
dev/signing/
  certificate.p12        # macOS signing cert
  certificate.pfx        # Windows signing cert (if applicable)
  gpg-private.asc        # Linux GPG key
  notes.txt              # Your passwords/IDs (keep secure!)
```

**Never commit credential files to git.**
