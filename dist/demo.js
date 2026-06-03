"use strict";
const input = document.getElementById("text-input");
const noMaskCheckbox = document.getElementById("no-mask");
const info = document.getElementById("info");
const dataFlat = document.getElementById("dataFlat");
const dataInfo = document.getElementById("dataInfo");
const outputText = document.getElementById("outputText");
const error = document.getElementById("error");
const scale = 8;
function decodeNumeric(bits, numDigits) {
    let result = "";
    let valid = true;
    let i = 0;
    let remaining = numDigits;
    while (remaining >= 3) {
        let val = 0;
        for (let b = 0; b < 10; b++)
            val = (val << 1) | bits[i++];
        if (val > 999)
            valid = false;
        result += val.toString().padStart(3, "0");
        remaining -= 3;
    }
    if (remaining === 2) {
        let val = 0;
        for (let b = 0; b < 7; b++)
            val = (val << 1) | bits[i++];
        if (val > 99)
            valid = false;
        result += val.toString().padStart(2, "0");
    }
    else if (remaining === 1) {
        let val = 0;
        for (let b = 0; b < 4; b++)
            val = (val << 1) | bits[i++];
        if (val > 9)
            valid = false;
        result += val.toString();
    }
    return { text: result, valid };
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
input.value = "0".repeat(numericDigits);
function makeQr(numericText) {
    const prefixSeg = qrcodegen.QrSegment.makeBytes(prefixBytes);
    const numSeg = qrcodegen.QrSegment.makeNumeric(numericText);
    updateState(numSeg.getData());
    const mask = noMaskCheckbox.checked ? -2 : 0;
    const minVersion = 4;
    const maxVersion = 4;
    const eccLevel = qrcodegen.QrCode.Ecc.LOW;
    const boostEcl = false;
    const qr = qrcodegen.QrCode.encodeSegments([prefixSeg, numSeg], eccLevel, minVersion, maxVersion, mask, boostEcl);
    return { qr, numSeg };
}
// Byte segment: 4 (mode) + 8 (count) + prefix_len*8 (data) bits
// Numeric segment: 4 (mode) + 10 (count) + data bits
const prefixSegBits = prefixSegBitsTotal;
const numericHeaderBits = numericHeaderBitsTotal;
function buildQrFromRawBits() {
    const prefixSeg = qrcodegen.QrSegment.makeBytes(prefixBytes);
    const numSeg = new qrcodegen.QrSegment(qrcodegen.QrSegment.Mode.NUMERIC, numericDigits, seg.slice());
    const mask = noMaskCheckbox.checked ? -2 : 0;
    const qr = qrcodegen.QrCode.encodeSegments([prefixSeg, numSeg], qrcodegen.QrCode.Ecc.LOW, 4, 4, mask, false);
    return { qr, numSeg };
}
function flipBitN(index) {
    if (index < 0 || index >= seg.length)
        return;
    seg[index] = seg[index] === 1 ? 0 : 1;
    updateState(seg);
    const decoded = decodeNumeric(seg, numericDigits);
    input.value = decoded.text;
    renderFromBits();
    error.textContent = decoded.valid ? "" : "Invalid: bit pattern exceeds numeric encoding range";
}
function updateState(s) {
    seg = s;
    dataInfo.textContent = `Data: ${seg.length} bits`;
    dataFlat.textContent = seg.map((b) => (b ? "x" : "_")).join("");
}
function renderFromBits() {
    error.textContent = "";
    const { qr, numSeg } = buildQrFromRawBits();
    info.textContent = `Version: ${qr.version} | Size: ${qr.size}×${qr.size} | Mask: ${qr.mask}`;
    const border = 2;
    const svgContainer = document.getElementById("qr-svg");
    svgContainer.innerHTML = qrToSvg(qr, border, numSeg);
}
function render() {
    const text = input.value;
    if (!text || !/^[0-9]+$/.test(text)) {
        info.textContent = "";
        const svgContainer = document.getElementById("qr-svg");
        svgContainer.innerHTML = "";
        error.textContent = text
            ? "Invalid: only digits 0-9 allowed"
            : "";
        return;
    }
    error.textContent = "";
    const { qr, numSeg } = makeQr(text);
    info.textContent = `Version: ${qr.version} | Size: ${qr.size}×${qr.size} | Mask: ${qr.mask}`;
    const border = 2;
    // Generate SVG
    const svgContainer = document.getElementById("qr-svg");
    svgContainer.innerHTML = qrToSvg(qr, border, numSeg);
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
                ? (dark ? "#0000aa" : "#ddeeff")
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
    const flipLog = document.getElementById("flip-log");
    let painting = false;
    function paintCell(target) {
        if (!target.classList.contains("qr-cell"))
            return;
        const currentFill = target.getAttribute("fill");
        if (currentFill === activeColor)
            return;
        const bitIndex = parseInt(target.getAttribute("data-bit"));
        flipLog.textContent = `Flipped data bit ${bitIndex}`;
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
input.addEventListener("input", () => {
    render();
});
noMaskCheckbox.addEventListener("change", render);
render();
