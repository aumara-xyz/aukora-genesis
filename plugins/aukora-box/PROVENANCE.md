# Deep's box: sealed source copy

Source repository: aumara-xyz/aukora-deep.
Commit: c417f7c5752bf14b8e927986cd995f2e086f4189.
Read-only source: a local checkout of that commit.

Copied as-is, byte for byte, with Deep's directory layout; no copied file has been edited. This box is not mounted in the release, and the live agent still runs on the host. Neither guest confinement nor same-UID authority isolation is established by this copy. The four requested directories are complete; other modules are included only through the static/dynamic relative import graph, with their adjacent declarations and READMEs. The original package.json preserves Deep's ESM, license and dependency metadata; its dependencies are not installed.

Each line below is destination path, SHA-256, source path (tab separated).

```text
plugins/aukora-box/aukora/activation/broker-state.d.mts	117f9c11896580c6aa9cacdde3bb3e30c50c7d30953789fb416c0908416fbe0d	aukora/activation/broker-state.d.mts
plugins/aukora-box/aukora/activation/broker-state.mjs	8cf6296e853098c2168793e5daf2759189895d31c06e628df13ef0fd6aed015b	aukora/activation/broker-state.mjs
plugins/aukora-box/aukora/activation/measure.d.mts	c5b36c3c3a32a71f8577326cd415d528c18365b268953574f2f594482ad31a5d	aukora/activation/measure.d.mts
plugins/aukora-box/aukora/activation/measure.mjs	e30e78e1b2e9f78a5f1056df5b082ae9d96d69cffde4350ad2c3c10d59507b1c	aukora/activation/measure.mjs
plugins/aukora-box/aukora/activation/statement.d.mts	e96a11ce6741897e5867716eebd142442b7640fa919b0018311022e70b62eb2b	aukora/activation/statement.d.mts
plugins/aukora-box/aukora/activation/statement.mjs	9221c7ce3d0df6c8c50c99c218359161edbcd1c749d33a7f107a2b1b5eb51f0a	aukora/activation/statement.mjs
plugins/aukora-box/aukora/activation/web-rollback-record.d.mts	0556fff8abb824edf4ae2bd159070a20b0b770b41d4faf1510d183d9a51207bb	aukora/activation/web-rollback-record.d.mts
plugins/aukora-box/aukora/activation/web-rollback-record.mjs	4725e8f25ba2085e979a2edca4946be65a0fd13403edaf0d5d5afcf614b95dd5	aukora/activation/web-rollback-record.mjs
plugins/aukora-box/aukora/activation/web-upgrade-record.d.mts	17aa1572c6336b221977b632595cf4808c4968ef0ce0e38ed9141f6d4dc52c14	aukora/activation/web-upgrade-record.d.mts
plugins/aukora-box/aukora/activation/web-upgrade-record.mjs	a6c521a83b63b2a259ab22f2772f01bbefaefc2efc0f8d5f535f1f3172ede189	aukora/activation/web-upgrade-record.mjs
plugins/aukora-box/aukora/approval/artifact.d.mts	ce4e62e31edb43bc0446cfdbda17f4bd090045f9c0a7a5a36961af229113b611	aukora/approval/artifact.d.mts
plugins/aukora-box/aukora/approval/artifact.mjs	05ce446b22a8a3a993b105291fb1daadda0d2557c7c6748c1a3b14c56eeb4cca	aukora/approval/artifact.mjs
plugins/aukora-box/aukora/approval/occurrence.d.mts	0e0f3cda4b80ebf508efd7718f6a74ca179858992032feaea1471a5f8716bc27	aukora/approval/occurrence.d.mts
plugins/aukora-box/aukora/approval/occurrence.mjs	af8f74baf7ce989feece9c78ee998abdd58976128f8c6bef9cd0767d366cfd13	aukora/approval/occurrence.mjs
plugins/aukora-box/aukora/approval/render.d.mts	d2301164940cdf87c4457e6d5d8295dca717b91ec74ad1f96f3b8eb777bb5415	aukora/approval/render.d.mts
plugins/aukora-box/aukora/approval/render.mjs	d54e63231d2a6acafbae6ccb29cbba822e56b18342b53e8a5f787f331aac43a0	aukora/approval/render.mjs
plugins/aukora-box/aukora/aura/authority-evidence.d.mts	0a20fc92c135c7f1653041da6356a343d1cdd194e8a283242b80cba82488c1d1	aukora/aura/authority-evidence.d.mts
plugins/aukora-box/aukora/aura/authority-evidence.mjs	02dc5fcc4d9709646ca2afbff20870ffb3dd159cec1255c864e6996afb884259	aukora/aura/authority-evidence.mjs
plugins/aukora-box/aukora/aura/record.d.mts	98be8ab4f03e528a87465451539d80efc0cab2d2bc0b0585c3ef39fc84c99aa1	aukora/aura/record.d.mts
plugins/aukora-box/aukora/aura/record.mjs	399df7807a05a4b80d91c438e7a996a97482f0962f6f058eaf5a93aeda70c362	aukora/aura/record.mjs
plugins/aukora-box/aukora/broker/broker.d.mts	699971bb3923ed508e1b9438b5ab9aa91697643d5d50eae31d28c9a7318e713f	aukora/broker/broker.d.mts
plugins/aukora-box/aukora/broker/broker.mjs	d7be570e6bb530caae015bb41f3a2b492d320c43c3b01b5c1487fc83c38b096e	aukora/broker/broker.mjs
plugins/aukora-box/aukora/broker/compute-job-args.mjs	21f2a997709d8ef26fca728bde65130411d0c0437e156cf02e2265df43c8b813	aukora/broker/compute-job-args.mjs
plugins/aukora-box/aukora/broker/compute-job.mjs	9ca9cb486fe2fc550c618e8a55d98a973efd9f13084794e03ee4d327d2b764d1	aukora/broker/compute-job.mjs
plugins/aukora-box/aukora/broker/confinement.mjs	ac6bf193faa4638aebbf9a9a99908d660389c25d7b8d6600d151dc7155e01af5	aukora/broker/confinement.mjs
plugins/aukora-box/aukora/broker/effect-body.d.mts	c8f6eaa9f692840f5b35c64b2d962900f4cf5e240670b9a7099d61ba1019233c	aukora/broker/effect-body.d.mts
plugins/aukora-box/aukora/broker/effect-body.mjs	2bf952d3a2a1df45477cee07dc5a5e866a1536e9cead6052173d868414074495	aukora/broker/effect-body.mjs
plugins/aukora-box/aukora/broker/effect-definition.d.mts	da966e8d95ad33b5504ea0d97b9d2d8c78786428d2dd4e4dcf40c6fdb253a136	aukora/broker/effect-definition.d.mts
plugins/aukora-box/aukora/broker/effect-definition.mjs	515bab2cbcf7efb2bc9dfea27932a04b815f4c21dff1e7015ad00877bcceeacd	aukora/broker/effect-definition.mjs
plugins/aukora-box/aukora/broker/effect.d.mts	3e164faffb199e097a6d9a661cef43a024e33b94ca2cd2a72a7ed487c4226e3f	aukora/broker/effect.d.mts
plugins/aukora-box/aukora/broker/effect.mjs	2f2cbd042ff514d95b62aa836ef1036b195c5d91c18a3c54dbe3ff8866ce1422	aukora/broker/effect.mjs
plugins/aukora-box/aukora/broker/kira-recall.d.mts	5a4e5c8f5b7a846de9a5ffe990622606b4843649376aa67f96a87c85925eca6b	aukora/broker/kira-recall.d.mts
plugins/aukora-box/aukora/broker/kira-recall.mjs	04ae61f836f538076dbe8bbc04cae8242417752aad4cc502a3b6fa91e4bd41a6	aukora/broker/kira-recall.mjs
plugins/aukora-box/aukora/broker/memory-entries.d.mts	4a804609f8015eb8e2bc5bdf03f7b510a102cc2a36e971633a28b56ddfeaac10	aukora/broker/memory-entries.d.mts
plugins/aukora-box/aukora/broker/memory-entries.mjs	63eb0d2777169d1f5a93092a0f258b2aaf7dfb515a374e8b74d644caa7ae4714	aukora/broker/memory-entries.mjs
plugins/aukora-box/aukora/broker/memory-put-args.d.mts	705f6053cc863688c775b048cb540167efd2a1ccf68637829abd0e361b4fdd86	aukora/broker/memory-put-args.d.mts
plugins/aukora-box/aukora/broker/memory-put-args.mjs	360892f2c912de23c7df3e98b4c958eabbc3e98bf0ed578e701ac2e800aaf4ce	aukora/broker/memory-put-args.mjs
plugins/aukora-box/aukora/broker/operation.d.mts	555e32ebec5db0ede5c45ef1436330f61c334bfb3f7b58a647b6dc9d1576801f	aukora/broker/operation.d.mts
plugins/aukora-box/aukora/broker/operation.mjs	a1de0aab65305ab061753c9cad110255f8a314be61bca6ac809c5001e5f2e34c	aukora/broker/operation.mjs
plugins/aukora-box/aukora/broker/public-outcome.d.mts	8523a503f508eb193db8d29b3f6a6868c42e73e2f4f8813f62a45fdf21c1ad66	aukora/broker/public-outcome.d.mts
plugins/aukora-box/aukora/broker/public-outcome.mjs	908d888aaf4659acf9377c9d49dd4a812050e6ef2503c4565fb3718e6adaf7b3	aukora/broker/public-outcome.mjs
plugins/aukora-box/aukora/broker/receipt-inspect.mjs	c486d12d35e2b1ce92f96963119e8779572e1dec47b6814c0e31fd5a06f54299	aukora/broker/receipt-inspect.mjs
plugins/aukora-box/aukora/broker/receipt.d.mts	088de6c1575ec82e10d33fbec4e114ba582c6d2773be673dddb43e379984efcc	aukora/broker/receipt.d.mts
plugins/aukora-box/aukora/broker/receipt.mjs	618fe0563599d5085a5c4a741030b46fbe223ab602c17c6fe0b3d6c5b160fd9c	aukora/broker/receipt.mjs
plugins/aukora-box/aukora/broker/review.d.mts	4943d5f9bb946a857ea4e26ccbb8fd35d5db60db61486e928eda1ca567e51455	aukora/broker/review.d.mts
plugins/aukora-box/aukora/broker/review.mjs	0937b1ffe4ecf0a218048ecbbe02fb5228840d046df191c5fe7937e360eb702a	aukora/broker/review.mjs
plugins/aukora-box/aukora/broker/subject-authority.d.mts	eced9503fef04b1725e8e29ae658b5b0592d4cf5a9e8317aa9e415067a300339	aukora/broker/subject-authority.d.mts
plugins/aukora-box/aukora/broker/subject-authority.mjs	2d8de1b2b8d1d2aacf29c37c2e9074a0aa0ed6910d5db09ea90069557bce344f	aukora/broker/subject-authority.mjs
plugins/aukora-box/aukora/broker/web-activation-upgrade.d.mts	2c861f4bfbfe7ca50ec0747788b70781859b0a3fbf558680fd41dfe0339d283c	aukora/broker/web-activation-upgrade.d.mts
plugins/aukora-box/aukora/broker/web-activation-upgrade.mjs	90fee3e403087538112224c0f767aaf56b8cf70b238d3b110d219b8bf1cc543d	aukora/broker/web-activation-upgrade.mjs
plugins/aukora-box/aukora/broker/workspace-patch-args.d.mts	b7a71e9257d3b9938abd303fe713137792a55ed2a0bc299c3a28b1958c430475	aukora/broker/workspace-patch-args.d.mts
plugins/aukora-box/aukora/broker/workspace-patch-args.mjs	eabbe0dabd8f8c7edda5d93787b5dbf0c2a2e0dbeeadb2c47ee7f381b3e060cd	aukora/broker/workspace-patch-args.mjs
plugins/aukora-box/aukora/broker/workspace-patch.d.mts	4cafc9c747597114c8afc0b2a8f3b65c1975a24271294bd8638a8fdbc9a350f0	aukora/broker/workspace-patch.d.mts
plugins/aukora-box/aukora/broker/workspace-patch.mjs	ec261854130c20bc9501f88938338ec8222151d27222c20eeaf2c61a0a28b2f4	aukora/broker/workspace-patch.mjs
plugins/aukora-box/aukora/guest/wasm-proposal-cell.d.mts	befcf97210e4a811d7adde8bed7d1741fa849df5a52777210e0d898b300d6e47	aukora/guest/wasm-proposal-cell.d.mts
plugins/aukora-box/aukora/guest/wasm-proposal-cell.mjs	379d1a0514dd83cc6d23880f3509aa1438d55a10977ac95edbde9bd65f975197	aukora/guest/wasm-proposal-cell.mjs
plugins/aukora-box/aukora/host-dsh/src/grant-v5.d.mts	6377796d61207978533609fa3d278eca6968ecb9f48ff3ff8aaf664d14fc5bc7	aukora/host-dsh/src/grant-v5.d.mts
plugins/aukora-box/aukora/host-dsh/src/grant-v5.mjs	c0bc91bc9adffeba527860e37a1a72a242a2c118ddcc85f4429d7dcca80a0d8a	aukora/host-dsh/src/grant-v5.mjs
plugins/aukora-box/aukora/host-dsh/src/grant.d.mts	35cb60d47f52accdc3d7dbc1dbcd794ba944587092734fb2bff1787dfa7c11c1	aukora/host-dsh/src/grant.d.mts
plugins/aukora-box/aukora/host-dsh/src/grant.mjs	b7fc285b7b1a9dbef9d4610e28f44c3069d16b1e36f3fe20fabceb943d09de84	aukora/host-dsh/src/grant.mjs
plugins/aukora-box/aukora/host-dsh/src/nonce-book.d.mts	ec33fbd25f834ffcf14b877b30174b11455609307a30a2c1b0fb145ae9bc8526	aukora/host-dsh/src/nonce-book.d.mts
plugins/aukora-box/aukora/host-dsh/src/nonce-book.mjs	dfd13404be32f7c6a2a8ef3fb51e6ce215304442dffb2ba947983a70bfd03b09	aukora/host-dsh/src/nonce-book.mjs
plugins/aukora-box/aukora/host-dsh/src/verifier-bytes.mjs	7e8fa869662d13262d650c1f4cab88119d4dd1651db3dc20c541f46a5554d7ef	aukora/host-dsh/src/verifier-bytes.mjs
plugins/aukora-box/aukora/identity/broker-state.d.mts	123db068cd58b2536f35d17c30cfb89880dc80e11c45a3e11fb885757d380acf	aukora/identity/broker-state.d.mts
plugins/aukora-box/aukora/identity/broker-state.mjs	c0ddae992f0561ba4943fffbe2c6a7f3f987ea3c43eb158d11ea75ac90d47b2b	aukora/identity/broker-state.mjs
plugins/aukora-box/aukora/identity/control.d.mts	0ccf88b4868721d08318b6f020361474d60ed024dae7e501953c19ec6c4d9931	aukora/identity/control.d.mts
plugins/aukora-box/aukora/identity/control.mjs	1ac74d089faef3265214c5271329139f11897c898a740bd5db43f92952c9bdbd	aukora/identity/control.mjs
plugins/aukora-box/aukora/identity/delegation.d.mts	1afde544f17de7b9df4b857c39f72f219b3ad20518073a12292a8ea066582269	aukora/identity/delegation.d.mts
plugins/aukora-box/aukora/identity/delegation.mjs	e9f94812237bf9dd242592545689d0a71c47d75e1f010546b931b49e53fca4d7	aukora/identity/delegation.mjs
plugins/aukora-box/aukora/identity/genesis.d.mts	9013c3ff4b7fb6a873bca2e56ce99beaa66524d5ea5afe7c876dee61332e4e36	aukora/identity/genesis.d.mts
plugins/aukora-box/aukora/identity/genesis.mjs	c3f5e36d98c2367c995553f3c165c7b94ee80f5c0d1546806b37f6e5adba50f8	aukora/identity/genesis.mjs
plugins/aukora-box/aukora/identity/local-control-store.d.mts	0582e4e6ed0e8a27c3486aa63df488543e23e0e685b79e28544caf291acc6bdb	aukora/identity/local-control-store.d.mts
plugins/aukora-box/aukora/identity/local-control-store.mjs	0d767318cbbcbe5732160a72672765a464a88f85cd9178a670477b37e2108814	aukora/identity/local-control-store.mjs
plugins/aukora-box/aukora/identity/validation.mjs	3c581247d5ebeaa85da0a117d026cffbe3aa9e4f368c142ee1288d53b0b1787e	aukora/identity/validation.mjs
plugins/aukora-box/aukora/issuer/approval-carrier.d.mts	9934478fa21a70320ae09bbabe52927052984d889868125098ea18c0456dec66	aukora/issuer/approval-carrier.d.mts
plugins/aukora-box/aukora/issuer/approval-carrier.mjs	dd92183089ea5a63533b34e3fde804e883a2af6dcfe5298ba0aab845a755f5d4	aukora/issuer/approval-carrier.mjs
plugins/aukora-box/aukora/issuer/issuer.mjs	12f1d20363111109dcf24d0399b12b1a282052c20d1a5fd2d464fd9663f732ba	aukora/issuer/issuer.mjs
plugins/aukora-box/aukora/issuer/mint.d.mts	88a2abaf92f78361806127303be5d9f922aec1c695deb4e95cd10386afde72fc	aukora/issuer/mint.d.mts
plugins/aukora-box/aukora/issuer/mint.mjs	e9c40c5dcddd4e0a52cd5f2b95bdbda09c0c632a9c9a4e0e6adeeaaa46e76ba9	aukora/issuer/mint.mjs
plugins/aukora-box/aukora/kernel-seed/canonical-json.d.mts	7c5418eee4e817a557fe3bc7c55d7bfea25401f64fd14139213434cf3364b458	aukora/kernel-seed/canonical-json.d.mts
plugins/aukora-box/aukora/kernel-seed/canonical-json.mjs	5cbfef67053f1154a589a124eea2996a9b9333e7c2ef270d16aec6cd5c91f5d4	aukora/kernel-seed/canonical-json.mjs
plugins/aukora-box/aukora/kira/recall.d.mts	8814b49eecf63c31db28a56481e56bc31a236ab94665a6b0da3f760096cd275a	aukora/kira/recall.d.mts
plugins/aukora-box/aukora/kira/recall.mjs	322641727d085be3ee975bd066895468be3076e1b01dcc489e2a36b4eba9ba85	aukora/kira/recall.mjs
plugins/aukora-box/aukora/kira/stage.d.mts	b021de90f93e4b003590f442390a0a56b5bf1e92686ded58e7a2a527197f9fa9	aukora/kira/stage.d.mts
plugins/aukora-box/aukora/kira/stage.mjs	81ca34244419ce76a10f273664d97c5d834c5b16a03a8652963c181eefe8a288	aukora/kira/stage.mjs
plugins/aukora-box/aukora/package.json	cf3796882b454681c4d51a55fbed23e08814e6ffb1723bcef63342746f6e8c4a	aukora/package.json
plugins/aukora-box/aukora/receipt-v3/export.mjs	c5086f25c199bbde6cee3c4308132e9907f66178afc09c8745ef93d319ec3a46	aukora/receipt-v3/export.mjs
plugins/aukora-box/aukora/receipt-v3/verify.mjs	a5b47fcf5e70ea166be37b49c086bf0fb347c1e2209fa5a794e419a047a52267	aukora/receipt-v3/verify.mjs
plugins/aukora-box/aukora/supervisor/README.i18n.yaml	bce8731f1bd2d136ddf6fb77d5418bf3c24558a04101a9c26d99bbc94ea3bf8f	aukora/supervisor/README.i18n.yaml
plugins/aukora-box/aukora/supervisor/README.md	dce8933c8ee199d0bf821092cf9c1148f71060c859b145141f44f971461e715a	aukora/supervisor/README.md
plugins/aukora-box/aukora/supervisor/README.zh.md	2513c1b4d4d618a5e9c373773ecb8e7a48d0b6f03b3c0c8d2cfb35a2ffed180c	aukora/supervisor/README.zh.md
plugins/aukora-box/aukora/supervisor/bin.mjs	17e59d91590940e48033ef57c3332fa5d811acdaf74e0ce377d60160309414bb	aukora/supervisor/bin.mjs
plugins/aukora-box/aukora/supervisor/confined-guest.md	dd52e0c179c47910cb50cc67a173fe6258e9252be56ebf95c895649597a336e5	aukora/supervisor/confined-guest.md
plugins/aukora-box/aukora/supervisor/confinement-provenance.md	8f8cbb3ec9b684ac8261b7fb741e9351d7a81e92c33a7b6174aa3ab5085193e7	aukora/supervisor/confinement-provenance.md
plugins/aukora-box/aukora/supervisor/confinement.LICENSE	0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0	aukora/supervisor/confinement.LICENSE
plugins/aukora-box/aukora/supervisor/developer-aumlok.d.mts	1e9211c33637c0497f0ab57807538da4708a900257e160ba42dca2ee6f4a2654	aukora/supervisor/developer-aumlok.d.mts
plugins/aukora-box/aukora/supervisor/developer-aumlok.mjs	f4eb898bc30a3aa33bdb7a1b561f8fbfb68959a8aaa4f5623a5bfac4873fc454	aukora/supervisor/developer-aumlok.mjs
plugins/aukora-box/aukora/supervisor/developer-guest-turn.mjs	02006ed395d4cbad6c2f8d901ca19545527813ff9e2edbe3c236f707731b6c9c	aukora/supervisor/developer-guest-turn.mjs
plugins/aukora-box/aukora/supervisor/developer-guest.mjs	46b32ef849ab891146b6e761af878eb4706e6bcbfaddb723c8736f0adfbe6945	aukora/supervisor/developer-guest.mjs
plugins/aukora-box/aukora/supervisor/developer-launch-bin.mjs	ae01782f9ab0f2ffb46670b3bddef10c17eba5a4566d22729218facc49f12152	aukora/supervisor/developer-launch-bin.mjs
plugins/aukora-box/aukora/supervisor/developer-launch-error.d.mts	539d0096df3c5b103a8f3ed5fdc9d1b5c0a901c177c99989fc471235571b633b	aukora/supervisor/developer-launch-error.d.mts
plugins/aukora-box/aukora/supervisor/developer-launch-error.mjs	e9f803c7b6e524b16ff1a284a4576a0bc158979350f76f9458ddb7116126489a	aukora/supervisor/developer-launch-error.mjs
plugins/aukora-box/aukora/supervisor/developer-launch.d.mts	141896e05d80b836e42edb262702648d5b6436a24f29358314eaaaf3c9dd07e4	aukora/supervisor/developer-launch.d.mts
plugins/aukora-box/aukora/supervisor/developer-launch.mjs	25e74a32a813a8f4e706f8ddf1156af5e92477a6b2e88f7d6f81fa5619f42667	aukora/supervisor/developer-launch.mjs
plugins/aukora-box/aukora/supervisor/developer-live-turn-bin.mjs	20f798b5ce805781d6299d2a1029c3a1943dd1e9618dc15319c8e80298e7f2ed	aukora/supervisor/developer-live-turn-bin.mjs
plugins/aukora-box/aukora/supervisor/developer-protocol.d.mts	a28c2d39495e27711c411c96d6576d1cd9b9459b929d20828498291a9fafe10c	aukora/supervisor/developer-protocol.d.mts
plugins/aukora-box/aukora/supervisor/developer-protocol.mjs	dc0db26cecd126da7b619aa29e7febb58acdda4a472ae26ac0a8b855eaa28efd	aukora/supervisor/developer-protocol.mjs
plugins/aukora-box/aukora/supervisor/developer-review.d.mts	815b78e5c4c9426a0e814103bffd21539e248e2292f30e143321fa4fda172a33	aukora/supervisor/developer-review.d.mts
plugins/aukora-box/aukora/supervisor/developer-review.mjs	94081bc6e581171751301de0b5997029fac190ee1accca8e7db20927f7c43b34	aukora/supervisor/developer-review.mjs
plugins/aukora-box/aukora/supervisor/developer-terminal.mjs	afa58148095956e7a6adbb26e89a896c882a7f10842d7d8eed93adae2fa86a8e	aukora/supervisor/developer-terminal.mjs
plugins/aukora-box/aukora/supervisor/developer-web-bin.mjs	e60da52806f907888c75aa91916fbb917d1ff2360d8da0cb01adea36b9a5ad0a	aukora/supervisor/developer-web-bin.mjs
plugins/aukora-box/aukora/supervisor/developer-web-capsule.mjs	807843e1572b0170d0d835509ba8653792d14c060bc6b8781cb8e0deb2ad02b9	aukora/supervisor/developer-web-capsule.mjs
plugins/aukora-box/aukora/supervisor/developer-web-guest.mjs	8afcfada341b89c82d96749306f35b4438c35e7144e2be07830fab2ae25952e9	aukora/supervisor/developer-web-guest.mjs
plugins/aukora-box/aukora/supervisor/developer-web-operator.d.mts	b9a72a40d4112f8ca6532f0949bd132498cff4f9369d98f790e4602e58cfae5f	aukora/supervisor/developer-web-operator.d.mts
plugins/aukora-box/aukora/supervisor/developer-web-operator.mjs	8e0ad41003fa682b8f2d69803adcf0606f457eacec7a8df7f1848a820185ba85	aukora/supervisor/developer-web-operator.mjs
plugins/aukora-box/aukora/supervisor/guest-confinement.d.mts	0935d80895c2b955f5205d9a8a810c4c27d3109c0c88246ec1ec9a6e316122fe	aukora/supervisor/guest-confinement.d.mts
plugins/aukora-box/aukora/supervisor/guest-confinement.mjs	9ccbc5a68ee13a9e84ab963ccbf202d8d920705653214af99857014b4879a7c0	aukora/supervisor/guest-confinement.mjs
plugins/aukora-box/aukora/supervisor/issuer-approval-bridge.d.mts	99e9396957e7eb3a38e65c69d446b6da0a097059ed1c763e94793f094b8f3dbe	aukora/supervisor/issuer-approval-bridge.d.mts
plugins/aukora-box/aukora/supervisor/issuer-approval-bridge.mjs	1558d862ef3a262d7900131b6388068d80dd9f3e55068b692fe29984971966ab	aukora/supervisor/issuer-approval-bridge.mjs
plugins/aukora-box/aukora/supervisor/live-turn-fixture-llm.ts	effa2ee86ccfe6a1522f83f4c91af065debc27b1a040d3f9e90a1d76ff565454	aukora/supervisor/live-turn-fixture-llm.ts
plugins/aukora-box/aukora/supervisor/live-turn-fixture.overlay.yml	6a9c96a556e93f3f843e6fb56c04e90ec787ff585c2309b96291a6bbb426ba32	aukora/supervisor/live-turn-fixture.overlay.yml
plugins/aukora-box/aukora/supervisor/live-turn.overlay.yml	7bcdbdacf96731cf08390acfb0c1be4b4da6b258067b1c682ebb697aed15b61d	aukora/supervisor/live-turn.overlay.yml
plugins/aukora-box/aukora/supervisor/owner-review-server.d.mts	081391ec6d5854553491ba2a2b64fac49293dac68ac2467eda3956b7fd1eeef4	aukora/supervisor/owner-review-server.d.mts
plugins/aukora-box/aukora/supervisor/owner-review-server.mjs	e6d75a04b6f81a2316e645f49e9c93eec283e799e14c5e8a0b7b42be19627d1b	aukora/supervisor/owner-review-server.mjs
plugins/aukora-box/aukora/supervisor/topology.d.mts	12bf811e50d1c1c68e9c946cb02180f0b7594e712363b6d126bd8ed4a27e6ed3	aukora/supervisor/topology.d.mts
plugins/aukora-box/aukora/supervisor/topology.mjs	8cefb91cfc86d0f4147214c61c9aa59d813969808fd00447885c2cbdc92c7d29	aukora/supervisor/topology.mjs
```

