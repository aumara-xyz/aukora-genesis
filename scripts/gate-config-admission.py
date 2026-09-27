"""The admission fields a launch writes into the gate config, and NOTHING ELSE.

WHY THIS IS A SEPARATE MODULE. `scripts/launch-dsh.py` is the config writer and it is Alpha's file: the
change there is ONE call, so a restructure he is already doing does not collide with it. Everything with a
decision in it lives here, where a court can import it and exercise the branches directly instead of
reading the launcher's source and hoping.

WITH NO OWNER INSTALL THIS RETURNS {} AND THE GATE PRINTS ITS CURRENT CEILING. That is the whole point of
returning an empty dict rather than a dict of nulls: a config carrying `pilotDaemonKeyPath: null` would
look like a deployment that MEANT to configure admission and got it wrong, and the gate would be right to
refuse. Absence has to be absent.
"""
import json
import os

# THE PIN IS THE ROOT-OWNED INSTALL'S KEY. This is the same constant Aumlok's daemon publishes, and it is
# deliberately hard-coded rather than configurable: a pin path that can be pointed somewhere else by a
# caller is not a pin, and this file exists so that the path a launch uses is the path the install wrote.
OWNER_PIN_PATH = '/Library/Application Support/AUKORA-Owner/owner.pub'

# WHERE THE OWNER DAEMON KEEPS THE SET GRANT IT SIGNED. Owner-owned, readable by the gate, never written
# by the agent. Named here so the launcher and the daemon agree on one string.
OWNER_SET_GRANT_PATH = '/Library/Application Support/AUKORA-Owner/set-grant.json'


def admission_fields(release_id, pin_path=OWNER_PIN_PATH, set_grant_path=OWNER_SET_GRANT_PATH,
                     daemon_present=None):
    """The admission keys for the gate config, or {} when no owner install is present.

    `daemon_present` IS THE CALLER'S VERDICT FROM THE DETECTOR, not a guess made here. `requireGrant` is
    true exactly when a daemon is installed: with one present, a missing grant must refuse, and with none
    it must not, because there is nothing that could have signed one.

    A SET GRANT THAT CANNOT BE READ IS AN ERROR RATHER THAN AN OMITTED FIELD. If a daemon is present and
    its grant is missing or malformed, writing a config WITHOUT the grant would produce a gate that
    refuses everything with `grant-required-when-owner-present` — technically correct and completely
    undiagnosable from the outside. The launch fails here instead, naming the path.
    """
    if not os.path.exists(pin_path):
        return {}
    present = os.path.exists(OWNER_PIN_PATH) if daemon_present is None else daemon_present
    fields = {
        # THE ROOT-OWNED PIN, from the install's own path. Never an agent-writable location.
        'pilotDaemonKeyPath': pin_path,
        'requireGrant': bool(present),
        'pilotRelease': release_id,
    }
    if os.path.exists(set_grant_path):
        with open(set_grant_path, encoding='utf-8') as handle:
            fields['setGrant'] = json.load(handle)
    elif present:
        raise SystemExit(
            f'gate-set-grant-unreadable: an owner daemon is installed ({pin_path} exists) and no set grant '
            f'is readable at {set_grant_path}. Writing a config without it would install a gate that '
            'refuses every plugin with grant-required-when-owner-present, which is correct and impossible '
            'to diagnose from the outside. The owner must approve the plugin set first.')
    return fields
