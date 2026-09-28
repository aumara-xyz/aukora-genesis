# The airlock: attended macOS runbook

**NOT ENFORCED until the operator completes and probes this installation:** second-UID key custody.
The owner's key remains software. Root/admin access can cross the boundary. Socket credentials identify a UID,
not a person or a popup click: another process with the operator's UID can request signatures directly.
There is no server-side check on GitHub main. Local digests identify reviewed bytes; they are not CI,
independent provenance, or proof that a person reviewed them. Installed-app behavior is NOT VERIFIED here.

This runbook is for a first install. Stop if any named account, config, plist, or destination already
exists; inspect it instead of replacing an unknown installation. Quit AUKORA before rotation. The
reviewed desktop signer change must be loaded through the normal release process before starting the
app with this config; copying the daemon does not update the desktop app. Run no command as an agent.
Every numbered step below is **The operator runs this (admin password)**; the first step computes bytes as
the operator before entering an admin shell. Paths containing `AUKORA-Owner` are separate from the app's state.

1. **The operator runs this (admin password).** Review the source and build locally, without sudo:

   ```sh
   cd ~/aukora-worktrees/airlock
   sh scripts/check.sh
   node scripts/aukora/airlock-digests.mjs --bundle /private/tmp/aukora-airlock-bundle
   /usr/bin/otool -L /private/tmp/aukora-airlock-bundle/bin/node
   ```

   Keep the printed `MANIFEST_SHA256` separately. Inspect `MANIFEST.sha256`: the existing
   `scripts/owner/owner-closure.mjs` follows the daemon/rotation/probe import graph, preserves notices,
   and includes the locally compiled `peer-uid` and this Node executable. Refuse a Node build whose
   `otool` dependencies resolve outside `/usr/lib` or `/System/Library`. Stop other agents while
   reviewing and staging: a digest supplied by the same writable checkout is not an independent witness.
   No seed, app state, or phrase is in this bundle. These commands do not create an account or install.

2. **The operator runs this (admin password).** Enter a clean admin shell and stage the exact reviewed bytes.
   Set `WANT` to the manifest digest from step 1; do not compute its expected value inside this shell.

   ```sh
   sudo -k /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash
   set -eu
   umask 077
   WANT='<MANIFEST_SHA256 from step 1>'
   CODE='/Library/Application Support/AUKORA-Airlock/code'
   test ! -e '/Library/Application Support/AUKORA-Airlock'
   test ! -L '/Library/Application Support/AUKORA-Airlock'
   STAGE=$(/usr/bin/mktemp -d /private/var/root/aukora-airlock.XXXXXX)
   /bin/cp -RP /private/tmp/aukora-airlock-bundle "$STAGE/bundle"
   cd "$STAGE/bundle"
   test -z "$(/usr/bin/find . ! -type d ! -type f -print)"
   test "$(/usr/bin/shasum -a 256 MANIFEST.sha256 | /usr/bin/awk '{print $1}')" = "$WANT"
   /usr/bin/awk 'length($1)!=64 || $2 ~ /(^\/|(^|\/)\.\.(\/|$))/ || NF!=2 {exit 1}' MANIFEST.sha256
   /usr/bin/shasum -a 256 -c MANIFEST.sha256
   /usr/bin/awk '{print $2}' MANIFEST.sha256 | /usr/bin/sort > "$STAGE/want"
   /usr/bin/find . -type f ! -name MANIFEST.sha256 | /usr/bin/sed 's|^./||' | /usr/bin/sort > "$STAGE/got"
   /usr/bin/cmp "$STAGE/want" "$STAGE/got"
   /usr/bin/install -d -o root -g wheel -m 0755 '/Library/Application Support/AUKORA-Airlock'
   /bin/mv "$STAGE/bundle" "$CODE"
   /usr/sbin/chown -R root:wheel "$CODE"
   /bin/chmod -RN "$CODE"
   /usr/bin/find "$CODE" -type d -exec /bin/chmod 0755 {} +
   /usr/bin/find "$CODE" -type f -exec /bin/chmod 0644 {} +
   /bin/chmod 0755 "$CODE/bin/node" "$CODE/peer-uid"
   ```

   Keep this admin shell open through step 7. Nothing from the bundle executes before its staged digest
   check. The code, runtime, helper and their ancestors must remain root-owned and not writable by the operator.

