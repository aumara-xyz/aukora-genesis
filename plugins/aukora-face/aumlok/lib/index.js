//#region lib/types/identity.js
const AUMLOK_IDENTITY_ENDPOINT = "/api/aukora/aumlok-identity";
const IDENTITY_VERIFY_CONTACT_ENDPOINT = "/api/aukora/identity/verify-contact";
const IDENTITY_CONTACT_ENDPOINT = "/api/aukora/identity/contact";
//#endregion
//#region ../aukora-face-messages/src/client/add-contact.ts
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [
	996825010,
	642813549,
	513874426,
	1027748829,
	705979059
];
const MAX_CONTACT_INPUT = 64 * 1024;
const CONTACT_FIELDS = new Set([
	"type",
	"version",
	"npub",
	"peerControllerKey",
	"binding",
	"label",
	"live"
]);
const ADD_REFUSE = Object.freeze({
	NPUB: "messages:add-npub-invalid",
	CONTROLLER: "messages:add-controller-invalid",
	NAME: "messages:add-name-invalid",
	QR: "messages:add-qr-invalid",
	BINDING: "messages:add-binding-invalid"
});
function refuse(reason, detail) {
	return {
		ok: false,
		reason,
		detail
	};
}
function isRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
function polymod(values) {
	let checksum = 1;
	for (const value of values) {
		const top = checksum >> 25;
		checksum = (checksum & 33554431) << 5 ^ value;
		for (let bit = 0; bit < 5; bit += 1) if ((top >> bit & 1) === 1) checksum ^= GENERATOR[bit] ?? 0;
	}
	return checksum;
}
function checkNpub(value) {
	const raw = typeof value === "string" ? value.trim().replace(/^nostr:/iu, "") : "";
	if (!raw) return refuse(ADD_REFUSE.NPUB, "no npub was given");
	const lower = raw.toLowerCase();
	if (raw !== lower && raw !== raw.toUpperCase()) return refuse(ADD_REFUSE.NPUB, "mixed case is not valid bech32");
	if (lower.length !== 63 || !lower.startsWith("npub1")) return refuse(ADD_REFUSE.NPUB, "an npub must be 63 characters starting with npub1");
	const values = [];
	for (const character of lower.slice(5)) {
		const index = CHARSET.indexOf(character);
		if (index === -1) return refuse(ADD_REFUSE.NPUB, "invalid bech32 character");
		values.push(index);
	}
	const hrp = [..."npub"].map((character) => character.charCodeAt(0));
	if (polymod([
		...hrp.map((code) => code >> 5),
		0,
		...hrp.map((code) => code & 31),
		...values
	]) !== 1) return refuse(ADD_REFUSE.NPUB, "the npub checksum does not match");
	let accumulator = 0;
	let bits = 0;
	let bytes = 0;
	for (const value of values.slice(0, -6)) {
		accumulator = (accumulator << 5 | value) & 4095;
		bits += 5;
		while (bits >= 8) {
			bits -= 8;
			bytes += 1;
		}
	}
	if (bytes !== 32 || bits >= 5 || (accumulator << 8 - bits & 255) !== 0) return refuse(ADD_REFUSE.NPUB, "an npub must encode 32 bytes with zero padding");
	return {
		ok: true,
		npub: lower
	};
}
function checkController(value) {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return refuse(ADD_REFUSE.CONTROLLER, "no controller key was given");
	if (!/^[0-9a-f]{64}$/iu.test(raw)) return refuse(ADD_REFUSE.CONTROLLER, "a controller key must be 64 hex characters");
	return {
		ok: true,
		controller: raw.toLowerCase()
	};
}
function parseContactInput(value) {
	let payload = value;
	if (typeof value === "string") {
		if (value.length > MAX_CONTACT_INPUT || new TextEncoder().encode(value).length > MAX_CONTACT_INPUT) return refuse(ADD_REFUSE.QR, "contact input exceeds 64 KiB");
		const raw = value.trim();
		if (/^(?:nostr:)?npub1/iu.test(raw) || raw === "") {
			const npub = checkNpub(raw);
			return npub.ok ? {
				...npub,
				controller: "",
				binding: null,
				label: "",
				source: "key"
			} : npub;
		}
		try {
			payload = JSON.parse(raw);
		} catch {
			return refuse(ADD_REFUSE.QR, "invalid contact JSON or npub");
		}
	} else if (isRecord(value)) try {
		const encoded = JSON.stringify(value);
		if (encoded.length > MAX_CONTACT_INPUT || new TextEncoder().encode(encoded).length > MAX_CONTACT_INPUT) return refuse(ADD_REFUSE.QR, "contact input exceeds 64 KiB");
	} catch {
		return refuse(ADD_REFUSE.QR, "contact payload must be JSON");
	}
	if (!isRecord(payload)) return refuse(ADD_REFUSE.QR, "contact payload must be an object");
	if (payload.type !== "aukora-contact") return refuse(ADD_REFUSE.QR, "unsupported contact type");
	if (payload.version !== 1) return refuse(ADD_REFUSE.QR, "unsupported contact version");
	if (Object.keys(payload).some((field) => !CONTACT_FIELDS.has(field))) return refuse(ADD_REFUSE.QR, "unknown contact field");
	if ("live" in payload && (!isRecord(payload.live) || Object.keys(payload.live).length !== 4 || !/^[0-9a-f]{64}$/u.test(String(payload.live.nonce ?? "")) || !Number.isSafeInteger(payload.live.issuedAt) || !Number.isSafeInteger(payload.live.expiresAt) || !/^[0-9a-f]{128}$/u.test(String(payload.live.signature ?? "")))) return refuse(ADD_REFUSE.QR, "invalid live contact proof");
	const npub = checkNpub(payload.npub);
	if (!npub.ok) return npub;
	if ("binding" in payload && payload.binding !== null && !isRecord(payload.binding)) return refuse(ADD_REFUSE.BINDING, "binding must be an object or null");
	let controller = "";
	if ("peerControllerKey" in payload) {
		if (typeof payload.peerControllerKey !== "string") return refuse(ADD_REFUSE.CONTROLLER, "controller must be a string");
		if (payload.peerControllerKey.trim()) {
			const checked = checkController(payload.peerControllerKey);
			if (!checked.ok) return checked;
			controller = checked.controller;
		}
	}
	let label = "";
	if ("label" in payload) {
		if (typeof payload.label !== "string") return refuse(ADD_REFUSE.QR, "label must be a string");
		label = payload.label.trim();
		if (label.length > 120) return refuse(ADD_REFUSE.NAME, `a label may be up to 120 characters`);
	}
	return {
		ok: true,
		npub: npub.npub,
		controller,
		binding: payload.binding ?? null,
		label,
		source: "qr"
	};
}
//#endregion
//#region lib/types/vendor/qrcodegen/qrcodegen.js
/*!
* QR Code generator library (TypeScript)
*
* Copyright (c) Project Nayuki. (MIT License)
* https://www.nayuki.io/page/qr-code-generator-library
*
* Permission is hereby granted, free of charge, to any person obtaining a copy of
* this software and associated documentation files (the "Software"), to deal in
* the Software without restriction, including without limitation the rights to
* use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
* the Software, and to permit persons to whom the Software is furnished to do so,
* subject to the following conditions:
* - The above copyright notice and this permission notice shall be included in
*   all copies or substantial portions of the Software.
* - The Software is provided "as is", without warranty of any kind, express or
*   implied, including but not limited to the warranties of merchantability,
*   fitness for a particular purpose and noninfringement. In no event shall the
*   authors or copyright holders be liable for any claim, damages or other
*   liability, whether in an action of contract, tort or otherwise, arising from,
*   out of or in connection with the Software or the use or other dealings in the
*   Software.
*/
var qrcodegen;
(function(qrcodegen) {
	class QrCode {
		version;
		errorCorrectionLevel;
		static encodeText(text, ecl) {
			const segs = qrcodegen.QrSegment.makeSegments(text);
			return QrCode.encodeSegments(segs, ecl);
		}
		static encodeBinary(data, ecl) {
			const seg = qrcodegen.QrSegment.makeBytes(data);
			return QrCode.encodeSegments([seg], ecl);
		}
		static encodeSegments(segs, ecl, minVersion = 1, maxVersion = 40, mask = -1, boostEcl = true) {
			if (!(QrCode.MIN_VERSION <= minVersion && minVersion <= maxVersion && maxVersion <= QrCode.MAX_VERSION) || mask < -1 || mask > 7) throw new RangeError("Invalid value");
			let version;
			let dataUsedBits;
			for (version = minVersion;; version++) {
				const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
				const usedBits = QrSegment.getTotalBits(segs, version);
				if (usedBits <= dataCapacityBits) {
					dataUsedBits = usedBits;
					break;
				}
				if (version >= maxVersion) throw new RangeError("Data too long");
			}
			for (const newEcl of [
				QrCode.Ecc.MEDIUM,
				QrCode.Ecc.QUARTILE,
				QrCode.Ecc.HIGH
			]) if (boostEcl && dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) ecl = newEcl;
			let bb = [];
			for (const seg of segs) {
				appendBits(seg.mode.modeBits, 4, bb);
				appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
				for (const b of seg.getData()) bb.push(b);
			}
			assert(bb.length == dataUsedBits);
			const dataCapacityBits = QrCode.getNumDataCodewords(version, ecl) * 8;
			assert(bb.length <= dataCapacityBits);
			appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
			appendBits(0, (8 - bb.length % 8) % 8, bb);
			assert(bb.length % 8 == 0);
			for (let padByte = 236; bb.length < dataCapacityBits; padByte ^= 253) appendBits(padByte, 8, bb);
			let dataCodewords = [];
			while (dataCodewords.length * 8 < bb.length) dataCodewords.push(0);
			bb.forEach((b, i) => dataCodewords[i >>> 3] |= b << 7 - (i & 7));
			return new QrCode(version, ecl, dataCodewords, mask);
		}
		size;
		mask;
		modules = [];
		isFunction = [];
		constructor(version, errorCorrectionLevel, dataCodewords, msk) {
			this.version = version;
			this.errorCorrectionLevel = errorCorrectionLevel;
			if (version < QrCode.MIN_VERSION || version > QrCode.MAX_VERSION) throw new RangeError("Version value out of range");
			if (msk < -1 || msk > 7) throw new RangeError("Mask value out of range");
			this.size = version * 4 + 17;
			let row = [];
			for (let i = 0; i < this.size; i++) row.push(false);
			for (let i = 0; i < this.size; i++) {
				this.modules.push(row.slice());
				this.isFunction.push(row.slice());
			}
			this.drawFunctionPatterns();
			const allCodewords = this.addEccAndInterleave(dataCodewords);
			this.drawCodewords(allCodewords);
			if (msk == -1) {
				let minPenalty = 1e9;
				for (let i = 0; i < 8; i++) {
					this.applyMask(i);
					this.drawFormatBits(i);
					const penalty = this.getPenaltyScore();
					if (penalty < minPenalty) {
						msk = i;
						minPenalty = penalty;
					}
					this.applyMask(i);
				}
			}
			assert(0 <= msk && msk <= 7);
			this.mask = msk;
			this.applyMask(msk);
			this.drawFormatBits(msk);
			this.isFunction = [];
		}
		getModule(x, y) {
			return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y][x];
		}
		drawFunctionPatterns() {
			for (let i = 0; i < this.size; i++) {
				this.setFunctionModule(6, i, i % 2 == 0);
				this.setFunctionModule(i, 6, i % 2 == 0);
			}
			this.drawFinderPattern(3, 3);
			this.drawFinderPattern(this.size - 4, 3);
			this.drawFinderPattern(3, this.size - 4);
			const alignPatPos = this.getAlignmentPatternPositions();
			const numAlign = alignPatPos.length;
			for (let i = 0; i < numAlign; i++) for (let j = 0; j < numAlign; j++) if (!(i == 0 && j == 0 || i == 0 && j == numAlign - 1 || i == numAlign - 1 && j == 0)) this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
			this.drawFormatBits(0);
			this.drawVersion();
		}
		drawFormatBits(mask) {
			const data = this.errorCorrectionLevel.formatBits << 3 | mask;
			let rem = data;
			for (let i = 0; i < 10; i++) rem = rem << 1 ^ (rem >>> 9) * 1335;
			const bits = (data << 10 | rem) ^ 21522;
			assert(bits >>> 15 == 0);
			for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
			this.setFunctionModule(8, 7, getBit(bits, 6));
			this.setFunctionModule(8, 8, getBit(bits, 7));
			this.setFunctionModule(7, 8, getBit(bits, 8));
			for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));
			for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
			for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
			this.setFunctionModule(8, this.size - 8, true);
		}
		drawVersion() {
			if (this.version < 7) return;
			let rem = this.version;
			for (let i = 0; i < 12; i++) rem = rem << 1 ^ (rem >>> 11) * 7973;
			const bits = this.version << 12 | rem;
			assert(bits >>> 18 == 0);
			for (let i = 0; i < 18; i++) {
				const color = getBit(bits, i);
				const a = this.size - 11 + i % 3;
				const b = Math.floor(i / 3);
				this.setFunctionModule(a, b, color);
				this.setFunctionModule(b, a, color);
			}
		}
		drawFinderPattern(x, y) {
			for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				const xx = x + dx;
				const yy = y + dy;
				if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size) this.setFunctionModule(xx, yy, dist != 2 && dist != 4);
			}
		}
		drawAlignmentPattern(x, y) {
			for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
		}
		setFunctionModule(x, y, isDark) {
			this.modules[y][x] = isDark;
			this.isFunction[y][x] = true;
		}
		addEccAndInterleave(data) {
			const ver = this.version;
			const ecl = this.errorCorrectionLevel;
			if (data.length != QrCode.getNumDataCodewords(ver, ecl)) throw new RangeError("Invalid argument");
			const numBlocks = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
			const blockEccLen = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
			const rawCodewords = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
			const numShortBlocks = numBlocks - rawCodewords % numBlocks;
			const shortBlockLen = Math.floor(rawCodewords / numBlocks);
			let blocks = [];
			const rsDiv = QrCode.reedSolomonComputeDivisor(blockEccLen);
			for (let i = 0, k = 0; i < numBlocks; i++) {
				let dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
				k += dat.length;
				const ecc = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
				if (i < numShortBlocks) dat.push(0);
				blocks.push(dat.concat(ecc));
			}
			let result = [];
			for (let i = 0; i < blocks[0].length; i++) blocks.forEach((block, j) => {
				if (i != shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
			});
			assert(result.length == rawCodewords);
			return result;
		}
		drawCodewords(data) {
			if (data.length != Math.floor(QrCode.getNumRawDataModules(this.version) / 8)) throw new RangeError("Invalid argument");
			let i = 0;
			for (let right = this.size - 1; right >= 1; right -= 2) {
				if (right == 6) right = 5;
				for (let vert = 0; vert < this.size; vert++) for (let j = 0; j < 2; j++) {
					const x = right - j;
					const y = (right + 1 & 2) == 0 ? this.size - 1 - vert : vert;
					if (!this.isFunction[y][x] && i < data.length * 8) {
						this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
						i++;
					}
				}
			}
			assert(i == data.length * 8);
		}
		applyMask(mask) {
			if (mask < 0 || mask > 7) throw new RangeError("Mask value out of range");
			for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
				let invert;
				switch (mask) {
					case 0:
						invert = (x + y) % 2 == 0;
						break;
					case 1:
						invert = y % 2 == 0;
						break;
					case 2:
						invert = x % 3 == 0;
						break;
					case 3:
						invert = (x + y) % 3 == 0;
						break;
					case 4:
						invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 == 0;
						break;
					case 5:
						invert = x * y % 2 + x * y % 3 == 0;
						break;
					case 6:
						invert = (x * y % 2 + x * y % 3) % 2 == 0;
						break;
					case 7:
						invert = ((x + y) % 2 + x * y % 3) % 2 == 0;
						break;
					default: throw new Error("Unreachable");
				}
				if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
			}
		}
		getPenaltyScore() {
			let result = 0;
			for (let y = 0; y < this.size; y++) {
				let runColor = false;
				let runX = 0;
				let runHistory = [
					0,
					0,
					0,
					0,
					0,
					0,
					0
				];
				for (let x = 0; x < this.size; x++) if (this.modules[y][x] == runColor) {
					runX++;
					if (runX == 5) result += QrCode.PENALTY_N1;
					else if (runX > 5) result++;
				} else {
					this.finderPenaltyAddHistory(runX, runHistory);
					if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
					runColor = this.modules[y][x];
					runX = 1;
				}
				result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * QrCode.PENALTY_N3;
			}
			for (let x = 0; x < this.size; x++) {
				let runColor = false;
				let runY = 0;
				let runHistory = [
					0,
					0,
					0,
					0,
					0,
					0,
					0
				];
				for (let y = 0; y < this.size; y++) if (this.modules[y][x] == runColor) {
					runY++;
					if (runY == 5) result += QrCode.PENALTY_N1;
					else if (runY > 5) result++;
				} else {
					this.finderPenaltyAddHistory(runY, runHistory);
					if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
					runColor = this.modules[y][x];
					runY = 1;
				}
				result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * QrCode.PENALTY_N3;
			}
			for (let y = 0; y < this.size - 1; y++) for (let x = 0; x < this.size - 1; x++) {
				const color = this.modules[y][x];
				if (color == this.modules[y][x + 1] && color == this.modules[y + 1][x] && color == this.modules[y + 1][x + 1]) result += QrCode.PENALTY_N2;
			}
			let dark = 0;
			for (const row of this.modules) dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
			const total = this.size * this.size;
			const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
			assert(0 <= k && k <= 9);
			result += k * QrCode.PENALTY_N4;
			assert(0 <= result && result <= 2568888);
			return result;
		}
		getAlignmentPatternPositions() {
			if (this.version == 1) return [];
			else {
				const numAlign = Math.floor(this.version / 7) + 2;
				const step = this.version == 32 ? 26 : Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
				let result = [6];
				for (let pos = this.size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
				return result;
			}
		}
		static getNumRawDataModules(ver) {
			if (ver < QrCode.MIN_VERSION || ver > QrCode.MAX_VERSION) throw new RangeError("Version number out of range");
			let result = (16 * ver + 128) * ver + 64;
			if (ver >= 2) {
				const numAlign = Math.floor(ver / 7) + 2;
				result -= (25 * numAlign - 10) * numAlign - 55;
				if (ver >= 7) result -= 36;
			}
			assert(208 <= result && result <= 29648);
			return result;
		}
		static getNumDataCodewords(ver, ecl) {
			return Math.floor(QrCode.getNumRawDataModules(ver) / 8) - QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
		}
		static reedSolomonComputeDivisor(degree) {
			if (degree < 1 || degree > 255) throw new RangeError("Degree out of range");
			let result = [];
			for (let i = 0; i < degree - 1; i++) result.push(0);
			result.push(1);
			let root = 1;
			for (let i = 0; i < degree; i++) {
				for (let j = 0; j < result.length; j++) {
					result[j] = QrCode.reedSolomonMultiply(result[j], root);
					if (j + 1 < result.length) result[j] ^= result[j + 1];
				}
				root = QrCode.reedSolomonMultiply(root, 2);
			}
			return result;
		}
		static reedSolomonComputeRemainder(data, divisor) {
			let result = divisor.map((_) => 0);
			for (const b of data) {
				const factor = b ^ result.shift();
				result.push(0);
				divisor.forEach((coef, i) => result[i] ^= QrCode.reedSolomonMultiply(coef, factor));
			}
			return result;
		}
		static reedSolomonMultiply(x, y) {
			if (x >>> 8 != 0 || y >>> 8 != 0) throw new RangeError("Byte out of range");
			let z = 0;
			for (let i = 7; i >= 0; i--) {
				z = z << 1 ^ (z >>> 7) * 285;
				z ^= (y >>> i & 1) * x;
			}
			assert(z >>> 8 == 0);
			return z;
		}
		finderPenaltyCountPatterns(runHistory) {
			const n = runHistory[1];
			assert(n <= this.size * 3);
			const core = n > 0 && runHistory[2] == n && runHistory[3] == n * 3 && runHistory[4] == n && runHistory[5] == n;
			return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
		}
		finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
			if (currentRunColor) {
				this.finderPenaltyAddHistory(currentRunLength, runHistory);
				currentRunLength = 0;
			}
			currentRunLength += this.size;
			this.finderPenaltyAddHistory(currentRunLength, runHistory);
			return this.finderPenaltyCountPatterns(runHistory);
		}
		finderPenaltyAddHistory(currentRunLength, runHistory) {
			if (runHistory[0] == 0) currentRunLength += this.size;
			runHistory.pop();
			runHistory.unshift(currentRunLength);
		}
		static MIN_VERSION = 1;
		static MAX_VERSION = 40;
		static PENALTY_N1 = 3;
		static PENALTY_N2 = 3;
		static PENALTY_N3 = 40;
		static PENALTY_N4 = 10;
		static ECC_CODEWORDS_PER_BLOCK = [
			[
				-1,
				7,
				10,
				15,
				20,
				26,
				18,
				20,
				24,
				30,
				18,
				20,
				24,
				26,
				30,
				22,
				24,
				28,
				30,
				28,
				28,
				28,
				28,
				30,
				30,
				26,
				28,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30
			],
			[
				-1,
				10,
				16,
				26,
				18,
				24,
				16,
				18,
				22,
				22,
				26,
				30,
				22,
				22,
				24,
				24,
				28,
				28,
				26,
				26,
				26,
				26,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28,
				28
			],
			[
				-1,
				13,
				22,
				18,
				26,
				18,
				24,
				18,
				22,
				20,
				24,
				28,
				26,
				24,
				20,
				30,
				24,
				28,
				28,
				26,
				30,
				28,
				30,
				30,
				30,
				30,
				28,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30
			],
			[
				-1,
				17,
				28,
				22,
				16,
				22,
				28,
				26,
				26,
				24,
				28,
				24,
				28,
				22,
				24,
				24,
				30,
				28,
				28,
				26,
				28,
				30,
				24,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30,
				30
			]
		];
		static NUM_ERROR_CORRECTION_BLOCKS = [
			[
				-1,
				1,
				1,
				1,
				1,
				1,
				2,
				2,
				2,
				2,
				4,
				4,
				4,
				4,
				4,
				6,
				6,
				6,
				6,
				7,
				8,
				8,
				9,
				9,
				10,
				12,
				12,
				12,
				13,
				14,
				15,
				16,
				17,
				18,
				19,
				19,
				20,
				21,
				22,
				24,
				25
			],
			[
				-1,
				1,
				1,
				1,
				2,
				2,
				4,
				4,
				4,
				5,
				5,
				5,
				8,
				9,
				9,
				10,
				10,
				11,
				13,
				14,
				16,
				17,
				17,
				18,
				20,
				21,
				23,
				25,
				26,
				28,
				29,
				31,
				33,
				35,
				37,
				38,
				40,
				43,
				45,
				47,
				49
			],
			[
				-1,
				1,
				1,
				2,
				2,
				4,
				4,
				6,
				6,
				8,
				8,
				8,
				10,
				12,
				16,
				12,
				17,
				16,
				18,
				21,
				20,
				23,
				23,
				25,
				27,
				29,
				34,
				34,
				35,
				38,
				40,
				43,
				45,
				48,
				51,
				53,
				56,
				59,
				62,
				65,
				68
			],
			[
				-1,
				1,
				1,
				2,
				4,
				4,
				4,
				5,
				6,
				8,
				8,
				11,
				11,
				16,
				16,
				18,
				16,
				19,
				21,
				25,
				25,
				25,
				34,
				30,
				32,
				35,
				37,
				40,
				42,
				45,
				48,
				51,
				54,
				57,
				60,
				63,
				66,
				70,
				74,
				77,
				81
			]
		];
	}
	qrcodegen.QrCode = QrCode;
	function appendBits(val, len, bb) {
		if (len < 0 || len > 31 || val >>> len != 0) throw new RangeError("Value out of range");
		for (let i = len - 1; i >= 0; i--) bb.push(val >>> i & 1);
	}
	function getBit(x, i) {
		return (x >>> i & 1) != 0;
	}
	function assert(cond) {
		if (!cond) throw new Error("Assertion error");
	}
	class QrSegment {
		mode;
		numChars;
		bitData;
		static makeBytes(data) {
			let bb = [];
			for (const b of data) appendBits(b, 8, bb);
			return new QrSegment(QrSegment.Mode.BYTE, data.length, bb);
		}
		static makeNumeric(digits) {
			if (!QrSegment.isNumeric(digits)) throw new RangeError("String contains non-numeric characters");
			let bb = [];
			for (let i = 0; i < digits.length;) {
				const n = Math.min(digits.length - i, 3);
				appendBits(parseInt(digits.substr(i, n), 10), n * 3 + 1, bb);
				i += n;
			}
			return new QrSegment(QrSegment.Mode.NUMERIC, digits.length, bb);
		}
		static makeAlphanumeric(text) {
			if (!QrSegment.isAlphanumeric(text)) throw new RangeError("String contains unencodable characters in alphanumeric mode");
			let bb = [];
			let i;
			for (i = 0; i + 2 <= text.length; i += 2) {
				let temp = QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)) * 45;
				temp += QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i + 1));
				appendBits(temp, 11, bb);
			}
			if (i < text.length) appendBits(QrSegment.ALPHANUMERIC_CHARSET.indexOf(text.charAt(i)), 6, bb);
			return new QrSegment(QrSegment.Mode.ALPHANUMERIC, text.length, bb);
		}
		static makeSegments(text) {
			if (text == "") return [];
			else if (QrSegment.isNumeric(text)) return [QrSegment.makeNumeric(text)];
			else if (QrSegment.isAlphanumeric(text)) return [QrSegment.makeAlphanumeric(text)];
			else return [QrSegment.makeBytes(QrSegment.toUtf8ByteArray(text))];
		}
		static makeEci(assignVal) {
			let bb = [];
			if (assignVal < 0) throw new RangeError("ECI assignment value out of range");
			else if (assignVal < 128) appendBits(assignVal, 8, bb);
			else if (assignVal < 16384) {
				appendBits(2, 2, bb);
				appendBits(assignVal, 14, bb);
			} else if (assignVal < 1e6) {
				appendBits(6, 3, bb);
				appendBits(assignVal, 21, bb);
			} else throw new RangeError("ECI assignment value out of range");
			return new QrSegment(QrSegment.Mode.ECI, 0, bb);
		}
		static isNumeric(text) {
			return QrSegment.NUMERIC_REGEX.test(text);
		}
		static isAlphanumeric(text) {
			return QrSegment.ALPHANUMERIC_REGEX.test(text);
		}
		constructor(mode, numChars, bitData) {
			this.mode = mode;
			this.numChars = numChars;
			this.bitData = bitData;
			if (numChars < 0) throw new RangeError("Invalid argument");
			this.bitData = bitData.slice();
		}
		getData() {
			return this.bitData.slice();
		}
		static getTotalBits(segs, version) {
			let result = 0;
			for (const seg of segs) {
				const ccbits = seg.mode.numCharCountBits(version);
				if (seg.numChars >= 1 << ccbits) return Infinity;
				result += 4 + ccbits + seg.bitData.length;
			}
			return result;
		}
		static toUtf8ByteArray(str) {
			str = encodeURI(str);
			let result = [];
			for (let i = 0; i < str.length; i++) if (str.charAt(i) != "%") result.push(str.charCodeAt(i));
			else {
				result.push(parseInt(str.substr(i + 1, 2), 16));
				i += 2;
			}
			return result;
		}
		static NUMERIC_REGEX = /^[0-9]*$/;
		static ALPHANUMERIC_REGEX = /^[A-Z0-9 $%*+.\/:-]*$/;
		static ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
	}
	qrcodegen.QrSegment = QrSegment;
})(qrcodegen || (qrcodegen = {}));
(function(qrcodegen) {
	(function(QrCode) {
		class Ecc {
			ordinal;
			formatBits;
			static LOW = new Ecc(0, 1);
			static MEDIUM = new Ecc(1, 0);
			static QUARTILE = new Ecc(2, 3);
			static HIGH = new Ecc(3, 2);
			constructor(ordinal, formatBits) {
				this.ordinal = ordinal;
				this.formatBits = formatBits;
			}
		}
		QrCode.Ecc = Ecc;
	})(qrcodegen.QrCode || (qrcodegen.QrCode = {}));
})(qrcodegen || (qrcodegen = {}));
(function(qrcodegen) {
	(function(QrSegment) {
		class Mode {
			modeBits;
			numBitsCharCount;
			static NUMERIC = new Mode(1, [
				10,
				12,
				14
			]);
			static ALPHANUMERIC = new Mode(2, [
				9,
				11,
				13
			]);
			static BYTE = new Mode(4, [
				8,
				16,
				16
			]);
			static KANJI = new Mode(8, [
				8,
				10,
				12
			]);
			static ECI = new Mode(7, [
				0,
				0,
				0
			]);
			constructor(modeBits, numBitsCharCount) {
				this.modeBits = modeBits;
				this.numBitsCharCount = numBitsCharCount;
			}
			numCharCountBits(ver) {
				return this.numBitsCharCount[Math.floor((ver + 7) / 17)];
			}
		}
		QrSegment.Mode = Mode;
	})(qrcodegen.QrSegment || (qrcodegen.QrSegment = {}));
})(qrcodegen || (qrcodegen = {}));
//#endregion
//#region lib/types/contact-qr.js
/** Contact labels always come from the binding handle. */
function contactPayload(identity, live) {
	return JSON.stringify({
		type: "aukora-contact",
		version: 1,
		npub: identity.npub,
		peerControllerKey: identity.peerControllerKey ?? "",
		binding: identity.binding,
		label: identity.label,
		...live ? { live } : {}
	});
}
/** A domain-separated Nostr event, reconstructed instead of duplicating the contact in the QR. */
function liveContactEvent(contact, proof, pubkey) {
	return {
		pubkey,
		created_at: proof.issuedAt,
		kind: 20001,
		tags: [
			["d", "aukora:contact-live:v1"],
			["nonce", proof.nonce],
			["expiration", String(proof.expiresAt)]
		],
		content: contact
	};
}
function contactQrDataUrl(payload) {
	const qr = qrcodegen.QrCode.encodeText(payload, qrcodegen.QrCode.Ecc.QUARTILE);
	const border = 4;
	const size = qr.size + border * 2;
	const modules = [];
	for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) modules.push(`M${x + border},${y + border}h1v1h-1z`);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#f4f3f8"/><path d="${modules.join("")}" fill="#151322"/></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
