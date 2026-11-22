/**
 * bios-ai-app.js - Unified MediaPipe AI Controller for BIOS TUI Interface
 * Includes all 5 AI Models + 3 Core Hand Readings + Serial Terminal Controls
 */

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

// UI Elements
const uiFps = document.getElementById('ui_fps');
const uiHandDetected = document.getElementById('ui_hand_detected');
const uiDistance = document.getElementById('ui_distance');
const uiFingerCount = document.getElementById('ui_finger_count');
const uiFingerBinary = document.getElementById('ui_finger_binary');

// Face UI Elements
const uiFaceDetected = document.getElementById('ui_face_detected');
const uiFaceXY = document.getElementById('ui_face_xy');
const uiFaceSize = document.getElementById('ui_face_size');
const uiFaceTilt = document.getElementById('ui_face_tilt');

// Face Mesh UI Elements
const uiMeshDetected = document.getElementById('ui_mesh_detected');
const uiMeshNose = document.getElementById('ui_mesh_nose');
const uiMeshYawPitch = document.getElementById('ui_mesh_yawpitch');
const uiMeshMouth = document.getElementById('ui_mesh_mouth');
const uiMeshEyes = document.getElementById('ui_mesh_eyes');

// Pose UI Elements
const uiPoseDetected = document.getElementById('ui_pose_detected');
const uiPoseElbows = document.getElementById('ui_pose_elbows');
const uiPoseShoulders = document.getElementById('ui_pose_shoulders');
const uiPoseWrists = document.getElementById('ui_pose_wrists');
const uiPoseArms = document.getElementById('ui_pose_arms');

const uiPacketPreview = document.getElementById('ui_packet_preview');
const uiSerialStatus = document.getElementById('ui_serial_status');
const uiTxCount = document.getElementById('ui_tx_count');
const serialTerminal = document.getElementById('serial_terminal');

// Configuration State
let activeModel = 'hands'; // 'hands' | 'face' | 'facemesh' | 'pose' | 'holistic'
let showSkeleton = true;
let showPinchLine = true;

// FPS Counter
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;

function updateFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        currentFps = frameCount;
        frameCount = 0;
        lastFpsTime = now;
        if (uiFps) uiFps.textContent = `FPS: ${currentFps}`;
    }
}

// Serial Monitor History & Filter State
const logHistory = []; // Stores { msg, type: 'tx' | 'rx' | 'system' | 'error' }
let logFilterMode = 'ALL'; // 'ALL' | 'TX' | 'RX'
let autoScrollEnabled = true;

function renderSerialMonitor() {
    if (!serialTerminal) return;
    const filtered = logHistory.filter(entry => {
        if (logFilterMode === 'TX') return entry.type === 'tx';
        if (logFilterMode === 'RX') return entry.type === 'rx';
        return true; // 'ALL' shows TX, RX, and system messages
    });
    serialTerminal.value = filtered.map(e => e.msg).join('\n');
    if (autoScrollEnabled) {
        serialTerminal.scrollTop = serialTerminal.scrollHeight;
    }
}

// Initialize SerialBridge
const serialBridge = new SerialBridge({
    baudRate: 115200,
    sendIntervalMs: 50,
    onStatusChange: (connected, baud) => {
        if (uiSerialStatus) {
            uiSerialStatus.value = connected ? `[ONLINE @ ${baud}]` : '[OFFLINE]';
            uiSerialStatus.className = connected
                ? 'tui-input green-168 black-text'
                : 'tui-input red-168 white-text';
        }
        const btnConnect = document.getElementById('btn_serial_connect');
        if (btnConnect) {
            btnConnect.textContent = connected ? 'DISCONNECT [F2]' : 'CONNECT MCU [F2]';
            btnConnect.className = connected
                ? 'tui-button red-168 white-255-text'
                : 'tui-button green-168 black-255-text';
        }
    },
    onLog: (msg, type = 'system') => {
        logHistory.push({ msg, type });
        if (logHistory.length > 200) {
            logHistory.splice(0, logHistory.length - 200);
        }
        renderSerialMonitor();
        if (uiTxCount) uiTxCount.textContent = serialBridge.txCount;
    }
});

// ==================== SIGNAL SMOOTHING FILTER (EMA + DEADBAND) ====================
const smoothState = {};
const SMOOTH_ALPHA = 0.22; // Lower = smoother & more stable (0.15 - 0.30 is ideal)

function stabilizeValue(key, rawVal, deadband = 2) {
    if (smoothState[key] === undefined) {
        smoothState[key] = rawVal;
        return Math.round(rawVal);
    }
    // Exponential Moving Average (Low-Pass Filter)
    const filtered = smoothState[key] + SMOOTH_ALPHA * (rawVal - smoothState[key]);
    // Deadband: Only update locked output if change exceeds threshold
    if (Math.abs(filtered - smoothState[key]) >= deadband * 0.25) {
        smoothState[key] = filtered;
    }
    const lockedKey = key + '_locked';
    if (smoothState[lockedKey] === undefined || Math.abs(smoothState[key] - smoothState[lockedKey]) >= deadband) {
        smoothState[lockedKey] = Math.round(smoothState[key]);
    }
    return smoothState[lockedKey];
}