3. **The operator runs this (admin password).** Create the account and groups. The password prompt below is
   for the new account; its login is disabled immediately afterward. Set `APP_USER` to the app user's macOS short
   name. Neither add this account to `admin` nor add the app user to `aukora-owner`.

   ```sh
   APP_USER='<your macOS short name>'
   APP_UID=$(/usr/bin/id -u "$APP_USER")
   OWNER_HOME=/private/var/aukora-owner-home
   test ! -e "$OWNER_HOME"
   test ! -L "$OWNER_HOME"
   if /usr/bin/id aukora-owner >/dev/null 2>&1; then exit 1; fi
   if /usr/sbin/dseditgroup -o read aukora-owner >/dev/null 2>&1; then exit 1; fi
   if /usr/sbin/dseditgroup -o read aukora-submit >/dev/null 2>&1; then exit 1; fi
   /usr/sbin/dseditgroup -o create aukora-owner
   /usr/sbin/sysadminctl -addUser aukora-owner -fullName 'AUKORA owner' -home "$OWNER_HOME" -shell /usr/bin/false -password -
   /usr/bin/dscl . -create /Users/aukora-owner AuthenticationAuthority ';DisabledUser;'
   /usr/sbin/dseditgroup -o edit -a aukora-owner -t user aukora-owner
   OWNER_GID=$(/usr/bin/dscl . -read /Groups/aukora-owner PrimaryGroupID | /usr/bin/awk '{print $2}')
   /usr/bin/dscl . -create /Users/aukora-owner PrimaryGroupID "$OWNER_GID"
   /usr/bin/install -d -o aukora-owner -g aukora-owner -m 0700 "$OWNER_HOME"
   /usr/sbin/chown -R aukora-owner:aukora-owner "$OWNER_HOME"
   /bin/chmod -RN "$OWNER_HOME"
   /bin/chmod 0700 "$OWNER_HOME"
   /usr/sbin/dseditgroup -o create aukora-submit
   /usr/sbin/dseditgroup -o edit -a "$APP_USER" -t user aukora-submit
   /usr/sbin/dseditgroup -o edit -a aukora-owner -t user aukora-submit
   OWNER_UID=$(/usr/bin/id -u aukora-owner)
   test "$OWNER_UID" != "$APP_UID"
   OWNER='/Library/Application Support/AUKORA-Owner'
   RUN='/Library/Application Support/AUKORA-Airlock/run'
   test ! -e "$OWNER"
   test ! -L "$OWNER"
   /usr/bin/install -d -o aukora-owner -g aukora-owner -m 0700 "$OWNER" "$OWNER/aumlok"
   /usr/bin/install -d -o aukora-owner -g aukora-submit -m 0750 "$RUN"
   /usr/bin/install -d -o root -g wheel -m 0755 /private/etc/aukora
   ```

4. **The operator runs this (admin password).** Rotate, never transfer the old seed. Quit the app first.
   Copy only its public record, then run the existing `refreshBindingV3` ceremony as the new UID.
   Enter the current root phrase and a different new phrase twice; input is hidden, never an argument
   or environment variable. Keep the new phrase offline. A lost current phrase cannot authorize this
   succession; stop instead of creating an unrelated identity.

   ```sh
   APP="/Users/$APP_USER/Library/Application Support/AUKORA"
   /usr/bin/install -o aukora-owner -g aukora-owner -m 0600 \
     "$APP/state/aumlok/local-control.json" "$OWNER/aumlok/local-control.json"
   /usr/bin/sudo -u aukora-owner "$CODE/bin/node" \
     "$CODE/scripts/aukora/airlock-rotate.mjs" "$OWNER/aumlok" "$APP_UID"
   /usr/sbin/chown aukora-owner:aukora-owner "$OWNER/aumlok/machine-seed-v3.json"
   /bin/chmod 0600 "$OWNER/aumlok/machine-seed-v3.json"
   ```

   The helper advances the epoch, carries the subject and signed succession, replaces `machines[]`,
   and checks every old machine is recorded as retired and refused by the refreshed public record.
   The new seed is created behind `0700` as the second UID. No old seed is read, copied, or printed.
   Copies of an old key cease to authorize against this refreshed record. Old/offline records and
   separate pins still accept whatever they previously trusted until they too are updated.

