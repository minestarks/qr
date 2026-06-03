"use strict";
const error = document.getElementById("error");
const encodedUrl = document.getElementById("encoded-url");
const scale = 8;
function decodeNumeric(bits, numDigits) {
    let result = "";
    let valid = true;
    const invalidBits = new Set();
    let i = 0;
    let remaining = numDigits;
    while (remaining >= 3) {
        const groupStart = i;
        let val = 0;
        for (let b = 0; b < 10; b++)
            val = (val << 1) | bits[i++];
        if (val > 999) {
            valid = false;
            for (let b = groupStart; b < i; b++)
                invalidBits.add(b);
        }
        result += val.toString().padStart(3, "0");
        remaining -= 3;
    }
    if (remaining === 2) {
        const groupStart = i;
        let val = 0;
        for (let b = 0; b < 7; b++)
            val = (val << 1) | bits[i++];
        if (val > 99) {
            valid = false;
            for (let b = groupStart; b < i; b++)
                invalidBits.add(b);
        }
        result += val.toString().padStart(2, "0");
    }
    else if (remaining === 1) {
        const groupStart = i;
        let val = 0;
        for (let b = 0; b < 4; b++)
            val = (val << 1) | bits[i++];
        if (val > 9) {
            valid = false;
            for (let b = groupStart; b < i; b++)
                invalidBits.add(b);
        }
        result += val.toString();
    }
    return { text: result, valid, invalidBits };
}
const dataPrefix = location.origin + location.pathname.replace(/\/(index\.html)?$/, "") + "?";
// Convert prefix to byte array (ASCII)
const prefixBytes = [];
for (let i = 0; i < dataPrefix.length; i++) {
    prefixBytes.push(dataPrefix.charCodeAt(i));
}
// Compute how many numeric digits fit in remaining capacity (V4 Low)
const v4LowDataBits = 640; // getNumDataCodewords(4, LOW) * 8 = 80 * 8
const prefixSegBitsTotal = 4 + 8 + dataPrefix.length * 8;
const numericHeaderBitsTotal = 4 + 10;
const availableBits = v4LowDataBits - prefixSegBitsTotal - numericHeaderBitsTotal;
const numericDigits = Math.floor(availableBits / 10) * 3
    + (availableBits % 10 >= 7 ? 2 : availableBits % 10 >= 4 ? 1 : 0);