// Detect each finger state: 1 = Open, 0 = Closed -> [Thumb, Index, Middle, Ring, Pinky]
function getFingerStates(lm) {
    if (!lm || lm.length < 21) return [0, 0, 0, 0, 0];

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const wrist = lm[0];

    // Thumb: compare distance from tip(4) to pinky base(17) vs joint(3) to pinky base(17)
    const thumbOpen = dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.05 ? 1 : 0;

    // 4 Fingers: tip distance to wrist > PIP joint distance to wrist
    const indexOpen = dist(lm[8], wrist) > dist(lm[6], wrist) * 1.05 ? 1 : 0;
    const middleOpen = dist(lm[12], wrist) > dist(lm[10], wrist) * 1.05 ? 1 : 0;
    const ringOpen = dist(lm[16], wrist) > dist(lm[14], wrist) * 1.05 ? 1 : 0;
    const pinkyOpen = dist(lm[20], wrist) > dist(lm[18], wrist) * 1.05 ? 1 : 0;

    return [thumbOpen, indexOpen, middleOpen, ringOpen, pinkyOpen];
}

// Update the Core Hand Readings & Send Selected via Serial
function updateReadings(hasHand, distancePx, states) {
    const handBool = hasHand ? 1 : 0;
    const dist = hasHand ? stabilizeValue('hand_dist', distancePx, 2) : 0;
    const count = states.reduce((sum, v) => sum + v, 0);
    const binaryStr = states.join('');

    if (uiHandDetected) {
        uiHandDetected.value = hasHand ? '[TRUE (1)]' : '[FALSE (0)]';
        uiHandDetected.className = hasHand
            ? 'tui-input green-168 white-text'
            : 'tui-input red-168 white-text';
    }
    if (uiDistance) uiDistance.value = `[${dist} px]`;
    if (uiFingerCount) uiFingerCount.value = `[${count} / 5]`;
    if (uiFingerBinary) uiFingerBinary.value = `[${binaryStr}]`;

    for (let i = 0; i < 5; i++) {
        const box = document.getElementById(`fbox_${i}`);
        const val = document.getElementById(`fval_${i}`);
        if (box) box.className = states[i] ? 'finger-item open' : 'finger-item closed';
        if (val) val.textContent = states[i] ? 'OPEN (1)' : 'SHUT (0)';
    }

    const parts = [];
    const chkHand = document.getElementById('chk_tx_hand');
    const chkDist = document.getElementById('chk_tx_dist');
    const chkCount = document.getElementById('chk_tx_count');
    const chkStates = document.getElementById('chk_tx_states');

    if (chkHand && chkHand.checked) parts.push(`H:${handBool}`);
    if (chkDist && chkDist.checked) parts.push(`D:${dist}`);
    if (chkCount && chkCount.checked) parts.push(`C:${count}`);
    if (chkStates && chkStates.checked) parts.push(`F:${binaryStr}`);

    const packet = parts.join(',');
    if (uiPacketPreview) {
        uiPacketPreview.value = packet || '[NONE]';
    }

    if (packet && serialBridge.isConnected) {
        serialBridge.sendRaw(packet);
    }
}

// Draw Retro BIOS Overlay HUD on Canvas
function drawBiosHud(ctx, labelText) {
    ctx.save();
    ctx.font = '14px "Perfect DOS VGA 437", monospace';
    ctx.fillStyle = 'rgba(0, 0, 168, 0.78)';
    ctx.fillRect(8, 8, 250, 24);
    ctx.strokeStyle = '#00AAAA';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, 250, 24);
    ctx.fillStyle = '#FFFF55';
    ctx.fillText(`MODE: ${labelText} | ${currentFps} FPS`, 14, 25);
    ctx.restore();
}

// ==================== 1. HANDS MODEL ====================
function onResultsHands(results) {
    updateFps();
    const W = canvasElement.width;
    const H = canvasElement.height;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, W, H);

    if (results.image) {
        canvasCtx.drawImage(results.image, 0, 0, W, H);
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (const landmarks of results.multiHandLandmarks) {
            if (showSkeleton && typeof drawConnectors !== 'undefined') {
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00AAAA', lineWidth: 2 });
                drawLandmarks(canvasCtx, landmarks, { color: '#FFFF55', fillColor: '#0000A8', radius: 3 });
            }

            const indexTip = landmarks[8];
            const thumbTip = landmarks[4];
            if (!indexTip || !thumbTip) continue;

            const x1 = indexTip.x * W;
            const y1 = indexTip.y * H;
            const x2 = thumbTip.x * W;
            const y2 = thumbTip.y * H;
            const distance = Math.hypot(x2 - x1, y2 - y1);
            const states = getFingerStates(landmarks);

            if (showPinchLine) {
                canvasCtx.beginPath();
                canvasCtx.arc(x1, y1, 14, 0, 2 * Math.PI);
                canvasCtx.fillStyle = '#FF5555';
                canvasCtx.fill();
                canvasCtx.lineWidth = 2;
                canvasCtx.strokeStyle = '#FFFFFF';
                canvasCtx.stroke();

                canvasCtx.beginPath();
                canvasCtx.arc(x2, y2, 14, 0, 2 * Math.PI);
                canvasCtx.fillStyle = '#55FFFF';
                canvasCtx.fill();
                canvasCtx.stroke();

                canvasCtx.beginPath();
                canvasCtx.moveTo(x1, y1);
                canvasCtx.lineTo(x2, y2);
                canvasCtx.lineWidth = 4;
                canvasCtx.strokeStyle = '#FFFF55';
                canvasCtx.stroke();

                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2 - 12;
                canvasCtx.fillStyle = '#0000A8';
                canvasCtx.fillRect(mx - 45, my - 16, 110, 22);
                canvasCtx.font = '14px "Perfect DOS VGA 437", monospace';
                canvasCtx.fillStyle = '#FFFFFF';
                canvasCtx.fillText(`DIST:${Math.round(distance)}px`, mx - 38, my);
            }

            updateReadings(true, distance, states);
        }
    } else {
        updateReadings(false, 0, [0, 0, 0, 0, 0]);
    }

    drawBiosHud(canvasCtx, 'HANDS TRACKING');
    canvasCtx.restore();
}

