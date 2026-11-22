/*
 * [1: HANDS MODEL] MediaPipe-MCU-Studio -> Arduino / ESP32 Serial Receiver
 * Packet Format: "H:1,D:120,C:5,F:11111\n"
 *   H = Hand Detected Boolean (1 = True / 0 = False)
 *   D = Thumb-Index Distance (px)
 *   C = Open Fingers Count (0..5)
 *   F = 5-Finger Binary State (Thumb, Index, Middle, Ring, Pinky)
 */

bool handDetected = false;
int thumbIndexDist = 0;
int openFingersCount = 0;
String fingersState = "00000";

void setup() {
  Serial.begin(115200);
  Serial.println("MCU_READY: Waiting for MediaPipe HANDS Data...");
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
    String handStr   = getValue(line, "H");
    String distStr   = getValue(line, "D");
    String countStr  = getValue(line, "C");
    String statesStr = getValue(line, "F"); // e.g. "10100"
  } 
}