5. **The operator runs this (admin password).** Publish public data, update the live overlay, and pin the
   socket, daemon UID and new public key. This command reads no seed. The canonical root-owned config
   is `/private/etc/aukora/owner-daemon.json` (`/etc/aukora/owner-daemon.json` on macOS).

   ```sh
   test ! -e /private/etc/aukora/owner-daemon.json
   test ! -L /private/etc/aukora/owner-daemon.json
   "$CODE/bin/node" --input-type=module - "$OWNER" "$RUN" "$APP" "$OWNER_UID" "$APP_UID" <<'JS'
   import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
   import { recordProjection } from '/Library/Application Support/AUKORA-Airlock/code/plugins/aukora-aumlok/lib/record-v3.mjs';
   import { didKeyFromEd25519PublicKey } from '/Library/Application Support/AUKORA-Airlock/code/plugins/aukora-aumlok/lib/did-key.mjs';
   const [owner, run, app, ownerUid, callerUid] = process.argv.slice(2);
   const bytes = readFileSync(`${owner}/aumlok/local-control.json`);
   const record = JSON.parse(bytes), view = recordProjection(record);
   const ownerPublicKeyHex = record.publicRoot.machines[0].ed25519;
   const approverDid = didKeyFromEd25519PublicKey(ownerPublicKeyHex);
   const overlay = `${app}/kira-deployment-overlay.patch.yml`;
   let text = readFileSync(overlay, 'utf8');
   for (const [name, value] of Object.entries({subject:view.subject, activeControlDigest:view.rootId, approverDid})) {
     const pattern = new RegExp(`^(\\s*)${name}:.*$`, 'gm');
     if ([...text.matchAll(pattern)].length !== 1) throw Error(`expected one ${name} in overlay`);
     text = text.replace(pattern, (_, space) => `${space}${name}: ${value}`);
   }
   writeFileSync(`${app}/state/aumlok/local-control.json`, bytes);
   writeFileSync(overlay, text);
   writeFileSync('/private/etc/aukora/local-control.json', bytes, {flag:'wx',mode:0o644});
   const config = {socketPath:`${run}/owner.sock`, ownerUid:Number(ownerUid), callerUid:Number(callerUid),
     ownerPublicKeyHex, peerHelperPath:'/Library/Application Support/AUKORA-Airlock/code/peer-uid',
     keyPath:`${owner}/aumlok/machine-seed-v3.json`};
   writeFileSync('/private/etc/aukora/owner-daemon.json', JSON.stringify(config)+'\n', {flag:'wx',mode:0o644});
   chmodSync('/private/etc/aukora/owner-daemon.json', 0o644);
   JS
   /usr/sbin/chown root:wheel /private/etc/aukora/*.json
   ```

   Config presence makes the new shell refuse local seed loading and fail closed on an unavailable,
   wrong-UID or incorrectly signing daemon. Do not remove config to recover: that restores legacy local
   signing. App-owned records/overlays can still be rolled back by the operator's UID; the protected copy does
   not automatically change every verifier's trust source. Historical evidence retains its old keys.