// ==================== 2. FACE DETECTION MODEL ====================
function updateFaceReadings(hasFace, cx, cy, boxW, tiltDeg) {
    const faceBool = hasFace ? 1 : 0;
    const x = hasFace ? stabilizeValue('face_x', cx, 3) : 0;
    const y = hasFace ? stabilizeValue('face_y', cy, 3) : 0;
    const w = hasFace ? stabilizeValue('face_w', boxW, 3) : 0;
    const tilt = hasFace ? stabilizeValue('face_tilt', tiltDeg, 1) : 0;

    if (uiFaceDetected) {
        uiFaceDetected.value = hasFace ? '[TRUE (1)]' : '[FALSE (0)]';
        uiFaceDetected.className = hasFace
            ? 'tui-input green-168 white-text'
            : 'tui-input red-168 white-text';
    }
    if (uiFaceXY) uiFaceXY.value = `[X:${x} Y:${y}]`;
    if (uiFaceSize) uiFaceSize.value = `[${w} px]`;
    if (uiFaceTilt) uiFaceTilt.value = `[${tilt} deg]`;

    const parts = [];
    const chkFaceDet = document.getElementById('chk_tx_face_det');
    const chkFaceXY = document.getElementById('chk_tx_face_xy');
    const chkFaceSize = document.getElementById('chk_tx_face_size');
    const chkFaceTilt = document.getElementById('chk_tx_face_tilt');

    if (chkFaceDet && chkFaceDet.checked) parts.push(`FD:${faceBool}`);
    if (chkFaceXY && chkFaceXY.checked) parts.push(`X:${x},Y:${y}`);
    if (chkFaceSize && chkFaceSize.checked) parts.push(`W:${w}`);
    if (chkFaceTilt && chkFaceTilt.checked) parts.push(`T:${tilt}`);

    const packet = parts.join(',');
    if (uiPacketPreview) {
        uiPacketPreview.value = packet || '[NONE]';
    }

    if (packet && serialBridge.isConnected) {
        serialBridge.sendRaw(packet);
    }
}

function onResultsFace(results) {
    updateFps();
    const W = canvasElement.width;
    const H = canvasElement.height;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, W, H);
    if (results.image) canvasCtx.drawImage(results.image, 0, 0, W, H);

    if (results.detections && results.detections.length > 0) {
        const det = results.detections[0];
        if (showSkeleton) {
            drawRectangle(canvasCtx, det.boundingBox, { color: '#55FFFF', lineWidth: 3, fillColor: '#00000000' });
            drawLandmarks(canvasCtx, det.landmarks, { color: '#FFFF55', radius: 4 });
        }

        const cx = det.boundingBox.xCenter * W;
        const cy = det.boundingBox.yCenter * H;
        const boxW = det.boundingBox.width * W;

        // Calculate Head Tilt Angle from Right Eye (landmark 0) and Left Eye (landmark 1)
        let tiltDeg = 0;
        if (det.landmarks && det.landmarks.length >= 2) {
            const eyeR = det.landmarks[0];
            const eyeL = det.landmarks[1];
            const dx = (eyeL.x - eyeR.x) * W;
            const dy = (eyeL.y - eyeR.y) * H;
            tiltDeg = Math.atan2(dy, dx) * (180 / Math.PI);

            if (showPinchLine) {
                // Draw Eye-to-Eye Tilt Line & Face Center Crosshair
                canvasCtx.beginPath();
                canvasCtx.moveTo(eyeR.x * W, eyeR.y * H);
                canvasCtx.lineTo(eyeL.x * W, eyeL.y * H);
                canvasCtx.lineWidth = 3;
                canvasCtx.strokeStyle = '#FFFF55';
                canvasCtx.stroke();

                canvasCtx.strokeStyle = '#55FF55';
                canvasCtx.lineWidth = 2;
                canvasCtx.beginPath();
                canvasCtx.moveTo(cx - 10, cy); canvasCtx.lineTo(cx + 10, cy);
                canvasCtx.moveTo(cx, cy - 10); canvasCtx.lineTo(cx, cy + 10);
                canvasCtx.stroke();
            }
        }

        updateFaceReadings(true, cx, cy, boxW, tiltDeg);
    } else {
        updateFaceReadings(false, 0, 0, 0, 0);
    }

    drawBiosHud(canvasCtx, 'FACE DETECTION');
    canvasCtx.restore();
}