let seg;
function makeQr(numericText) {
    const prefixSeg = qrcodegen.QrSegment.makeBytes(prefixBytes);
    const numSeg = qrcodegen.QrSegment.makeNumeric(numericText);
    updateState(numSeg.getData());
    const qr = qrcodegen.QrCode.encodeSegments([prefixSeg, numSeg], qrcodegen.QrCode.Ecc.LOW, 4, 4, 0, false);
    return { qr, numSeg };
}
// Byte segment: 4 (mode) + 8 (count) + prefix_len*8 (data) bits
// Numeric segment: 4 (mode) + 10 (count) + data bits
const prefixSegBits = prefixSegBitsTotal;
const numericHeaderBits = numericHeaderBitsTotal;
function buildQrFromRawBits() {
    const prefixSeg = qrcodegen.QrSegment.makeBytes(prefixBytes);
    const numSeg = new qrcodegen.QrSegment(qrcodegen.QrSegment.Mode.NUMERIC, numericDigits, seg.slice());
    const qr = qrcodegen.QrCode.encodeSegments([prefixSeg, numSeg], qrcodegen.QrCode.Ecc.LOW, 4, 4, 0, false);
    return { qr, numSeg };
}
function flipBitN(index) {
    if (index < 0 || index >= seg.length)
        return;
    seg[index] = seg[index] === 1 ? 0 : 1;
    updateState(seg);
    renderFromBits();
}
function updateState(s) {
    seg = s;
    const decoded = decodeNumeric(seg, numericDigits);
    if (decoded.valid) {
        encodedUrl.textContent = dataPrefix + decoded.text;
        error.textContent = "";
    }
    else {
        encodedUrl.textContent = "";
        error.textContent = "Not scannable. Try flipping some bits.";
    }
    invalidBits = decoded.invalidBits;
}
let invalidBits = new Set();
function renderFromBits() {
    const { qr, numSeg } = buildQrFromRawBits();
    const border = 2;
    const svgContainer = document.getElementById("qr-svg");
    svgContainer.innerHTML = qrToSvg(qr, border, numSeg);
}
function render() {
    error.textContent = "";
    const numericText = "0".repeat(numericDigits);
    const { qr, numSeg } = makeQr(numericText);
    // Flip bits so all paintable cells start as light blue
    const dataBits = numSeg.getData().length;
    const positions = getDataBitPositions(qr, prefixSegBits + numericHeaderBits, prefixSegBits + numericHeaderBits + dataBits);
    for (const [key, bitIndex] of positions) {
        const [x, y] = key.split(",").map(Number);
        if (qr.getModule(x, y)) {
            seg[bitIndex] = seg[bitIndex] === 1 ? 0 : 1;
        }
    }
    // Fix any invalid groups by zeroing their bits
    const check = decodeNumeric(seg, numericDigits);
    for (const b of check.invalidBits) {
        seg[b] = 0;
    }
    updateState(seg);
    error.textContent = "";
    renderFromBits();
}
// Returns a map from "x,y" to bit index for data bits in the given range.
// Uses the same zigzag traversal as drawCodewords.
function getDataBitPositions(qr, startBit, endBit) {
    const positions = new Map();
    let i = 0;
    for (let right = qr.size - 1; right >= 1; right -= 2) {
        if (right === 6)
            right = 5;
        for (let vert = 0; vert < qr.size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? qr.size - 1 - vert : vert;
                if (!qr.isFunctionModule(x, y)) {
                    if (i >= startBit && i < endBit) {
                        positions.set(`${x},${y}`, i - startBit);
                    }
                    i++;
                }
            }
        }
    }
    return positions;
}
function qrToSvg(qr, border, seg) {
    const size = qr.size + border * 2;
    // Clickable area is the numeric segment's data bits
    const dataBits = seg.getData().length;
    const clickable = getDataBitPositions(qr, prefixSegBits + numericHeaderBits, prefixSegBits + numericHeaderBits + dataBits);
    let rects = "";
    for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
            const dark = qr.getModule(x, y);
            const bitIndex = clickable.get(`${x},${y}`);
            const isClickable = bitIndex !== undefined;
            const cls = isClickable ? "qr-cell" : "qr-func";
            const bitAttr = isClickable ? ` data-bit="${bitIndex}"` : "";
            const fill = isClickable
                ? (invalidBits.has(bitIndex) ? (dark ? "#aa0000" : "#ffdddd") : (dark ? "#0000aa" : "#ddeeff"))
                : (dark ? "#000000" : "#ffffff");
            rects += `<rect x="${x + border}" y="${y + border}" width="1" height="1" fill="${fill}" data-x="${x}" data-y="${y}" class="${cls}"${bitAttr}/>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" shape-rendering="crispEdges">
<rect width="100%" height="100%" fill="#ffffff"/>
${rects}
</svg>`;
}
let activeColor = "#0000aa"; // dark by default
function setupColorPicker() {
    const picker = document.getElementById("color-picker");
    picker.addEventListener("click", (e) => {
        const target = e.target.closest("[data-color]");
        if (!target)
            return;
        activeColor = target.getAttribute("data-color");
        picker.querySelectorAll("[data-color]").forEach((el) => {
            el.style.borderColor =
                el.getAttribute("data-color") === activeColor ? "#ff0000" : "transparent";
        });
    });
}
setupColorPicker();
function setupSvgClicks() {
    const svgContainer = document.getElementById("qr-svg");
    let painting = false;
    function paintCell(target) {
        if (!target.classList.contains("qr-cell"))
            return;
        const currentFill = target.getAttribute("fill");
        const isDark = currentFill === "#0000aa" || currentFill === "#aa0000";
        const wantDark = activeColor === "#0000aa";
        if (isDark === wantDark)
            return;
        const bitIndex = parseInt(target.getAttribute("data-bit"));
        document.getElementById("color-picker").classList.remove("hint");
        flipBitN(bitIndex);
    }
    svgContainer.addEventListener("mousedown", (e) => {
        painting = true;
        paintCell(e.target);
    });
    svgContainer.addEventListener("mousemove", (e) => {
        if (!painting)
            return;
        paintCell(e.target);
    });
    document.addEventListener("mouseup", () => {
        painting = false;
    });
}
setupSvgClicks();
render();
