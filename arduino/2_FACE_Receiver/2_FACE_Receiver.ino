/*
 * [2: FACE MODEL] MediaPipe-MCU-Studio -> Arduino / ESP32 Serial Receiver
 * Packet Format: "FD:1,X:320,Y:240,W:180,T:-5\n"
 *   FD = Face Detected Boolean (1 = True / 0 = False)
 *   X  = Face Center X Coordinate (px)
 *   Y  = Face Center Y Coordinate (px)
 *   W  = Face Box Width / Proximity (px)
 *   T  = Head Tilt Angle in Degrees (-45..+45)
 */

bool faceDetected = false;
int faceX = 0;
int faceY = 0;
int faceWidth = 0;
int headTilt = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("MCU_READY: Waiting for MediaPipe FACE Data...");
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
    String faceStr  = getValue(line, "FD");
    String xStr     = getValue(line, "X");
    String yStr     = getValue(line, "Y");
    String widthStr = getValue(line, "W");
    String tiltStr  = getValue(line, "T");
  } 
}