// ==================== 3. FACE MESH MODEL ====================
let smoothEyeEAR = 0.28;
let bothEyesOpenLocked = false;
let mouthOpenLocked = false;

function updateMeshReadings(hasMesh, rawNoseX, rawNoseY, rawYaw, rawPitch, rawMouthRatio, rawCombinedEAR) {
    const meshBool = hasMesh ? 1 : 0;
    const nx = hasMesh ? stabilizeValue('mesh_nx', rawNoseX, 2) : 0;
    const ny = hasMesh ? stabilizeValue('mesh_ny', rawNoseY, 2) : 0;
    const yaw = hasMesh ? stabilizeValue('mesh_yaw', rawYaw, 2) : 0;
    const pitch = hasMesh ? stabilizeValue('mesh_pitch', rawPitch, 2) : 0;

    // Mouth Open Boolean with hysteresis
    if (hasMesh) {
        if (!mouthOpenLocked && rawMouthRatio > 0.065) {
            mouthOpenLocked = true;
        } else if (mouthOpenLocked && rawMouthRatio < 0.045) {
            mouthOpenLocked = false;
        }
    } else {
        mouthOpenLocked = false;
    }
    const mouthBool = mouthOpenLocked ? 1 : 0;

    // Smooth combined EAR of both eyes with hysteresis to prevent flicker
    if (hasMesh) {
        smoothEyeEAR = smoothEyeEAR + 0.35 * (rawCombinedEAR - smoothEyeEAR);
        if (bothEyesOpenLocked && smoothEyeEAR < 0.255) {
            bothEyesOpenLocked = false;
        } else if (!bothEyesOpenLocked && smoothEyeEAR > 0.270) {
            bothEyesOpenLocked = true;
        }
    } else {
        bothEyesOpenLocked = false;
    }
    const eyesBool = bothEyesOpenLocked ? 1 : 0;

    if (uiMeshDetected) {
        uiMeshDetected.value = hasMesh ? '[TRUE (1)]' : '[FALSE (0)]';
        uiMeshDetected.className = hasMesh
            ? 'tui-input green-168 white-text'
            : 'tui-input red-168 white-text';
    }
    if (uiMeshNose) uiMeshNose.value = `[X:${nx} Y:${ny}]`;
    if (uiMeshYawPitch) uiMeshYawPitch.value = `[Y:${yaw} P:${pitch}]`;
    if (uiMeshMouth) {
        uiMeshMouth.value = mouthOpenLocked ? '[TRUE (1)]' : '[FALSE (0)]';
        uiMeshMouth.className = mouthOpenLocked
            ? 'tui-input green-168 white-text'
            : 'tui-input red-168 white-text';
    }
    if (uiMeshEyes) {
        uiMeshEyes.value = bothEyesOpenLocked ? '[TRUE (1)]' : '[FALSE (0)]';
        uiMeshEyes.className = bothEyesOpenLocked
            ? 'tui-input green-168 white-text'
            : 'tui-input red-168 white-text';
    }

    const eboxBoth = document.getElementById('ebox_both');
    const evalBoth = document.getElementById('eval_both');
    if (eboxBoth) eboxBoth.className = bothEyesOpenLocked ? 'finger-item open' : 'finger-item closed';
    if (evalBoth) evalBoth.textContent = bothEyesOpenLocked ? 'TRUE (1)' : 'FALSE (0)';

    const mbox = document.getElementById('mbox_state');
    const mval = document.getElementById('mval_state');
    if (mbox) mbox.className = mouthOpenLocked ? 'finger-item open' : 'finger-item closed';
    if (mval) mval.textContent = mouthOpenLocked ? 'TRUE (1)' : 'FALSE (0)';

    // Build Serial Packet
    const parts = [];
    const chkDet = document.getElementById('chk_tx_mesh_det');
    const chkNose = document.getElementById('chk_tx_mesh_nose');
    const chkYP = document.getElementById('chk_tx_mesh_yawpitch');
    const chkMouth = document.getElementById('chk_tx_mesh_mouth');
    const chkEyes = document.getElementById('chk_tx_mesh_eyes');

    if (chkDet && chkDet.checked) parts.push(`MD:${meshBool}`);
    if (chkNose && chkNose.checked) parts.push(`NX:${nx},NY:${ny}`);
    if (chkYP && chkYP.checked) parts.push(`Y:${yaw},P:${pitch}`);
    if (chkMouth && chkMouth.checked) parts.push(`M:${mouthBool}`);
    if (chkEyes && chkEyes.checked) parts.push(`E:${eyesBool}`);

    const packet = parts.join(',');
    if (uiPacketPreview) {
        uiPacketPreview.value = packet || '[NONE]';
    }

    if (packet && serialBridge.isConnected) {
        serialBridge.sendRaw(packet);
    }
}

