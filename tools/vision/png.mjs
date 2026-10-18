// 极简 PNG 编解码（只依赖 node:zlib），供评测脚本和测试读写图片。
// 解码支持 8/16 位、灰度/RGB/调色板/灰度+α/RGBA，非隔行；编码输出 8 位 RGBA。
import { inflateSync, deflateSync } from 'node:zlib';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePNG(buf) {
	const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) throw new Error('not a PNG');
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
	let palette = null, trns = null;
	const idat = [];
	while (off < b.length) {
		const len = dv.getUint32(off); const type = String.fromCharCode(...b.subarray(off + 4, off + 8));
		const data = b.subarray(off + 8, off + 8 + len);
		if (type === 'IHDR') {
			width = dv.getUint32(off + 8); height = dv.getUint32(off + 12);
			depth = data[8]; ctype = data[9]; interlace = data[12];
		} else if (type === 'PLTE') palette = data;
		else if (type === 'tRNS') trns = data;
		else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		off += 12 + len;
	}
	if (interlace) throw new Error('interlaced PNG not supported');
	const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
	const bpp = Math.max(1, (chans * depth) >> 3);
	const stride = (width * chans * depth + 7) >> 3;
	const raw = inflateSync(Buffer.concat(idat.map(x => Buffer.from(x))));
	const px = new Uint8Array(stride * height);
	let prev = new Uint8Array(stride);
	for (let y = 0, p = 0; y < height; y++) {
		const f = raw[p++], line = px.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < stride; x++, p++) {
			const a = x >= bpp ? line[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
			let v = raw[p];
			if (f === 1) v += a;
			else if (f === 2) v += up;
			else if (f === 3) v += (a + up) >> 1;
			else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
			line[x] = v & 255;
		}
		prev = line;
	}
	const out = new Uint8ClampedArray(width * height * 4);
	const sample = (line, i) => {
		if (depth === 8) return line[i];
		if (depth === 16) return line[2 * i];
		const per = 8 / depth, byte = line[Math.floor(i / per)], shift = 8 - depth * (i % per + 1);
		const v = (byte >> shift) & ((1 << depth) - 1);
		return ctype === 3 ? v : Math.round(v * 255 / ((1 << depth) - 1));
	};
	for (let y = 0; y < height; y++) {
		const line = px.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			if (ctype === 6) { for (let k = 0; k < 4; k++) out[o + k] = sample(line, x * 4 + k); }
			else if (ctype === 2) { for (let k = 0; k < 3; k++) out[o + k] = sample(line, x * 3 + k); out[o + 3] = 255; }
			else if (ctype === 0) { const v = sample(line, x); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255; }
			else if (ctype === 4) { const v = sample(line, x * 2); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = sample(line, x * 2 + 1); }
			else if (ctype === 3) {
				const i = sample(line, x);
				out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2];
				out[o + 3] = trns && i < trns.length ? trns[i] : 255;
			}
		}
	}
	return { width, height, data: out };
}

const CRC = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
	return t;
})();
function crc32(bytes) {
	let c = 0xffffffff;
	for (const v of bytes) c = CRC[(c ^ v) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, 'ascii');
	Buffer.from(data).copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

// 编码：opaque=true 时写 RGB（更小）；每行用 Paeth 滤波
export function encodePNG(img, { opaque = true } = {}) {
	const { width, height, data } = img;
	const ch = opaque ? 3 : 4, stride = width * ch;
	const raw = Buffer.alloc((stride + 1) * height);
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const line = Buffer.alloc(stride);
		for (let x = 0; x < width; x++) for (let k = 0; k < ch; k++) line[x * ch + k] = data[(y * width + x) * 4 + k];
		const o = y * (stride + 1);
		raw[o] = 4;
		for (let x = 0; x < stride; x++) {
			const a = x >= ch ? line[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0;
			const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
			const pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
			raw[o + 1 + x] = (line[x] - pred) & 255;
		}
		prev = line;
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
	return Buffer.concat([Buffer.from(SIG), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