//#endregion
//#region lib/types/contact-verification.js
var __rewriteRelativeImportExtension$2 = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
async function consumeContactNonce(stateDir, pubkey, proof) {
	const fs = await import(__rewriteRelativeImportExtension$2(
		/* @vite-ignore */
		"node:fs"
	));
	const directory = `${stateDir}/identity/contact-nonces`;
	fs.mkdirSync(directory, {
		recursive: true,
		mode: 448
	});
	const now = Math.floor(Date.now() / 1e3);
	if (proof.issuedAt > now || proof.expiresAt <= now) throw new Error("identity:expired-contact");
	for (const file of fs.readdirSync(directory)) {
		if (!/^[0-9a-f]{64}-[0-9a-f]{64}\.json$/u.test(file)) continue;
		try {
			const expiry = JSON.parse(fs.readFileSync(`${directory}/${file}`, "utf8"));
			if (typeof expiry === "number" && expiry <= now) fs.unlinkSync(`${directory}/${file}`);
		} catch {}
	}
	try {
		fs.writeFileSync(`${directory}/${pubkey}-${proof.nonce}.json`, JSON.stringify(proof.expiresAt), {
			flag: "wx",
			mode: 384
		});
	} catch (error) {
		if (error?.code === "EEXIST") throw new Error("identity:replayed-contact");
		throw error;
	}
}
/** Authenticate the binding AND the fresh Nostr proof before releasing the contact's name. */
async function verifyIdentityContact(raw) {
	const contact = parseContactInput(raw);
	if (!contact.ok || contact.source !== "qr" || !contact.binding || !contact.controller) throw new Error("identity:invalid-contact");
	let proof;
	try {
		proof = JSON.parse(raw).live;
	} catch {
		throw new Error("identity:invalid-contact");
	}
	if (!proof || proof.expiresAt - proof.issuedAt !== 60) throw new Error("identity:invalid-contact");
	const now = Math.floor(Date.now() / 1e3);
	if (proof.issuedAt > now || proof.expiresAt <= now) throw new Error("identity:expired-contact");
	const { roots, moduleBase } = await identityRuntime();
	const { resolveContact } = await import(__rewriteRelativeImportExtension$2(
		/* @vite-ignore */
		`${moduleBase}contact.mjs`
	));
	const verified = resolveContact({
		npub: contact.npub,
		peerControllerKey: contact.controller,
		binding: contact.binding
	});
	if (verified.binding !== "verified" || verified.state !== "TEST" && verified.state !== "BOUND" && verified.state !== "VERIFIED" || verified.npub !== contact.npub || !verified.subject || !/^aukora:1:[0-9a-f]{64}$/u.test(verified.subject) || verified.controllerKeyHex !== contact.controller) throw new Error("identity:invalid-contact");
	const { npubDecode } = await import(__rewriteRelativeImportExtension$2(
		/* @vite-ignore */
		`${moduleBase}identity.mjs`
	));
	const { eventId, verifyEvent } = await import(__rewriteRelativeImportExtension$2(
		/* @vite-ignore */
		`${moduleBase}event.mjs`
	));
	const pubkey = npubDecode(contact.npub);
	const event = liveContactEvent(contactPayload({
		npub: contact.npub,
		peerControllerKey: contact.controller,
		subject: verified.subject,
		binding: contact.binding,
		label: contact.label
	}), proof, pubkey);
	try {
		verifyEvent({
			...event,
			id: eventId(event),
			sig: proof.signature
		});
	} catch {
		throw new Error("identity:invalid-contact");
	}
	await consumeContactNonce(roots.stateDir, pubkey, proof);
	return {
		npub: contact.npub,
		controller: contact.controller,
		subject: verified.subject,
		label: contact.label,
		bindingState: verified.state,
		liveChallengePerformed: false,
		nonce: proof.nonce,
		expiresAt: proof.expiresAt * 1e3
	};
}
function identityContactVerificationRoute(fence) {
	return identityJsonPostRoute(IDENTITY_VERIFY_CONTACT_ENDPOINT, fence, verifyIdentityContact);
}
function identityJsonPostRoute(path, fence, action) {
	return {
		kind: "exact",
		path,
		handler: async (req, res) => {
			const reply = (status, body) => {
				res.writeHead(status, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"x-content-type-options": "nosniff"
				});
				res.end(JSON.stringify(body));
			};
			const rejection = fence(req);
			if (rejection !== void 0) {
				reply(rejection, null);
				return;
			}
			if (req.method !== "POST") {
				res.setHeader("allow", "POST");
				reply(405, null);
				return;
			}
			if (!/^application\/json(?:\s*;|$)/iu.test(String(req.headers["content-type"] ?? ""))) {
				reply(415, null);
				return;
			}
			try {
				const decoder = new TextDecoder("utf-8", { fatal: true });
				let raw = "";
				let length = 0;
				for await (const chunk of req) {
					const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
					length += bytes.byteLength;
					if (length > 64 * 1024) {
						reply(413, null);
						return;
					}
					raw += decoder.decode(bytes, { stream: true });
				}
				raw += decoder.decode();
				reply(200, await action(raw));
			} catch (error) {
				const code = error instanceof Error ? error.message : "";
				const invalid = [
					"identity:invalid-contact",
					"identity:expired-contact",
					"identity:replayed-contact"
				].includes(code);
				const changed = ["identity:identity-changed", "identity:binding-unavailable"].includes(code);
				reply(invalid ? 400 : changed ? 409 : 503, { code: invalid || changed ? code : "identity:verification-unavailable" });
			}
		}
	};
}
//#endregion
//#region lib/types/identity-host.js
var __rewriteRelativeImportExtension$1 = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
/** Host-only imports share the release's pinned Nostr implementation and configured state root. */
async function identityRuntime(controllerDir) {
	const { env } = await import(__rewriteRelativeImportExtension$1(
		/* @vite-ignore */
		"node:process"
	));
	const { resolve } = await import(__rewriteRelativeImportExtension$1(
		/* @vite-ignore */
		"node:path"
	));
	const stateDir = env["DSH_HOME"]?.trim() || (env["AUKORA_SUPPORT_ROOT"]?.trim() ? resolve(env["AUKORA_SUPPORT_ROOT"], "state", "home") : "");
	if (!stateDir) throw new Error("identity:state-unconfigured");
	const contactModule = env["AUKORA_NOSTR_CONTACT_MODULE"]?.trim();
	const moduleBase = contactModule ? contactModule.replace(/contact\.mjs$/u, "") : new URL("../../../aukora-nostr/lib/", import.meta.url).href;
	const bootstrap = await import(__rewriteRelativeImportExtension$1(
		/* @vite-ignore */
		`${moduleBase}bootstrap.mjs`
	));
	return {
		roots: {
			controllerDir,
			stateDir: resolve(stateDir)
		},
		moduleBase,
		bootstrap
	};
}
const qrImages = /* @__PURE__ */ new Map();
async function contactQr(payload) {
	const cached = qrImages.get(payload);
	if (cached && Date.now() < cached.expires) return cached.image;
	const image = Promise.resolve().then(() => {
		return contactQrDataUrl(payload);
	}).catch(() => null);
	const entry = {
		image,
		expires: Infinity
	};
	qrImages.set(payload, entry);
	if (qrImages.size > 4) qrImages.delete(qrImages.keys().next().value);
	const result = await image;
	if (!result) entry.expires = Date.now() + 3e4;
	return result;
}
async function readIdentity(controllerDir) {
	const { roots, bootstrap } = await identityRuntime(controllerDir);
	const identity = await bootstrap.readMessagesIdentity(roots);
	if (identity.subject && !identity.binding) bootstrap.ensureMessagesIdentity(roots).catch(() => {});
	const contact = contactPayload(identity);
	return {
		...identity,
		contact,
		qrDataUrl: await contactQr(contact)
	};
}
/** Only the local Nostr contact key signs this short-lived contact; the Aumlok/root keys never do. */
async function issueIdentityContact(controllerDir, input) {
	if (!checkNpub(input.npub).ok) throw new Error("identity:invalid-contact");
	const { roots, moduleBase, bootstrap } = await identityRuntime(controllerDir);
	const identity = await bootstrap.readMessagesIdentity(roots);
	if (identity.npub !== input.npub || identity.subject !== input.subject) throw new Error("identity:identity-changed");
	const { loadOrCreateNostrKey } = await import(__rewriteRelativeImportExtension$1(
		/* @vite-ignore */
		`${moduleBase}identity.mjs`
	));
	const { signEvent } = await import(__rewriteRelativeImportExtension$1(
		/* @vite-ignore */
		`${moduleBase}event.mjs`
	));
	const { randomBytes } = await import(__rewriteRelativeImportExtension$1(
		/* @vite-ignore */
		"node:crypto"
	));
	const key = loadOrCreateNostrKey(roots.stateDir);
	if (key.npub !== identity.npub) throw new Error("identity:identity-changed");
	const issuedAt = Math.floor(Date.now() / 1e3);
	const proof = {
		nonce: randomBytes(32).toString("hex"),
		issuedAt,
		expiresAt: issuedAt + 60
	};
	const event = liveContactEvent(contactPayload(identity), proof, key.xonlyHex);
	const contact = contactPayload(identity, {
		...proof,
		signature: signEvent(event, key.secretKeyHex).sig
	});
	return {
		...identity,
		contact,
		qrDataUrl: await contactQr(contact),
		expiresAt: proof.expiresAt * 1e3
	};
}
function identityContactIssueRoute(fence, directory) {
	return identityJsonPostRoute(IDENTITY_CONTACT_ENDPOINT, fence, async (raw) => {
		let input;
		try {
			input = JSON.parse(raw);
		} catch {
			throw new Error("identity:invalid-contact");
		}
		if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("identity:invalid-contact");
		const value = input;
		if (Object.keys(value).sort().join(",") !== "npub,subject" || typeof value.npub !== "string" || value.subject !== null && typeof value.subject !== "string") throw new Error("identity:invalid-contact");
		return issueIdentityContact(directory(), {
			npub: value.npub,
			subject: value.subject
		});
	});
}
//#endregion
//#region lib/types/client/record-projection.js
/**
* The fields `recordProjection` in `plugins/aukora-aumlok/lib/record-v3.mjs` produces.
*
* EIGHT, PLUS THE HANDLE WHEN THE RECORD CARRIES ONE (Y2, 2026-09-23), PLUS THE APPROVAL KEY. This list
* used to be exhaustive at eight, and the organ's projection gained a ninth field when X8 made the
* handle half of the key: `recordProjection` spreads `handle` only for a record that has one, because a
* record bound before X8 carries none and must keep projecting. A list that demanded EXACTLY eight
* therefore refused every record the CURRENT ceremony writes — including, through
* `parseAumlokControl`, the answer the mounted adapter gives — so a machine that had just bound read
* `control-unreadable` and its badge stayed UNBOUND. MEASURED: the organ's own projection over a fresh
* bind carries `subject,rootId,ed25519,mlDsa65,boundAt,genesisRef,epoch,receipt,handle` and this parser
* refused it with "fields must be exactly boundAt, ed25519, epoch, genesisRef, mlDsa65, receipt, rootId,
* subject".
*
* SO THE REQUIRED SET IS THE EIGHT AND THE HANDLE IS OPTIONAL. An unknown ninth field is STILL a
* refusal: a v3 record's field set is closed, and a value nothing validates must not reach the screen.
*
* `approvalKeyDid` IS REQUIRED, AND THE HANDLE'S OPTIONALITY IS EXACTLY WHY IT IS (2026-09-23). The
* screen showed the WRONG KEY for as long as it derived one itself: it built `approvalKeyDid` from
* `ed25519`, which is `publicRoot.ed25519` — the ROOT key — while the key that signs an approval here is
* the MACHINE key whose seed sits in `machine-seed-v3.json` and whose public half the record lists in
* `machines[]`. Those are different keys on a real record (`161bc509…` against `59d6f06e…` on Peter's),
* and a signature made with one cannot verify under the other. The organ's projection now carries the
* approval key it derived, so this parser CARRIES THAT VALUE THROUGH instead of inventing a second
* answer. It is required rather than optional because an optional field would leave the old derivation
* as the fallback and the wrong key would come back the moment the field was absent — and
* `recordProjection` DOES omit it for a record that lists more than one machine, where the record alone
* cannot say which machine signs here. Such a projection is refused by name, which is the honest screen.
* `activeControlDigest` is still read from `rootId` rather than carried: for a v3 record the record's own
* root IS the control head, that is the mapping this file's own comment documents, and a second copy of
* one fact is a second thing to disagree.
*/
const AUMLOK_RECORD_FIELDS = [
	"subject",
	"rootId",
	"ed25519",
	"mlDsa65",
	"boundAt",
	"genesisRef",
	"epoch",
	"receipt",
	"approvalKeyDid"
];
/**
* The seven control fields, as the ORGAN defines them (`plugins/aukora-aumlok/lib/projection.mjs`).
*
* SPELLED HERE RATHER THAN IMPORTED because that module is `node:crypto` code and cannot come into the
* bundle, exactly as the base58 encoder below is spelled for the same reason. The court that asserts
* this list is the organ's is `tests/aukora-face-aumlok-control.test.mjs`, which parses a projection the
* ORGAN produced rather than one this file invented.
*/
const AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS = [
	"domain",
	"subject",
	"epoch",
	"activeControlDigest",
	"revoked",
	"approvalKeyDid",
	"custodyClass"
];
/**
* The record facts the ORGAN'S CONTROL PROJECTION carries beside the seven control fields.
*
* WHY THIS EXISTS, AND IT IS THE SECOND HALF OF THE SAME REPAIR. `loadLocalAumlokPublicControl` now
* answers a v3 record with `projectRecordV3Control` — the seven fields the admission machinery reads,
* which is what makes an approval possible at all — and that function also carries `boundAt` and
* `handle`, because the SCREEN reads them and a read that answered with the control fields alone would
* have taken the binding time away from the receipt and the public name away from the ceremony lock.
* MEASURED: that read arrives here and, before this list existed, `parseAumlokControl` refused it
* `aumlok-control-projection:unrecognised` — a machine that had just bound read UNBOUND, which is the
* exact defect U6 exists to catch, arrived at from the other side.
*/
const AUMLOK_CONTROL_CARRIED_RECORD_FIELDS = ["boundAt", "handle"];
/**
* The record's own fields the ORGAN'S CONTROL PROJECTION carries, and the one it makes optional.
*
* WHAT THE ORGAN'S PROJECTION ACTUALLY IS, MEASURED RATHER THAN ASSUMED. `projectRecordV3Control`
* returns the seven control fields, plus `boundAt` — the one field a person reads as "when did I do
* this", which the receipt renders — plus `handle` when the record has one. It does NOT carry the
* record's other public fields (`rootId`, `ed25519`, `mlDsa65`, `genesisRef`, `receipt`), and that is
* the design rather than an omission: those are the RECORD's view, `recordProjection` answers them, and
* a read that answered both would be two field sets in one value, which is the shape ambiguity this
* file's predicates exist to remove. A caller that needs both — a screen rendering a receipt AND the
* record's keys — reads both, and each answer is closed.
*/
const AUMLOK_CONTROL_RECORD_FIELDS = ["boundAt"];
/**
* Whether a candidate is the ORGAN'S CONTROL projection of a v3 record: the seven control fields, the
* binding moment, and the public handle when the record carries one.
*
* STRICT IN BOTH DIRECTIONS, like every other shape check in this file. A missing required field is not
* this shape, and an EXTRA field is not either — an unknown field reaching the screen is what the closed
* sets exist to prevent. The control fields are spelled here rather than imported from the v1 parser
* because that parser's list is its own contract and this shape is a different one.
*/
function isAumlokRecordControlProjection(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
	if (Object.getPrototypeOf(input) !== Object.prototype) return false;
	const allowed = new Set([
		...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS,
		...AUMLOK_CONTROL_RECORD_FIELDS,
		...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS
	]);
	if (Object.keys(input).some((key) => !allowed.has(key))) return false;
	return [...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_RECORD_FIELDS].every((field) => Object.hasOwn(input, field));
}
/** The one field a v3 record carries only sometimes: the public handle X8 salts the key with. */
const AUMLOK_RECORD_OPTIONAL_FIELDS = ["handle"];
/**
* The domain this screen shows for a v3 record.
*
* IT IS NOT `aukora:aumlok-public-control:v1`, AND IT MUST NOT PRETEND TO BE. `store.mjs` names the
* two record formats by domain so a reader can tell which one it holds; a v3 record rendered under
* the v1 control domain would be the screen making the claim the controller refused to make. The
* field is on the screen precisely so a person can see which record they are reading.
*/
const AUMLOK_RECORD_DOMAIN = "aukora:local-aumlok-control:v3";
/**
* The domain a CONTROL projection carries, which is NOT this file's record domain.
*
* SPELLED HERE RATHER THAN IMPORTED, AND THE REASON IS A CYCLE. `control-projection.ts` already imports
* THIS module, so a value import back into it would be a cycle — the same reason the type import at the
* top is type-only. The value is the organ's (`PUBLIC_CONTROL_DOMAIN` in
* `plugins/aukora-aumlok/lib/projection.mjs`) and it is the same string the face's own
* `AUMLOK_PUBLIC_CONTROL_DOMAIN` holds; the arm in `tests/aukora-face-aumlok-control.test.mjs` parses a
* projection the ORGAN produced, so a drift between the three shows up as a refused projection rather
* than as three spellings agreeing with each other.
*/
const AUMLOK_CONTROL_PROJECTION_DOMAIN = "aukora:aumlok-public-control:v1";
const SUBJECT$1 = /^aukora:1:[0-9a-f]{64}$/u;
const DIGEST$1 = /^[0-9a-f]{64}$/u;
const REF24 = /^[0-9a-f]{24}$/u;
const LOWER_HEX = /^[0-9a-f]+$/u;
/** The one custody ceiling a local controller declares, v1 control and v3 record alike. */
const CUSTODY_CLASS = "same-uid-posix-mode-only";
/**
* Validate the ORGAN'S CONTROL projection of a v3 record and map it onto what the surface renders.
*
* IT DOES NOT RE-DERIVE THE APPROVAL KEY, AND THAT IS THE WHOLE POINT. The value carries
* `approvalKeyDid` because the organ decided which machine signs here — from the seed this laptop kept,
* held against the record's own `machines[]`. This parser checks the field's SHAPE and CARRIES IT. The
* version of this file that computed a DID itself computed the ROOT's, from `publicRoot.ed25519`, and a
* signature made by this laptop can never verify under that key.
*
* THE CLOCK AND THE DIGEST ARE READ THE SAME WAY as in the record view: `activeControlDigest` is
* carried, because on this shape the organ has already stated it, and `rootId` is the same value — the
* arm that asserts they agree is in `tests/aukora-face-aumlok-control.test.mjs`, so the two cannot drift.
* @param input - a value for which {@link isAumlokRecordControlProjection} is true.
* @returns the frozen projection the surface renders.
* @throws TypeError when the value is not exactly one control projection of a v3 record.
*/
function parseAumlokRecordControlProjection(input) {
	if (!isAumlokRecordControlProjection(input)) throw new TypeError(`aumlok-record-control-projection: fields must be exactly ${[...AUMLOK_RECORD_CONTROL_PROJECTION_FIELDS, ...AUMLOK_CONTROL_CARRIED_RECORD_FIELDS].sort().join(", ")}`);
	const record = input;
	const fail = (detail) => {
		throw new TypeError(`aumlok-record-control-projection: ${detail}`);
	};
	const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass, boundAt } = record;
	if (domain !== "aukora:aumlok-public-control:v1") fail(`domain must equal ${AUMLOK_CONTROL_PROJECTION_DOMAIN}`);
	if (typeof revoked !== "boolean") fail("revoked must be a boolean");
	if (custodyClass !== CUSTODY_CLASS) fail(`custodyClass must equal ${CUSTODY_CLASS}`);
	const subjectText = typeof subject === "string" && SUBJECT$1.test(subject) ? subject : fail("subject must be aukora:1:<64 hex>");
	if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
	if (typeof activeControlDigest !== "string" || !DIGEST$1.test(activeControlDigest)) fail("activeControlDigest must be 64 hex characters");
	if (typeof approvalKeyDid !== "string" || !approvalKeyDid.startsWith("did:key:z")) fail("approvalKeyDid must be the did:key of the machine key that signs approvals here");
	if (typeof boundAt !== "string" && typeof boundAt !== "number") fail("boundAt must be a string or a number");
	const { handle } = record;
	if (handle !== void 0 && (typeof handle !== "string" || handle.length === 0)) fail("handle must be a non-empty string when the record carries one");
	return Object.freeze({
		domain,
		subject: subjectText,
		epoch,
		activeControlDigest,
		revoked,
		approvalKeyDid,
		custodyClass: CUSTODY_CLASS,
		boundAt,
		...typeof handle === "string" ? { handle } : {}
	});
}
/**
* Whether a candidate value is a v3 record projection.
*
* STRICT, FOR THE SAME REASON THE SEVEN-FIELD PARSER IS. The record module builds the eight required
* fields, plus `handle` on a record that carries one, and nothing else — so an extra field is a refusal
* rather than a value to ignore.
* @param input - candidate value decoded at a transport boundary.
* @returns true when the value's keys are {@link AUMLOK_RECORD_FIELDS}, plus only
*   {@link AUMLOK_RECORD_OPTIONAL_FIELDS} when present.
*/
function isAumlokRecordProjection(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
	if (Object.getPrototypeOf(input) !== Object.prototype) return false;
	const allowed = new Set([...AUMLOK_RECORD_FIELDS, ...AUMLOK_RECORD_OPTIONAL_FIELDS]);
	if (Object.keys(input).some((key) => !allowed.has(key))) return false;
	return AUMLOK_RECORD_FIELDS.every((field) => Object.hasOwn(input, field));
}
/**
* Validate one v3 record projection and map it onto the projection the surface renders.
*
* EVERY FIELD IS CHECKED AGAINST THE SAME GRAMMARS THE SEVEN-FIELD PARSER USES, so a record this
* screen renders is held to the shapes the controller's own readers enforce. `receipt` is
* present-and-null-or-object: `buildRecordV3` writes it as `null` until a binding produces one, so
* the shape a reader sees never changes between an unbound and a bound root.
*
* THE TWO FIELDS A v3 RECORD DOES NOT CARRY, AND WHAT IS SHOWN FOR THEM:
*
*   `activeControlDigest` names the ACTIVE CONTROL HEAD in v1 — it changes on rotation and on
*   revocation while the subject stays put. A v3 record has no control heads, so the value shown is
*   the record's own `rootId`: the sha256 the organ computed over the record's public keys in
*   `aumlokRootId`, which IS the v3 spelling of "the keys in play now". It is a real digest of a
*   real public identity, it is 64 hex as the field demands, and it is labelled on the screen as
*   the record's digest rather than passed off as a control head's. IT IS NOT THE SUBJECT and must
*   not be required to equal it: a v3 subject is the GENESIS digest, so a refresh moves this field
*   to the new keys while the subject stays where it was — which is the whole point of the pin.
*
*   `revoked` has no v3 counterpart at all — there is no revocation in this record and no control
*   head to revoke. A lost phrase is a NEW INSTANCE, not a terminal state to publish, so this reads
*   the honest value for a record that carries no such statement and never claims one was made.
* @param input - a value for which {@link isAumlokRecordProjection} is true.
* @returns the frozen projection the surface renders.
* @throws TypeError when the value is not exactly one v3 record projection.
*/
function parseAumlokRecordProjection(input) {
	if (!isAumlokRecordProjection(input)) throw new TypeError(`aumlok-record-projection: fields must be exactly ${[...AUMLOK_RECORD_FIELDS].sort().join(", ")}`);
	const record = input;
	const fail = (detail) => {
		throw new TypeError(`aumlok-record-projection: ${detail}`);
	};
	const { subject, rootId, ed25519, mlDsa65, boundAt, genesisRef, epoch, receipt, approvalKeyDid, handle } = record;
	const subjectText = typeof subject === "string" && SUBJECT$1.test(subject) ? subject : fail("subject must be aukora:1:<64 hex>");
	if (typeof rootId !== "string" || !DIGEST$1.test(rootId)) fail("rootId must be 64 hex characters");
	if (typeof approvalKeyDid !== "string" || !approvalKeyDid.startsWith("did:key:z")) fail("approvalKeyDid must be the did:key of the machine key that signs approvals here — a record listing more than one machine does not settle which, and the root key is never the answer");
	if (typeof ed25519 !== "string" || !LOWER_HEX.test(ed25519) || ed25519.length !== 64) fail("ed25519 must be a 64-hex raw Ed25519 public key");
	if (typeof mlDsa65 !== "string" || !LOWER_HEX.test(mlDsa65) || mlDsa65.length === 0) fail("mlDsa65 must be the raw ML-DSA-65 public key in hex");
	if (typeof boundAt !== "string" && typeof boundAt !== "number") fail("boundAt must be a string or a number");
	if (typeof genesisRef !== "string" || !REF24.test(genesisRef)) fail("genesisRef must be 24 hex characters");
	if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
	if (receipt !== null && (typeof receipt !== "object" || Array.isArray(receipt))) fail("receipt must be null or the binding receipt object");
	if (handle !== void 0 && (typeof handle !== "string" || handle.length === 0)) fail("handle must be a non-empty string when the record carries one");
	return Object.freeze({
		domain: AUMLOK_RECORD_DOMAIN,
		subject: subjectText,
		epoch,
		activeControlDigest: rootId,
		revoked: false,
		approvalKeyDid,
		custodyClass: CUSTODY_CLASS,
		boundAt,
		...typeof handle === "string" ? { handle } : {}
	});
}
//#endregion
//#region lib/types/control-projection.js
/**
* The AUMLOK public control projection, exactly as the controller plugin defines it.
*
* THIS FILE OWNS NO SCHEMA OF ITS OWN. `plugins/aukora-aumlok/lib/projection.mjs`
* defines a closed seven-field public control and builds it field by field so that the
* private half — the Ed25519 private key PEM and the ML-DSA-65 secret — structurally
* cannot appear in it. The screen reproduces those seven fields and refuses anything
* else on the wire. A screen with its own shape would be a second definition of a
* public identity, and the first time the two disagreed the screen would be lying.
*
* WHAT THIS SURFACE IS NOT. It shows status. It never generates a phrase, never asks for one,
* never holds a key, and never approves anything. BINDING RUNS HERE, ON THIS SCREEN: the seven
* words are drawn once, typed back into their tiles, and the root is DERIVED from them — there is
* no separate window in v3 and nothing is unwrapped into a record, because the words themselves
* are the key. Approval is a separate signer process on a Unix socket. Neither is reachable from a
* browser, and neither should be.
*/
const SUBJECT = /^aukora:1:[0-9a-f]{64}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{16,}$/u;
/** The closed field set of `plugins/aukora-aumlok/lib/projection.mjs`. */
const FIELDS = [
	"domain",
	"subject",
	"epoch",
	"activeControlDigest",
	"revoked",
	"approvalKeyDid",
	"custodyClass"
];
/** The one domain a public control projection may carry. */
const AUMLOK_PUBLIC_CONTROL_DOMAIN = "aukora:aumlok-public-control:v1";
/** The one custody ceiling the local controller declares. */
const AUMLOK_LOCAL_CUSTODY_CLASS = "same-uid-posix-mode-only";
/** Same-origin GET route serving the current AUMLOK public control. */
const AUMLOK_CONTROL_STATUS_ENDPOINT = "/api/aukora/aumlok-control";
/**
* Build one not-connected body.
* @param reason - which of the three absences this is.
* @param code - the controller's own refusal code, when it produced one.
* @returns the frozen body.
*/
function aumlokNotConnected(reason, code, detail) {
	return Object.freeze({
		status: "not-connected",
		reason,
		...code === void 0 ? {} : { code },
		...detail === void 0 || detail === "" ? {} : { detail }
	});
}
/**
* Validate a candidate not-connected body from the status endpoint.
* @param input - candidate value decoded at a transport boundary.
* @returns the frozen body when exact, undefined otherwise.
*/
function parseAumlokNotConnectedBody(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return void 0;
	if (Object.getPrototypeOf(input) !== Object.prototype) return void 0;
	const record = input;
	if (record["status"] !== "not-connected") return void 0;
	const reason = record["reason"];
	if (reason !== "no-controller-service" && reason !== "adapter-unbound" && reason !== "controller-absent" && reason !== "control-unreadable" && reason !== "record-names-no-machine") return;
	const code = record["code"];
	if (code !== void 0 && (typeof code !== "string" || code.length === 0 || code.length > 128)) return void 0;
	const detail = record["detail"];
	if (detail !== void 0 && (typeof detail !== "string" || detail.length === 0 || detail.length > 1024)) return void 0;
	const keys = Object.keys(record).sort();
	const expected = [
		...code === void 0 ? [] : ["code"],
		...detail === void 0 ? [] : ["detail"],
		"reason",
		"status"
	];
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return void 0;
	return aumlokNotConnected(reason, code, detail);
}
/**
* Validate a candidate public control projection against the controller's closed set.
*
* Exactness is the point. An extra field is a refusal, not a value to ignore: the
* controller builds this object field by field precisely so that nothing else can ride
* along, and a parser that tolerated extras would undo that at the last hop.
* @param input - candidate value decoded at a transport boundary.
* @returns the frozen projection.
* @throws TypeError when the value is not exactly one projection.
*/
function parseAumlokControlProjection(input) {
	const fail = (detail) => {
		throw new TypeError(`aumlok-control-projection: ${detail}`);
	};
	if (input === null || typeof input !== "object" || Array.isArray(input)) fail("not an object");
	if (Object.getPrototypeOf(input) !== Object.prototype) fail("not a plain object");
	const record = input;
	const actual = Object.keys(record).sort();
	const expected = [...FIELDS].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`fields must be exactly ${expected.join(", ")}`);
	const { domain, subject, epoch, activeControlDigest, revoked, approvalKeyDid, custodyClass } = record;
	if (domain !== "aukora:aumlok-public-control:v1") fail(`domain must equal ${AUMLOK_PUBLIC_CONTROL_DOMAIN}`);
	if (typeof subject !== "string" || !SUBJECT.test(subject)) fail("subject must be aukora:1:<64 hex>");
	if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) fail("epoch must be a non-negative integer");
	if (typeof activeControlDigest !== "string" || !DIGEST.test(activeControlDigest)) fail("activeControlDigest must be 64 hex characters");
	if (typeof revoked !== "boolean") fail("revoked must be a boolean");
	if (typeof approvalKeyDid !== "string" || !DID_KEY.test(approvalKeyDid)) fail("approvalKeyDid must be a did:key");
	if (custodyClass !== "same-uid-posix-mode-only") fail(`custodyClass must equal ${AUMLOK_LOCAL_CUSTODY_CLASS}`);
	return Object.freeze({
		domain: AUMLOK_PUBLIC_CONTROL_DOMAIN,
		subject,
		epoch,
		activeControlDigest,
		revoked,
		approvalKeyDid,
		custodyClass: AUMLOK_LOCAL_CUSTODY_CLASS
	});
}
/**
* Validate and normalise EITHER record shape this screen may be handed.
*
* THREE RECOGNISED SHAPES NOW, AND THE THIRD IS WHY THE FIRST TWO COULD NOT BE LEFT ALONE. The
* controller's `lib/store.mjs` dispatches on the record's own domain, so a directory holding a v1
* control record serves the seven-field public control; a directory holding a v3 record serves the
* ORGAN'S CONTROL projection — the seven control fields plus the two record facts the screen reads,
* which is the shape that makes an approval possible at all; and `recordProjection` serves the record's
* own view, which the face's host half reads directly from a directory. All three are the controller's
* own output for a BOUND machine, and a screen that accepts only one of them reports the others as an
* unrecognised projection — which is how a machine bound the v3 way never showed BOUND at all.
*
* THE ORDER IS SPECIFIC-FIRST, AND THAT IS NOT AN ACCIDENT. The control projection and the record view
* have DISJOINT field sets, so at most one predicate can match and no input is read as the wrong shape;
* the v1 parser is last because it is the strictest and the oldest. A shape that is none of the three is
* still a refusal, and the failure names the seven-field contract because that is the one this module
* owns. Nothing unknown is ever rendered.
* @param input - candidate value decoded at a transport boundary.
* @returns the frozen projection, in the surface's own field set either way.
* @throws TypeError when the value is neither shape.
*/
function parseAumlokControl(input) {
	if (isAumlokRecordControlProjection(input)) return parseAumlokRecordControlProjection(input);
	if (isAumlokRecordProjection(input)) return parseAumlokRecordProjection(input);
	return parseAumlokControlProjection(input);
}
//#endregion
//#region lib/types/index.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
/** The controller's own refusal when a mount carries no directory. */
const ADAPTER_UNBOUND = "aumlok:adapter-unbound";
/**
* THE RECORD READER'S OWN NAME FOR "THIS RECORD DOES NOT SAY WHICH MACHINE IS THIS LAPTOP".
*
* The shell passes its kept machine key so a second device reads BOUND; a caller that passes none, for a
* record listing several, gets this by name from `record-v3.mjs`. It is a FIFTH absence on this screen
* rather than `control-unreadable`, because the record is not unreadable — nobody said which machine
* this is.
*/
const RECORD_NAMES_NO_MACHINE = "aumlok:record-names-no-machine";
/**
* THE CONTROLLER'S OWN CODE FOR "THERE IS NO RECORD TO READ".
*
* IT IS NOT THE SAME FACT AS A BROKEN ONE, and a person acts differently on each: an empty bound
* directory means nobody has bound yet and the next step is the ceremony; a malformed record means
* something is wrong and the next step is to look. Both used to arrive as `control-unreadable`, so the
* screen told the owner of an empty directory to investigate a controller they had never created.
*/
const CONTROLLER_ABSENT = "aumlok-local:unavailable";
/**
* Required service: the loopback HTTP route registry.
*
* `aumlokControl` is deliberately NOT here. Declaring it would withhold this whole
* plugin from any composition without a controller row — the screen would vanish
* rather than report that there is no controller, which is the opposite of saying
* what is true. It is reached optionally instead, inside apply.
*/
const inject = ["webServer", "connection"];
/**
* Ask the controller for its current public control, and answer with the state the screen renders.
*
* EVERY ABSENCE CARRIES `status: 'not-connected'`, so a caller keys off ONE field whatever happened,
* and the connected case is the same discriminated shape. The reasons are never collapsed: no
* controller service in the composition at all; a service mounted with no directory, which refuses
* `aumlok:adapter-unbound` by name; and a directory that could not be read, whose own refusal code
* is carried verbatim.
* @param service - the mounted adapter, or undefined when no row provides one.
* @returns the fresh control state, or the named absence.
*/
function readControl(service) {
	if (service === void 0) return aumlokNotConnected("no-controller-service");
	return readControlFromAdapter(service);
}
/**
* THE ROUTE'S READ, WHICH HAS A SECOND SOURCE WHEN THE COMPOSITION HAS NONE.
*
* `readControl` keeps its own contract — the adapter, or the named absence — because it is called from
* more than one place and a signature that grew a Promise would move under every caller. This is the
* one the route uses, and it exists for the case Y2 measured: the adapter's row is absent, unpatched,
* or pointed at a directory other than the one the ceremony wrote, and a record on disk must still
* reach the badge.
* @param service - the mounted adapter, when a row provides one.
* @param directory - the controller directory this launch is bound to, when one was named.
* @returns the fresh control state, or the named absence.
*/
async function readControlWithFallback(service, directory) {
	return service === void 0 ? readControlFromDirectory(directory) : readControlFromAdapter(service);
}
/**
* Load one module by a specifier this build cannot see.
* @param specifier - the module to load.
* @returns the module, as the caller's own declared shape.
*/
async function loadUnseen(specifier) {
	return await import(__rewriteRelativeImportExtension(
		/* @vite-ignore */
		specifier
	));
}
/**
* THE DIRECTORY IS A SOURCE OF ITS OWN, AND PETER'S SCREEN IS WHY (Y2, 2026-09-23 17:02).
*
* A binding is a RECORD ON DISK: `bindV3` writes `local-control.json` into the directory the
* composition names, and every reader in this tree — the shell's `readBindingState`, the ceremony, the
* mount's own adapter — reads that file. This plugin ALSO HAS A MOUNT OF ITS OWN, and when that row is
* absent, unpatched, or pointed at a directory other than the one the ceremony wrote, the ONLY route
* the badge reads answered `no-controller-service` over a machine that had just bound. The ceremony
* succeeded, the record was on disk, and the screen could not see it.
*
* SO A MISSING ADAPTER IS NO LONGER AN ANSWER; IT IS A REASON TO READ THE DIRECTORY. The projection is
* built by the ORGAN'S OWN LOADER, `loadLocalAumlokPublicControl` from
* `plugins/aukora-aumlok/lib/store.mjs` — THE SAME CALL the mounted adapter's `refresh()` makes, so a
* record read here and a record read through the composition's row arrive at the screen as the SAME
* value, one field set and one set of grammars, with the public handle included exactly when the record
* carries one. Nothing private is read: the loader returns the public half, and the record's secret
* fields are never touched.
*
* IT USED TO CALL `recordProjection` DIRECTLY, AND THAT IS WHY THIS ROUTE WENT DARK. `recordProjection`
* is the RECORD's view — the published keys, the binding moment, the genesis — and it carries neither
* `activeControlDigest` nor `approvalKeyDid`. `projectControl` below hands what it returns to
* `parseAumlokControl`, which recognises the v1 control, the organ's CONTROL projection, and the record
* view; the record view of a v3 record was the one thing none of them accepted, so a machine that had
* just bound answered 404 with `aumlok-control-projection:unrecognised` on the very route the badge
* reads. The loader answers the control projection for a v3 record, which is what this route serves.
*
* THE ABSENCES KEEP THEIR NAMES: no directory named for this launch is `no-controller-service`
* (nothing has told this process where to look), a directory that is not there or holds no record is
* the organ's own `aumlok-local:unavailable` (`controller-absent`), and a record that IS there and
* cannot be read keeps its code verbatim.
* @param directory - the controller directory this launch is bound to, when one was named.
* @returns the fresh control state, or the named absence.
*/
async function readControlFromDirectory(directory) {
	if (typeof directory !== "string" || directory.length === 0) return aumlokNotConnected("no-controller-service");
	let store;
	try {
		store = await loadUnseen(new URL("../../../aukora-aumlok/lib/store.mjs", import.meta.url).href);
	} catch {
		return aumlokNotConnected("no-controller-service");
	}
	let raw;
	try {
		raw = store.loadLocalAumlokPublicControl(directory).projection;
	} catch (error) {
		return refusalOf(error);
	}
	return projectControl(raw);
}
/**
* One public control off the controller's own adapter, the composition's own service.
* @param service - the mounted adapter.
* @returns the fresh control state, or the named absence.
*/
function readControlFromAdapter(service) {
	let raw;
	try {
		raw = service.refresh();
	} catch (error) {
		return refusalOf(error);
	}
	return projectControl(raw);
}
/**
* The named absence for one refusal, never collapsed with the others.
*
* A THROW IS NOT A VERDICT, AND NOT EVERY THROW IS THE SAME. The adapter throws one named code when it
* was mounted with no directory; the store throws its own codes when a directory is there but
* unreadable. Collapsing both into a single not-found would erase the difference between "nobody
* configured this" and "something is wrong with what was configured".
* @param error - whatever the reader or the adapter threw.
* @returns the not-connected state carrying the reason and the raiser's own code.
*/
function refusalOf(error) {
	const code = typeof error?.code === "string" ? error.code : void 0;
	const message = typeof error?.message === "string" ? error.message : "";
	const rendered = code !== void 0 && message.startsWith(`${code}: `) ? message.slice(code.length + 2) : message === code ? "" : message;
	const detail = rendered.length > 1e3 ? rendered.slice(0, 1e3) : rendered;
	return aumlokNotConnected(code === ADAPTER_UNBOUND ? "adapter-unbound" : code === CONTROLLER_ABSENT ? "controller-absent" : code === RECORD_NAMES_NO_MACHINE ? "record-names-no-machine" : "control-unreadable", code, detail === "" ? void 0 : detail);
}
/**
* The state one projected control is, or the refusal that says why it is not one.
*
* EITHER RECORD SHAPE: the v1 public control and the v3 record are two NAMED formats the controller
* itself serves from one directory, and `store.mjs` says so when it dispatches on the record's own
* domain. `parseAumlokControl` accepts both and normalises them into the field set this screen renders;
* a shape that is neither is refused by name rather than rendered.
* @param raw - the value the adapter or the record reader returned.
* @returns the connected state, or the unrecognised-projection refusal.
*/
function projectControl(raw) {
	try {
		return Object.freeze({
			status: "connected",
			control: parseAumlokControl(raw)
		});
	} catch {
		return aumlokNotConnected("control-unreadable", "aumlok-control-projection:unrecognised");
	}
}
/**
* THE FENCE, AND THE ANSWER TO THE QUESTION THIS ITEM ASKS FIRST: a route that cannot verify its caller must not
* serve.
*
* Security has one home — the composition's `connection` service — and `vendor/dsh/packages/host/open-in-app/src/
* index.ts` states what its fence does: it "defeats DNS rebinding and cross-site calls", and its browser
* authentication "gates every caller before any resolution result, icon, or launch is reachable". This face used to
* call that fence **and** keep a fifteen-line local Host/Origin check of its own, which is a second fence that can
* drift from the one the rest of the organism uses. The local one is gone; this is the only one left.
*
* **THE FOUR CASES, AND WHY NONE OF THEM SERVES UNFENCED.** The rule on optional pins is that absent is a ceiling and
* present-and-unusable is a fault — but a security dependency is not an optional pin, so there is no ceiling branch
* here: without a working fence the request is refused, and the reason says which of the four it was.
*
* @param connection - the composition's connection service, as `ctx` holds it (possibly nothing at all).
* @param request - the incoming request, which the fence reads headers from.
* @returns the status to refuse with, and the reason; `rejection` undefined means the fence let it through.
*/
function fenceRejectionOf(connection, request) {
	if (connection === null || typeof connection !== "object") return {
		rejection: 403,
		reason: "no-connection"
	};
	const ask = connection.requestRejection;
	if (typeof ask !== "function") return {
		rejection: 500,
		reason: "rejection-not-callable"
	};
	let answer;
	try {
		answer = ask.call(connection, request);
	} catch (error) {
		return {
			rejection: 500,
			reason: `rejection-threw: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	if (answer === 401 || answer === 403) return {
		rejection: answer,
		reason: "fence-rejected"
	};
	if (answer !== void 0) return {
		rejection: 500,
		reason: `rejection-unknown: ${String(answer)}`
	};
	return {
		rejection: void 0,
		reason: null
	};
}
function end(res, status) {
	res.writeHead(status, {
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end();
}
function route(gate, read) {
	return {
		kind: "exact",
		path: AUMLOK_CONTROL_STATUS_ENDPOINT,
		handler: (req, res) => {
			const fence = fenceRejectionOf(gate(), req);
			if (fence.rejection !== void 0) {
				end(res, fence.rejection);
				return;
			}
			if (req.method !== "GET") {
				res.setHeader("allow", "GET");
				end(res, 405);
				return;
			}
			read().then((answer) => {
				const connected = answer.status === "connected";
				res.writeHead(connected ? 200 : 404, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"x-content-type-options": "nosniff"
				});
				res.end(JSON.stringify(answer));
			});
		}
	};
}
function identityRoute(gate, directory) {
	return {
		kind: "exact",
		path: AUMLOK_IDENTITY_ENDPOINT,
		handler: async (req, res) => {
			const fence = fenceRejectionOf(gate(), req);
			if (fence.rejection !== void 0) {
				end(res, fence.rejection);
				return;
			}
			if (req.method !== "GET") {
				res.setHeader("allow", "GET");
				end(res, 405);
				return;
			}
			try {
				const identity = await readIdentity(directory());
				res.writeHead(200, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"x-content-type-options": "nosniff"
				});
				res.end(JSON.stringify(identity));
			} catch (error) {
				const code = error?.code;
				res.writeHead(503, {
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
					"x-content-type-options": "nosniff"
				});
				res.end(JSON.stringify({ code: typeof code === "string" && /^[a-z0-9:_-]{1,96}$/u.test(code) ? code : "aumlok:identity-unavailable" }));
			}
		}
	};
}
/**
* Publish the controller's public control on one loopback, same-origin GET route.
*
* TWO SOURCES, ONE ANSWER, and the order matters: the composition's own adapter when a row provides
* one, because a mounted adapter can carry a pinned `expectation` this route knows nothing about; and
* otherwise the controller DIRECTORY this row names, read with the face's own record reader. Without
* the second source a machine whose record is on disk reads as no-controller-service, which is the
* state Y2's red arm measured on Peter's bind.
* @param ctx - host context carrying the route registry.
* @param config - this row's `directory`, when the composition names one.
*/
function apply(ctx, config) {
	if (ctx.webServer.host !== "127.0.0.1") throw new Error("ui-aumlok: control status requires a loopback web server");
	const directory = readConfiguredDirectory(config);
	const controller = () => {
		const service = ctx.get("aumlokControl");
		return typeof service === "object" && service !== null && typeof service.refresh === "function" ? service : void 0;
	};
	const gate = () => Reflect.get(ctx, "connection");
	ctx.effect(() => ctx.webServer.register(identityContactVerificationRoute((request) => fenceRejectionOf(gate(), request).rejection)), "ui-aumlok: fresh contact verification");
	ctx.effect(() => ctx.webServer.register(identityContactIssueRoute((request) => fenceRejectionOf(gate(), request).rejection, () => {
		const service = controller();
		return service === void 0 ? directory : readConfiguredDirectory(service);
	})), "ui-aumlok: signed live contact route");
	ctx.effect(() => ctx.webServer.register(route(gate, () => readControlWithFallback(controller(), directory))), "ui-aumlok: control status route");
	ctx.effect(() => ctx.webServer.register(identityRoute(gate, () => {
		const service = controller();
		return service === void 0 ? directory : readConfiguredDirectory(service);
	})), "ui-aumlok: public identity route");
}
/**
* This row's `directory`, when the composition names one.
*
* THE ROW IS HOW A DEPLOYMENT TELLS THIS SCREEN WHERE TO LOOK. Peter's launch already patches an
* existing row rather than inserting one — `session-query-sqlite` in his own patch set is the measured
* example — so `aukora-face-aumlok` can be pointed at the controller directory the same way, and the
* shell's ceremony writes to the same path. Nothing is guessed here: a config that names no directory
* is not an error, it is the composition this plugin has always served, and the adapter's own source
* is preferred over it whenever a row provides one.
* @param config - the composition row's configuration.
* @returns the directory, or undefined when this row names none.
*/
function readConfiguredDirectory(config) {
	if (config === null || typeof config !== "object") return void 0;
	const directory = config.directory;
	return typeof directory === "string" && directory.length > 0 ? directory : void 0;
}
//#endregion
export { AUMLOK_CONTROL_STATUS_ENDPOINT, AUMLOK_LOCAL_CUSTODY_CLASS, AUMLOK_PUBLIC_CONTROL_DOMAIN, apply, aumlokNotConnected, fenceRejectionOf, inject, parseAumlokControl, parseAumlokControlProjection, parseAumlokNotConnectedBody, readControl, readControlWithFallback };
