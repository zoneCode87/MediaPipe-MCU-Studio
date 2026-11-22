/*
 * [3: FACE MESH MODEL] MediaPipe-MCU-Studio -> Arduino / ESP32 Serial Receiver
 * Packet Format: "MD:1,NX:320,NY:240,Y:10,P:-5,M:0,E:1\n"
 *   MD = Mesh Detected Boolean (1 = True / 0 = False)
 *   NX = Nose Tip X Coordinate (px)
 *   NY = Nose Tip Y Coordinate (px)
 *   Y  = Head Yaw Left/Right Angle (-45..+45 deg)
 *   P  = Head Pitch Up/Down Angle (-45..+45 deg)
 *   M  = Mouth Open Boolean (1 = True [Open] / 0 = False [Closed])
 *   E  = Both Eyes Open Boolean (1 = True [Open] / 0 = False [Closed])
 */

bool meshDetected = false;
int noseX = 0;
int noseY = 0;
int headYaw = 0;
int headPitch = 0;
bool mouthOpen = false;
bool eyesOpen = false;

void setup() {
  Serial.begin(115200);
  Serial.println("MCU_READY: Waiting for MediaPipe FACE MESH Data...");
}

String getValue(String data, String key) {
  int start = data.indexOf(key + ":");
  if (start == -1) return "";
  start += key.length() + 1;
  int end = data.indexOf(",", start);
  if (end == -1) end = data.length();
  return data.substring(start, end);
}

void loop() {
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    String meshStr  = getValue(line, "MD");
    String noseXStr = getValue(line, "NX");
    String noseYStr = getValue(line, "NY");
    String yawStr   = getValue(line, "Y");
    String pitchStr = getValue(line, "P");
    String mouthStr = getValue(line, "M"); // "1" = True (Open), "0" = False (Closed)
    String eyesStr  = getValue(line, "E"); // "1" = True (Open), "0" = False (Closed)
  } 
}