function onResultsFaceMesh(results) {
    updateFps();
    const W = canvasElement.width;
    const H = canvasElement.height;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, W, H);
    if (results.image) canvasCtx.drawImage(results.image, 0, 0, W, H);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const lm = results.multiFaceLandmarks[0];

        if (showSkeleton) {
            drawConnectors(canvasCtx, lm, FACEMESH_TESSELATION, { color: '#C0C0C070', lineWidth: 1 });
            drawConnectors(canvasCtx, lm, FACEMESH_RIGHT_EYE, { color: '#FF5555' });
            drawConnectors(canvasCtx, lm, FACEMESH_LEFT_EYE, { color: '#55FF55' });
            drawConnectors(canvasCtx, lm, FACEMESH_FACE_OVAL, { color: '#55FFFF' });
            drawConnectors(canvasCtx, lm, FACEMESH_LIPS, { color: '#FFFF55' });
        }

        const dist2D = (a, b) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);

        // Reference Face Height (Forehead L10 to Chin L152) & Width (Left Cheek L234 to Right Cheek L454)
        const faceH = Math.max(1, dist2D(lm[10], lm[152]));
        const faceW = Math.max(1, dist2D(lm[234], lm[454]));

        // 1. Nose Tip Coordinates (L1)
        const rawNoseX = lm[1].x * W;
        const rawNoseY = lm[1].y * H;

        // 2. Mouth Open Ratio (Upper Lip L13 to Lower Lip L14 normalized by Face Height)
        const mouthDist = dist2D(lm[13], lm[14]);
        const mouthRatio = mouthDist / faceH;

        // 3. Head Yaw (Left/Right) & Pitch (Up/Down)
        const midX = (lm[234].x + lm[454].x) / 2;
        const midY = (lm[10].y + lm[152].y) / 2;
        const rawYaw = ((lm[1].x - midX) / (faceW / W)) * 90;
        const rawPitch = ((midY - lm[1].y) / (faceH / H)) * 90;

        // 4. Combined Both Eyes Aspect Ratio (3 vertical lid pairs per eye)
        const leftV = (dist2D(lm[159], lm[145]) + dist2D(lm[158], lm[153]) + dist2D(lm[160], lm[144])) / 3;
        const leftH = Math.max(1, dist2D(lm[33], lm[133]));
        const rightV = (dist2D(lm[386], lm[374]) + dist2D(lm[385], lm[380]) + dist2D(lm[387], lm[373])) / 3;
        const rightH = Math.max(1, dist2D(lm[362], lm[263]));
        const combinedEAR = ((leftV / leftH) + (rightV / rightH)) / 2;

        if (showPinchLine) {
            // Draw Nose Tip Target Crosshair & Mouth Opening Line
            canvasCtx.strokeStyle = '#55FF55';
            canvasCtx.lineWidth = 2;
            canvasCtx.beginPath();
            canvasCtx.moveTo(rawNoseX - 10, rawNoseY); canvasCtx.lineTo(rawNoseX + 10, rawNoseY);
            canvasCtx.moveTo(rawNoseX, rawNoseY - 10); canvasCtx.lineTo(rawNoseX, rawNoseY + 10);
            canvasCtx.stroke();

            canvasCtx.beginPath();
            canvasCtx.moveTo(lm[13].x * W, lm[13].y * H);
            canvasCtx.lineTo(lm[14].x * W, lm[14].y * H);
            canvasCtx.lineWidth = 3;
            canvasCtx.strokeStyle = '#FFFF55';
            canvasCtx.stroke();
        }

        updateMeshReadings(true, rawNoseX, rawNoseY, rawYaw, rawPitch, mouthRatio, combinedEAR);
    } else {
        updateMeshReadings(false, 0, 0, 0, 0, 0, 0);
    }

    drawBiosHud(canvasCtx, 'FACE MESH 468');
    canvasCtx.restore();
}

// ==================== 4. POSE MODEL ====================
function calcJointAngle2D(A, B, C, W, H) {
    if (!A || !B || !C) return 0;
    const v1x = (A.x - B.x) * W;
    const v1y = (A.y - B.y) * H;
    const v2x = (C.x - B.x) * W;
    const v2y = (C.y - B.y) * H;
    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.hypot(v1x, v1y);
    const mag2 = Math.hypot(v2x, v2y);
    if (mag1 === 0 || mag2 === 0) return 0;
    const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cosTheta) * (180 / Math.PI);
}

