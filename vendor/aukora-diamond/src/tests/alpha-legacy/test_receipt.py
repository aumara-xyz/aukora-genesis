"""Actual historical v1 and synthetic v2 cold validation; no producer execution."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond.ed25519 import public_from_seed, sign
from profiles.alpha.legacy.keychain import validate_keychain
from profiles.alpha.legacy.receipt import parse_json, verify_receipt

FIX = Path(__file__).resolve().parent / "fixtures"
CLI = ROOT / "scripts/verify-alpha-legacy.py"
CORE = "kind nonce subject agent operation resource key from to canonical digest authority issuedAt expiresAt approvedAt settledAt statePath effectObserved probes capability usesRemaining scopeDisposed approval issuerKeyId domain envelope ceilings operatorPresence".split()
V2 = "authorization definitionId policyDigest evidenceDigest evidenceIds evidencePath".split()
SUBJECT = "3b1a5b966322f418652f15aca0ae5cb88ee77454"
HISTORICAL_PINS = {
    "receipt-v1.json": "ec5627d598a5eff615500d39c5ceeea911cca1bfe9c9979c2f315db46406569b",
    "aura.jsonl": "10d7e0bb5b26d338e0010fd55b885a2dda160f9135bfc2a8ce366284d7abec27",
    "issuer-public.jwk": "ffac8bed663e6882806be82e40af2da04dca1557b51700f7ca6ef222353571c2",
    "effect-v1.json": "793b5d2fc970b4cb60de6228be4c181908d61cb8eeb297b4387c97d8f1ea445c",
    "unsigned-v1.json": "9b4589526da2554937d1d1a0a7554fe7ff0e9415625e90c2b59ff7d3a1e76d37",
}


def wire(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def signed(body, seed):
    return base64.b64encode(sign(seed, wire(body))).decode()


def rows_for(r, seed):
    entries = []
    for e in ({"type":"settled", "nonce":r["nonce"], "digest":r["digest"], "subject":r["subject"], "to":r["to"], "observed":r["effectObserved"], "kid":"ep1", "domain":"aukora:evidence:v1"},
              {"type":"replay-probe", "nonce":r["nonce"], "result":"refused", "kid":"ep1", "domain":"aukora:evidence:v1"}):
        e = dict(e, sig=signed(e, seed)); prev = entries[-1]["hash"] if entries else "aukora-genesis-v1"; seq = len(entries)+1
        digest = hashlib.sha256(prev.encode()+b"\n"+str(seq).encode()+b"\n"+wire(e)).hexdigest()
        entries.append({"seq":seq,"prev":prev,"hash":digest,"entry":e})
    r["aura"] = {k:entries[0][k] for k in ("seq","prev","hash")}
    r["aura"]["log"] = "/never-open-this"
    r["replayProbeEntry"] = {k:entries[1][k] for k in ("seq","hash")}
    return entries


def synthetic_v2():
    r = json.loads((FIX/"receipt-v1.json").read_text())
    seed = bytes([37])*32
    jwk = {"kty":"OKP","crv":"Ed25519","kid":"ep1","x":base64.urlsafe_b64encode(public_from_seed(seed)).decode().rstrip("=")}
    definition = (ROOT/"profiles/alpha/contracts/workspace-patch.source.txt").read_bytes()
    source = b'{"records":[{"id":"incident-a","text":"synthetic permitted input"}]}'
    content = '{"service":"demo-api","logRetentionDays":30,"auditLogging":true,"exportDestination":"local"}\n'
    policy = {"version":"retention-v1", "service":"demo-api", "path":"demo-service/config.json",
              "minDays":7, "maxDays":90, "auditLogging":True, "exportDestination":"local"}
    action = {"op":"workspace.patch","resource":"demo-service-config","version":1,"workspace":"a"*36,
              "path":"demo-service/config.json","beforeSha256":"0"*64,"content":content,
              "definitionId":hashlib.sha256(b"aukora:workspace-definition:v1\n"+definition).hexdigest(),
              "policyDigest":hashlib.sha256(json.dumps(policy,separators=(",", ":")).encode()).hexdigest(),
              "evidenceDigest":hashlib.sha256(source).hexdigest(),"evidenceIds":["incident-a"]}
    r.update(kind="aukora-receipt/v2", operation="workspace.patch", resource=action["resource"],key=action["path"],
             canonical=wire(action).decode(),to=hashlib.sha256(content.encode()).hexdigest(),evidencePath="/never-open-evidence")
    r["from"] = action["beforeSha256"];r["effectObserved"]=r["to"];r["digest"]=hashlib.sha256(wire(action)).hexdigest()
    r["envelope"]["operations"]=["workspace.patch"]
    for k in ("definitionId","policyDigest","evidenceDigest","evidenceIds"):r[k]=action[k]
    auth={k:r[k] for k in ("digest","nonce","resource","issuedAt","expiresAt","definitionId")}
    auth.update(op="workspace.patch",challenge="synthetic-challenge",kid="ep1",domain="aukora:authorization:v2")
    r["authorization"]=dict(auth,signature=signed(auth,seed))
    r["signature"]=signed({k:r[k] for k in CORE+V2},seed)
    entries=rows_for(r,seed)
    return r,entries,validate_keychain(jwk,None,{},[]),content.encode(),source,definition,seed


class ReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.historical=json.loads((FIX/"receipt-v1.json").read_text())
        cls.historical_rows=[json.loads(line) for line in (FIX/"aura.jsonl").read_text().splitlines()]
        cls.historical_keys=validate_keychain(json.loads((FIX/"issuer-public.jwk").read_text()),None,{},[])
        cls.original=copy.deepcopy(cls.historical)
        seed=bytes([37])*32
        key={"kty":"OKP","crv":"Ed25519","kid":"ep1","x":base64.urlsafe_b64encode(public_from_seed(seed)).decode().rstrip("=")}
        cls.hierarchy=validate_keychain(key,None,{},[])
        cls.original["signature"]=signed({k:cls.original[k] for k in CORE},seed)
        cls.history=rows_for(cls.original,seed)
        cls.v2=synthetic_v2()

    def verify(self,r=None,**kw):
        args=dict(subject=SUBJECT,effect_bytes=b'{"limit":50000}');args.update(kw)
        return verify_receipt(self.original if r is None else r,self.history,self.hierarchy,**args)

    def verify_v2(self,v=None,**kw):
        r,entries,h,effect,source,definition,_=copy.deepcopy(self.v2 if v is None else v)
        args=dict(subject=SUBJECT,effect_bytes=effect,source_bytes=source,definition_bytes=definition);args.update(kw)
        return verify_receipt(r,entries,h,**args)

    def test_historical_fixture_hashes(self):
        provenance=json.loads((FIX/'PROVENANCE.json').read_text())
        self.assertEqual({e["path"] for e in provenance["files"]},set(HISTORICAL_PINS))
        for entry in provenance["files"]:
            raw=(FIX/entry["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),entry["sha256"])
            self.assertEqual(entry["sha256"],HISTORICAL_PINS[entry["path"]])
            self.assertEqual(hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),entry["gitBlob"])

    def test_real_historical_v1_with_scope(self):
        got=verify_receipt(self.historical,self.historical_rows,self.historical_keys,subject=SUBJECT,effect_bytes=b'{"limit":50000}')
        self.assertEqual(got["signedCore"],"SIGNATURE_VALID")
        self.assertEqual(got["transportMetadata"],"NOT_AUTHENTICATED")
        self.assertEqual(got["reportedApprovalMode"],"scripted")
        self.assertEqual(got["humanAttendance"],"NOT_ESTABLISHED")

    def test_historical_unsigned_fields_never_gain_attendance(self):
        r=json.loads((FIX/'unsigned-v1.json').read_text())
        r['operatorPresence']='human-attended'
        got=verify_receipt(r,self.historical_rows,self.historical_keys,
                           subject='78be97abea201c4a3b76c1888a8219010ad661c1',effect_bytes=b'{"limit":50000}')
        self.assertEqual(got['status'],'CHECKPOINT_COVERED_RECORD')
        self.assertEqual(got['signedCore'],'UNAUTHENTICATED')
        self.assertEqual(got['humanAttendance'],'NOT_ESTABLISHED')
        self.assertEqual(got['reportedApprovalMode'],'UNAUTHENTICATED')

    def test_separate_subject_and_effect_required(self):
        for kw in ({"subject":"0"*40},{"subject":None},{"effect_bytes":None},{"effect_bytes":b'{"limit":9}'}):
            with self.subTest(kw=kw),self.assertRaises(ValueError):self.verify(**kw)

    def test_signed_metadata_change_refused(self):
        r=copy.deepcopy(self.original);r["statePath"]="/other"
        with self.assertRaisesRegex(ValueError,"RECEIPT_SIGNATURE"):self.verify(r)

    def test_bad_signature_refused(self):
        r=copy.deepcopy(self.original);sig=bytearray(base64.b64decode(r["signature"]));sig[0]^=1
        r["signature"]=base64.b64encode(sig).decode()
        with self.assertRaisesRegex(ValueError,"RECEIPT_SIGNATURE"):self.verify(r)

    def test_transport_paths_are_not_trusted_or_opened(self):
        r=copy.deepcopy(self.original);r["aura"]["log"]="/nonexistent/never-read";r["witnessHead"]="/never-read"
        self.assertEqual(self.verify(r)["transportMetadata"],"NOT_AUTHENTICATED")

    def test_transport_cross_binding_refuses_wrong_sequence(self):
        for number in (True, 99):
            r=copy.deepcopy(self.original);r["aura"]["seq"]=number
            with self.subTest(number=number),self.assertRaisesRegex(ValueError,"AURA_BINDING"):self.verify(r)

    def test_strict_json_numbers_duplicates_and_depth(self):
        for raw in (b'{"a":1,"a":2}',b'{"a":1.5}',b'{"a":-0}',b'{"a":NaN}',b'{"a":9007199254740992}',b'['*70+b'0'+b']'*70):
            with self.subTest(raw=raw),self.assertRaises(ValueError):parse_json(raw)

    def test_input_types_are_named(self):
        for field,value in (("issuerKeyId",[]),("canonical",[])):
            r=copy.deepcopy(self.original);r[field]=value
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,"ALPHA_LEGACY_"):self.verify(r)
        with self.assertRaisesRegex(ValueError,"JSON_INVALID"):parse_json({})

    def test_synthetic_v2_is_consistent_not_execution(self):
        got=self.verify_v2();self.assertEqual(got["status"],"SIGNED_RECORD_CONSISTENT")
        self.assertEqual(got["effectExecution"],"NOT_ESTABLISHED")

    def test_v2_config_matches_preserved_producer_content_for(self):
        # workspace-patch.source.txt contentFor(30) emits this fixed field order.
        content = self.v2[3]
        self.assertEqual(content, b'{"service":"demo-api","logRetentionDays":30,"auditLogging":true,"exportDestination":"local"}\n')
        self.assertEqual(hashlib.sha256(content).hexdigest(),
                         "3f93ddaa0fdd23ada53f3c0289122a254906058e280f26839f00df47f149ea7a")
        self.assertEqual(self.v2[0]["policyDigest"],
                         "af92815fd459e31585f811cfc9e06632720f6ac7911ee1016f6ffb367fc14685")

    def test_v2_config_alternate_field_order_refuses_before_signature(self):
        v=list(copy.deepcopy(self.v2));action=json.loads(v[0]["canonical"])
        action["content"]='{"auditLogging":true,"exportDestination":"local","logRetentionDays":30,"service":"demo-api"}\n'
        v[0]["canonical"]=wire(action).decode()
        with self.assertRaisesRegex(ValueError,"ALPHA_LEGACY_CONTENT_ENCODING"):
            self.verify_v2(v)

    def test_v2_separate_source_and_definition_bytes(self):
        for kw in ({"source_bytes":None},{"source_bytes":b'{}'},{"definition_bytes":b'other'},{"effect_bytes":b'other'}):
            with self.subTest(kw=kw),self.assertRaises(ValueError):self.verify_v2(**kw)

    def test_v2_authorization_binding_refuses_signed_mismatch(self):
        v=list(copy.deepcopy(self.v2));r=v[0];seed=v[-1]
        r["authorization"]["nonce"]="other"
        r["authorization"]["signature"]=signed({k:x for k,x in r["authorization"].items() if k!="signature"},seed)
        with self.assertRaisesRegex(ValueError,"AUTHORIZATION_BINDING"):self.verify_v2(v)

    def test_boolean_authorization_timestamp_is_not_integer(self):
        v=list(copy.deepcopy(self.v2));r=v[0];seed=v[-1]
        r["issuedAt"]=1;r["authorization"]["issuedAt"]=True
        r["authorization"]["signature"]=signed({k:x for k,x in r["authorization"].items() if k!="signature"},seed)
        with self.assertRaisesRegex(ValueError,"AUTHORIZATION_BINDING"):self.verify_v2(v)

    def test_boolean_settlement_value_is_not_integer(self):
        r=copy.deepcopy(self.original);seed=bytes([37])*32
        r["to"]=1;r["effectObserved"]=1
        action={"from":r["from"],"key":r["key"],"op":"memory.put","resource":"customer-limit","to":1}
        r["canonical"]=wire(action).decode();r["digest"]=hashlib.sha256(wire(action)).hexdigest()
        r["signature"]=signed({k:r[k] for k in CORE},seed)
        # Wire-level boolean is independently signed, then chain is regenerated.
        other=copy.deepcopy(r);other["to"]=True
        entries=rows_for(other,seed);r["aura"]=other["aura"];r["replayProbeEntry"]=other["replayProbeEntry"]
        with self.assertRaisesRegex(ValueError,"SETTLED_BINDING"):
            verify_receipt(r,entries,self.hierarchy,subject=SUBJECT,effect_bytes=b'{"limit":1}')

    def test_approval_mode_is_signed_and_consistent(self):
        v=list(copy.deepcopy(self.v2));r=v[0];seed=v[-1]
        r["approval"]["mode"]="human-approved"
        r["signature"]=signed({k:r[k] for k in CORE+V2},seed)
        with self.assertRaisesRegex(ValueError,"APPROVAL_MODE_BINDING"):self.verify_v2(v)

    def test_cli_empty_cwd_and_scope_on_refusal(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);effect=p/'effect.json';effect.write_text('{"limit":50000}')
            args=[sys.executable,'-B',str(CLI),'--receipt',str(FIX/'receipt-v1.json'),'--log',str(FIX/'aura.jsonl'),
                  '--pub',str(FIX/'issuer-public.jwk'),'--subject',SUBJECT,'--effect',str(effect)]
            ok=subprocess.run(args,cwd=d,capture_output=True,text=True)
            self.assertEqual(ok.returncode,0,ok.stdout+ok.stderr)
            self.assertIn('ALPHA LEGACY: SIGNED_RECORD_CONSISTENT',ok.stdout)
            badkey=p/'bad-key.json';badkey.write_text('{"kty":"bad"}')
            for suffix in (['--subject','0'*40],['--retained-tip',''],['--pub',str(badkey)]):
                bad=subprocess.run(args+suffix,cwd=d,capture_output=True,text=True)
                self.assertEqual(bad.returncode,2,bad.stdout+bad.stderr)
                self.assertEqual(bad.stdout.count('CELL_EXECUTION: NOT_ESTABLISHED'),1)
                self.assertNotIn('ALPHA LEGACY: SIGNED_RECORD_CONSISTENT',bad.stdout)
                self.assertNotIn('Traceback',bad.stderr)
                if suffix[0]=='--pub':self.assertIn('alpha-keychain:public-key-fields',bad.stdout)
            usage=subprocess.run([sys.executable,'-B',str(CLI)],cwd=d,capture_output=True,text=True)
            self.assertEqual(usage.returncode,2)
            self.assertEqual(usage.stdout.count('CELL_EXECUTION: NOT_ESTABLISHED'),1)


if __name__=='__main__':unittest.main()