6. **The operator runs this (admin password).** Install this launchd job. `GroupName` makes the new socket
   `aukora-submit`; the daemon enforces `0660`, checks key `0600`, private directory `0700`, run directory
   `0750`, and obtains the caller UID from the accepted socket through the measured native helper.

   ```sh
   test ! -e /Library/LaunchDaemons/com.aukora.airlock.plist
   /bin/cat > /Library/LaunchDaemons/com.aukora.airlock.plist <<'PLIST'
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>com.aukora.airlock</string>
     <key>UserName</key><string>aukora-owner</string>
     <key>GroupName</key><string>aukora-submit</string>
     <key>ProgramArguments</key><array>
       <string>/Library/Application Support/AUKORA-Airlock/code/bin/node</string>
       <string>/Library/Application Support/AUKORA-Airlock/code/plugins/aukora-owner-daemon/bin/airlock-daemon.mjs</string>
       <string>/etc/aukora/owner-daemon.json</string>
     </array>
     <key>WorkingDirectory</key><string>/Library/Application Support/AUKORA-Airlock/code</string>
     <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
     <key>Umask</key><integer>7</integer>
     <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin</string></dict>
   </dict></plist>
   PLIST
   /usr/sbin/chown root:wheel /Library/LaunchDaemons/com.aukora.airlock.plist
   /bin/chmod 0644 /Library/LaunchDaemons/com.aukora.airlock.plist
   /usr/bin/plutil -lint /Library/LaunchDaemons/com.aukora.airlock.plist
   /bin/launchctl bootstrap system /Library/LaunchDaemons/com.aukora.airlock.plist
   /bin/launchctl print system/com.aukora.airlock
   ```

7. **The operator runs this (admin password).** End the admin shell, log out and in to refresh group
   membership, then probe **as the operator, without sudo**:

   ```sh
   exit
   node ~/aukora-worktrees/airlock/scripts/aukora/airlock-probe.mjs
   ```

   The probe must get `EACCES` opening the configured key and require a different configured owner UID. Any other
   result retains `SAME_UID`; an absent file (`ENOENT`) is not proof. The probe never reads key bytes.
   Then reopen the updated AUKORA and have the owner approve an actual request. Until that output is observed, the
   installed flow is NOT VERIFIED. The source call path is `apps/aukora-desktop/main.mjs` →
   `aumlok-signer.mjs` → `aumlok-signer-airlock.mjs` → Unix socket →
   `plugins/aukora-owner-daemon/bin/airlock-daemon.mjs` → `lib/airlock-server.mjs` →
   `lib/airlock-protocol.mjs`. Both peers use `lib/peer-uid.mjs` → `native/peer-uid.c` for the kernel UID.
   This is a source trace, not evidence of an installed execution.

8. **The operator runs this (admin password).** Retire separate current verifier pins before claiming the old
   seed's copies no longer count everywhere. `docs/owner-pin.json` is the repository advance pin, read
   from the previous committed tree; `refreshBindingV3` does not update it. After the updated shell is
   running, these future commands stage and then ask the app to commit/push the pin update. They are
   part of installation, not commands performed while building these patches:

   ```sh
   cd ~/aukora-genesis
   node --input-type=module - <<'JS'
   import { readFileSync, writeFileSync } from 'node:fs';
   import { didKeyFromEd25519PublicKey } from '/Library/Application Support/AUKORA-Airlock/code/plugins/aukora-aumlok/lib/did-key.mjs';
   const record = JSON.parse(readFileSync('/etc/aukora/local-control.json', 'utf8'));
   const pin = JSON.parse(readFileSync('docs/owner-pin.json', 'utf8'));
   pin.approvalKeys = [didKeyFromEd25519PublicKey(record.publicRoot.machines[0].ed25519)];
   pin.policyVersion += 1;
   writeFileSync('docs/owner-pin.json', JSON.stringify(pin, null, 2)+'\n');
   JS
   node scripts/aukora/self-change.mjs --preview 'Retire the old approval key from the repository pin.' docs/owner-pin.json
   node scripts/aukora/self-change.mjs 'Retire the old approval key from the repository pin.' docs/owner-pin.json
   ```

   Do not use `advance-main` to bootstrap this pin: its previous-tree pin still names the old key.
   Other installations must adopt the signed succession and current pins.
   This runbook does not erase historical keys, stop record rollback globally, or establish remote main
   enforcement. Those remain NOT VERIFIED/NOT ENFORCED, even after a successful key-read probe.