function updatePoseReadings(hasPose, rawElL, rawElR, rawShL, rawShR, rawWristsDist, leftUp, rightUp) {
    const poseBool = hasPose ? 1 : 0;
    const elL = hasPose ? stabilizeValue('pose_el_l', rawElL, 3) : 0;
    const elR = hasPose ? stabilizeValue('pose_el_r', rawElR, 3) : 0;
    const shL = hasPose ? stabilizeValue('pose_sh_l', rawShL, 3) : 0;
    const shR = hasPose ? stabilizeValue('pose_sh_r', rawShR, 3) : 0;
    const wDist = hasPose ? stabilizeValue('pose_wdist', rawWristsDist, 4) : 0;
    const lBit = hasPose && leftUp ? 1 : 0;
    const rBit = hasPose && rightUp ? 1 : 0;
    const armsStr = `${lBit}${rBit}`;

    if (uiPoseDetected) {
        uiPoseDetected.value = hasPose ? '[TRUE (1)]' : '[FALSE (0)]';
        uiPoseDetected.className = hasPose
            ? 'tui-input green-168 white-text'
            : 'tui-input red-168 white-text';
    }
    if (uiPoseElbows) uiPoseElbows.value = `[L:${elL}° R:${elR}°]`;
    if (uiPoseShoulders) uiPoseShoulders.value = `[L:${shL}° R:${shR}°]`;
    if (uiPoseWrists) uiPoseWrists.value = `[${wDist} px]`;
    if (uiPoseArms) uiPoseArms.value = `[${armsStr}]`;

    const aboxL = document.getElementById('abox_left');
    const avalL = document.getElementById('aval_left');
    if (aboxL) aboxL.className = lBit ? 'finger-item open' : 'finger-item closed';
    if (avalL) avalL.textContent = lBit ? 'UP (1)' : 'DOWN (0)';

    const aboxR = document.getElementById('abox_right');
    const avalR = document.getElementById('aval_right');
    if (aboxR) aboxR.className = rBit ? 'finger-item open' : 'finger-item closed';
    if (avalR) avalR.textContent = rBit ? 'UP (1)' : 'DOWN (0)';

    // Build Serial Packet
    const parts = [];
    const chkDet = document.getElementById('chk_tx_pose_det');
    const chkElbows = document.getElementById('chk_tx_pose_elbows');
    const chkShoulders = document.getElementById('chk_tx_pose_shoulders');
    const chkWrists = document.getElementById('chk_tx_pose_wrists');
    const chkArms = document.getElementById('chk_tx_pose_arms');

    if (chkDet && chkDet.checked) parts.push(`PD:${poseBool}`);
    if (chkElbows && chkElbows.checked) parts.push(`EL:${elL},ER:${elR}`);
    if (chkShoulders && chkShoulders.checked) parts.push(`SL:${shL},SR:${shR}`);
    if (chkWrists && chkWrists.checked) parts.push(`WD:${wDist}`);
    if (chkArms && chkArms.checked) parts.push(`AR:${armsStr}`);

    const packet = parts.join(',');
    if (uiPacketPreview) {
        uiPacketPreview.value = packet || '[NONE]';
    }

    if (packet && serialBridge.isConnected) {
        serialBridge.sendRaw(packet);
    }
}

function onResultsPose(results) {
    updateFps();
    const W = canvasElement.width;
    const H = canvasElement.height;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, W, H);
    if (results.image) canvasCtx.drawImage(results.image, 0, 0, W, H);

    if (results.poseLandmarks && results.poseLandmarks.length > 16) {
        const lm = results.poseLandmarks;

        if (showSkeleton) {
            drawConnectors(canvasCtx, lm, POSE_CONNECTIONS, { color: '#55FFFF', lineWidth: 3 });
            drawLandmarks(canvasCtx, lm, { color: '#FFFF55', fillColor: '#AA0000', radius: 4 });
        }

        // Key Upper-Body Landmarks (Swapped for Selfie Mirror Mode so Left/Right match user's real arms):
        const shL = lm[12], elL = lm[14], wrL = lm[16], hipL = lm[24];
        const shR = lm[11], elR = lm[13], wrR = lm[15], hipR = lm[23];

        // 1. Elbow Flexion Angles (Shoulder -> Elbow -> Wrist)
        const rawElbowL = calcJointAngle2D(shL, elL, wrL, W, H);
        const rawElbowR = calcJointAngle2D(shR, elR, wrR, W, H);

        // 2. Shoulder Elevation Angles (Hip -> Shoulder -> Elbow)
        const rawShoulderL = calcJointAngle2D(hipL, shL, elL, W, H);
        const rawShoulderR = calcJointAngle2D(hipR, shR, elR, W, H);

        // 3. Wrists Distance (L15 <-> L16)
        const rawWristsDist = Math.hypot((wrL.x - wrR.x) * W, (wrL.y - wrR.y) * H);

        // 4. Hands Raised Boolean (Wrist Y above Shoulder Y)
        const leftUp = wrL.y < shL.y;
        const rightUp = wrR.y < shR.y;

        if (showPinchLine) {
            // Draw Wrists Distance Vector Line
            const x1 = wrL.x * W, y1 = wrL.y * H;
            const x2 = wrR.x * W, y2 = wrR.y * H;
            canvasCtx.beginPath();
            canvasCtx.moveTo(x1, y1);
            canvasCtx.lineTo(x2, y2);
            canvasCtx.lineWidth = 3;
            canvasCtx.strokeStyle = '#FFFF55';
            canvasCtx.stroke();
        }

        updatePoseReadings(true, rawElbowL, rawElbowR, rawShoulderL, rawShoulderR, rawWristsDist, leftUp, rightUp);
    } else {
        updatePoseReadings(false, 0, 0, 0, 0, 0, false, false);
    }

    drawBiosHud(canvasCtx, 'POSE SKELETON');
    canvasCtx.restore();
}