## unresolved outside aukora/

These imports are unchanged and their targets were not copied. Node built-ins use the host Node runtime. Declaration-only references are included for completeness.

- `aukora/activation/web-rollback-record.mjs:3` — `@noble/curves/ed25519.js` (static).
- `aukora/activation/web-rollback-record.mjs:4` — `@noble/post-quantum/ml-dsa.js` (static).
- `aukora/activation/web-upgrade-record.mjs:2` — `@noble/curves/ed25519.js` (static).
- `aukora/activation/web-upgrade-record.mjs:3` — `@noble/post-quantum/ml-dsa.js` (static).
- `aukora/identity/control.d.mts:1` — `@deepseek-ai/dsh-brand` (static, declaration).
- `aukora/identity/control.mjs:10` — `@noble/curves/ed25519.js` (static).
- `aukora/identity/control.mjs:11` — `@noble/post-quantum/ml-dsa.js` (static).
- `aukora/identity/delegation.d.mts:1` — `@deepseek-ai/dsh-brand` (static, declaration).
- `aukora/identity/genesis.d.mts:1` — `@deepseek-ai/dsh-brand` (static, declaration).
- `aukora/identity/local-control-store.mjs:32` — `@noble/post-quantum/ml-dsa.js` (static).
- `aukora/kira/stage.d.mts:1` — `@deepseek-ai/dsh-brand` (static, declaration).
- `aukora/supervisor/developer-guest-turn.mjs:3` — `@deepseek-ai/dsh-app-boot` (static).
- `aukora/supervisor/developer-guest-turn.mjs:4` — `@deepseek-ai/dsh-launch-environment` (static).
- `aukora/supervisor/developer-guest-turn.mjs:5` — `@deepseek-ai/dsh-llm` (static).
- `aukora/supervisor/developer-guest-turn.mjs:11` — `../../apps/cli/src/profile-boot.ts` (static).
- `aukora/supervisor/developer-guest.mjs:19` — `@deepseek-ai/dsh-app-boot` (dynamic).
- `aukora/supervisor/developer-guest.mjs:22` — `@deepseek-ai/dsh-launch-environment` (dynamic).
- `aukora/supervisor/developer-guest.mjs:25` — `../../apps/cli/lib/profile-boot.js` (dynamic).
- `aukora/supervisor/developer-guest.mjs:25` — `../../apps/cli/src/profile-boot.ts` (dynamic).
- `aukora/supervisor/developer-launch.d.mts:214` — `../../packages/governed/capsule/src/worker.ts` (dynamic, declaration).
- `aukora/supervisor/developer-launch.mjs:29` — `@deepseek-ai/cordis-plugin-include` (static).
- `aukora/supervisor/developer-launch.mjs:30` — `@deepseek-ai/cordis-plugin-loader` (static).
- `aukora/supervisor/developer-launch.mjs:31` — `js-yaml` (static).
- `aukora/supervisor/developer-review.d.mts:3` — `../../scripts/launchd-review-transport.mjs` (static, declaration).
- `aukora/supervisor/developer-review.d.mts:25` — `../../scripts/launchd-review-transport.mjs` (dynamic, declaration).
- `aukora/supervisor/developer-review.mjs:6` — `../../scripts/launchd-review-transport.mjs` (static).
- `aukora/supervisor/developer-web-guest.mjs:3` — `@deepseek-ai/dsh-app-boot` (static).
- `aukora/supervisor/developer-web-guest.mjs:4` — `@deepseek-ai/dsh-launch-environment` (static).
- `aukora/supervisor/developer-web-guest.mjs:5` — `../../apps/cli/src/profile-boot.ts` (static).
- `aukora/supervisor/developer-web-operator.mjs:2` — `@deepseek-ai/cordis-plugin-include` (static).
- `aukora/supervisor/developer-web-operator.mjs:3` — `@deepseek-ai/cordis-plugin-loader` (static).
- `aukora/supervisor/developer-web-operator.mjs:4` — `js-yaml` (static).
- `aukora/supervisor/live-turn-fixture-llm.ts:13` — `@deepseek-ai/cordis` (static, TypeScript).
- `aukora/supervisor/live-turn-fixture-llm.ts:14` — `@deepseek-ai/dsh-llm` (static, TypeScript).

## Additional unchanged runtime path requirements

- `aukora/supervisor/developer-guest.mjs:18` anchors package resolution at `../../apps/cli/package.json`.
- `aukora/supervisor/developer-review.mjs:22-31` reads and hashes Deep-root files at import time: `../../scripts/launchd-review-transport.mjs`, `../../scripts/aukora-web-review.mjs`, `../../scripts/launchd-socket-listener.mjs`, and `../../packages/client/ui-conversation/src/client/` files `owner-review.ts`, `skeleton/OwnerReviewPanel.tsx`, `skeleton/ApprovalPanel.tsx`, `skeleton/ApprovalPanel.module.css`.
- `aukora/supervisor/developer-launch.mjs:107-190` derives Deep's root from `../..` and expects root manifests/lockfiles, profiles, CLI boot/configuration, bundles and review/client assets. These outside-aukora runtime paths are not supplied.

No import rewrites or proposed edits were applied. Running the full launch paths requires their original outside dependencies and runtime layout; the copy alone does not resolve them.