// ==================== MODEL INITIALIZATION & SWITCHER ====================
const models = {
    hands: null,
    face: null,
    facemesh: null,
    pose: null
};

function getOrCreateModel(name) {
    if (models[name]) return models[name];

    if (name === 'hands') {
        const m = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.1/${f}` });
        m.setOptions({ selfieMode: true, maxNumHands: 2, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        m.onResults(onResultsHands);
        models.hands = m;
    } else if (name === 'face') {
        const m = new FaceDetection({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.0/${f}` });
        m.setOptions({ selfieMode: true, minDetectionConfidence: 0.5 });
        m.onResults(onResultsFace);
        models.face = m;
    } else if (name === 'facemesh') {
        const m = new FaceMesh({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.1/${f}` });
        m.setOptions({ selfieMode: true, maxNumFaces: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        m.onResults(onResultsFaceMesh);
        models.facemesh = m;
    } else if (name === 'pose') {
        const m = new Pose({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.2/${f}` });
        m.setOptions({ selfieMode: true, upperBodyOnly: false, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        m.onResults(onResultsPose);
        models.pose = m;
    }
    return models[name];
}

function showArduinoSketch(sketchType) {
    const codeHands = document.getElementById('code_arduino_hands');
    const codeFace = document.getElementById('code_arduino_face');
    const codeMesh = document.getElementById('code_arduino_mesh');
    const codePose = document.getElementById('code_arduino_pose');
    const btnHands = document.getElementById('btn_sketch_hands');
    const btnFace = document.getElementById('btn_sketch_face');
    const btnMesh = document.getElementById('btn_sketch_mesh');
    const btnPose = document.getElementById('btn_sketch_pose');

    if (codeHands) codeHands.style.display = sketchType === 'hands' ? 'block' : 'none';
    if (codeFace) codeFace.style.display = sketchType === 'face' ? 'block' : 'none';
    if (codeMesh) codeMesh.style.display = sketchType === 'facemesh' ? 'block' : 'none';
    if (codePose) codePose.style.display = sketchType === 'pose' ? 'block' : 'none';

    if (btnHands) btnHands.className = sketchType === 'hands' ? 'tui-button blue-168 yellow-255-text' : 'tui-button white-255 black-text';
    if (btnFace) btnFace.className = sketchType === 'face' ? 'tui-button blue-168 yellow-255-text' : 'tui-button white-255 black-text';
    if (btnMesh) btnMesh.className = sketchType === 'facemesh' ? 'tui-button blue-168 yellow-255-text' : 'tui-button white-255 black-text';
    if (btnPose) btnPose.className = sketchType === 'pose' ? 'tui-button blue-168 yellow-255-text' : 'tui-button white-255 black-text';
}

function switchAIModel(modelName) {
    activeModel = modelName;
    getOrCreateModel(modelName);
    serialBridge.onLog(`[SYS] Switched AI Engine to: ${modelName.toUpperCase()}`, "system");

    document.querySelectorAll('.model-select-btn').forEach(btn => {
        if (btn.dataset.model === modelName) {
            btn.className = 'tui-button cyan-168 black-255-text model-select-btn';
        } else {
            btn.className = 'tui-button blue-168 white-255-text model-select-btn';
        }
    });

    // Toggle Readings Panel, Camera Overlay Checkboxes & corresponding Arduino Sketch
    const panelHands = document.getElementById('panel_readings_hands');
    const panelFace = document.getElementById('panel_readings_face');
    const panelMesh = document.getElementById('panel_readings_mesh');
    const panelPose = document.getElementById('panel_readings_pose');

    const lblPinch = document.getElementById('lbl_toggle_pinch');
    const txtSkel = document.getElementById('txt_toggle_skeleton');
    const txtPinch = document.getElementById('txt_toggle_pinch');

    if (panelHands) panelHands.style.display = 'none';
    if (panelFace) panelFace.style.display = 'none';
    if (panelMesh) panelMesh.style.display = 'none';
    if (panelPose) panelPose.style.display = 'none';

    if (modelName === 'face') {
        if (panelFace) panelFace.style.display = 'block';
        if (txtSkel) txtSkel.textContent = 'Draw Face Box';
        if (lblPinch) lblPinch.style.display = 'none';
        showArduinoSketch('face');
    } else if (modelName === 'facemesh') {
        if (panelMesh) panelMesh.style.display = 'block';
        if (txtSkel) txtSkel.textContent = 'Draw Face Mesh';
        if (lblPinch) lblPinch.style.display = 'none';
        showArduinoSketch('facemesh');
    } else if (modelName === 'pose') {
        if (panelPose) panelPose.style.display = 'block';
        if (txtSkel) txtSkel.textContent = 'Draw Pose Skeleton';
        if (txtPinch) txtPinch.textContent = 'Draw Wrists Distance Line';
        if (lblPinch) lblPinch.style.display = 'block';
        showArduinoSketch('pose');
    } else {
        if (panelHands) panelHands.style.display = 'block';
        if (txtSkel) txtSkel.textContent = 'Draw Hand Skeleton';
        if (txtPinch) txtPinch.textContent = 'Draw Distance Line';
        if (lblPinch) lblPinch.style.display = 'block';
        showArduinoSketch('hands');
    }
}

// Start Camera Loop
getOrCreateModel('hands');
const camera = new Camera(videoElement, {
    onFrame: async () => {
        const currentInstance = getOrCreateModel(activeModel);
        if (currentInstance) {
            await currentInstance.send({ image: videoElement });
        }
    },
    width: 640,
    height: 480
});
camera.start();

// ==================== UI EVENT BINDINGS ====================
document.addEventListener('DOMContentLoaded', () => {
    serialBridge.onLog("[SYS] MediaPipe-MCU-Studio v2.0 Ready.", "system");
    serialBridge.onLog("[SYS] Select Baud Rate and press CONNECT MCU [F2].", "system");

    document.querySelectorAll('.model-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchAIModel(btn.dataset.model);
        });
    });

    const btnSketchHands = document.getElementById('btn_sketch_hands');
    const btnSketchFace = document.getElementById('btn_sketch_face');
    const btnSketchMesh = document.getElementById('btn_sketch_mesh');
    const btnSketchPose = document.getElementById('btn_sketch_pose');
    if (btnSketchHands) btnSketchHands.addEventListener('click', () => showArduinoSketch('hands'));
    if (btnSketchFace) btnSketchFace.addEventListener('click', () => showArduinoSketch('face'));
    if (btnSketchMesh) btnSketchMesh.addEventListener('click', () => showArduinoSketch('facemesh'));
    if (btnSketchPose) btnSketchPose.addEventListener('click', () => showArduinoSketch('pose'));

    const btnConnect = document.getElementById('btn_serial_connect');
    if (btnConnect) {
        btnConnect.addEventListener('click', async () => {
            if (serialBridge.isConnected) {
                await serialBridge.disconnect();
            } else {
                const baudSelect = document.getElementById('select_baud');
                const baud = baudSelect ? parseInt(baudSelect.value, 10) : 115200;
                await serialBridge.connect(baud);
            }
        });
    }

    const selectRate = document.getElementById('select_rate');
    if (selectRate) {
        selectRate.addEventListener('change', (e) => {
            serialBridge.sendIntervalMs = parseInt(e.target.value, 10);
            serialBridge.onLog(`[SYS] TX Interval set to ${serialBridge.sendIntervalMs} ms`, "system");
        });
    }

    const chkSkeleton = document.getElementById('chk_skeleton');
    if (chkSkeleton) {
        chkSkeleton.addEventListener('change', (e) => {
            showSkeleton = e.target.checked;
        });
    }

    const chkPinch = document.getElementById('chk_pinch');
    if (chkPinch) {
        chkPinch.addEventListener('change', (e) => {
            showPinchLine = e.target.checked;
        });
    }

    const btnSendCustom = document.getElementById('btn_send_custom');
    const inputCustomCmd = document.getElementById('input_custom_cmd');
    if (btnSendCustom && inputCustomCmd) {
        const sendCmd = () => {
            const cmd = inputCustomCmd.value.trim();
            if (!cmd) return;
            if (serialBridge.isConnected) {
                serialBridge.sendRaw(cmd, true);
            } else {
                serialBridge.onLog(`[SIM-TX] > ${cmd} (Not connected)`, "tx");
            }
            inputCustomCmd.value = '';
        };
        btnSendCustom.addEventListener('click', sendCmd);
        inputCustomCmd.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendCmd();
        });
    }

    const btnClearLog = document.getElementById('btn_clear_log');
    if (btnClearLog) {
        btnClearLog.addEventListener('click', () => {
            logHistory.length = 0;
            if (serialTerminal) serialTerminal.value = '';
        });
    }

    const selectLogFilter = document.getElementById('select_log_filter');
    if (selectLogFilter) {
        selectLogFilter.addEventListener('change', (e) => {
            logFilterMode = e.target.value;
            renderSerialMonitor();
        });
    }

    const chkAutoScroll = document.getElementById('chk_autoscroll');
    if (chkAutoScroll) {
        chkAutoScroll.addEventListener('change', (e) => {
            autoScrollEnabled = e.target.checked;
            if (autoScrollEnabled && serialTerminal) {
                serialTerminal.scrollTop = serialTerminal.scrollHeight;
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'F2') {
            e.preventDefault();
            if (btnConnect) btnConnect.click();
        } else if (e.key === 'F3') {
            e.preventDefault();
            const order = ['hands', 'face', 'facemesh', 'pose'];
            const next = order[(order.indexOf(activeModel) + 1) % order.length];
            switchAIModel(next);
        } else if (e.key === 'F9') {
            e.preventDefault();
            logHistory.length = 0;
            if (serialTerminal) serialTerminal.value = '';
        }
    });
});
